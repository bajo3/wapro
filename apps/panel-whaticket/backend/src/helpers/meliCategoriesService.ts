import fetch from "node-fetch";

import Vehicle from "../models/Vehicle";
import { meliApiRequest, sanitizeMeliLogPayload } from "../services/MercadoLibre/meliClient";
import { logger } from "../utils/logger";

const MELI_API_URL = process.env.MELI_API_URL || "https://api.mercadolibre.com";
const MELI_SITE_ID = process.env.MELI_SITE_ID || "MLA";
const CATEGORY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

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
  attributeMap: Array<Record<string, any>>;
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

const hasValue = (value: any): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return asString(value).length > 0;
  return Boolean(value);
};

const normalizeText = (value: any): string =>
  asString(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

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
  Boolean(attribute.tags?.required || attribute.tags?.catalog_required || attribute.tags?.fixed);

const isRecommendedAttribute = (attribute: MeliCategoryAttribute): boolean =>
  !isRequiredAttribute(attribute) &&
  (attribute.hierarchy === "RECOMMENDED" || Boolean(attribute.tags?.allow_variations) || Boolean(attribute.tags?.defines_picture));

const isValuePresent = hasValue;

const FUEL_NORMALIZATION: Record<string, string> = {
  nafta: "Nafta",
  diesel: "Diésel",
  dieselo: "Diésel",
  electrico: "Eléctrico",
  hibrido: "Híbrido",
  hybrid: "Híbrido"
};

const VEHICLE_TYPE_NORMALIZATION: Record<string, string> = {
  sedan: "Sedán",
  hatchback: "Hatchback",
  suv: "SUV",
  pickup: "Pick-Up",
  "pick up": "Pick-Up",
  coupe: "Coupé"
};

const normalizeFuelValue = (value: any): string | null => {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  return FUEL_NORMALIZATION[normalized] || asString(value);
};

const normalizeVehicleTypeValue = (value: any): string | null => {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  return VEHICLE_TYPE_NORMALIZATION[normalized] || asString(value);
};

const normalizeDoorsValue = (value: any): string | null => {
  const numeric = asNumber(value);
  if (numeric === null) {
    const normalized = normalizeText(value).replace(/ puertas?$/i, "");
    return /^\d+$/.test(normalized) ? normalized : null;
  }
  return String(Math.trunc(numeric));
};

const normalizeTrimValue = (value: any): string | null => {
  const normalized = asString(value);
  return normalized || null;
};

type AttributeResolutionContext = {
  condition?: string | null;
};

const normalizeKilometersValue = (value: any): string | null => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.max(0, Math.trunc(value)));
  }

  const raw = asString(value).toLowerCase();
  if (!raw) return null;

  const compact = raw
    .replace(/km|kms|kilometers|kilometros|mileage/gi, "")
    .replace(/[.,]/g, "")
    .replace(/\s+/g, "")
    .trim();

  if (!compact) return null;
  return /^\d+$/.test(compact) ? compact : null;
};

const inferDoorsFromText = (value: any): string | null => {
  const normalized = normalizeText(value);
  if (!normalized) return null;

  const explicitMatch = normalized.match(/\b([2-5])\s*puertas?\b/);
  if (explicitMatch?.[1]) return explicitMatch[1];

  const shortMatch = normalized.match(/\b([2-5])\s*p\b/);
  if (shortMatch?.[1]) return shortMatch[1];

  return null;
};

const getVehicleField = (vehicle: Vehicle, keys: string[]): any => {
  for (const key of keys) {
    const value = (vehicle as any)?.[key];
    if (hasValue(value)) return value;
  }
  return null;
};

const getVehicleKilometers = (vehicle: Vehicle, context?: AttributeResolutionContext): string | null => {
  const rawValue = getVehicleField(vehicle, ["km", "kms", "kilometers", "mileage"]);
  const normalized = normalizeKilometersValue(rawValue);
  if (normalized) return normalized;
  if (context?.condition === "new") return "0";
  return null;
};

const getVehicleDoors = (vehicle: Vehicle): string | null =>
  normalizeDoorsValue(vehicle.doors) || inferDoorsFromText(vehicle.version) || inferDoorsFromText(vehicle.title);

