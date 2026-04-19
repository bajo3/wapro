import fetch from "node-fetch";
import pg from "pg";

import { resolveDatabaseUrl } from "../config/resolveDatabaseUrl";
import Vehicle from "../models/Vehicle";
import buildMeliVehiclePayload from "../services/MeliServices/buildMeliVehiclePayload";
import { logger } from "../utils/logger";

const MELI_API_URL = process.env.MELI_API_URL || "https://api.mercadolibre.com";
const MELI_TOKEN_URL = `${MELI_API_URL}/oauth/token`;
const TOKEN_EXPIRY_BUFFER_MS = 60_000;
const TOKEN_ID = "main";
export const MELI_PUBLISH_DISABLED_MESSAGE =
  "MercadoLibre publishing is disabled. Set MELI_PUBLISH_ENABLED=true to allow real publishing.";
const MISSING_TOKEN_ROW_MESSAGE = "Missing MercadoLibre token row id=main";
const MISSING_TOKEN_VALUES_MESSAGE = "MercadoLibre token row id=main has no access_token or refresh_token";

type MeliTokenRow = {
  id: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: number | null;
};

type MeliDeps = {
  request?: (path: string, options?: any) => Promise<{ ok: boolean; status: number; body: any }>;
  publishEnabled?: boolean;
  tokenRow?: MeliTokenRow | null;
};

export type MeliVehicleActionResult = {
  ok: boolean;
  action: "validate" | "dry-run" | "publish" | "sync" | "pause" | "reactivate";
  missingFields: string[];
  warnings: string[];
  payloadPreview: Record<string, any>;
  apiCalled: boolean;
  meliItemId?: string | null;
  permalink?: string | null;
  meliStatus?: string | null;
  rawResponse?: any;
  error?: string | null;
  statusCode?: number;
};

