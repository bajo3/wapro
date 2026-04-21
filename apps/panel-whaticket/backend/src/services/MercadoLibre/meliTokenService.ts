import fetch from "node-fetch";
import pg from "pg";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

import { resolveDatabaseUrl } from "../../config/resolveDatabaseUrl";

const MELI_API_URL = process.env.MELI_API_URL || "https://api.mercadolibre.com";
const MELI_TOKEN_URL = `${MELI_API_URL}/oauth/token`;
const TOKEN_EXPIRY_BUFFER_MS = 60_000;
const TOKEN_ID = "main";
const EXTERNAL_SUPABASE_API_ERROR_MESSAGE = "Cannot read external MercadoLibre token from Supabase API.";
const EXTERNAL_DB_ERROR_MESSAGE = "Cannot read external MercadoLibre token database.";
const EXTERNAL_TOKEN_EXPIRED_MESSAGE =
  "MercadoLibre external token expired. Refresh it from the token owner system.";

export const MISSING_TOKEN_ROW_MESSAGE = "Missing MercadoLibre token row id=main";
export const MISSING_TOKEN_VALUES_MESSAGE = "MercadoLibre token row id=main has no access_token";

export type MeliTokenRow = {
  id: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type MeliTokenHealth = {
  hasTokenRow: boolean;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  expiresAt: number | null;
  isExpired: boolean;
  publishEnabled: boolean;
  canAttemptRefresh: boolean;
  source?: MeliTokenSource;
  error?: string | null;
};

type MeliTokenSource = "local" | "external-supabase-js" | "external-database";

let localPool: pg.Pool | null = null;
let externalMeliTokenPool: pg.Pool | null = null;
let externalMeliSupabaseClient: SupabaseClient | null = null;

const isPublishingEnabled = (): boolean => process.env.MELI_PUBLISH_ENABLED === "true";

const toErrorMessage = (error: any): string => String(error?.message || error || "unknown_error");

const hasExternalSupabaseConfig = (): boolean =>
  Boolean(String(process.env.MELI_TOKENS_SUPABASE_URL || "").trim()) &&
  Boolean(String(process.env.MELI_TOKENS_SUPABASE_SERVICE_ROLE_KEY || "").trim());

const hasExternalDatabaseConfig = (): boolean =>
  Boolean(String(process.env.MELI_TOKENS_DATABASE_URL || "").trim());

const getMeliTokenSource = (): MeliTokenSource => {
  if (hasExternalSupabaseConfig()) return "external-supabase-js";
  if (hasExternalDatabaseConfig()) return "external-database";
  return "local";
};

const getMeliTokenRefreshOwner = (): string =>
  String(process.env.MELI_TOKEN_REFRESH_OWNER || "").trim().toLowerCase();

const shouldBlockRefresh = (): boolean =>
  getMeliTokenSource() !== "local" || getMeliTokenRefreshOwner() === "external";

const withSafeSupabaseParams = (rawUrl: string): string => {
  let url = rawUrl;

  try {
    const parsed = new URL(rawUrl);
    if (parsed.password) {
      const decoded = decodeURIComponent(parsed.password);
      parsed.password = encodeURIComponent(decoded);
    }
    if (!/sslmode=/i.test(parsed.toString()) && /supabase\.com/i.test(parsed.toString())) {
      url = `${parsed.toString()}${parsed.toString().includes("?") ? "&" : "?"}sslmode=require&uselibpqcompat=true`;
    } else {
      url = parsed.toString();
    }
  } catch {
    url = rawUrl;
  }

  return url;
};

const buildPool = (rawUrl: string, timeoutMs = 5_000): pg.Pool => {
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
};

const getLocalPool = (): pg.Pool => {
  if (localPool) return localPool;

  const rawUrl = process.env.SUPABASE_DATABASE_URL || resolveDatabaseUrl();
  if (!rawUrl) {
    throw new Error("SUPABASE_DATABASE_URL or DATABASE_URL is required");
  }

  localPool = buildPool(rawUrl);
  return localPool;
};

const getExternalMeliTokenPool = (): pg.Pool => {
  if (externalMeliTokenPool) return externalMeliTokenPool;

  const rawUrl = String(process.env.MELI_TOKENS_DATABASE_URL || "").trim();
  if (!rawUrl) {
    throw new Error("MELI_TOKENS_DATABASE_URL is required");
  }

  externalMeliTokenPool = buildPool(rawUrl);
  return externalMeliTokenPool;
};

const getExternalMeliSupabaseClient = (): SupabaseClient => {
  if (externalMeliSupabaseClient) return externalMeliSupabaseClient;

  const supabaseUrl = String(process.env.MELI_TOKENS_SUPABASE_URL || "").trim();
  const serviceRoleKey = String(process.env.MELI_TOKENS_SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("MELI_TOKENS_SUPABASE_URL and MELI_TOKENS_SUPABASE_SERVICE_ROLE_KEY are required");
  }

  externalMeliSupabaseClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  return externalMeliSupabaseClient;
};

const logMeliTokenMetadata = (token: MeliTokenRow | null, source: MeliTokenSource): void => {
  const expiresAt = token?.expires_at ?? null;
  const isExpired = typeof expiresAt === "number" ? expiresAt <= Date.now() : false;

  console.info("[meliTokenService] token metadata", {
    meliTokenSource: source,
    hasAccessToken: Boolean(token?.access_token),
    hasRefreshToken: Boolean(token?.refresh_token),
    expiresAt,
    isExpired,
    updatedAt: token?.updated_at ?? null
  });
};

const readTokenRowFromPool = async (pool: pg.Pool): Promise<MeliTokenRow | null> => {
  const { rows } = await pool.query<MeliTokenRow>(
    "SELECT id, access_token, refresh_token, expires_at, created_at, updated_at FROM public.meli_tokens WHERE id = $1",
    [TOKEN_ID]
  );
  return rows[0] ?? null;
};

const readTokenRowFromSupabase = async (): Promise<MeliTokenRow | null> => {
  const { data, error } = await getExternalMeliSupabaseClient()
    .schema("public")
    .from("meli_tokens")
    .select("id, access_token, refresh_token, expires_at, created_at, updated_at")
    .eq("id", TOKEN_ID)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as MeliTokenRow | null) ?? null;
};

