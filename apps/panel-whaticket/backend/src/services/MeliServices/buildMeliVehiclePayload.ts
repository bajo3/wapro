import Vehicle from "../../models/Vehicle";
import {
  MeliCategoryAttribute,
  getCategoryAttributes,
  getCategoryBuyingModes,
  mapVehicleToMeliAttributes
} from "../../helpers/meliCategoriesService";
import { logger } from "../../utils/logger";

export type MeliVehiclePayloadValidation = {
  ok: boolean;
  missingFields: string[];
  warnings: string[];
  fatalErrors: string[];
};

export type ValidationResult = {
  ok: boolean;
  missingFields: string[];
  warnings: string[];
  fatalErrors: string[];
  payload: Record<string, any>;
  mappedAttributes: Array<Record<string, any>>;
  attributeMap: Array<Record<string, any>>;
  descriptionPlainText: string;
  validPicturesCount: number;
  picturesCount: number;
  picturesRawType: string;
  originalListingTypeId: string | null;
  finalListingTypeId: string | null;
  usesMeliPayloadDraft: boolean;
  validation: MeliVehiclePayloadValidation;
};

type NormalizedVehicleMetadata = {
  categoryId: string | null;
  domainId: string | null;
  condition: string | null;
  listingTypeId: string;
  categorySource: string;
  domainSource: string;
  conditionSource: string;
  listingTypeSource: string;
  originalCategoryId: string | null;
  originalDomainId: string | null;
  originalCondition: string | null;
  originalListingTypeId: string | null;
  warnings: string[];
  missingFields: string[];
  fatalErrors: string[];
};

type NormalizedVehicleLocation = {
  location: Record<string, any> | null;
  source: string;
  missingFields: string[];
  fatalErrors: string[];
};

type NormalizedPicture = {
  url: string;
  order: number;
};

type NormalizePicturesResult = {
  pictures: NormalizedPicture[];
  selectedSourceField: string;
  rawImagesCount: number;
  rawPicturesCount: number;
  validPicturesCount: number;
  picturesRawType: string;
};

type ValidatePayloadOptions = {
  dryRun?: boolean;
  validPicturesCount?: number;
  descriptionPlainText?: string;
  requiredAttributes?: MeliCategoryAttribute[];
  baseMissingFields?: string[];
  baseWarnings?: string[];
  baseFatalErrors?: string[];
  classified?: boolean;
};

const VEHICLE_LISTING_TYPE_ID = "classified";
const VEHICLE_DEFAULT_CATEGORY_ID = "MLA1744";
const VEHICLE_DEFAULT_DOMAIN_ID = "MLA-CARS_AND_VANS";
const VEHICLE_PICTURES_FATAL_ERROR = "Vehicle has no valid pictures for MercadoLibre publish.";
const VEHICLE_CONDITION_FATAL_ERROR = "Vehicle condition is required for MercadoLibre publish.";
const VEHICLE_LOCATION_FATAL_ERROR = "Vehicle location is required for MercadoLibre publish.";

const asString = (value: any): string => String(value ?? "").trim();

const asNumber = (value: any): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeCondition = (value: any): string => {
  const raw = asString(value).toLowerCase();
  if (raw === "new" || raw === "nuevo" || raw === "0km" || raw === "0 km") return "new";
  if (raw === "used" || raw === "usado") return "used";
  return raw || "";
};

const normalizeSearchText = (value: any): string =>
  asString(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const extractNumericString = (value: any): string | null => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.max(0, Math.trunc(value)));
  }

  const compact = asString(value)
    .toLowerCase()
    .replace(/km|kms|kilometers|kilometros|mileage/gi, "")
    .replace(/[.,]/g, "")
    .replace(/\s+/g, "")
    .trim();

  if (!compact) return null;
  return /^\d+$/.test(compact) ? compact : null;
};

const isValidHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value);

