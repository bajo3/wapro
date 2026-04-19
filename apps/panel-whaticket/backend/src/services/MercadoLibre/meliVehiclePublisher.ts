import Vehicle from "../../models/Vehicle";
import buildMeliVehiclePayload from "../MeliServices/buildMeliVehiclePayload";
import { logger } from "../../utils/logger";
import { meliApiRequest, sanitizeMeliLogPayload } from "./meliClient";
import {
  getMeliTokenHealth,
  MISSING_TOKEN_ROW_MESSAGE,
  MISSING_TOKEN_VALUES_MESSAGE
} from "./meliTokenService";

export const MELI_PUBLISH_DISABLED_MESSAGE =
  "MercadoLibre publishing is disabled. Set MELI_PUBLISH_ENABLED=true to allow real publishing.";

type MeliDeps = {
  request?: (path: string, options?: any) => Promise<{ ok: boolean; status: number; body: any }>;
  publishEnabled?: boolean;
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

const isPublishingEnabled = (deps: MeliDeps = {}): boolean =>
  typeof deps.publishEnabled === "boolean" ? deps.publishEnabled : process.env.MELI_PUBLISH_ENABLED === "true";

const toErrorMessage = (error: any): string => String(error?.message || error || "unknown_error");

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

const extractRemoteSnapshot = (body: any) => ({
  meliItemId: body?.id || null,
  permalink: body?.permalink || null,
  meliStatus: body?.status || null
});

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
      requestPayload: sanitizeMeliLogPayload(requestBody ?? payload),
      responseBody: sanitizeMeliLogPayload(result.rawResponse)
    },
    "vehicles.ml.action"
  );
};

const validateOnly = async (vehicle: Vehicle): Promise<MeliVehicleActionResult> => {
  const local = await buildMeliVehiclePayload(vehicle);
  return buildResult("validate", vehicle, local.payload, {
    ok: local.ok,
    missingFields: local.missingFields,
    warnings: local.warnings,
    apiCalled: false,
    error: local.ok ? null : local.missingFields.join(", ")
  });
};

const dryRunOnly = async (vehicle: Vehicle): Promise<MeliVehicleActionResult> => {
  const local = await buildMeliVehiclePayload(vehicle);
  return buildResult("dry-run", vehicle, local.payload, {
    ok: local.ok,
    missingFields: local.missingFields,
    warnings: local.warnings,
    apiCalled: false,
    error: local.ok ? null : local.missingFields.join(", ")
  });
};

const assertPublishable = async (
  vehicle: Vehicle,
  action: MeliVehicleActionResult["action"]
): Promise<MeliVehicleActionResult | null> => {
  const validation = await validateOnly(vehicle);
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

const ensureTokenReady = async (
  action: "publish" | "sync" | "pause" | "reactivate",
  vehicle: Vehicle,
  payload: Record<string, any>,
  warnings: string[]
): Promise<MeliVehicleActionResult | null> => {
  const health = await getMeliTokenHealth();
  if (!health.hasTokenRow) {
    return buildBlockedResult(action, vehicle, payload, MISSING_TOKEN_ROW_MESSAGE, 424, warnings);
  }
  if (!health.hasAccessToken && !health.hasRefreshToken) {
    return buildBlockedResult(action, vehicle, payload, MISSING_TOKEN_VALUES_MESSAGE, 424, warnings);
  }
  return null;
};

export const validateVehicleForMeli = async (vehicle: Vehicle): Promise<MeliVehicleActionResult> => validateOnly(vehicle);

export const dryRunVehicleForMeli = async (vehicle: Vehicle): Promise<MeliVehicleActionResult> => dryRunOnly(vehicle);

export const publishVehicleToMeli = async (vehicle: Vehicle, deps: MeliDeps = {}): Promise<MeliVehicleActionResult> => {
  const local = await buildMeliVehiclePayload(vehicle);

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

  if (!isPublishingEnabled(deps)) {
    const result = buildBlockedResult("publish", vehicle, local.payload, MELI_PUBLISH_DISABLED_MESSAGE, 503, local.warnings);
    logMeliAction(vehicle, "publish", local.payload, result);
    return result;
  }

  const tokenBlocked = await ensureTokenReady("publish", vehicle, local.payload, local.warnings);
  if (tokenBlocked) {
    logMeliAction(vehicle, "publish", local.payload, tokenBlocked);
    return tokenBlocked;
  }

  const blocked = await assertPublishable(vehicle, "publish");
  if (blocked) {
    logMeliAction(vehicle, "publish", local.payload, blocked);
    return blocked;
  }

  try {
    const requester = deps.request || meliApiRequest;
    const response = await requester("/items", {
      method: "POST",
      body: JSON.stringify(local.payload)
    });

    if (!response.ok) {
      const result = buildResult("publish", vehicle, local.payload, {
        ok: false,
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
  const local = await buildMeliVehiclePayload(vehicle);

  if (!isPublishingEnabled(deps)) {
    const result = buildBlockedResult("sync", vehicle, local.payload, MELI_PUBLISH_DISABLED_MESSAGE, 503, local.warnings);
    logMeliAction(vehicle, "sync", local.payload, result);
    return result;
  }

  const tokenBlocked = await ensureTokenReady("sync", vehicle, local.payload, local.warnings);
  if (tokenBlocked) {
    logMeliAction(vehicle, "sync", local.payload, tokenBlocked);
    return tokenBlocked;
  }

  if (!vehicle.meliItemId) {
    return publishVehicleToMeli(vehicle, deps);
  }

  const blocked = await assertPublishable(vehicle, "sync");
  if (blocked) {
    logMeliAction(vehicle, "sync", local.payload, blocked);
    return blocked;
  }

  try {
    const requester = deps.request || meliApiRequest;
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
  const local = await buildMeliVehiclePayload(vehicle);

  if (!isPublishingEnabled(deps)) {
    const result = buildBlockedResult(action, vehicle, local.payload, MELI_PUBLISH_DISABLED_MESSAGE, 503, local.warnings);
    logMeliAction(vehicle, action, local.payload, result, { status: nextStatus });
    return result;
  }

  const tokenBlocked = await ensureTokenReady(action, vehicle, local.payload, local.warnings);
  if (tokenBlocked) {
    logMeliAction(vehicle, action, local.payload, tokenBlocked, { status: nextStatus });
    return tokenBlocked;
  }

  if (!vehicle.meliItemId) {
    const result = buildResult(action, vehicle, local.payload, {
      ok: false,
      warnings: local.warnings,
      apiCalled: false,
      error: "vehicle_has_no_meli_item",
      statusCode: 409
    });
    logMeliAction(vehicle, action, local.payload, result, { status: nextStatus });
    return result;
  }

  try {
    const requester = deps.request || meliApiRequest;
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