export type MeliHealthStatus = {
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

const readToken = async (): Promise<MeliTokenRow | null> => {
  const { rows } = await getPool().query<MeliTokenRow>(
    "SELECT id, access_token, refresh_token, expires_at FROM meli_tokens WHERE id = $1",
    [TOKEN_ID]
  );
  return rows[0] ?? null;
};

const getTokenRow = async (deps: MeliDeps = {}): Promise<MeliTokenRow | null> => {
  if (Object.prototype.hasOwnProperty.call(deps, "tokenRow")) {
    return deps.tokenRow ?? null;
  }
  return readToken();
};

const saveToken = async (accessToken: string, refreshToken: string, expiresAt: number): Promise<void> => {
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

const refreshToken = async (currentRefreshToken: string): Promise<MeliTokenRow> => {
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

  const data = await response.json() as { access_token: string; refresh_token: string; expires_in: number };
  const expiresAt = Date.now() + data.expires_in * 1000;

  await saveToken(data.access_token, data.refresh_token, expiresAt);

  return {
    id: TOKEN_ID,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: expiresAt
  };
};

const getAccessToken = async (deps: MeliDeps = {}): Promise<string> => {
  let token = await getTokenRow(deps);
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
    token = await refreshToken(token.refresh_token);
  }

  if (!token.access_token) {
    if (!token.refresh_token) {
      throw new Error(MISSING_TOKEN_VALUES_MESSAGE);
    }
    token = await refreshToken(token.refresh_token);
  }

  if (!token.access_token) {
    throw new Error(MISSING_TOKEN_VALUES_MESSAGE);
  }

  return token.access_token;
};

const sanitizeForLog = (value: any): any => {
  if (Array.isArray(value)) return value.map(sanitizeForLog);
  if (!value || typeof value !== "object") return value;

  return Object.entries(value).reduce<Record<string, any>>((acc, [key, entryValue]) => {
    if (/access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization/i.test(key)) {
      acc[key] = "[REDACTED]";
      return acc;
    }

    acc[key] = sanitizeForLog(entryValue);
    return acc;
  }, {});
};

const toErrorMessage = (error: any): string => String(error?.message || error || "unknown_error");

const isPublishingEnabled = (deps: MeliDeps = {}): boolean =>
  typeof deps.publishEnabled === "boolean" ? deps.publishEnabled : process.env.MELI_PUBLISH_ENABLED === "true";

const buildBlockedResult = (
  action: MeliVehicleActionResult["action"],
  vehicle: Vehicle,
  payload: Record<string, any>,
  error: string,
  statusCode = 400,
  warnings: string[] = [],
  missingFields: string[] = []
): MeliVehicleActionResult =>
  buildResult(action, vehicle, payload, {
    ok: false,
    error,
    statusCode,
    warnings,
    missingFields,
    apiCalled: false
  });

const ensurePublishingEnabled = (
  action: "publish" | "sync" | "pause" | "reactivate",
  vehicle: Vehicle,
  payload: Record<string, any>,
  warnings: string[],
  deps: MeliDeps = {}
): MeliVehicleActionResult | null => {
  if (isPublishingEnabled(deps)) return null;
  return buildBlockedResult(action, vehicle, payload, MELI_PUBLISH_DISABLED_MESSAGE, 503, warnings);
};

const ensureTokenReady = async (
  action: "publish" | "sync" | "pause" | "reactivate",
  vehicle: Vehicle,
  payload: Record<string, any>,
  warnings: string[],
  deps: MeliDeps = {}
): Promise<MeliVehicleActionResult | null> => {
  try {
    const token = await getTokenRow(deps);
    if (!token) {
      return buildBlockedResult(action, vehicle, payload, MISSING_TOKEN_ROW_MESSAGE, 424, warnings);
    }

    if (!token.access_token && !token.refresh_token) {
      return buildBlockedResult(action, vehicle, payload, MISSING_TOKEN_VALUES_MESSAGE, 424, warnings);
    }

    return null;
  } catch (error) {
    return buildBlockedResult(action, vehicle, payload, toErrorMessage(error), 500, warnings);
  }
};

const logMeliAction = (
  vehicle: Vehicle,
  action: MeliVehicleActionResult["action"],
  payload: Record<string, any>,
  result: Partial<MeliVehicleActionResult>,
  requestBody?: any
) => {
  logger.info(
    {
      vehicleId: vehicle.id,
      action,
      hasMeliItemId: Boolean(vehicle.meliItemId),
      meliItemId: vehicle.meliItemId || null,
      category_id: payload.category_id || null,
      listing_type_id: payload.listing_type_id || null,
      status: result.meliStatus || null,
      error: result.error || null,
      requestPayload: sanitizeForLog(requestBody ?? payload),
      responseBody: sanitizeForLog(result.rawResponse)
    },
    "vehicles.ml.action"
  );
};

const meliRequest = async (
  path: string,
  options: any = {},
  deps: MeliDeps = {}
): Promise<{ ok: boolean; status: number; body: any }> => {
  let token = await getAccessToken(deps);
  let response = await fetch(`${MELI_API_URL}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    }
  });

  if (response.status === 401) {
    const current = await getTokenRow(deps);
    if (!current?.refresh_token) throw new Error("401 from MercadoLibre and no token row to refresh.");
    await refreshToken(current.refresh_token);
    token = await getAccessToken(deps);
    response = await fetch(`${MELI_API_URL}${path}`, {
      ...options,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`
      }
    });
  }

  const text = await response.text();
  let body: any = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = text;
  }

  return {
    ok: response.ok,
    status: response.status,
    body
  };
};

const buildResult = (
  action: MeliVehicleActionResult["action"],
  vehicle: Vehicle,
  payload: Record<string, any>,
  options: Partial<MeliVehicleActionResult> = {}
): MeliVehicleActionResult => ({
  ok: Boolean(options.ok),
  action,
  missingFields: options.missingFields || [],
  warnings: options.warnings || [],
  payloadPreview: payload,
  apiCalled: Boolean(options.apiCalled),
  meliItemId: options.meliItemId ?? vehicle.meliItemId ?? null,
  permalink: options.permalink ?? vehicle.meliPermalink ?? vehicle.permalink ?? null,
  meliStatus: options.meliStatus ?? vehicle.meliStatus ?? null,
  rawResponse: options.rawResponse,
  error: options.error ?? null,
  statusCode: options.statusCode
});

const validateOnly = (vehicle: Vehicle): MeliVehicleActionResult => {
  const local = buildMeliVehiclePayload(vehicle);
  return buildResult("validate", vehicle, local.payload, {
    ok: local.ok,
    missingFields: local.missingFields,
    warnings: local.warnings,
    apiCalled: false,
    error: local.ok ? null : local.missingFields.join(", ")
  });
};

const buildDryRunResult = (vehicle: Vehicle): MeliVehicleActionResult => {
  const local = buildMeliVehiclePayload(vehicle);
  return buildResult("dry-run", vehicle, local.payload, {
    ok: local.ok,
    missingFields: local.missingFields,
    warnings: local.warnings,
    apiCalled: false,
    error: local.ok ? null : local.missingFields.join(", ")
  });
};