export const readMeliTokenRow = async (): Promise<MeliTokenRow | null> => {
  const source = getMeliTokenSource();

  try {
    const token =
      source === "external-supabase-js"
        ? await readTokenRowFromSupabase()
        : source === "external-database"
          ? await readTokenRowFromPool(getExternalMeliTokenPool())
          : await readTokenRowFromPool(getLocalPool());

    logMeliTokenMetadata(token, source);
    return token;
  } catch (error) {
    if (source === "external-supabase-js") {
      console.error("[meliTokenService] external Supabase token read failed", {
        meliTokenSource: source,
        error: toErrorMessage(error)
      });
      throw new Error(EXTERNAL_SUPABASE_API_ERROR_MESSAGE);
    }

    if (source === "external-database") {
      console.error("[meliTokenService] external token DB read failed", {
        meliTokenSource: source,
        error: toErrorMessage(error)
      });
      throw new Error(EXTERNAL_DB_ERROR_MESSAGE);
    }

    throw error;
  }
};

const saveMeliTokenRow = async (accessToken: string, refreshToken: string, expiresAt: number): Promise<void> => {
  if (getMeliTokenSource() !== "local") {
    throw new Error("MercadoLibre token writes are disabled for external token source.");
  }

  await getLocalPool().query(
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
  if (shouldBlockRefresh()) {
    const source = getMeliTokenSource();
    throw new Error(
      source !== "local"
        ? EXTERNAL_TOKEN_EXPIRED_MESSAGE
        : "MercadoLibre token refresh is disabled because MELI_TOKEN_REFRESH_OWNER=external."
    );
  }

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
  const source = getMeliTokenSource();

  if (!token) {
    throw new Error(MISSING_TOKEN_ROW_MESSAGE);
  }

  if (!token.access_token) {
    throw new Error(MISSING_TOKEN_VALUES_MESSAGE);
  }

  const isExpired =
    token.expires_at !== null && token.expires_at <= Date.now() + TOKEN_EXPIRY_BUFFER_MS;

  if (isExpired) {
    if (shouldBlockRefresh()) {
      throw new Error(
        source !== "local"
          ? EXTERNAL_TOKEN_EXPIRED_MESSAGE
          : "MercadoLibre token refresh is disabled because MELI_TOKEN_REFRESH_OWNER=external."
      );
    }

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
  const source = getMeliTokenSource();

  try {
    const token = await readMeliTokenRow();
    const hasAccessToken = Boolean(token?.access_token);
    const hasRefreshToken = Boolean(token?.refresh_token);
    const expiresAt = token?.expires_at ?? null;
    const isExpired = Boolean(expiresAt && expiresAt <= Date.now());
    const canAttemptRefresh =
      !shouldBlockRefresh() &&
      hasRefreshToken &&
      Boolean(process.env.MELI_CLIENT_ID) &&
      Boolean(process.env.MELI_CLIENT_SECRET);

    return {
      hasTokenRow: Boolean(token),
      hasAccessToken,
      hasRefreshToken,
      expiresAt,
      isExpired,
      publishEnabled: isPublishingEnabled(),
      canAttemptRefresh,
      source
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
      source,
      error: toErrorMessage(error)
    };
  }
};