const VEHICLE_ATTRIBUTE_ALIASES: Record<string, Array<(vehicle: Vehicle, context?: AttributeResolutionContext) => any>> = {
  BRAND: [(vehicle) => vehicle.brand],
  MLA1744_MARC: [(vehicle) => vehicle.brand],
  MODEL: [(vehicle) => vehicle.model],
  MLA1744_MODL: [(vehicle) => vehicle.model],
  YEAR: [(vehicle) => vehicle.year],
  VEHICLE_YEAR: [(vehicle) => vehicle.year],
  MLA1744_YEAR: [(vehicle) => vehicle.year],
  KILOMETERS: [(vehicle, context) => getVehicleKilometers(vehicle, context)],
  VEHICLE_MILEAGE: [(vehicle, context) => getVehicleKilometers(vehicle, context)],
  MLA1744_KMTS: [(vehicle, context) => getVehicleKilometers(vehicle, context)],
  TRIM: [(vehicle) => normalizeTrimValue(vehicle.version)],
  VERSION: [(vehicle) => normalizeTrimValue(vehicle.version)],
  FUEL_TYPE: [(vehicle) => normalizeFuelValue(getVehicleField(vehicle, ["fuel", "fuelType", "fuel_type"]))],
  TRANSMISSION: [(vehicle) => getVehicleField(vehicle, ["transmission", "caja"])],
  COLOR: [(vehicle) => getVehicleField(vehicle, ["color"])],
  EXTERIOR_COLOR: [(vehicle) => getVehicleField(vehicle, ["color"])],
  MLA1744_COLOREXT: [(vehicle) => getVehicleField(vehicle, ["color"])],
  DOORS: [(vehicle) => getVehicleDoors(vehicle)],
  MLA1744_DOOR: [(vehicle) => getVehicleDoors(vehicle)],
  ENGINE: [(vehicle) => vehicle.engine],
  ENGINE_DISPLACEMENT: [(vehicle) => vehicle.engine],
  BODY_TYPE: [(vehicle) => vehicle.bodyType],
  VEHICLE_TYPE: [(vehicle) => normalizeVehicleTypeValue(vehicle.vehicleType), (vehicle) => normalizeVehicleTypeValue(vehicle.bodyType)],
  TRACTION_CONTROL: [(vehicle) => vehicle.traction],
  TRACTION_TYPE: [(vehicle) => vehicle.traction]
};

const extractDigits = (value: any): string => asString(value).replace(/\D+/g, "");

const matchAllowedValue = (
  rawValue: any,
  attribute: MeliCategoryAttribute
): { value_id?: string; value_name: string } | null => {
  if (!isValuePresent(rawValue)) return null;

  const values = Array.isArray(attribute.values) ? attribute.values : [];
  if (!values.length) {
    return { value_name: String(rawValue) };
  }

  const rawNormalized = normalizeText(rawValue);
  const rawDigits = extractDigits(rawValue);
  if (!rawNormalized && !rawDigits) return null;

  const exactMatch = values.find((item) => {
    const candidates = [
      normalizeText(item?.name),
      normalizeText(item?.id),
      normalizeText(item?.value_name)
    ].filter(Boolean);
    const digits = [
      extractDigits(item?.name),
      extractDigits(item?.id),
      extractDigits(item?.value_name)
    ].filter(Boolean);
    return candidates.includes(rawNormalized) || (rawDigits && digits.includes(rawDigits));
  });

  if (exactMatch) {
    return {
      value_id: asString(exactMatch?.id) || undefined,
      value_name: asString(exactMatch?.name || exactMatch?.value_name || rawValue)
    };
  }

  const fuzzyMatches = values.filter((item) => {
    const candidates = [
      normalizeText(item?.name),
      normalizeText(item?.id),
      normalizeText(item?.value_name)
    ].filter(Boolean);
    return candidates.some((candidate) =>
      candidate && rawNormalized && (candidate.includes(rawNormalized) || rawNormalized.includes(candidate))
    );
  });

  if (fuzzyMatches.length === 1) {
    const match = fuzzyMatches[0];
    return {
      value_id: asString(match?.id) || undefined,
      value_name: asString(match?.name || match?.value_name || rawValue)
    };
  }

  return { value_name: String(rawValue) };
};