const resolveBuyingMode = async (
  vehicleId: number | string,
  categoryId: string,
  domainId: string | null,
  listingTypeId: string
): Promise<{ buyingMode: string; source: string; allowedBuyingModes: string[] }> => {
  let allowedBuyingModes: string[] = [];
  try {
    allowedBuyingModes = await getCategoryBuyingModes(categoryId);
  } catch {
    // proceed with static rule
  }

  const originalBuyingMode = "buy_it_now";
  let buyingMode: string;
  let source: string;

  if (listingTypeId === "classified") {
    buyingMode = "classified";
    source = allowedBuyingModes.length > 0
      ? "classified_listing_type_api_confirmed"
      : "classified_listing_type_static_rule";
  } else if (allowedBuyingModes.length > 0) {
    buyingMode = allowedBuyingModes.includes("buy_it_now") ? "buy_it_now" : allowedBuyingModes[0];
    source = "category_buying_modes_api";
  } else {
    buyingMode = originalBuyingMode;
    source = "default_buy_it_now";
  }

  logger.info(
    {
      vehicleId,
      categoryId,
      domainId,
      originalBuyingMode,
      finalBuyingMode: buyingMode,
      source,
      allowedBuyingModes
    },
    "meli.vehicle.buyingMode.resolved"
  );

  return { buyingMode, source, allowedBuyingModes };
};

const normalizePictureInput = (input: any): any[] => {
  if (input === null || input === undefined || input === "") return [];

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return trimmed.split(/[\r\n,]+/).map((entry) => entry.trim()).filter(Boolean);
      }
    }

    return trimmed.split(/[\r\n,]+/).map((entry) => entry.trim()).filter(Boolean);
  }

  if (Array.isArray(input)) return input;
  if (typeof input === "object") return [input];
  return [];
};

const detectPicturesRawType = (values: any[]): string => {
  if (!values.length) return "none";
  const types = Array.from(new Set(values.map((value) => {
    if (Array.isArray(value)) return "array";
    if (value === null) return "null";
    return typeof value;
  })));

  return types.length === 1 ? types[0] : "mixed";
};

