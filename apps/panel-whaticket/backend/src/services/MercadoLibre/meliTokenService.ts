import fetch from "node-fetch";
import pg from "pg";

import { resolveDatabaseUrl } from "../../config/resolveDatabaseUrl";

const MELI_API_URL = process.env.MELI_API_URL || "https://api.mercadolibre.com";
const MELI_TOKEN_URL = `${MELI_API_URL}/oauth/token`;
const TOKEN_EXPIRY_BUFFER_MS = 60_000;
const TOKEN_ID = "main";

export const MISSING_TOKEN_ROW_MESSAGE = "Missing MercadoLibre token row id=main";
export const MISSING_TOKEN_VALUES_MESSAGE = "MercadoLibre token row id=main has no access_token or refresh_token";

export type MeliTokenRow = {
  id: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: number | null;
};

export type MeliTokenHealth = {
  hasTokenRow: boolean;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  expiresAt: number | null;
  isExpired: boolean;
  publishEnabled: boolean;
  canAttemptRefresh: boolean;
  error?: string | null;
};

let pool: pg.Pool | null = null;

const isPublishingEnabled = (): boolean => process.env.MELI_PUBLISH_ENABLED === "true";

const toErrorMessage = (error: any): string => String(error?.message || error || "unknown_error");

const getPool = (): pg.Pool => {
  if (pool) return pool;

  const rawUrl = process.env.SUPABASE_DATABASE_URL || resolveDatabaseUrl();
  if (!rawUrl) {
    throw new Error("SUPABASE_DATABASE_URL or DATABASE_URL is required");
  }

  const ssl = /supabase\.com|sslmode=require/i.test(rawUrl) ? { rejectUnauthorized: false } : undefined;
  pool = new pg.Pool({ connectionString: rawUrl, ssl, max: 3, idleTimeoutMillis: 30_000 });
  return pool;
};

export const readMeliTokenRow = async (): Promise<MeliTokenRow | null> => {
  const { rows } = await getPool().query<MeliTokenRow>(
    "SELECT id, access_token, refresh_token, expires_at FROM meli_tokens WHERE id = $1",
    [TOKEN_ID]
  );
  return rows[0] ?? null;
};

const saveMeliTokenRow = async (accessToken: string, refreshToken: string, expiresAt: number): Promise<void> => {
  await getPool().query(
    `INSERT INTO meli_tokens (id, access_token, refresh_token, expires_at, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (id) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       expires_at = EXCLUDED.expires_at,
       updated_at = now()`,
    [TOKEN_ID, accessToken, refreshToken, expiresAt]
  );
};

export const refreshMeliToken = async (currentRefreshToken: string): Promise<MeliTokenRow> => {
  const clientId = process.env.MELI_CLIENT_ID;
  const clientSecret = process.env.MELI_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("MELI_CLIENT_ID and MELI_CLIENT_SECRET are required for token refresh");
  }

  const response = await fetch(MELI_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: currentRefreshToken
    }).toString()
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Token refresh failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as { access_token: string; refresh_token: string; expires_in: number };
  const expiresAt = Date.now() + data.expires_in * 1000;

  await saveMeliTokenRow(data.access_token, data.refresh_token, expiresAt);

  return {
    id: TOKEN_ID,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: expiresAt
  };
};

export const getValidMeliAccessToken = async (): Promise<string> => {
  let token = await readMeliTokenRow();
  if (!token) {
    throw new Error(MISSING_TOKEN_ROW_MESSAGE);
  }

  if (!token.access_token && !token.refresh_token) {
    throw new Error(MISSING_TOKEN_VALUES_MESSAGE);
  }

  if (token.expires_at !== null && token.expires_at < Date.now() + TOKEN_EXPIRY_BUFFER_MS) {
    if (!token.refresh_token) {
      throw new Error(MISSING_TOKEN_VALUES_MESSAGE);
    }
    token = await refreshMeliToken(token.refresh_token);
  }

  if (!token.access_token) {
    if (!token.refresh_token) {
      throw new Error(MISSING_TOKEN_VALUES_MESSAGE);
    }
    token = await refreshMeliToken(token.refresh_token);
  }

  if (!token.access_token) {
    throw new Error(MISSING_TOKEN_VALUES_MESSAGE);
  }

  return token.access_token;
};

export const getMeliTokenHealth = async (): Promise<MeliTokenHealth> => {
  try {
    const token = await readMeliTokenRow();
    const hasAccessToken = Boolean(token?.access_token);
    const hasRefreshToken = Boolean(token?.refresh_token);
    const expiresAt = token?.expires_at ?? null;
    const isExpired = Boolean(expiresAt && expiresAt < Date.now());
    const canAttemptRefresh = hasRefreshToken && Boolean(process.env.MELI_CLIENT_ID) && Boolean(process.env.MELI_CLIENT_SECRET);

    return {
      hasTokenRow: Boolean(token),
      hasAccessToken,
      hasRefreshToken,
      expiresAt,
      isExpired,
      publishEnabled: isPublishingEnabled(),
      canAttemptRefresh
    };
  } catch (error) {
    return {
      hasTokenRow: false,
      hasAccessToken: false,
      hasRefreshToken: false,
      expiresAt: null,
      isExpired: true,
      publishEnabled: isPublishingEnabled(),
      canAttemptRefresh: false,
      error: toErrorMessage(error)
    };
  }
};

