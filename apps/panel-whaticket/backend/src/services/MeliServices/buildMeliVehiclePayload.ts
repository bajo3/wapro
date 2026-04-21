import Vehicle from "../../models/Vehicle";
import {
  getCategoryAttributes,
  mapVehicleToMeliAttributes
} from "../../helpers/meliCategoriesService";
import { logger } from "../../utils/logger";

type ValidationResult = {
  ok: boolean;
  missingFields: string[];
  warnings: string[];
  payload: Record<string, any>;
  mappedAttributes: Array<Record<string, any>>;
};

const asString = (value: any): string => String(value ?? "").trim();
const VEHICLE_LISTING_TYPE_ID = "classified";

const asNumber = (value: any): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

// Normaliza condition a los valores que acepta ML: "new" | "used".
// Cubre valores en español que pueden venir de imports o datos legacy.
const normalizeCondition = (value: any): string => {
  const raw = asString(value).toLowerCase();
  if (raw === "nuevo") return "new";
  if (raw === "usado") return "used";
  return raw;
};

const normalizePictures = (pictures: any): Array<Record<string, any>> => {
  const list = Array.isArray(pictures) ? pictures : [];
  return list
    .map((item: any, index: number) => {
      if (typeof item === "string") {
        const url = asString(item);
        if (!url) return null;
        return { url, order: index };
      }

      if (!item || typeof item !== "object") return null;

      const url = asString(item.url || item.secure_url || item.source_url);
      if (!url) return null;

      return {
        url,
        order: Number.isFinite(Number(item.order)) ? Number(item.order) : index
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(a!.order || 0) - Number(b!.order || 0)) as Array<Record<string, any>>;
};

const resolveVehicleListingTypeId = (vehicle: Vehicle, categoryId: string): string => {
  const requestedListingTypeId = asString(
    vehicle.meliListingTypeId || process.env.MELI_DEFAULT_LISTING_TYPE_ID || process.env.MELI_LISTING_TYPE_ID
  );

  if (requestedListingTypeId && requestedListingTypeId !== VEHICLE_LISTING_TYPE_ID) {
    logger.info(
      {
        vehicleId: vehicle.id,
        category_id: categoryId || null,
        listing_type_id: VEHICLE_LISTING_TYPE_ID,
        reason: "vehicle_category_requires_classified"
      },
      "meli.vehicle.listingType.override"
    );
  }

  return VEHICLE_LISTING_TYPE_ID;
};

export const buildMeliVehiclePayload = async (
  vehicle: Vehicle,
  options: { dryRun?: boolean } = {}
): Promise<ValidationResult> => {
  const missingFields: string[] = [];
  const warnings: string[] = [];

  const title = asString(vehicle.title);
  const categoryId = asString(vehicle.meliCategoryId);
  const listingTypeId = resolveVehicleListingTypeId(vehicle, categoryId);
  const price = asNumber(vehicle.price);
  const currencyId = asString(vehicle.currency);
  const condition = normalizeCondition(vehicle.condition);
  const brand = asString(vehicle.brand);
  const model = asString(vehicle.model);
  const year = asString(vehicle.year);
  const km = asNumber(vehicle.km);
  const description = asString(vehicle.description);
  const pictures = normalizePictures(vehicle.pictures);

  logger.info(
    {
      vehicleId: vehicle.id,
      meliCategoryId: categoryId || null,
      condition: condition || null,
      meliListingTypeId: listingTypeId || null,
      dryRun: Boolean(options.dryRun)
    },
    "meli.buildPayload.input"
  );

  let attributes = Array.isArray(vehicle.meliAttributes)
    ? vehicle.meliAttributes.filter((attribute) => attribute && typeof attribute === "object")
    : [];

  if (!title) missingFields.push("title");
  if (!categoryId) missingFields.push("category_id");
  if (price === null || price <= 0) missingFields.push("price");
  if (!currencyId) missingFields.push("currency_id");
  if (!condition) missingFields.push("condition");
  if (!listingTypeId) missingFields.push("listing_type_id");
  if (!brand) missingFields.push("brand");
  if (!model) missingFields.push("model");
  if (!year) missingFields.push("year");
  if (condition === "used" && (km === null || km < 0)) missingFields.push("km");

  if (!description) warnings.push("description");
  if (!pictures.length) warnings.push("pictures");
  if (!vehicle.meliDomainId) warnings.push("meliDomainId");

  if (categoryId) {
    try {
      const categoryAttributes = await getCategoryAttributes(categoryId);
      const mapping = mapVehicleToMeliAttributes(vehicle, categoryAttributes);
      attributes = mapping.attributes;

      const KM_ALIASES = new Set(["km", "KILOMETERS", "VEHICLE_MILEAGE"]);
      const hasKmAlready = missingFields.some(f => KM_ALIASES.has(f));
      mapping.missingRequired.forEach((attributeId) => {
        if (KM_ALIASES.has(attributeId) && hasKmAlready) return;
        if (!missingFields.includes(attributeId)) {
          missingFields.push(attributeId);
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

  logger.info(
    { vehicleId: vehicle.id, ok: missingFields.length === 0, missingFields, warnings },
    "meli.buildPayload.result"
  );

  return {
    ok: missingFields.length === 0,
    missingFields,
    warnings,
    mappedAttributes: attributes,
    payload: {
      title,
      category_id: categoryId || null,
      price,
      currency_id: currencyId || null,
      available_quantity: 1,
      buying_mode: "buy_it_now",
      listing_type_id: listingTypeId || null,
      condition: condition || null,
      pictures: pictures.map((picture) => ({ source: picture.url })),
      attributes
    }
  };
};

export default buildMeliVehiclePayload;