const assertPublishable = (vehicle: Vehicle, action: MeliVehicleActionResult["action"]): MeliVehicleActionResult | null => {
  const validation = validateOnly(vehicle);
  if (validation.missingFields.length) {
    return {
      ...validation,
      action,
      ok: false,
      apiCalled: false,
      statusCode: 400
    };
  }
  return null;
};

const extractRemoteSnapshot = (body: any) => ({
  meliItemId: body?.id || null,
  permalink: body?.permalink || null,
  meliStatus: body?.status || null
});

export const validateVehicleForMeli = async (vehicle: Vehicle): Promise<MeliVehicleActionResult> => validateOnly(vehicle);

export const dryRunVehicleForMeli = async (vehicle: Vehicle): Promise<MeliVehicleActionResult> => buildDryRunResult(vehicle);

export const getMeliHealthStatus = async (deps: MeliDeps = {}): Promise<MeliHealthStatus> => {
  try {
    const token = await getTokenRow(deps);
    const publishEnabled = isPublishingEnabled(deps);
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
      publishEnabled,
      canAttemptRefresh
    };
  } catch (error) {
    return {
      hasTokenRow: false,
      hasAccessToken: false,
      hasRefreshToken: false,
      expiresAt: null,
      isExpired: true,
      publishEnabled: isPublishingEnabled(deps),
      canAttemptRefresh: false,
      error: toErrorMessage(error)
    };
  }
};

export const publishVehicleToMeli = async (vehicle: Vehicle, deps: MeliDeps = {}): Promise<MeliVehicleActionResult> => {
  const local = buildMeliVehiclePayload(vehicle);
  if (vehicle.meliItemId) {
    const result = buildBlockedResult(
      "publish",
      vehicle,
      local.payload,
      "Vehicle already has MercadoLibre item. Use sync instead.",
      409,
      local.warnings
    );
    logMeliAction(vehicle, "publish", local.payload, result);
    return result;
  }

  const disabled = ensurePublishingEnabled("publish", vehicle, local.payload, local.warnings, deps);
  if (disabled) {
    logMeliAction(vehicle, "publish", local.payload, disabled);
    return disabled;
  }

  const tokenBlocked = await ensureTokenReady("publish", vehicle, local.payload, local.warnings, deps);
  if (tokenBlocked) {
    logMeliAction(vehicle, "publish", local.payload, tokenBlocked);
    return tokenBlocked;
  }

  const blocked = assertPublishable(vehicle, "publish");
  if (blocked) {
    logMeliAction(vehicle, "publish", local.payload, blocked);
    return blocked;
  }

  try {
    const requester = deps.request || ((path: string, options?: any) => meliRequest(path, options, deps));
    const response = await requester("/items", {
      method: "POST",
      body: JSON.stringify(local.payload)
    });

    if (!response.ok) {
      const result = buildResult("publish", vehicle, local.payload, {
        ok: false,
        missingFields: [],
        warnings: local.warnings,
        apiCalled: true,
        rawResponse: response.body,
        error: response.body?.message || `MercadoLibre publish failed (${response.status})`
      });
      logMeliAction(vehicle, "publish", local.payload, result);
      return result;
    }

    const result = buildResult("publish", vehicle, local.payload, {
      ok: true,
      warnings: local.warnings,
      apiCalled: true,
      rawResponse: response.body,
      ...extractRemoteSnapshot(response.body)
    });
    logMeliAction(vehicle, "publish", local.payload, result, local.payload);
    return result;
  } catch (error) {
    const result = buildBlockedResult("publish", vehicle, local.payload, toErrorMessage(error), 500, local.warnings);
    logMeliAction(vehicle, "publish", local.payload, result);
    return result;
  }
};

