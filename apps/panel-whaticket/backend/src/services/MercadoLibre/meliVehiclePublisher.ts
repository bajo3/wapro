import Vehicle from "../../models/Vehicle";
import buildMeliVehiclePayload, { BuildMeliVehiclePayloadOptions } from "../MeliServices/buildMeliVehiclePayload";
import { logger } from "../../utils/logger";
import { meliApiRequest, sanitizeMeliLogPayload } from "./meliClient";
import {
  getMeliTokenHealth,
  MISSING_TOKEN_ROW_MESSAGE,
  MISSING_TOKEN_VALUES_MESSAGE
} from "./meliTokenService";
import { getCategoryBuyingModes, getCategoryDetails, predictVehicleCategories } from "../../helpers/meliCategoriesService";

export const MELI_PUBLISH_DISABLED_MESSAGE =
  "MercadoLibre publishing is disabled. Set MELI_PUBLISH_ENABLED=true to allow real publishing.";

type MeliDeps = {
  request?: (path: string, options?: any) => Promise<{ ok: boolean; status: number; body: any }>;
  publishEnabled?: boolean;
};

type MeliPackCatalogEntry = {
  promotionPackId: string | null;
  listingTypeId: string | null;
  categoryId: string | null;
  domainId: string | null;
  availableListings: number;
  remainingListings: number;
  status: string | null;
  name: string | null;
  packageContent: string | null;
  raw: Record<string, any>;
};

type MeliVehiclePublishPreflight = {
  ok: boolean;
  sellerId: number | null;
  originalCategoryId: string | null;
  finalCategoryId: string | null;
  categorySource: string;
  originalCondition: string | null;
  finalCondition: string | null;
  conditionSource: string;
  originalDomainId: string | null;
  finalDomainId: string | null;
  domainSource: string;
  originalListingTypeId: string | null;
  finalListingTypeId: string | null;
  listingTypeSource: string;
  originalBuyingMode: string;
  finalBuyingMode: string | null;
  buyingModeSource: string;
  packageCatalog: MeliPackCatalogEntry[];
  sellerPackages: MeliPackCatalogEntry[];
  selectedPackage: MeliPackCatalogEntry | null;
  missingFields: string[];
  error?: string;
  statusCode?: number;
};

