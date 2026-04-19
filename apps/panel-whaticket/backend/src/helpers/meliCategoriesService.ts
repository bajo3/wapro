import fetch from "node-fetch";

import Vehicle from "../models/Vehicle";
import { meliApiRequest, sanitizeMeliLogPayload } from "../services/MercadoLibre/meliClient";
import { logger } from "../utils/logger";

const MELI_API_URL = process.env.MELI_API_URL || "https://api.mercadolibre.com";
const MELI_SITE_ID = process.env.MELI_SITE_ID || "MLA";
const CATEGORY_CACHE_TTL_MS = 15 * 60 * 1000;

type CachedValue<T> = {
  expiresAt: number;
  value: T;
};

type MeliReadResponse<T = any> = {
  ok: boolean;
  status: number;
  body: T;
  usedAuth: boolean;
};

type MeliCategoryPath = {
  id?: string;
  name?: string;
};

export type MeliPredictedCategory = {
  category_id: string | null;
  category_name: string | null;
  domain_id: string | null;
  path: string | null;
  probability: number | null;
  confidence: number | null;
  raw: Record<string, any>;
};

export type MeliCategoryAttribute = {
  id: string;
  name: string;
  tags?: Record<string, any>;
  hierarchy?: string | null;
  value_type?: string | null;
  value_max_length?: number | null;
  values?: Array<Record<string, any>>;
  raw: Record<string, any>;
};

export type VehicleAttributeMapping = {
  attributes: Array<Record<string, any>>;
  requiredAttributes: MeliCategoryAttribute[];
  recommendedAttributes: MeliCategoryAttribute[];
  optionalAttributes: MeliCategoryAttribute[];
  missingRequired: string[];
  missingRecommended: string[];
};

const cache = new Map<string, CachedValue<any>>();

const getCached = <T>(key: string): T | null => {
  const current = cache.get(key);
  if (!current) return null;
  if (current.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return current.value as T;
};

const setCached = <T>(key: string, value: T, ttlMs = CATEGORY_CACHE_TTL_MS): T => {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs
  });
  return value;
};

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

const summarizePath = (pathFromRoot: any): string | null => {
  if (!Array.isArray(pathFromRoot) || !pathFromRoot.length) return null;
  return pathFromRoot
    .map((item: MeliCategoryPath) => asString(item?.name || item?.id))
    .filter(Boolean)
    .join(" > ");
};

const normalizeCategoryAttribute = (attribute: any): MeliCategoryAttribute => ({
  id: asString(attribute?.id),
  name: asString(attribute?.name),
  tags: attribute?.tags && typeof attribute.tags === "object" ? attribute.tags : {},
  hierarchy: asString(attribute?.hierarchy) || null,
  value_type: asString(attribute?.value_type) || null,
  value_max_length: asNumber(attribute?.value_max_length),
  values: Array.isArray(attribute?.values) ? attribute.values : [],
  raw: sanitizeMeliLogPayload(attribute)
});

const shouldRequireAuth = (status: number, body: any): boolean => {
  if (status === 401 || status === 403) return true;
  const message = asString(body?.message || body?.error || body);
  return /authorization|required|forbidden|unauthorized/i.test(message);
};

const readMeliPath = async <T = any>(path: string): Promise<MeliReadResponse<T>> => {
  const url = `${MELI_API_URL}${path}`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json"
      }
    });

    const text = await response.text();
    let body: any = text;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = text;
    }

    if (response.ok) {
      return {
        ok: true,
        status: response.status,
        body,
        usedAuth: false
      };
    }

    if (!shouldRequireAuth(response.status, body)) {
      return {
        ok: false,
        status: response.status,
        body,
        usedAuth: false
      };
    }
  } catch (error) {
    logger.warn({ error, path }, "meli.categories.public_read.failed");
  }

  const authResponse = await meliApiRequest(path, { method: "GET" });
  return {
    ...authResponse,
    usedAuth: true
  };
};

const getOrLoad = async <T>(cacheKey: string, loader: () => Promise<T>): Promise<T> => {
  const cached = getCached<T>(cacheKey);
  if (cached !== null) return cached;
  const loaded = await loader();
  return setCached(cacheKey, loaded);
};

const isRequiredAttribute = (attribute: MeliCategoryAttribute): boolean =>
  Boolean(attribute.tags?.required || attribute.tags?.catalog_required);

const isRecommendedAttribute = (attribute: MeliCategoryAttribute): boolean =>
  !isRequiredAttribute(attribute) &&
  (attribute.hierarchy === "RECOMMENDED" || Boolean(attribute.tags?.allow_variations) || Boolean(attribute.tags?.defines_picture));

const isValuePresent = (value: any): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return asString(value).length > 0;
  return Boolean(value);
};

