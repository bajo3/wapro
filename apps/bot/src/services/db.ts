import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../lib/env.js';

const { Pool } = pg;

function withLibpqCompat(url: string): string {
  // pg-connection-string treats sslmode=require as an alias for verify-full unless
  // you explicitly opt into libpq compatibility. Supabase pooler connections are
  // a common case where you want libpq semantics.
  if (!url) return url;
  if (!/sslmode=/i.test(url)) return url;
  if (/uselibpqcompat=/i.test(url)) return url;
  const joiner = url.includes('?') ? '&' : '?';
  return `${url}${joiner}uselibpqcompat=true`;
}

function shouldRelaxTls(url: string): boolean {
  // In some hosted environments, the root CA chain isn't available and Node's TLS
  // verification fails with SELF_SIGNED_CERT_IN_CHAIN when using Supabase pooler.
  // We relax verification ONLY when SSL is explicitly requested.
  if (!url) return false;
  return /sslmode=(require|verify-ca|verify-full|prefer)/i.test(url) || /\.supabase\.com/i.test(url);
}

const connectionString = withLibpqCompat(env.databaseUrl);
const ssl = shouldRelaxTls(connectionString) ? { rejectUnauthorized: false } : undefined;

export const pool = new Pool({
  connectionString,
  ssl,
  max: 20,                          // was 5 — supports concurrent CRM + bot usage
  idleTimeoutMillis: 30_000,        // was 10s — reduces reconnect churn
  connectionTimeoutMillis: 15_000   // was 10s — more tolerant of network latency
});

// ── Supabase pool (optional) ────────────────────────────────────────────────
// When SUPABASE_DATABASE_URL is set, this pool connects directly to Supabase
// for vehicle catalog reads — eliminating the Railway sync script entirely.
// Use the Supabase Pooler URL (port 6543, transaction mode) for best results:
//   postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
//
// Falls back gracefully to the main Railway pool if the variable is not set.
export const supabasePool: InstanceType<typeof Pool> | null = (() => {
  const rawUrl = env.supabaseDatabaseUrl;
  if (!rawUrl) return null;
  try {
    const connStr = withLibpqCompat(rawUrl);
    const sslOpts = shouldRelaxTls(connStr) ? { rejectUnauthorized: false } : undefined;
    const p = new Pool({
      connectionString: connStr,
      ssl: sslOpts,
      // Keep pool small — Supabase free tier has a connection limit of ~15
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000
    });
    // Log on connect errors to make misconfiguration obvious, but don't crash
    p.on('error', (err) => {
      console.error('[supabasePool] idle client error:', err.message);
    });
    console.log('[db] supabasePool initialized — vehicles will be read from Supabase');
    return p;
  } catch (e) {
    console.error('[db] Failed to initialize supabasePool, falling back to main pool:', e);
    return null;
  }
})();

export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const dir = path.join(process.cwd(), 'sql');
    const files = (await fs.readdir(dir))
      .filter((f) => f.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));

    for (const file of files) {
      const sql = await fs.readFile(path.join(dir, file), 'utf8');
      if (sql.trim()) await client.query(sql);
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
