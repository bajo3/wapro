/**
 * meliClient.ts
 *
 * Manages MercadoLibre API access tokens stored in Supabase `meli_tokens`.
 * - Reads token for id="main"
 * - Auto-refreshes if expires_at < now + 60s
 * - Updates meli_tokens after refresh
 *
 * Env vars required:
 *   SUPABASE_DATABASE_URL or DATABASE_URL  → Supabase pool
 *   MELI_CLIENT_ID                         → ML app client_id
 *   MELI_CLIENT_SECRET                     → ML app client_secret
 */

import pg from 'pg';

const MELI_TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';
const TOKEN_EXPIRY_BUFFER_MS = 60_000; // refresh 60s before expiry
const TOKEN_ID = 'main';

// ── Pool (Supabase) ────────────────────────────────────────────────────────────

function buildPool(): pg.Pool {
  const rawUrl = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
  if (!rawUrl) throw new Error('[meliClient] SUPABASE_DATABASE_URL or DATABASE_URL is required');

  let url = rawUrl;
  try {
    const u = new URL(rawUrl);
    if (u.password) {
      const decoded = decodeURIComponent(u.password);
      u.password = encodeURIComponent(decoded);
    }
    if (!/sslmode=/i.test(u.toString()) && /supabase\.com/i.test(u.toString())) {
      url = `${u.toString()}${u.toString().includes('?') ? '&' : '?'}sslmode=require&uselibpqcompat=true`;
    } else {
      url = u.toString();
    }
  } catch { /* not a valid URL — use as-is */ }

  const ssl = /supabase\.com|sslmode=require/i.test(url) ? { rejectUnauthorized: false } : undefined;
  return new pg.Pool({ connectionString: url, ssl, max: 3, idleTimeoutMillis: 30_000 });
}

let _pool: pg.Pool | null = null;
function getPool(): pg.Pool {
  if (!_pool) _pool = buildPool();
  return _pool;
}

// ── Token DB ops ───────────────────────────────────────────────────────────────

interface MeliTokenRow {
  id: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

async function readToken(): Promise<MeliTokenRow | null> {
  const { rows } = await getPool().query<MeliTokenRow>(
    'SELECT id, access_token, refresh_token, expires_at FROM meli_tokens WHERE id = $1',
    [TOKEN_ID]
  );
  return rows[0] ?? null;
}

async function saveToken(access_token: string, refresh_token: string, expires_at: number): Promise<void> {
  await getPool().query(
    `INSERT INTO meli_tokens (id, access_token, refresh_token, expires_at, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (id) DO UPDATE SET
       access_token  = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       expires_at    = EXCLUDED.expires_at,
       updated_at    = now()`,
    [TOKEN_ID, access_token, refresh_token, expires_at]
  );
}

// ── Token refresh ──────────────────────────────────────────────────────────────

async function refreshToken(currentRefreshToken: string): Promise<MeliTokenRow> {
  const clientId = process.env.MELI_CLIENT_ID;
  const clientSecret = process.env.MELI_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('[meliClient] MELI_CLIENT_ID and MELI_CLIENT_SECRET are required for token refresh');
  }

  const res = await fetch(MELI_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: currentRefreshToken
    })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[meliClient] Token refresh failed (${res.status}): ${body}`);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  const expires_at = Date.now() + data.expires_in * 1000;
  await saveToken(data.access_token, data.refresh_token, expires_at);

  console.log('[meliClient] Token refreshed, expires_at:', new Date(expires_at).toISOString());

  return {
    id: TOKEN_ID,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Returns a valid access_token, refreshing if needed.
 * Throws if no token row exists in meli_tokens.
 */
export async function getAccessToken(): Promise<string> {
  let token = await readToken();
  if (!token) throw new Error('[meliClient] No token found in meli_tokens (id="main"). Seed it first.');

  const isExpiring = token.expires_at < Date.now() + TOKEN_EXPIRY_BUFFER_MS;
  if (isExpiring) {
    console.log('[meliClient] Token expiring soon, refreshing...');
    token = await refreshToken(token.refresh_token);
  }

  return token.access_token;
}

/**
 * Wraps a fetch call with automatic 401 → refresh retry.
 */
export async function meliFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  const headers = { ...(options.headers ?? {}), Authorization: `Bearer ${token}` };

  let res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    console.warn('[meliClient] Got 401, forcing token refresh...');
    const row = await readToken();
    if (!row) throw new Error('[meliClient] 401 and no token row to refresh');
    await refreshToken(row.refresh_token);
    const newToken = await getAccessToken();
    const retryHeaders = { ...(options.headers ?? {}), Authorization: `Bearer ${newToken}` };
    res = await fetch(url, { ...options, headers: retryHeaders });
  }

  return res;
}
