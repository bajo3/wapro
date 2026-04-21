import Vehicle from "../../models/Vehicle";
import {
  getCategoryAttributes,
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
  descriptionPlainText: string;
  validPicturesCount: number;
  picturesCount: number;
  picturesRawType: string;
  originalListingTypeId: string | null;
  finalListingTypeId: string | null;
  validation: MeliVehiclePayloadValidation;
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
  requiredAttributeIds?: string[];
};

const VEHICLE_LISTING_TYPE_ID = "classified";
const VEHICLE_PICTURES_FATAL_ERROR = "Vehicle has no valid pictures for MercadoLibre publish.";

const asString = (value: any): string => String(value ?? "").trim();

const asNumber = (value: any): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeCondition = (value: any): string => {
  const raw = asString(value).toLowerCase();
  if (raw === "nuevo") return "new";
  if (raw === "usado") return "used";
  return raw;
};

const isValidHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value);

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

const resolveVehicleListingTypeId = (vehicle: Vehicle, categoryId: string): { original: string | null; final: string } => {
  const original = asString(
    (vehicle as any).meliListingTypeId || process.env.MELI_DEFAULT_LISTING_TYPE_ID || process.env.MELI_LISTING_TYPE_ID
  ) || null;
  const final = VEHICLE_LISTING_TYPE_ID;

  logger.info(
    {
      vehicleId: vehicle.id,
      category_id: categoryId || null,
      originalListingTypeId: original,
      finalListingTypeId: final,
      reason: original !== final ? "vehicle_category_requires_classified" : "vehicle_category_default_classified"
    },
    "meli.vehicle.listingType.override"
  );

  return { original, final };
};

export const validateMeliVehiclePayload = (
  payload: Record<string, any>,
  options: ValidatePayloadOptions = {}
): MeliVehiclePayloadValidation => {
  const missingFields: string[] = [];
  const warnings: string[] = [];
  const fatalErrors: string[] = [];

  if (!asString(payload.title)) missingFields.push("title");
  if (!asString(payload.category_id)) missingFields.push("category_id");
  if (asNumber(payload.price) === null || Number(payload.price) <= 0) missingFields.push("price");
  if (!asString(payload.currency_id)) missingFields.push("currency_id");
  if (asNumber(payload.available_quantity) === null || Number(payload.available_quantity) <= 0) missingFields.push("available_quantity");
  if (!asString(payload.buying_mode)) missingFields.push("buying_mode");
  if (!asString(payload.listing_type_id)) missingFields.push("listing_type_id");
  if (!asString(payload.condition)) missingFields.push("condition");

  for (const attributeId of options.requiredAttributeIds || []) {
    if (!missingFields.includes(attributeId)) {
      missingFields.push(attributeId);
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
  const categoryId = asString((vehicle as any).meliCategoryId);
  const listingType = resolveVehicleListingTypeId(vehicle, categoryId);
  const price = asNumber((vehicle as any).price);
  const currencyId = asString((vehicle as any).currency);
  const condition = normalizeCondition((vehicle as any).condition);
  const description = resolveVehicleDescription(vehicle);
  const normalizedPictures = normalizeVehiclePictures(vehicle);

  logger.info(
    {
      vehicleId: vehicle.id,
      meliCategoryId: categoryId || null,
      condition: condition || null,
      sourceOfTruth: "wapro_vehicle",
      usesMeliPayloadDraft: false,
      originalListingTypeId: listingType.original,
      finalListingTypeId: listingType.final,
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
  const warnings: string[] = [];

  if (!(vehicle as any).meliDomainId) warnings.push("meliDomainId");

  if (categoryId) {
    try {
      const categoryAttributes = await getCategoryAttributes(categoryId);
      const mapping = mapVehicleToMeliAttributes(vehicle, categoryAttributes);
      attributes = mapping.attributes;

      const kmAliases = new Set(["km", "KILOMETERS", "VEHICLE_MILEAGE"]);
      const baseKmMissing =
        condition === "used" &&
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

  const payload: Record<string, any> = {
    title,
    category_id: categoryId || null,
    price,
    currency_id: currencyId || null,
    available_quantity: 1,
    buying_mode: "buy_it_now",
    listing_type_id: listingType.final,
    condition: condition || null,
    attributes
  };

  if (normalizedPictures.validPicturesCount > 0) {
    payload.pictures = normalizedPictures.pictures.map((picture) => ({ source: picture.url }));
  }

  const validation = validateMeliVehiclePayload(payload, {
    dryRun: options.dryRun,
    validPicturesCount: normalizedPictures.validPicturesCount,
    descriptionPlainText: description,
    requiredAttributeIds
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
    descriptionPlainText: description,
    validPicturesCount: normalizedPictures.validPicturesCount,
    picturesCount: normalizedPictures.rawImagesCount + normalizedPictures.rawPicturesCount,
    picturesRawType: normalizedPictures.picturesRawType,
    originalListingTypeId: listingType.original,
    finalListingTypeId: listingType.final,
    validation: {
      ...validation,
      warnings: mergedWarnings
    }
  };
};

export default buildMeliVehiclePayload;