const resolveVehicleAttributeValue = (
  vehicle: Vehicle,
  attribute: MeliCategoryAttribute,
  context: AttributeResolutionContext = {}
): { attribute: Record<string, any> | null; source: string | null; rawValue: any } => {
  if (attribute.tags?.fixed && Array.isArray(attribute.values) && attribute.values.length === 1) {
    const fixedValue = attribute.values[0];
    return {
      attribute: {
        id: attribute.id,
        value_id: asString(fixedValue?.id) || undefined,
        value_name: asString(fixedValue?.name || fixedValue?.value_name || fixedValue?.id) || null
      },
      source: "fixed_attribute",
      rawValue: fixedValue?.name || fixedValue?.value_name || fixedValue?.id || null
    };
  }

  const candidates = [
    asString(attribute.id).toUpperCase().replace(/[^A-Z0-9]+/g, "_"),
    asString(attribute.name).toUpperCase().replace(/[^A-Z0-9]+/g, "_")
  ].filter(Boolean);

  for (const key of candidates) {
    const resolvers = VEHICLE_ATTRIBUTE_ALIASES[key];
    if (!resolvers) continue;
    for (const resolver of resolvers) {
      const rawValue = resolver(vehicle, context);
      if (!isValuePresent(rawValue)) continue;

      if (attribute.value_type === "list" || (Array.isArray(attribute.values) && attribute.values.length > 0)) {
        const matchedValue = matchAllowedValue(rawValue, attribute);
        if (matchedValue) {
          return {
            attribute: {
              id: attribute.id,
              ...(matchedValue.value_id ? { value_id: matchedValue.value_id } : {}),
              value_name: matchedValue.value_name
            },
            source: key,
            rawValue
          };
        }
        continue;
      }

      if (attribute.value_type === "number" || attribute.value_type === "number_unit") {
        const normalizedKm = normalizeKilometersValue(rawValue);
        if (normalizedKm !== null) {
          return {
            attribute: {
              id: attribute.id,
              value_name: normalizedKm
            },
            source: key,
            rawValue
          };
        }

        const numeric = asNumber(rawValue);
        if (numeric !== null) {
          return {
            attribute: {
              id: attribute.id,
              value_name: String(Math.trunc(numeric))
            },
            source: key,
            rawValue
          };
        }
      }

      return {
        attribute: {
          id: attribute.id,
          value_name: String(rawValue)
        },
        source: key,
        rawValue
      };
    }
  }

  return { attribute: null, source: null, rawValue: null };
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
  categoryAttributes: MeliCategoryAttribute[],
  context: AttributeResolutionContext = {}
): VehicleAttributeMapping => {
  const attributeMap: Array<Record<string, any>> = [];
  const mappedAttributes = categoryAttributes.reduce<Array<Record<string, any>>>((acc, attribute) => {
    const resolved = resolveVehicleAttributeValue(vehicle, attribute, context);
    attributeMap.push({
      id: attribute.id,
      name: attribute.name,
      required: isRequiredAttribute(attribute),
      recommended: isRecommendedAttribute(attribute),
      source: resolved.source,
      hasValue: Boolean(resolved.attribute),
      rawValue: isValuePresent(resolved.rawValue) ? String(resolved.rawValue) : null,
      value_name: resolved.attribute?.value_name || null,
      value_id: resolved.attribute?.value_id || null
    });
    if (!resolved.attribute) return acc;

    acc.push(resolved.attribute);
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
    attributeMap,
    requiredAttributes,
    recommendedAttributes,
    optionalAttributes,
    missingRequired,
    missingRecommended
  };
};

export const getCategoryBuyingModes = async (categoryId: string): Promise<string[]> => {
  try {
    const details = await getCategoryDetails(categoryId);
    const modes = (details as any)?.settings?.buying_modes;
    return Array.isArray(modes) ? modes.map(asString).filter(Boolean) : [];
  } catch {
    return [];
  }
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