export type MeliVehicleActionResult = {
  ok: boolean;
  action: "validate" | "dry-run" | "publish" | "sync" | "pause" | "reactivate";
  missingFields: string[];
  warnings: string[];
  fatalErrors: string[];
  payloadPreview: Record<string, any>;
  inputSnapshot?: Record<string, any>;
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
const asString = (value: any): string => String(value ?? "").trim();
const asNumber = (value: any): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const buildVehicleTitle = (vehicle: Partial<Vehicle>): string =>
  [vehicle.brand, vehicle.model, vehicle.version, vehicle.year]
    .map(asString)
    .filter(Boolean)
    .join(" ")
    .trim();

const normalizeVehicleCondition = (value: any): string | null => {
  const normalized = asString(value).toLowerCase();
  if (!normalized) return null;
  if (["used", "usado"].includes(normalized)) return "used";
  if (["new", "nuevo", "0km", "0 km"].includes(normalized)) return "new";
  return normalized;
};

const inferVehicleConditionForPreflight = (
  vehicle: Vehicle,
  domainId: string | null
): { condition: string | null; source: string } => {
  const explicitCondition = normalizeVehicleCondition((vehicle as any).condition);
  if (explicitCondition) {
    return {
      condition: explicitCondition,
      source: "vehicle_field_normalized"
    };
  }

  const normalizedKm = asNumber((vehicle as any).km ?? (vehicle as any).kms ?? (vehicle as any).kilometers ?? (vehicle as any).mileage);
  if (normalizedKm !== null && normalizedKm > 0) {
    return {
      condition: "used",
      source: "km_gt_zero_inferred_used"
    };
  }

  if (domainId === "MLA-CARS_AND_VANS") {
    return {
      condition: "used",
      source: "vehicle_domain_default_used"
    };
  }

  return {
    condition: null,
    source: "missing_explicit_vehicle_condition"
  };
};

const resolveVehicleBuyingMode = (
  categoryId: string | null,
  domainId: string | null,
  allowedBuyingModes: string[]
): { buyingMode: string | null; source: string } => {
  if (allowedBuyingModes.includes("classified")) {
    return {
      buyingMode: "classified",
      source: "category_buying_modes_vehicle_classified"
    };
  }

  if (domainId === "MLA-CARS_AND_VANS" || categoryId === "MLA1744") {
    return {
      buyingMode: "classified",
      source: "vehicle_domain_classified_default"
    };
  }

  return {
    buyingMode: null,
    source: "vehicle_buying_mode_unresolved"
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
  fatalErrors: options.fatalErrors || [],
  payloadPreview: payload,
  inputSnapshot: options.inputSnapshot,
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
    fatalErrors: statusCode >= 400 ? [error] : [],
    apiCalled: false
  });

const extractRemoteSnapshot = (body: any) => ({
  meliItemId: body?.id || null,
  permalink: body?.permalink || null,
  meliStatus: body?.status || null
});

const normalizePackEntry = (entry: any, detail?: any): MeliPackCatalogEntry => {
  const source = detail || entry;
  const availableListings = Math.max(
    0,
    asNumber(
      source?.available_listings ||
      source?.availableListings ||
      source?.available_quantity ||
      source?.available_quantity_limit ||
      source?.remaining_listings ||
      entry?.available_listings ||
      entry?.availableListings ||
      entry?.available_quantity ||
      entry?.available_quantity_limit ||
      entry?.remaining_listings
    ) || 0
  );
  const remainingListings = Math.max(
    0,
    asNumber(source?.remaining_listings || entry?.remaining_listings || availableListings) || 0
  );

  return {
    promotionPackId: asString(
      entry?.promotion_pack_id || entry?.promotionPackId || entry?.package_id || entry?.id
    ) || null,
    listingTypeId: asString(
      source?.listing_type_id ||
      source?.listingTypeId ||
      source?.listing_type ||
      source?.listingType ||
      source?.type ||
      entry?.listing_type_id ||
      entry?.listingTypeId ||
      entry?.listing_type ||
      entry?.listingType ||
      entry?.type
    ) || null,
    categoryId: asString(
      source?.category_id || source?.categoryId || entry?.category_id || entry?.categoryId
    ) || null,
    domainId: asString(
      source?.domain_id || source?.domainId || entry?.domain_id || entry?.domainId
    ) || null,
    availableListings,
    remainingListings,
    status: asString(source?.status || source?.state || entry?.status || entry?.state) || null,
    name: asString(
      entry?.name || entry?.description || entry?.package_name || entry?.packageName || source?.name || source?.description
    ) || null,
    packageContent: asString(entry?.package_content || entry?.packageContent) || null,
    raw: sanitizeMeliLogPayload(entry)
  };
};

const normalizePackList = (body: any): MeliPackCatalogEntry[] => {
  const candidates = Array.isArray(body)
    ? body
    : Array.isArray(body?.results)
      ? body.results
      : Array.isArray(body?.packages)
        ? body.packages
        : Array.isArray(body?.available_packages)
          ? body.available_packages
          : [];

  return candidates
    .flatMap((entry: any) => {
      const listingDetails = Array.isArray(entry?.listing_details) ? entry.listing_details : [];
      if (!listingDetails.length) {
        return [normalizePackEntry(entry)];
      }
      return listingDetails.map((detail: any) => normalizePackEntry(entry, detail));
    })
    .filter((entry: MeliPackCatalogEntry) => entry.listingTypeId || entry.promotionPackId);
};

const isCategoryCompatible = (entry: MeliPackCatalogEntry, categoryId: string | null): boolean =>
  !entry.categoryId || !categoryId || entry.categoryId === categoryId;

const isDomainCompatible = (entry: MeliPackCatalogEntry, domainId: string | null): boolean =>
  !entry.domainId || !domainId || entry.domainId === domainId;

const buildPackageDebugSummary = (
  entry: MeliPackCatalogEntry,
  categoryId: string | null,
  domainId: string | null,
  allowedListingTypes: Set<string>
) => ({
  packageId: entry.promotionPackId,
  listingTypeId: entry.listingTypeId,
  name: entry.name,
  packageContent: entry.packageContent,
  availableListings: entry.availableListings,
  remainingListings: entry.remainingListings,
  categoryId: entry.categoryId,
  domainId: entry.domainId,
  categoryCompatible: isCategoryCompatible(entry, categoryId),
  domainCompatible: isDomainCompatible(entry, domainId),
  listingTypeCompatible: !entry.listingTypeId || allowedListingTypes.size === 0 || allowedListingTypes.has(entry.listingTypeId)
});

const resolveVehicleCategoryForPublish = async (
  vehicle: Vehicle
): Promise<{ categoryId: string | null; domainId: string | null; source: string; details: Record<string, any> | null }> => {
  const explicitCategoryId = asString((vehicle as any).meliCategoryId);
  const explicitDomainId = asString((vehicle as any).meliDomainId);

  if (explicitCategoryId) {
    const details = await getCategoryDetails(explicitCategoryId);
    return {
      categoryId: explicitCategoryId,
      domainId: explicitDomainId || asString(details?.settings?.catalog_domain) || asString(details?.domain_id) || null,
      source: "vehicle_field",
      details
    };
  }

  const title = asString((vehicle as any).title) || buildVehicleTitle(vehicle);
  if (!title) {
    return {
      categoryId: null,
      domainId: explicitDomainId || null,
      source: "missing_vehicle_title",
      details: null
    };
  }

  const predictions = await predictVehicleCategories(title);
  const selected = predictions.find((prediction) => asString(prediction.category_id)) || null;
  const categoryId = asString(selected?.category_id) || null;
  const details = categoryId ? await getCategoryDetails(categoryId) : null;
  const predictedOrExplicitDomainId =
    asString(selected?.domain_id) ||
    explicitDomainId ||
    asString(details?.settings?.catalog_domain) ||
    asString(details?.domain_id) ||
    null;

  if (!categoryId && predictedOrExplicitDomainId === "MLA-CARS_AND_VANS") {
    const fallbackCategoryId = "MLA1744";
    const fallbackDetails = await getCategoryDetails(fallbackCategoryId);
    return {
      categoryId: fallbackCategoryId,
      domainId:
        predictedOrExplicitDomainId ||
        asString(fallbackDetails?.settings?.catalog_domain) ||
        asString(fallbackDetails?.domain_id) ||
        null,
      source: "vehicle_domain_fallback_mla1744",
      details: fallbackDetails
    };
  }

  return {
    categoryId,
    domainId: predictedOrExplicitDomainId,
    source: categoryId ? "predictor_top_result" : "predictor_no_match",
    details
  };
};

const selectVehiclePackage = (
  packageCatalog: MeliPackCatalogEntry[],
  sellerPackages: MeliPackCatalogEntry[],
  categoryId: string | null,
  domainId: string | null
): MeliPackCatalogEntry | null => {
  const allowedListingTypes = new Set(
    packageCatalog
      .map((entry) => entry.listingTypeId)
      .filter(Boolean) as string[]
  );

  return sellerPackages
    .filter((entry) => Boolean(entry.listingTypeId))
    .filter((entry) => entry.remainingListings > 0 || entry.availableListings > 0)
    .filter((entry) => !entry.status || ["active", "published", "usable"].includes(entry.status.toLowerCase()))
    .filter((entry) => !entry.packageContent || entry.packageContent.toLowerCase() === "publications")
    .filter((entry) => isCategoryCompatible(entry, categoryId))
    .filter((entry) => isDomainCompatible(entry, domainId))
    .filter((entry) => allowedListingTypes.size === 0 || allowedListingTypes.has(entry.listingTypeId as string))
    .sort((left, right) => {
      const rightQuota = Math.max(right.remainingListings, right.availableListings);
      const leftQuota = Math.max(left.remainingListings, left.availableListings);
      return rightQuota - leftQuota;
    })[0] || null;
};

export const resolveVehicleMeliPreflight = async (
  vehicle: Vehicle,
  requester: NonNullable<MeliDeps["request"]>
): Promise<MeliVehiclePublishPreflight> => {
  const originalCategoryId = asString((vehicle as any).meliCategoryId) || null;
  const originalDomainId = asString((vehicle as any).meliDomainId) || null;
  const originalCondition = normalizeVehicleCondition((vehicle as any).condition);
  const originalListingTypeId = asString((vehicle as any).meliListingTypeId) || null;
  const originalBuyingMode = "buy_it_now";

  logger.info(
    {
      vehicleId: vehicle.id,
      originalCategoryId,
      originalCondition,
      originalDomainId,
      originalListingTypeId,
      originalBuyingMode,
      hasMeliItemId: Boolean(vehicle.meliItemId)
    },
    "meli.vehicle.preflight.start"
  );

  const meResponse = await requester("/users/me", { method: "GET" });
  if (!meResponse.ok) {
    return {
      ok: false,
      sellerId: null,
      originalCategoryId,
      finalCategoryId: null,
      categorySource: originalCategoryId ? "vehicle_field" : "missing_vehicle_category",
      originalCondition,
      finalCondition: null,
      conditionSource: originalCondition ? "vehicle_field_normalized" : "missing_explicit_vehicle_condition",
      originalDomainId,
      finalDomainId: originalDomainId,
      domainSource: originalDomainId ? "vehicle_field" : "missing_vehicle_domain",
      originalListingTypeId,
      finalListingTypeId: null,
      listingTypeSource: originalListingTypeId ? "vehicle_field" : "missing_vehicle_listing_type",
      originalBuyingMode,
      finalBuyingMode: null,
      buyingModeSource: "vehicle_buying_mode_unresolved",
      packageCatalog: [],
      sellerPackages: [],
      selectedPackage: null,
      missingFields: ["category_id", "condition", "listing_type_id"],
      error: `MercadoLibre /users/me failed (${meResponse.status})`,
      statusCode: 502
    };
  }

  const sellerId = asNumber(meResponse.body?.id);
  if (sellerId === null) {
    return {
      ok: false,
      sellerId: null,
      originalCategoryId,
      finalCategoryId: null,
      categorySource: originalCategoryId ? "vehicle_field" : "missing_vehicle_category",
      originalCondition,
      finalCondition: null,
      conditionSource: originalCondition ? "vehicle_field_normalized" : "missing_explicit_vehicle_condition",
      originalDomainId,
      finalDomainId: originalDomainId,
      domainSource: originalDomainId ? "vehicle_field" : "missing_vehicle_domain",
      originalListingTypeId,
      finalListingTypeId: null,
      listingTypeSource: originalListingTypeId ? "vehicle_field" : "missing_vehicle_listing_type",
      originalBuyingMode,
      finalBuyingMode: null,
      buyingModeSource: "vehicle_buying_mode_unresolved",
      packageCatalog: [],
      sellerPackages: [],
      selectedPackage: null,
      missingFields: ["category_id", "condition", "listing_type_id"],
      error: "MercadoLibre /users/me did not return a valid seller id.",
      statusCode: 502
    };
  }

  const categoryResolution = await resolveVehicleCategoryForPublish(vehicle);
  const finalConditionResolution = inferVehicleConditionForPreflight(vehicle, categoryResolution.domainId);
  const allowedBuyingModes = categoryResolution.categoryId
    ? await getCategoryBuyingModes(categoryResolution.categoryId)
    : [];
  const finalBuyingModeResolution = resolveVehicleBuyingMode(
    categoryResolution.categoryId,
    categoryResolution.domainId,
    allowedBuyingModes
  );

  const packageCatalogResponse = categoryResolution.categoryId
    ? await requester(`/categories/${categoryResolution.categoryId}/classifieds_promotion_packs`, { method: "GET" })
    : { ok: false, status: 400, body: [] };
  const sellerPackagesResponse = await requester(`/users/${sellerId}/classifieds_promotion_packs?package_content=ALL`, {
    method: "GET"
  });
  const packageCatalog = packageCatalogResponse.ok ? normalizePackList(packageCatalogResponse.body) : [];
  const sellerPackages = sellerPackagesResponse.ok ? normalizePackList(sellerPackagesResponse.body) : [];
  const selectedPackage =
    categoryResolution.categoryId && sellerPackagesResponse.ok
      ? selectVehiclePackage(packageCatalog, sellerPackages, categoryResolution.categoryId, categoryResolution.domainId)
      : null;

  const finalCategoryId = categoryResolution.categoryId;
  const finalDomainId = categoryResolution.domainId;
  const finalCondition = finalConditionResolution.condition;
  const finalListingTypeId = selectedPackage?.listingTypeId || null;
  const missingFields = [
    ...(!finalCategoryId ? ["category_id"] : []),
    ...(!finalCondition ? ["condition"] : []),
    ...(!finalListingTypeId ? ["listing_type_id"] : [])
  ];

  logger.info(
    {
      vehicleId: vehicle.id,
      sellerId,
      originalCategoryId,
      finalCategoryId,
      categorySource: categoryResolution.source,
      originalCondition,
      finalCondition,
      conditionSource: finalConditionResolution.source,
      originalListingTypeId,
      finalListingTypeId,
      listingTypeSource: finalListingTypeId ? "seller_package_selection" : "missing_vehicle_listing_type",
      originalBuyingMode,
      finalBuyingMode: finalBuyingModeResolution.buyingMode,
      selectedListingTypeId: selectedPackage?.listingTypeId || null,
      packageCatalogCount: packageCatalog.length,
      missingFields,
      packageCatalog: packageCatalog.map((entry) =>
        buildPackageDebugSummary(
          entry,
          finalCategoryId,
          finalDomainId,
          new Set(packageCatalog.map((catalogEntry) => catalogEntry.listingTypeId).filter(Boolean) as string[])
        )
      ),
      sellerPackages: sellerPackages.map((entry) =>
        buildPackageDebugSummary(
          entry,
          finalCategoryId,
          finalDomainId,
          new Set(packageCatalog.map((catalogEntry) => catalogEntry.listingTypeId).filter(Boolean) as string[])
        )
      )
    },
    "meli.vehicle.preflight.resolved"
  );

  if (!finalCategoryId) {
    return {
      ok: false,
      sellerId,
      originalCategoryId,
      finalCategoryId,
      categorySource: categoryResolution.source,
      originalCondition,
      finalCondition,
      conditionSource: finalConditionResolution.source,
      originalDomainId,
      finalDomainId,
      domainSource: originalDomainId ? "vehicle_field" : "publish_preflight",
      originalListingTypeId,
      finalListingTypeId,
      listingTypeSource: "missing_vehicle_listing_type",
      originalBuyingMode,
      finalBuyingMode: finalBuyingModeResolution.buyingMode,
      buyingModeSource: finalBuyingModeResolution.source,
      packageCatalog,
      sellerPackages,
      selectedPackage: null,
      missingFields,
      error: "Vehicle category could not be resolved for MercadoLibre publish.",
      statusCode: 400
    };
  }

  if (!finalCondition) {
    return {
      ok: false,
      sellerId,
      originalCategoryId,
      finalCategoryId,
      categorySource: categoryResolution.source,
      originalCondition,
      finalCondition,
      conditionSource: finalConditionResolution.source,
      originalDomainId,
      finalDomainId,
      domainSource: originalDomainId ? "vehicle_field" : "publish_preflight",
      originalListingTypeId,
      finalListingTypeId,
      listingTypeSource: finalListingTypeId ? "seller_package_selection" : "missing_vehicle_listing_type",
      originalBuyingMode,
      finalBuyingMode: finalBuyingModeResolution.buyingMode,
      buyingModeSource: finalBuyingModeResolution.source,
      packageCatalog,
      sellerPackages,
      selectedPackage,
      missingFields,
      error: "Vehicle condition is required for MercadoLibre publish.",
      statusCode: 400
    };
  }

  if (categoryResolution.details?.settings?.listing_allowed === false) {
    return {
      ok: false,
      sellerId,
      originalCategoryId,
      finalCategoryId,
      categorySource: categoryResolution.source,
      originalCondition,
      finalCondition,
      conditionSource: finalConditionResolution.source,
      originalDomainId,
      finalDomainId,
      domainSource: originalDomainId ? "vehicle_field" : "publish_preflight",
      originalListingTypeId,
      finalListingTypeId,
      listingTypeSource: finalListingTypeId ? "seller_package_selection" : "missing_vehicle_listing_type",
      originalBuyingMode,
      finalBuyingMode: finalBuyingModeResolution.buyingMode,
      buyingModeSource: finalBuyingModeResolution.source,
      packageCatalog,
      sellerPackages,
      selectedPackage,
      missingFields,
      error: `MercadoLibre category ${categoryResolution.categoryId} does not allow listings.`,
      statusCode: 400
    };
  }

  if (!packageCatalogResponse.ok && finalCategoryId) {
    return {
      ok: false,
      sellerId,
      originalCategoryId,
      finalCategoryId,
      categorySource: categoryResolution.source,
      originalCondition,
      finalCondition,
      conditionSource: finalConditionResolution.source,
      originalDomainId,
      finalDomainId,
      domainSource: originalDomainId ? "vehicle_field" : "publish_preflight",
      originalListingTypeId,
      finalListingTypeId,
      listingTypeSource: finalListingTypeId ? "seller_package_selection" : "missing_vehicle_listing_type",
      originalBuyingMode,
      finalBuyingMode: finalBuyingModeResolution.buyingMode,
      buyingModeSource: finalBuyingModeResolution.source,
      packageCatalog,
      sellerPackages,
      selectedPackage,
      missingFields,
      error: `MercadoLibre vehicle package catalog failed (${packageCatalogResponse.status}).`,
      statusCode: 502
    };
  }

  if (!sellerPackagesResponse.ok) {
    return {
      ok: false,
      sellerId,
      originalCategoryId,
      finalCategoryId,
      categorySource: categoryResolution.source,
      originalCondition,
      finalCondition,
      conditionSource: finalConditionResolution.source,
      originalDomainId,
      finalDomainId,
      domainSource: originalDomainId ? "vehicle_field" : "publish_preflight",
      originalListingTypeId,
      finalListingTypeId,
      listingTypeSource: finalListingTypeId ? "seller_package_selection" : "missing_vehicle_listing_type",
      originalBuyingMode,
      finalBuyingMode: finalBuyingModeResolution.buyingMode,
      buyingModeSource: finalBuyingModeResolution.source,
      packageCatalog,
      sellerPackages,
      selectedPackage,
      missingFields,
      error: `MercadoLibre seller package check failed (${sellerPackagesResponse.status}).`,
      statusCode: 502
    };
  }

  if (!finalListingTypeId) {
    return {
      ok: false,
      sellerId,
      originalCategoryId,
      finalCategoryId,
      categorySource: categoryResolution.source,
      originalCondition,
      finalCondition,
      conditionSource: finalConditionResolution.source,
      originalDomainId,
      finalDomainId,
      domainSource: originalDomainId ? "vehicle_field" : "publish_preflight",
      originalListingTypeId,
      finalListingTypeId,
      listingTypeSource: "missing_vehicle_listing_type",
      originalBuyingMode,
      finalBuyingMode: finalBuyingModeResolution.buyingMode,
      buyingModeSource: finalBuyingModeResolution.source,
      packageCatalog,
      sellerPackages,
      selectedPackage: null,
      missingFields,
      error: "No se pudo resolver paquete/listing_type_id v?lido para este vendedor/categor?a",
      statusCode: 409
    };
  }

  return {
    ok: missingFields.length === 0 && Boolean(finalBuyingModeResolution.buyingMode),
    sellerId,
    originalCategoryId,
    finalCategoryId,
    categorySource: categoryResolution.source,
    originalCondition,
    finalCondition,
    conditionSource: finalConditionResolution.source,
    originalDomainId,
    finalDomainId,
    domainSource: originalDomainId ? "vehicle_field" : "publish_preflight",
    originalListingTypeId,
    finalListingTypeId,
    listingTypeSource: "seller_package_selection",
    originalBuyingMode,
    finalBuyingMode: finalBuyingModeResolution.buyingMode,
    buyingModeSource: finalBuyingModeResolution.source,
    packageCatalog,
    sellerPackages,
    selectedPackage,
    missingFields
  };
};

const buildOptionsFromPreflight = (preflight: MeliVehiclePublishPreflight): BuildMeliVehiclePayloadOptions => ({
  resolvedCategoryId: preflight.finalCategoryId,
  resolvedDomainId: preflight.finalDomainId,
  resolvedCondition: preflight.finalCondition,
  resolvedListingTypeId: preflight.finalListingTypeId,
  resolvedBuyingMode: preflight.finalBuyingMode,
  requireLocation: true
});

const logMeliAction = (
  vehicle: Vehicle,
  action: MeliVehicleActionResult["action"],
  payload: Record<string, any>,
  result: Partial<MeliVehicleActionResult>,
  requestBody?: any
) => {
  const responseBody = sanitizeMeliLogPayload(result.rawResponse);
  const responseCause = Array.isArray((result.rawResponse as any)?.cause)
    ? (result.rawResponse as any).cause
    : [];

  logger.info(
    {
      vehicleId: vehicle.id,
      action,
      hasMeliItemId: Boolean(vehicle.meliItemId),
      meliItemId: vehicle.meliItemId || null,
      category_id: payload.category_id || null,
      listing_type_id: payload.listing_type_id || null,
      status: result.meliStatus || null,
      statusCode: result.statusCode ?? null,
      error: result.error || null,
      message: (result.rawResponse as any)?.message || null,
      cause: responseCause,
      requestPayload: sanitizeMeliLogPayload(requestBody ?? payload),
      responseBody
    },
    "vehicles.ml.action"
  );
};

const buildRequestLogPayload = (
  payload: Record<string, any>,
  descriptionPlainText: string
): Record<string, any> => {
  const description = String(descriptionPlainText || "").trim();
  if (!description) {
    return payload;
  }

  return {
    item: payload,
    description: {
      plain_text: description
    }
  };
};

const normalizeImageArrayForSnapshot = (value: any): any[] => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return trimmed.split(/[\r\n,]+/).map((entry: string) => entry.trim()).filter(Boolean);
    }
  }
  return [];
};