const VEHICLE_ATTRIBUTE_ALIASES: Record<string, Array<(vehicle: Vehicle) => any>> = {
  BRAND: [(vehicle) => vehicle.brand],
  MODEL: [(vehicle) => vehicle.model],
  YEAR: [(vehicle) => vehicle.year],
  VEHICLE_YEAR: [(vehicle) => vehicle.year],
  KILOMETERS: [(vehicle) => (asString(vehicle.condition).toLowerCase() === "used" ? vehicle.km : null)],
  VEHICLE_MILEAGE: [(vehicle) => (asString(vehicle.condition).toLowerCase() === "used" ? vehicle.km : null)],
  VERSION: [(vehicle) => vehicle.version],
  FUEL_TYPE: [(vehicle) => vehicle.fuel],
  TRANSMISSION: [(vehicle) => vehicle.transmission],
  COLOR: [(vehicle) => vehicle.color],
  DOORS: [(vehicle) => vehicle.doors],
  ENGINE: [(vehicle) => vehicle.engine],
  ENGINE_DISPLACEMENT: [(vehicle) => vehicle.engine],
  BODY_TYPE: [(vehicle) => vehicle.bodyType],
  VEHICLE_TYPE: [(vehicle) => vehicle.vehicleType],
  TRACTION_CONTROL: [(vehicle) => vehicle.traction],
  TRACTION_TYPE: [(vehicle) => vehicle.traction]
};

const resolveVehicleAttributeValue = (vehicle: Vehicle, attribute: MeliCategoryAttribute): any => {
  const candidates = [
    asString(attribute.id).toUpperCase(),
    asString(attribute.name).toUpperCase().replace(/[^A-Z0-9]+/g, "_")
  ].filter(Boolean);

  for (const key of candidates) {
    const resolvers = VEHICLE_ATTRIBUTE_ALIASES[key];
    if (!resolvers) continue;
    for (const resolver of resolvers) {
      const value = resolver(vehicle);
      if (isValuePresent(value)) return value;
    }
  }

  return null;
};

