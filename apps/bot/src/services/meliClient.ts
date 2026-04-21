/**
 * meliClient.ts
 *
 * Manages MercadoLibre API access tokens from local or external `meli_tokens`.
 * - Reads token for id="main"
 * - Uses external Supabase API first when configured, then external DB fallback
 * - Blocks refresh when source/owner is external
 * - Never logs token values
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';

const MELI_TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';
const TOKEN_EXPIRY_BUFFER_MS = 60_000;
const TOKEN_ID = 'main';
const EXTERNAL_SUPABASE_API_ERROR_MESSAGE = 'Cannot read external MercadoLibre token from Supabase API.';
const EXTERNAL_DB_ERROR_MESSAGE = 'Cannot read external MercadoLibre token database.';
const EXTERNAL_TOKEN_EXPIRED_MESSAGE =
  'MercadoLibre external token expired. Refresh it from the token owner system.';

type MeliTokenSource = 'local' | 'external-supabase-js' | 'external-database';

interface MeliTokenRow {
  id: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

function getMeliTokenRefreshOwner(): string {
  return String(process.env.MELI_TOKEN_REFRESH_OWNER || '').trim().toLowerCase();
}

function withSafeSupabaseParams(rawUrl: string): string {
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
  } catch {
    url = rawUrl;
  }

  return url;
}

function buildPool(rawUrl: string, timeoutMs = 5_000): pg.Pool {
  const connectionString = withSafeSupabaseParams(rawUrl);
  const ssl = /supabase\.com|sslmode=require/i.test(connectionString) ? { rejectUnauthorized: false } : undefined;

  return new pg.Pool({
    connectionString,
    ssl,
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs,
    statement_timeout: timeoutMs
  });
}

let localPool: pg.Pool | null = null;
let externalMeliTokenPool: pg.Pool | null = null;
let externalMeliSupabaseClient: SupabaseClient | null = null;

function getLocalPool(): pg.Pool {
  if (!localPool) {
    const rawUrl = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
    if (!rawUrl) throw new Error('[meliClient] SUPABASE_DATABASE_URL or DATABASE_URL is required');
    localPool = buildPool(rawUrl);
  }
  return localPool;
}

function hasExternalSupabaseConfig(): boolean {
  return Boolean(String(process.env.MELI_TOKENS_SUPABASE_URL || '').trim())
    && Boolean(String(process.env.MELI_TOKENS_SUPABASE_SERVICE_ROLE_KEY || '').trim());
}

function hasExternalDatabaseConfig(): boolean {
  return Boolean(String(process.env.MELI_TOKENS_DATABASE_URL || '').trim());
}

function getMeliTokenSource(): MeliTokenSource {
  if (hasExternalSupabaseConfig()) return 'external-supabase-js';
  if (hasExternalDatabaseConfig()) return 'external-database';
  return 'local';
}

function shouldBlockRefresh(): boolean {
  return getMeliTokenSource() !== 'local' || getMeliTokenRefreshOwner() === 'external';
}

function getExternalMeliTokenPool(): pg.Pool {
  if (!externalMeliTokenPool) {
    const rawUrl = String(process.env.MELI_TOKENS_DATABASE_URL || '').trim();
    if (!rawUrl) throw new Error('[meliClient] MELI_TOKENS_DATABASE_URL is required');
    externalMeliTokenPool = buildPool(rawUrl);
  }
  return externalMeliTokenPool;
}

function getExternalMeliSupabaseClient(): SupabaseClient {
  if (!externalMeliSupabaseClient) {
    const supabaseUrl = String(process.env.MELI_TOKENS_SUPABASE_URL || '').trim();
    const serviceRoleKey = String(process.env.MELI_TOKENS_SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('[meliClient] MELI_TOKENS_SUPABASE_URL and MELI_TOKENS_SUPABASE_SERVICE_ROLE_KEY are required');
    }

    externalMeliSupabaseClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }

  return externalMeliSupabaseClient;
}

function logMeliTokenMetadata(token: MeliTokenRow | null, source: MeliTokenSource): void {
  const expiresAt = token?.expires_at ?? null;
  const isExpired = typeof expiresAt === 'number' ? expiresAt <= Date.now() : false;

  console.info('[meliClient] token metadata', {
    meliTokenSource: source,
    hasAccessToken: Boolean(token?.access_token),
    hasRefreshToken: Boolean(token?.refresh_token),
    expiresAt,
    isExpired,
    updatedAt: token?.updated_at ?? null
  });
}

async function readTokenRowFromPool(pool: pg.Pool): Promise<MeliTokenRow | null> {
  const { rows } = await pool.query<MeliTokenRow>(
    'SELECT id, access_token, refresh_token, expires_at, created_at, updated_at FROM public.meli_tokens WHERE id = $1',
    [TOKEN_ID]
  );
  return rows[0] ?? null;
}

async function readTokenRowFromSupabase(): Promise<MeliTokenRow | null> {
  const { data, error } = await getExternalMeliSupabaseClient()
    .schema('public')
    .from('meli_tokens')
    .select('id, access_token, refresh_token, expires_at, created_at, updated_at')
    .eq('id', TOKEN_ID)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as MeliTokenRow | null) ?? null;
}

async function readToken(): Promise<MeliTokenRow | null> {
  const source = getMeliTokenSource();

  try {
    const token =
      source === 'external-supabase-js'
        ? await readTokenRowFromSupabase()
        : source === 'external-database'
          ? await readTokenRowFromPool(getExternalMeliTokenPool())
          : await readTokenRowFromPool(getLocalPool());

    logMeliTokenMetadata(token, source);
    return token;
  } catch (error) {
    if (source === 'external-supabase-js') {
      console.error('[meliClient] external Supabase token read failed', {
        meliTokenSource: source,
        error: String((error as Error)?.message || error || 'unknown_error')
      });
      throw new Error(EXTERNAL_SUPABASE_API_ERROR_MESSAGE);
    }

    if (source === 'external-database') {
      console.error('[meliClient] external token DB read failed', {
        meliTokenSource: source,
        error: String((error as Error)?.message || error || 'unknown_error')
      });
      throw new Error(EXTERNAL_DB_ERROR_MESSAGE);
    }

    throw error;
  }
}

async function saveToken(access_token: string, refresh_token: string, expires_at: number): Promise<void> {
  if (getMeliTokenSource() !== 'local') {
    throw new Error('[meliClient] MercadoLibre token writes are disabled for external token source.');
  }

  await getLocalPool().query(
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

async function refreshToken(currentRefreshToken: string): Promise<MeliTokenRow> {
  if (shouldBlockRefresh()) {
    const source = getMeliTokenSource();
    throw new Error(
      source !== 'local'
        ? EXTERNAL_TOKEN_EXPIRED_MESSAGE
        : '[meliClient] MercadoLibre token refresh is disabled because MELI_TOKEN_REFRESH_OWNER=external.'
    );
  }

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

  return {
    id: TOKEN_ID,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at
  };
}

/**
 * Returns a valid access_token, refreshing only when allowed.
 * Throws if no token row exists in meli_tokens.
 */