const logVehiclePayloadSnapshot = (vehicle: Vehicle) => {
  const plainVehicle = typeof (vehicle as any).get === "function" ? (vehicle as any).get({ plain: true }) : vehicle;
  const hasImagesField = Object.prototype.hasOwnProperty.call(plainVehicle, "images");
  const hasPicturesField = Object.prototype.hasOwnProperty.call(plainVehicle, "pictures");
  const imagesValue = (plainVehicle as any).images;
  const picturesValue = (plainVehicle as any).pictures;
  const normalizedImages = normalizeImageArrayForSnapshot(imagesValue);
  const normalizedPictures = normalizeImageArrayForSnapshot(picturesValue);

  logger.info(
    {
      vehicleId: vehicle.id,
      hasImagesField,
      imagesType: Array.isArray(imagesValue) ? "array" : typeof imagesValue,
      imagesIsArray: Array.isArray(imagesValue),
      imagesLength: normalizedImages.length,
      hasPicturesField,
      picturesType: Array.isArray(picturesValue) ? "array" : typeof picturesValue,
      picturesLength: normalizedPictures.length
    },
    "meli.vehicle.payload.snapshot"
  );
};

// validate/publish comparten el mismo builder vehicular.
// El listing_type_id de vehiculos se normaliza alli a "classified".
const validateOnly = async (
  vehicle: Vehicle,
  options: BuildMeliVehiclePayloadOptions = {},
  requester: NonNullable<MeliDeps["request"]> = meliApiRequest
): Promise<MeliVehicleActionResult> => {
  logVehiclePayloadSnapshot(vehicle);
  const preflight = await resolveVehicleMeliPreflight(vehicle, requester);
  const mergedOptions = {
    ...options,
    ...buildOptionsFromPreflight(preflight),
    dryRun: options.dryRun
  };
  const local = await buildMeliVehiclePayload(vehicle, mergedOptions);
  const result = buildResult(options.dryRun ? "dry-run" : "validate", vehicle, local.payload, {
    ok: preflight.ok && local.ok,
    missingFields: Array.from(new Set([...(preflight.missingFields || []), ...local.missingFields])),
    warnings: local.warnings,
    fatalErrors: preflight.ok ? local.fatalErrors : Array.from(new Set([...(local.fatalErrors || []), preflight.error || "meli_vehicle_preflight_failed"])),
    apiCalled: false,
    error: preflight.ok ? (local.ok ? null : local.fatalErrors[0] || local.missingFields.join(", ")) : preflight.error || "meli_vehicle_preflight_failed",
    inputSnapshot: {
      vehicleId: vehicle.id,
      meliCategoryId: preflight.finalCategoryId,
      condition: preflight.finalCondition,
      meliListingTypeId: preflight.finalListingTypeId,
      meliDomainId: preflight.finalDomainId,
      buyingMode: preflight.finalBuyingMode,
      categorySource: preflight.categorySource,
      conditionSource: preflight.conditionSource,
      listingTypeSource: preflight.listingTypeSource,
      buyingModeSource: preflight.buyingModeSource,
      originalListingTypeId: local.originalListingTypeId,
      finalListingTypeId: local.finalListingTypeId,
      version: vehicle.version || null,
      vehicleType: vehicle.vehicleType || null,
      fuel: vehicle.fuel || null,
      doors: vehicle.doors ?? null,
      km: vehicle.km ?? null,
      picturesRawType: local.picturesRawType,
      picturesCount: local.picturesCount,
      validPicturesCount: local.validPicturesCount,
      hasDescription: Boolean(local.descriptionPlainText)
    }
  });
  logger.info(
    {
      vehicleId: vehicle.id,
      action: result.action,
      originalCategoryId: preflight.originalCategoryId,
      finalCategoryId: preflight.finalCategoryId,
      categorySource: preflight.categorySource,
      originalCondition: preflight.originalCondition,
      finalCondition: preflight.finalCondition,
      conditionSource: preflight.conditionSource,
      originalListingTypeId: preflight.originalListingTypeId,
      finalListingTypeId: local.finalListingTypeId,
      listingTypeSource: preflight.listingTypeSource,
      originalBuyingMode: preflight.originalBuyingMode,
      finalBuyingMode: preflight.finalBuyingMode,
      selectedListingTypeId: preflight.selectedPackage?.listingTypeId || null,
      packageCatalogCount: preflight.packageCatalog.length,
      ok: result.ok,
      missingFields: result.missingFields,
      warnings: result.warnings,
      fatalErrors: local.fatalErrors
    },
    "vehicles.ml.validation"
  );
  return result;
};