export const syncVehicleToMeli = async (vehicle: Vehicle, deps: MeliDeps = {}): Promise<MeliVehicleActionResult> => {
  const local = buildMeliVehiclePayload(vehicle);
  const disabled = ensurePublishingEnabled("sync", vehicle, local.payload, local.warnings, deps);
  if (disabled) {
    logMeliAction(vehicle, "sync", local.payload, disabled);
    return disabled;
  }

  const tokenBlocked = await ensureTokenReady("sync", vehicle, local.payload, local.warnings, deps);
  if (tokenBlocked) {
    logMeliAction(vehicle, "sync", local.payload, tokenBlocked);
    return tokenBlocked;
  }

  if (!vehicle.meliItemId) {
    return publishVehicleToMeli(vehicle, deps);
  }

  const blocked = assertPublishable(vehicle, "sync");
  if (blocked) {
    logMeliAction(vehicle, "sync", local.payload, blocked);
    return blocked;
  }

  try {
    const requester = deps.request || ((path: string, options?: any) => meliRequest(path, options, deps));
    const response = await requester(`/items/${vehicle.meliItemId}`, {
      method: "PUT",
      body: JSON.stringify(local.payload)
    });

    if (!response.ok) {
      const result = buildResult("sync", vehicle, local.payload, {
        ok: false,
        warnings: local.warnings,
        apiCalled: true,
        rawResponse: response.body,
        error: response.body?.message || `MercadoLibre sync failed (${response.status})`
      });
      logMeliAction(vehicle, "sync", local.payload, result);
      return result;
    }

    const snapshot = extractRemoteSnapshot(response.body);
    const result = buildResult("sync", vehicle, local.payload, {
      ok: true,
      warnings: local.warnings,
      apiCalled: true,
      rawResponse: response.body,
      meliItemId: snapshot.meliItemId ?? vehicle.meliItemId,
      permalink: snapshot.permalink ?? vehicle.meliPermalink ?? vehicle.permalink ?? null,
      meliStatus: snapshot.meliStatus ?? vehicle.meliStatus ?? null
    });
    logMeliAction(vehicle, "sync", local.payload, result, local.payload);
    return result;
  } catch (error) {
    const result = buildBlockedResult("sync", vehicle, local.payload, toErrorMessage(error), 500, local.warnings);
    logMeliAction(vehicle, "sync", local.payload, result);
    return result;
  }
};

const updateRemoteStatus = async (
  vehicle: Vehicle,
  nextStatus: "paused" | "active",
  action: "pause" | "reactivate",
  deps: MeliDeps = {}
): Promise<MeliVehicleActionResult> => {
  const local = buildMeliVehiclePayload(vehicle);
  const disabled = ensurePublishingEnabled(action, vehicle, local.payload, local.warnings, deps);
  if (disabled) {
    logMeliAction(vehicle, action, local.payload, disabled, { status: nextStatus });
    return disabled;
  }

  const tokenBlocked = await ensureTokenReady(action, vehicle, local.payload, local.warnings, deps);
  if (tokenBlocked) {
    logMeliAction(vehicle, action, local.payload, tokenBlocked, { status: nextStatus });
    return tokenBlocked;
  }

  if (!vehicle.meliItemId) {
    const result = buildResult(action, vehicle, local.payload, {
      ok: false,
      warnings: local.warnings,
      missingFields: [],
      apiCalled: false,
      error: "vehicle_has_no_meli_item",
      statusCode: 409
    });
    logMeliAction(vehicle, action, local.payload, result, { status: nextStatus });
    return result;
  }

  try {
    const requester = deps.request || ((path: string, options?: any) => meliRequest(path, options, deps));
    const response = await requester(`/items/${vehicle.meliItemId}`, {
      method: "PUT",
      body: JSON.stringify({ status: nextStatus })
    });

    if (!response.ok) {
      const result = buildResult(action, vehicle, local.payload, {
        ok: false,
        warnings: local.warnings,
        apiCalled: true,
        rawResponse: response.body,
        error: response.body?.message || `MercadoLibre ${action} failed (${response.status})`
      });
      logMeliAction(vehicle, action, local.payload, result, { status: nextStatus });
      return result;
    }

    const result = buildResult(action, vehicle, local.payload, {
      ok: true,
      warnings: local.warnings,
      apiCalled: true,
      rawResponse: response.body,
      ...extractRemoteSnapshot(response.body),
      meliStatus: response.body?.status || nextStatus
    });
    logMeliAction(vehicle, action, local.payload, result, { status: nextStatus });
    return result;
  } catch (error) {
    const result = buildBlockedResult(action, vehicle, local.payload, toErrorMessage(error), 500, local.warnings);
    logMeliAction(vehicle, action, local.payload, result, { status: nextStatus });
    return result;
  }
};

export const pauseVehicleOnMeli = async (vehicle: Vehicle, deps: MeliDeps = {}): Promise<MeliVehicleActionResult> =>
  updateRemoteStatus(vehicle, "paused", "pause", deps);

export const reactivateVehicleOnMeli = async (vehicle: Vehicle, deps: MeliDeps = {}): Promise<MeliVehicleActionResult> =>
  updateRemoteStatus(vehicle, "active", "reactivate", deps);

export const logMeliVehicleError = (context: string, error: any) => {
  logger.error({ error }, context);
};