export async function getAccessToken(): Promise<string> {
  let token = await readToken();
  const source = getMeliTokenSource();

  if (!token) throw new Error('[meliClient] No token found in meli_tokens (id="main"). Seed it first.');
  if (!token.access_token) throw new Error('[meliClient] MercadoLibre token row id="main" has no access_token.');

  const isExpiring = token.expires_at !== null && token.expires_at <= Date.now() + TOKEN_EXPIRY_BUFFER_MS;
  if (isExpiring) {
    if (shouldBlockRefresh()) {
      throw new Error(
        source !== 'local'
          ? EXTERNAL_TOKEN_EXPIRED_MESSAGE
          : '[meliClient] MercadoLibre token refresh is disabled because MELI_TOKEN_REFRESH_OWNER=external.'
      );
    }

    if (!token.refresh_token) {
      throw new Error('[meliClient] MercadoLibre token row id="main" has no refresh_token.');
    }

    token = await refreshToken(token.refresh_token);
  }

  if (!token.access_token) {
    throw new Error('[meliClient] MercadoLibre token row id="main" has no access_token.');
  }

  return token.access_token;
}

/**
 * Wraps a fetch call with one controlled 401 retry using the latest stored access token.
 * It never triggers OAuth refresh when owner/source is external.
 */
export async function meliFetch(url: string, options: RequestInit = {}): Promise<Response> {
  let token = await getAccessToken();
  const headers = { ...(options.headers ?? {}), Authorization: `Bearer ${token}` };

  let res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    const row = await readToken();
    if (!row?.access_token) {
      throw new Error('[meliClient] 401 and no usable access_token is available.');
    }
    const newToken = await getAccessToken();
    const retryHeaders = { ...(options.headers ?? {}), Authorization: `Bearer ${newToken}` };
    res = await fetch(url, { ...options, headers: retryHeaders });
  }

  return res;
}