const dryRunOnly = async (vehicle: Vehicle): Promise<MeliVehicleActionResult> => {
  return validateOnly(vehicle, { dryRun: true });
};

const assertPublishable = async (
  vehicle: Vehicle,
  action: MeliVehicleActionResult["action"],
  options: BuildMeliVehiclePayloadOptions = {},
  requester: NonNullable<MeliDeps["request"]> = meliApiRequest
): Promise<MeliVehicleActionResult | null> => {
  const validation = await validateOnly(vehicle, options, requester);
  if (validation.missingFields.length || validation.fatalErrors.length) {
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

const upsertItemDescription = async (
  requester: NonNullable<MeliDeps["request"]>,
  itemId: string,
  plainText: string,
  method: "POST" | "PUT"
): Promise<{ ok: boolean; status: number; body: any } | null> => {
  const description = String(plainText || "").trim();
  if (!itemId || !description) {
    return null;
  }

  return requester(`/items/${itemId}/description`, {
    method,
    body: JSON.stringify({ plain_text: description })
  });
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

export const validateVehicleForMeli = async (vehicle: Vehicle, deps: MeliDeps = {}): Promise<MeliVehicleActionResult> =>
  validateOnly(vehicle, { dryRun: true }, deps.request || meliApiRequest);

export const dryRunVehicleForMeli = async (vehicle: Vehicle, deps: MeliDeps = {}): Promise<MeliVehicleActionResult> =>
  validateOnly(vehicle, { dryRun: true }, deps.request || meliApiRequest);

export const publishVehicleToMeli = async (vehicle: Vehicle, deps: MeliDeps = {}): Promise<MeliVehicleActionResult> => {
  logVehiclePayloadSnapshot(vehicle);
  const requester = deps.request || meliApiRequest;
  let buildOptions: BuildMeliVehiclePayloadOptions = {};
  let localPayload: Record<string, any> = {};

  if (vehicle.meliItemId) {
    const result = buildBlockedResult(
      "publish",
      vehicle,
      localPayload,
      "Vehicle already has MercadoLibre item. Use sync instead.",
      409,
      []
    );
    logMeliAction(vehicle, "publish", localPayload, result);
    return result;
  }

  if (!isPublishingEnabled(deps)) {
    const result = buildBlockedResult("publish", vehicle, localPayload, MELI_PUBLISH_DISABLED_MESSAGE, 503, []);
    logMeliAction(vehicle, "publish", localPayload, result);
    return result;
  }

  const tokenBlocked = await ensureTokenReady("publish", vehicle, localPayload, []);
  if (tokenBlocked) {
    logMeliAction(vehicle, "publish", localPayload, tokenBlocked);
    return tokenBlocked;
  }

  const preflight = await resolveVehicleMeliPreflight(vehicle, requester);
  buildOptions = buildOptionsFromPreflight(preflight);
  const local = await buildMeliVehiclePayload(vehicle, buildOptions);
  localPayload = local.payload;

  if (!preflight.ok) {
    const result = buildBlockedResult(
      "publish",
      vehicle,
      local.payload,
      preflight.error || "meli_vehicle_preflight_failed",
      preflight.statusCode || 400,
      local.warnings,
      Array.from(new Set([...(preflight.missingFields || []), ...local.missingFields]))
    );
    logger.error(
      {
        vehicleId: vehicle.id,
        statusCode: result.statusCode,
        error: result.error,
        missingFields: result.missingFields,
        sellerId: preflight.sellerId,
        categoryId: preflight.finalCategoryId,
        listingTypeId: preflight.finalListingTypeId
      },
      "meli.vehicle.publish.error"
    );
    logMeliAction(vehicle, "publish", local.payload, result);
    return result;
  }

  const blocked = await assertPublishable(vehicle, "publish", buildOptions, requester);
  if (blocked) {
    logger.error(
      {
        vehicleId: vehicle.id,
        statusCode: blocked.statusCode,
        error: blocked.error,
        missingFields: blocked.missingFields,
        fatalErrors: blocked.fatalErrors
      },
      "meli.vehicle.publish.error"
    );
    logMeliAction(vehicle, "publish", local.payload, blocked);
    return blocked;
  }

  if (local.payload.listing_type_id !== preflight.finalListingTypeId) {
    const result = buildBlockedResult(
      "publish",
      vehicle,
      local.payload,
      "Selected MercadoLibre package listing type does not match the final payload.",
      409,
      local.warnings,
      local.missingFields
    );
    logger.error(
      {
        vehicleId: vehicle.id,
        selectedListingTypeId: preflight.finalListingTypeId,
        payloadListingTypeId: local.payload.listing_type_id || null
      },
      "meli.vehicle.publish.error"
    );
    logMeliAction(vehicle, "publish", local.payload, result);
    return result;
  }

  try {
    const response = await requester("/items", {
      method: "POST",
      body: JSON.stringify(local.payload)
    });

    if (!response.ok) {
      const result = buildResult("publish", vehicle, local.payload, {
        ok: false,
        warnings: local.warnings,
        fatalErrors: [],
        apiCalled: true,
        statusCode: response.status,
        rawResponse: response.body,
        error: response.body?.message || `MercadoLibre publish failed (${response.status})`
      });
      logger.error(
        {
          vehicleId: vehicle.id,
          statusCode: response.status,
          error: result.error,
          responseBody: sanitizeMeliLogPayload(response.body)
        },
        "meli.vehicle.publish.error"
      );
      logMeliAction(vehicle, "publish", local.payload, result);
      return result;
    }

    const snapshot = extractRemoteSnapshot(response.body);
    const descriptionResponse = snapshot.meliItemId
      ? await upsertItemDescription(requester, snapshot.meliItemId, local.descriptionPlainText, "POST")
      : null;
    const warnings = [...local.warnings];
    if (descriptionResponse && !descriptionResponse.ok) {
      warnings.push(`description_upload_failed:${descriptionResponse.status}`);
    }

    const result = buildResult("publish", vehicle, local.payload, {
      ok: true,
      warnings,
      fatalErrors: [],
      apiCalled: true,
      rawResponse: descriptionResponse
        ? {
            item: response.body,
            description: descriptionResponse.body
          }
        : response.body,
      ...snapshot
    });
    logMeliAction(vehicle, "publish", local.payload, result, buildRequestLogPayload(local.payload, local.descriptionPlainText));
    return result;
  } catch (error) {
    const result = buildBlockedResult("publish", vehicle, local.payload, toErrorMessage(error), 500, local.warnings);
    logger.error(
      {
        vehicleId: vehicle.id,
        statusCode: 500,
        error: result.error
      },
      "meli.vehicle.publish.error"
    );
    logMeliAction(vehicle, "publish", local.payload, result);
    return result;
  }
};

export const syncVehicleToMeli = async (vehicle: Vehicle, deps: MeliDeps = {}): Promise<MeliVehicleActionResult> => {
  logVehiclePayloadSnapshot(vehicle);
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
        fatalErrors: [],
        apiCalled: true,
        statusCode: response.status,
        rawResponse: response.body,
        error: response.body?.message || `MercadoLibre sync failed (${response.status})`
      });
      logMeliAction(vehicle, "sync", local.payload, result);
      return result;
    }

    const snapshot = extractRemoteSnapshot(response.body);
    const descriptionResponse = snapshot.meliItemId
      ? await upsertItemDescription(requester, snapshot.meliItemId, local.descriptionPlainText, "PUT")
      : null;
    const warnings = [...local.warnings];
    if (descriptionResponse && !descriptionResponse.ok) {
      warnings.push(`description_upload_failed:${descriptionResponse.status}`);
    }
    const result = buildResult("sync", vehicle, local.payload, {
      ok: true,
      warnings,
      fatalErrors: [],
      apiCalled: true,
      rawResponse: descriptionResponse
        ? {
            item: response.body,
            description: descriptionResponse.body
          }
        : response.body,
      meliItemId: snapshot.meliItemId ?? vehicle.meliItemId,
      permalink: snapshot.permalink ?? vehicle.meliPermalink ?? vehicle.permalink ?? null,
      meliStatus: snapshot.meliStatus ?? vehicle.meliStatus ?? null
    });
    logMeliAction(vehicle, "sync", local.payload, result, buildRequestLogPayload(local.payload, local.descriptionPlainText));
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
  logVehiclePayloadSnapshot(vehicle);
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
      fatalErrors: [],
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
        fatalErrors: [],
        apiCalled: true,
        statusCode: response.status,
        rawResponse: response.body,
        error: response.body?.message || `MercadoLibre ${action} failed (${response.status})`
      });
      logMeliAction(vehicle, action, local.payload, result, { status: nextStatus });
      return result;
    }

    const result = buildResult(action, vehicle, local.payload, {
      ok: true,
      warnings: local.warnings,
      fatalErrors: [],
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