const normalizeVehiclePictures = (vehicle: Vehicle): NormalizePicturesResult => {
  const rawImagesInput = (vehicle as any).images;
  const rawPicturesInput = (vehicle as any).pictures;
  const normalizedImagesInput = normalizePictureInput(rawImagesInput);
  const normalizedPicturesInput = normalizePictureInput(rawPicturesInput);

  const candidateSources = [
    {
      field: "images",
      rawInput: rawImagesInput,
      entries: normalizedImagesInput
    },
    {
      field: "pictures",
      rawInput: rawPicturesInput,
      entries: normalizedPicturesInput
    },
    {
      field: "photos",
      rawInput: (vehicle as any).photos,
      entries: normalizePictureInput((vehicle as any).photos)
    },
    {
      field: "gallery",
      rawInput: (vehicle as any).gallery,
      entries: normalizePictureInput((vehicle as any).gallery)
    },
    {
      field: "image_urls",
      rawInput: (vehicle as any).image_urls,
      entries: normalizePictureInput((vehicle as any).image_urls)
    },
    {
      field: "imageUrls",
      rawInput: (vehicle as any).imageUrls,
      entries: normalizePictureInput((vehicle as any).imageUrls)
    },
    {
      field: "thumbnail",
      rawInput: (vehicle as any).thumbnail,
      entries: normalizePictureInput((vehicle as any).thumbnail)
    }
  ];

  const selectedSource =
    candidateSources.find((source) => source.field === "images" && source.entries.length > 0) ||
    candidateSources.find((source) => source.field === "pictures" && source.entries.length > 0) ||
    candidateSources.find((source) => source.entries.length > 0) || {
      field: normalizedImagesInput.length || rawImagesInput !== undefined ? "images" : "pictures",
      rawInput: normalizedImagesInput.length || rawImagesInput !== undefined ? rawImagesInput : rawPicturesInput,
      entries: normalizedImagesInput.length > 0 ? normalizedImagesInput : normalizedPicturesInput
    };

  const rawType = detectPicturesRawType([selectedSource.rawInput].filter((value) => value !== undefined));
  const rawPictures = selectedSource.entries;

  const normalized = rawPictures
    .map((item: any, index: number): NormalizedPicture | null => {
      if (typeof item === "string") {
        const url = asString(item);
        if (!url) return null;
        return { url, order: index };
      }

      if (!item || typeof item !== "object") return null;

      const url = asString(item.url || item.source || item.secure_url || item.source_url || item.src);
      if (!url) return null;

      return {
        url,
        order: Number.isFinite(Number(item.order)) ? Number(item.order) : index
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(a!.order || 0) - Number(b!.order || 0)) as NormalizedPicture[];

  const deduped: NormalizedPicture[] = [];
  const seen = new Set<string>();
  for (const picture of normalized) {
    const normalizedUrl = asString(picture.url);
    if (!normalizedUrl) continue;
    if (!isValidHttpUrl(normalizedUrl)) continue;
    if (seen.has(normalizedUrl)) continue;

    seen.add(normalizedUrl);
    deduped.push({ url: normalizedUrl, order: deduped.length });
  }

  logger.info(
    {
      vehicleId: vehicle.id,
      selectedSourceField: selectedSource.field,
      rawImagesCount: normalizedImagesInput.length,
      rawPicturesCount: normalizedPicturesInput.length,
      picturesRawType: rawType,
      validPicturesCount: deduped.length
    },
    "meli.vehicle.pictures.normalized"
  );

  return {
    pictures: deduped,
    selectedSourceField: selectedSource.field,
    rawImagesCount: normalizedImagesInput.length,
    rawPicturesCount: normalizedPicturesInput.length,
    validPicturesCount: deduped.length,
    picturesRawType: rawType
  };
};

const buildVehicleTitle = (vehicle: Vehicle): string =>
  [vehicle.brand, vehicle.model, vehicle.version, vehicle.year]
    .map(asString)
    .filter(Boolean)
    .join(" ")
    .trim();

const buildVehicleDescription = (vehicle: Vehicle): string => {
  const contactPieces = [
    asString(process.env.MELI_DEALERSHIP_NAME),
    asString(process.env.MELI_DEALERSHIP_PHONE),
    asString(process.env.MELI_DEALERSHIP_WHATSAPP),
    asString(process.env.MELI_DEALERSHIP_CONTACT)
  ].filter(Boolean);

  const lines = [
    buildVehicleTitle(vehicle),
    asString(vehicle.year) ? `Ano: ${asString(vehicle.year)}` : "",
    Number.isFinite(Number(vehicle.km)) ? `Kilometraje: ${Number(vehicle.km)} km` : "",
    asString(vehicle.fuel) ? `Combustible: ${asString(vehicle.fuel)}` : "",
    asString(vehicle.transmission) ? `Transmision: ${asString(vehicle.transmission)}` : "",
    asString(vehicle.color) ? `Color: ${asString(vehicle.color)}` : "",
    Number.isFinite(Number(vehicle.price)) && asString(vehicle.currency)
      ? `Precio: ${Number(vehicle.price)} ${asString(vehicle.currency)}`
      : "",
    asString(vehicle.locationCity) || asString(vehicle.locationState)
      ? `Ubicacion: ${[asString(vehicle.locationCity), asString(vehicle.locationState)].filter(Boolean).join(", ")}`
      : "",
    contactPieces.length ? `Contacto: ${contactPieces.join(" | ")}` : ""
  ].filter(Boolean);

  return lines.join("\n");
};

const resolveVehicleDescription = (vehicle: Vehicle): string => {
  const providedDescription = asString((vehicle as any).description);
  const description = providedDescription || buildVehicleDescription(vehicle);

  logger.info(
    {
      vehicleId: vehicle.id,
      hasDescription: Boolean(description),
      generatedDescription: !providedDescription && Boolean(description),
      descriptionLength: description.length
    },
    "meli.vehicle.description.resolved"
  );

  return description;
};

export const normalizeMeliVehicleMetadata = (
  vehicle: Vehicle,
  options: { dryRun?: boolean } = {}
): NormalizedVehicleMetadata => {
  const originalCategoryId = asString((vehicle as any).meliCategoryId) || null;
  const originalDomainId = asString((vehicle as any).meliDomainId) || null;
  const originalCondition = asString((vehicle as any).condition) || null;
  const originalListingTypeId = asString(
    (vehicle as any).meliListingTypeId || process.env.MELI_DEFAULT_LISTING_TYPE_ID || process.env.MELI_LISTING_TYPE_ID
  ) || null;
  const categoryId = originalCategoryId || VEHICLE_DEFAULT_CATEGORY_ID;
  const domainId = originalDomainId || VEHICLE_DEFAULT_DOMAIN_ID;
  const normalizedCondition = normalizeCondition(originalCondition);
  const normalizedKilometers = extractNumericString(
    (vehicle as any).km ?? (vehicle as any).kms ?? (vehicle as any).kilometers ?? (vehicle as any).mileage
  );
  const titleAndVersion = `${asString((vehicle as any).title)} ${asString((vehicle as any).version)}`.trim();
  const hasZeroKmHint = /\b0\s*km\b/.test(normalizeSearchText(titleAndVersion));
  const condition =
    normalizedCondition ||
    (normalizedKilometers !== null && Number(normalizedKilometers) > 0
      ? "used"
      : normalizedKilometers === "0" && hasZeroKmHint
        ? "new"
        : null);
  const listingTypeId = VEHICLE_LISTING_TYPE_ID;
  const missingFields: string[] = [];
  const warnings: string[] = [];
  const fatalErrors: string[] = [];

  if (!condition) {
    missingFields.push("condition");
    if (!options.dryRun) {
      fatalErrors.push(VEHICLE_CONDITION_FATAL_ERROR);
    }
  }

  const normalized: NormalizedVehicleMetadata = {
    categoryId,
    domainId,
    condition,
    listingTypeId,
    categorySource: originalCategoryId ? "vehicle_field" : "vehicle_default_mla1744",
    domainSource: originalDomainId ? "vehicle_field" : "vehicle_default_mla_cars_and_vans",
    conditionSource:
      normalizedCondition
        ? "vehicle_field_normalized"
        : condition === "used"
          ? "km_gt_zero_inferred_used"
          : condition === "new"
            ? "zero_km_text_inferred_new"
            : "missing_vehicle_condition",
    listingTypeSource:
      originalListingTypeId && originalListingTypeId !== VEHICLE_LISTING_TYPE_ID
        ? "vehicle_category_requires_classified"
        : "vehicle_default_classified",
    originalCategoryId,
    originalDomainId,
    originalCondition,
    originalListingTypeId,
    warnings,
    missingFields,
    fatalErrors
  };

  logger.info(
    {
      vehicleId: vehicle.id,
      originalCategoryId,
      finalCategoryId: normalized.categoryId,
      categorySource: normalized.categorySource,
      originalDomainId,
      finalDomainId: normalized.domainId,
      domainSource: normalized.domainSource,
      originalCondition,
      finalCondition: normalized.condition,
      conditionSource: normalized.conditionSource,
      originalListingTypeId,
      finalListingTypeId: normalized.listingTypeId,
      listingTypeSource: normalized.listingTypeSource
    },
    "meli.vehicle.metadata.normalized"
  );

  return normalized;
};

const resolveVehicleLocation = (
  vehicle: Vehicle,
  options: { dryRun?: boolean } = {}
): NormalizedVehicleLocation => {
  const neighborhoodId =
    asString(
      (vehicle as any).meliNeighborhoodId ||
      (vehicle as any).locationNeighborhoodId ||
      (vehicle as any).neighborhoodId ||
      process.env.MELI_DEFAULT_NEIGHBORHOOD_ID
    ) || null;
  const cityId =
    asString(
      (vehicle as any).meliCityId ||
      (vehicle as any).locationCityId ||
      (vehicle as any).cityId ||
      process.env.MELI_DEFAULT_CITY_ID
    ) || null;

  const location = neighborhoodId
    ? { neighborhood: { id: neighborhoodId } }
    : cityId
      ? { city: { id: cityId } }
      : null;
  const missingFields: string[] = [];
  const fatalErrors: string[] = [];

  if (!location) {
    missingFields.push("location.city.id or location.neighborhood.id");
    if (!options.dryRun) {
      fatalErrors.push(VEHICLE_LOCATION_FATAL_ERROR);
    }
  }

  return {
    location,
    source: neighborhoodId ? "vehicle_or_env_neighborhood" : cityId ? "vehicle_or_env_city" : "missing_location",
    missingFields,
    fatalErrors
  };
};

export const getMissingMeliFields = (
  payload: Record<string, any>,
  requiredAttributes: MeliCategoryAttribute[] = [],
  options: { classified?: boolean } = {}
): string[] => {
  const missingFields: string[] = [];

  if (!asString(payload.title)) missingFields.push("title");
  if (!asString(payload.category_id)) missingFields.push("category_id");
  if (asNumber(payload.price) === null || Number(payload.price) <= 0) missingFields.push("price");
  if (!asString(payload.currency_id)) missingFields.push("currency_id");
  if (asNumber(payload.available_quantity) === null || Number(payload.available_quantity) <= 0) missingFields.push("available_quantity");
  if (!asString(payload.buying_mode)) missingFields.push("buying_mode");
  if (!asString(payload.listing_type_id)) missingFields.push("listing_type_id");
  if (!asString(payload.condition)) missingFields.push("condition");

  if (options.classified && !payload?.location?.city?.id && !payload?.location?.neighborhood?.id) {
    missingFields.push("location.city.id or location.neighborhood.id");
  }

  const presentIds = new Set(
    (Array.isArray(payload.attributes) ? payload.attributes : [])
      .map((attribute: any) => asString(attribute?.id || attribute?.name).toUpperCase())
      .filter(Boolean)
  );

  requiredAttributes.forEach((attribute) => {
    const attributeId = asString(attribute.id).toUpperCase();
    if (!attributeId || presentIds.has(attributeId)) return;
    missingFields.push(attribute.id);
  });

  return Array.from(new Set(missingFields));
};

export const validateMeliVehiclePayload = (
  payload: Record<string, any>,
  options: ValidatePayloadOptions = {}
): MeliVehiclePayloadValidation => {
  const missingFields: string[] = [...(options.baseMissingFields || [])];
  const warnings: string[] = [...(options.baseWarnings || [])];
  const fatalErrors: string[] = [...(options.baseFatalErrors || [])];

  getMissingMeliFields(payload, options.requiredAttributes || [], { classified: options.classified }).forEach((field) => {
    if (!missingFields.includes(field)) {
      missingFields.push(field);
    }
  });

  if (asString(payload.listing_type_id) === "classified" && asString(payload.buying_mode) === "buy_it_now") {
    const invalidComboError =
      "buying_mode buy_it_now is incompatible with listing_type_id classified: use buying_mode classified instead.";
    if (!fatalErrors.includes(invalidComboError)) {
      fatalErrors.push(invalidComboError);
    }
  }

  if (!asString(options.descriptionPlainText)) {
    warnings.push("description");
  }

  if ((options.validPicturesCount || 0) <= 0) {
    warnings.push("pictures");
    if (!options.dryRun) {
      missingFields.push("pictures");
      fatalErrors.push(VEHICLE_PICTURES_FATAL_ERROR);
    }
  }

  const dedupedMissingFields = Array.from(new Set(missingFields));
  const dedupedWarnings = Array.from(new Set(warnings));
  const dedupedFatalErrors = Array.from(new Set(fatalErrors));

  return {
    ok: dedupedMissingFields.length === 0 && dedupedFatalErrors.length === 0,
    missingFields: dedupedMissingFields,
    warnings: dedupedWarnings,
    fatalErrors: dedupedFatalErrors
  };
};

export const buildMeliVehiclePayload = async (
  vehicle: Vehicle,
  options: { dryRun?: boolean } = {}
): Promise<ValidationResult> => {
  const title = asString((vehicle as any).title) || buildVehicleTitle(vehicle);
  const metadata = normalizeMeliVehicleMetadata(vehicle, options);
  const price = asNumber((vehicle as any).price);
  const currencyId = asString((vehicle as any).currency);
  const description = resolveVehicleDescription(vehicle);
  const normalizedPictures = normalizeVehiclePictures(vehicle);

  logger.info(
    {
      vehicleId: vehicle.id,
      meliCategoryId: metadata.categoryId,
      meliDomainId: metadata.domainId,
      condition: metadata.condition,
      sourceOfTruth: "wapro_vehicle",
      usesMeliPayloadDraft: false,
      originalListingTypeId: metadata.originalListingTypeId,
      finalListingTypeId: metadata.listingTypeId,
      dryRun: Boolean(options.dryRun),
      selectedSourceField: normalizedPictures.selectedSourceField,
      rawImagesCount: normalizedPictures.rawImagesCount,
      rawPicturesCount: normalizedPictures.rawPicturesCount,
      picturesRawType: normalizedPictures.picturesRawType,
      validPicturesCount: normalizedPictures.validPicturesCount,
      hasDescription: Boolean(description)
    },
    "meli.buildPayload.input"
  );

  logger.info(
    {
      vehicleId: vehicle.id,
      sourceOfTruth: "wapro_vehicle",
      usesMeliPayloadDraft: false
    },
    "meli.vehicle.payload.source"
  );

  let attributes = Array.isArray((vehicle as any).meliAttributes)
    ? (vehicle as any).meliAttributes.filter((attribute: any) => attribute && typeof attribute === "object")
    : [];
  const requiredAttributeIds: string[] = [];
  const warnings: string[] = [...metadata.warnings];

  if (metadata.categoryId) {
    try {
      const categoryAttributes = await getCategoryAttributes(metadata.categoryId);
      const mapping = mapVehicleToMeliAttributes(vehicle, categoryAttributes);
      attributes = mapping.attributes;

      const kmAliases = new Set(["km", "KILOMETERS", "VEHICLE_MILEAGE"]);
      const baseKmMissing =
        metadata.condition === "used" &&
        (asNumber((vehicle as any).km) === null || Number((vehicle as any).km) < 0);

      mapping.missingRequired.forEach((attributeId) => {
        if (kmAliases.has(attributeId) && baseKmMissing) return;
        if (!requiredAttributeIds.includes(attributeId)) {
          requiredAttributeIds.push(attributeId);
        }
      });

      mapping.missingRecommended.forEach((attributeId) => {
        if (!warnings.includes(attributeId)) {
          warnings.push(attributeId);
        }
      });
    } catch (error) {
      const message = asString((error as any)?.message || error);
      if (message && !warnings.includes(`category_attributes_unavailable:${message}`)) {
        warnings.push(`category_attributes_unavailable:${message}`);
      }
    }
  }

  const resolvedBuyingMode = await resolveBuyingMode(
    vehicle.id,
    metadata.categoryId || VEHICLE_DEFAULT_CATEGORY_ID,
    metadata.domainId,
    metadata.listingTypeId
  );

  const payload: Record<string, any> = {
    title,
    category_id: metadata.categoryId,
    price,
    currency_id: currencyId || null,
    available_quantity: 1,
    buying_mode: resolvedBuyingMode.buyingMode,
    listing_type_id: metadata.listingTypeId,
    condition: metadata.condition,
    attributes
  };

  if (normalizedPictures.validPicturesCount > 0) {
    payload.pictures = normalizedPictures.pictures.map((picture) => ({ source: picture.url }));
  }

  const validation = validateMeliVehiclePayload(payload, {
    dryRun: options.dryRun,
    validPicturesCount: normalizedPictures.validPicturesCount,
    descriptionPlainText: description,
    classified: metadata.listingTypeId === "classified",
    baseMissingFields: metadata.missingFields,
    baseWarnings: metadata.warnings,
    baseFatalErrors: metadata.fatalErrors
  });

  const mergedWarnings = Array.from(new Set([...warnings, ...validation.warnings]));

  logger.info(
    {
      vehicleId: vehicle.id,
      ok: validation.ok,
      missingFields: validation.missingFields,
      warnings: mergedWarnings,
      fatalErrors: validation.fatalErrors
    },
    "meli.vehicle.payload.validation"
  );

  logger.info(
    {
      vehicleId: vehicle.id,
      ok: validation.ok,
      missingFields: validation.missingFields,
      warnings: mergedWarnings
    },
    "meli.buildPayload.result"
  );

  return {
    ok: validation.ok,
    missingFields: validation.missingFields,
    warnings: mergedWarnings,
    fatalErrors: validation.fatalErrors,
    payload,
    mappedAttributes: attributes,
    attributeMap: [],
    descriptionPlainText: description,
    validPicturesCount: normalizedPictures.validPicturesCount,
    picturesCount: normalizedPictures.rawImagesCount + normalizedPictures.rawPicturesCount,
    picturesRawType: normalizedPictures.picturesRawType,
    originalListingTypeId: metadata.originalListingTypeId,
    finalListingTypeId: metadata.listingTypeId,
    usesMeliPayloadDraft: false,
    validation: {
      ...validation,
      warnings: mergedWarnings
    }
  };
};

export default buildMeliVehiclePayload;