const mergeCustomAttributes = (
  mappedAttributes: Array<Record<string, any>>,
  customAttributes: any[]
): Array<Record<string, any>> => {
  const seen = new Set(
    mappedAttributes
      .map((attribute) => asString(attribute.id || attribute.name).toUpperCase())
      .filter(Boolean)
  );

  const extras = customAttributes
    .filter((attribute) => attribute && typeof attribute === "object")
    .filter((attribute) => {
      const key = asString(attribute.id || attribute.name).toUpperCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return [...mappedAttributes, ...extras];
};

export const predictVehicleCategories = async (title: string): Promise<MeliPredictedCategory[]> => {
  const query = asString(title);
  if (!query) return [];

  const response = await readMeliPath<any[]>(`/sites/${MELI_SITE_ID}/domain_discovery/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) {
    const errorBody: any = response.body;
    throw new Error(asString(errorBody?.message || errorBody?.error || "meli_category_predict_failed"));
  }

  const list = Array.isArray(response.body) ? response.body : [];
  return list.map((item: any) => ({
    category_id: asString(item?.category_id) || null,
    category_name: asString(item?.category_name) || null,
    domain_id: asString(item?.domain_id) || null,
    path: summarizePath(item?.category_path_from_root || item?.path_from_root || item?.path),
    probability: asNumber(item?.probability),
    confidence: asNumber(item?.confidence),
    raw: sanitizeMeliLogPayload(item)
  }));
};

export const getCategoryDetails = async (categoryId: string): Promise<Record<string, any>> =>
  getOrLoad(`category:details:${categoryId}`, async () => {
    const response = await readMeliPath<Record<string, any>>(`/categories/${encodeURIComponent(categoryId)}`);
    if (!response.ok) {
      throw new Error(asString(response.body?.message || response.body?.error || "meli_category_details_failed"));
    }
    return sanitizeMeliLogPayload(response.body);
  });

export const getCategoryAttributes = async (categoryId: string): Promise<MeliCategoryAttribute[]> =>
  getOrLoad(`category:attributes:${categoryId}`, async () => {
    const response = await readMeliPath<any[]>(`/categories/${encodeURIComponent(categoryId)}/attributes`);
    if (!response.ok) {
      const errorBody: any = response.body;
      throw new Error(asString(errorBody?.message || errorBody?.error || "meli_category_attributes_failed"));
    }
    const list = Array.isArray(response.body) ? response.body : [];
    return list.map(normalizeCategoryAttribute).filter((attribute) => attribute.id);
  });

export const getListingTypesForCategory = async (categoryId: string): Promise<Array<Record<string, any>>> =>
  getOrLoad(`category:listing-types:${categoryId}`, async () => {
    try {
      const response = await readMeliPath<any[]>(`/sites/${MELI_SITE_ID}/listing_types`);
      if (!response.ok) {
        const errorBody: any = response.body;
        throw new Error(asString(errorBody?.message || errorBody?.error || "meli_listing_types_failed"));
      }
      const list = Array.isArray(response.body) ? response.body : [];
      return list.map((item: any) => sanitizeMeliLogPayload(item));
    } catch (error) {
      logger.warn(
        {
          categoryId,
          error: asString((error as any)?.message || error)
        },
        "meli.categories.listingTypes.unavailable"
      );
      return [];
    }
  });

export const mapVehicleToMeliAttributes = (
  vehicle: Vehicle,
  categoryAttributes: MeliCategoryAttribute[]
): VehicleAttributeMapping => {
  const mappedAttributes = categoryAttributes.reduce<Array<Record<string, any>>>((acc, attribute) => {
    const value = resolveVehicleAttributeValue(vehicle, attribute);
    if (!isValuePresent(value)) return acc;

    acc.push({
      id: attribute.id,
      value_name: String(value)
    });
    return acc;
  }, []);

  const mergedAttributes = mergeCustomAttributes(
    mappedAttributes,
    Array.isArray(vehicle.meliAttributes) ? vehicle.meliAttributes : []
  );

  const presentIds = new Set(
    mergedAttributes
      .map((attribute) => asString(attribute.id || attribute.name).toUpperCase())
      .filter(Boolean)
  );

  const requiredAttributes = categoryAttributes.filter(isRequiredAttribute);
  const recommendedAttributes = categoryAttributes.filter(isRecommendedAttribute);
  const optionalAttributes = categoryAttributes.filter(
    (attribute) => !requiredAttributes.includes(attribute) && !recommendedAttributes.includes(attribute)
  );

  const missingRequired = requiredAttributes
    .filter((attribute) => !presentIds.has(asString(attribute.id).toUpperCase()))
    .map((attribute) => attribute.id);

  const missingRecommended = recommendedAttributes
    .filter((attribute) => !presentIds.has(asString(attribute.id).toUpperCase()))
    .map((attribute) => attribute.id);

  return {
    attributes: mergedAttributes,
    requiredAttributes,
    recommendedAttributes,
    optionalAttributes,
    missingRequired,
    missingRecommended
  };
};

export const getVehicleCategoryRequirements = async (vehicle: Vehicle) => {
  const categoryId = asString(vehicle.meliCategoryId);
  if (!categoryId) {
    throw new Error("vehicle_missing_meli_category_id");
  }

  const [details, attributes, listingTypesResult] = await Promise.all([
    getCategoryDetails(categoryId),
    getCategoryAttributes(categoryId),
    getListingTypesForCategory(categoryId)
      .then((listingTypes) => ({ listingTypes, error: null }))
      .catch((error) => ({ listingTypes: [], error: asString((error as any)?.message || error) }))
  ]);

  const mapping = mapVehicleToMeliAttributes(vehicle, attributes);
  const listingTypes = listingTypesResult.listingTypes;

  return {
    categoryId,
    categoryName: asString(details?.name) || categoryId,
    listingAllowed:
      typeof details?.settings?.listing_allowed === "boolean" ? details.settings.listing_allowed : null,
    requiredAttributes: mapping.requiredAttributes.map((attribute) => ({
      id: attribute.id,
      name: attribute.name,
      valueType: attribute.value_type,
      hierarchy: attribute.hierarchy,
      missing: mapping.missingRequired.includes(attribute.id)
    })),
    recommendedAttributes: mapping.recommendedAttributes.map((attribute) => ({
      id: attribute.id,
      name: attribute.name,
      valueType: attribute.value_type,
      hierarchy: attribute.hierarchy,
      missing: mapping.missingRecommended.includes(attribute.id)
    })),
    optionalAttributes: mapping.optionalAttributes.map((attribute) => ({
      id: attribute.id,
      name: attribute.name,
      valueType: attribute.value_type,
      hierarchy: attribute.hierarchy
    })),
    allowedListingTypes: listingTypes.map((item) => ({
      id: asString(item?.id) || null,
      name: asString(item?.name) || null
    })),
    rawSummary: sanitizeMeliLogPayload({
      settings: details?.settings || null,
      path_from_root: details?.path_from_root || null,
      listing_types_count: listingTypes.length,
      listing_types_error: listingTypesResult.error,
      usedVehicleTitle: buildVehicleTitle(vehicle),
      mappedAttributeIds: mapping.attributes.map((attribute) => attribute.id || attribute.name).filter(Boolean)
    })
  };
};
