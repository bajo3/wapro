/**
 * supabaseDb.ts
 *
 * Optional direct connection to Supabase for the vehicles catalog.
 * When SUPABASE_DATABASE_URL is set, VehiclesController uses this pool
 * instead of the main Sequelize connection — catalog reads/writes always
 * reflect Supabase truth without needing a sync script.
 *
 * Use the Supabase Pooler URL (port 6543, transaction mode) for best results:
 *   postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
 */

import pg from "pg";

const { Pool } = pg;

function encodePasswordInUrl(url: string): string {
  if (!url) return url;
  try {
    const u = new URL(url);
    if (u.password) {
      const decoded = decodeURIComponent(u.password);
      u.password = encodeURIComponent(decoded);
    }
    return u.toString();
  } catch {
    return url;
  }
}

function withLibpqCompat(url: string): string {
  if (!url) return url;
  if (!/sslmode=/i.test(url)) return url;
  if (/uselibpqcompat=/i.test(url)) return url;
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}uselibpqcompat=true`;
}

function shouldRelaxTls(url: string): boolean {
  return /sslmode=(require|verify-ca|verify-full|prefer)/i.test(url) || /\.supabase\.com/i.test(url);
}

let _supabasePool: pg.Pool | null = null;

export function getSupabasePool(): pg.Pool | null {
  if (_supabasePool) return _supabasePool;

  /**
   * Derive a connection string for Supabase:
   *   1. Prefer the explicit SUPABASE_DATABASE_URL env.
   *   2. Fall back to DATABASE_URL if it appears to be a Supabase connection.
   *      Many deployments already expose the DB via DATABASE_URL; in those
   *      cases no additional env var was set for the panel, leading to the
   *      vehicles endpoint hitting the main Railway DB and returning 0 rows.
   *
   * We intentionally avoid using DATABASE_URL for non-Supabase hosts to
   * prevent accidental writes to the wrong database. The heuristic is
   * conservative: we only fall back when the URL contains ".supabase".
   */
  let rawUrl = process.env.SUPABASE_DATABASE_URL;
  if (!rawUrl) {
    const fallback = process.env.DATABASE_URL || process.env.DB_URL;
    if (fallback && /supabase/i.test(fallback)) {
      rawUrl = fallback;
    }
  }
  if (!rawUrl) return null;

  try {
    const connStr = withLibpqCompat(encodePasswordInUrl(rawUrl));
    const ssl = shouldRelaxTls(connStr) ? { rejectUnauthorized: false } : undefined;
    _supabasePool = new Pool({
      connectionString: connStr,
      ssl,
      // Keep small — Supabase free tier has ~15 concurrent connection limit
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000
    });
    _supabasePool.on("error", (err) => {
      console.error("[supabasePool] idle client error:", err.message);
    });
    console.log("[supabaseDb] Pool initialized — vehicles will be read from Supabase directly");
    return _supabasePool;
  } catch (e) {
    console.error("[supabaseDb] Failed to initialize pool:", e);
    return null;
  }
}
