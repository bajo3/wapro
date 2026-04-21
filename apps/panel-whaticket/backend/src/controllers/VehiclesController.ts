import { Request, Response } from "express";
import { Op } from "sequelize";
import { v4 as uuidv4 } from "uuid";

import {
  dryRunVehicleForMeli,
  getMeliHealthStatus,
  logMeliVehicleError,
  pauseVehicleOnMeli,
  publishVehicleToMeli,
  reactivateVehicleOnMeli,
  syncVehicleToMeli,
  validateVehicleForMeli
} from "../helpers/meliVehiclesPublisher";
import {
  getVehicleCategoryRequirements,
  predictVehicleCategories
} from "../helpers/meliCategoriesService";
import Quotation from "../models/Quotation";
import Vehicle from "../models/Vehicle";
import { logger } from "../utils/logger";

type VehicleQuery = {
  q?: string;
  brand?: string;
  model?: string;
  year?: string;
  internalStatus?: string;
  meliStatus?: string;
  publishToMeli?: string;
  currency?: string;
  id?: string;
  limit?: string;
};

const cleanString = (value: any): string => String(value ?? "").trim();

const cleanNullableString = (value: any): string | null => {
  const normalized = cleanString(value);
  return normalized || null;
};

const cleanNumber = (value: any): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const cleanBoolean = (value: any): boolean | null => {
  if (typeof value === "boolean") return value;
  const normalized = cleanString(value).toLowerCase();
  if (!normalized) return null;
  if (["true", "1", "yes", "si"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return null;
};

const toSlug = (value: string): string =>
  cleanString(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);

const buildVehicleTitle = (vehicle: Partial<Vehicle>): string =>
  [vehicle.brand, vehicle.model, vehicle.version, vehicle.year]
    .map(cleanString)
    .filter(Boolean)
    .join(" ")
    .trim();

const normalizePictures = (input: any): Array<Record<string, any>> => {
  if (!input) return [];

  let pictures = input;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        pictures = JSON.parse(trimmed);
      } catch {
        pictures = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      }
    } else {
      pictures = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    }
  }

  if (!Array.isArray(pictures)) return [];

  return pictures
    .map((picture, index) => {
      if (typeof picture === "string") {
        const url = cleanString(picture);
        if (!url) return null;
        return {
          url,
          source: "manual",
          order: index,
          alt: "",
          isCover: index === 0
        };
      }

      if (!picture || typeof picture !== "object") return null;

      const url = cleanString(picture.url || picture.secure_url || picture.source);
      if (!url) return null;

      return {
        url,
        source: cleanString(picture.source || "manual") || "manual",
        order: Number.isFinite(Number(picture.order)) ? Number(picture.order) : index,
        alt: cleanString(picture.alt),
        isCover: Boolean(picture.isCover || picture.cover || index === 0)
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(a!.order || 0) - Number(b!.order || 0)) as Array<Record<string, any>>;
};

const normalizeImages = (input: any): Array<string | Record<string, any>> => {
  if (!input) return [];

  let images = input;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        images = JSON.parse(trimmed);
      } catch {
        images = trimmed.split(/[\r\n,]+/).map((entry) => entry.trim()).filter(Boolean);
      }
    } else {
      images = trimmed.split(/[\r\n,]+/).map((entry) => entry.trim()).filter(Boolean);
    }
  }

  if (!Array.isArray(images)) return [];

  return images
    .map((image) => {
      if (typeof image === "string") {
        const url = cleanString(image);
        return url || null;
      }

      if (!image || typeof image !== "object") return null;

      const url = cleanString(image.url || image.source || image.secure_url || image.src);
      if (!url) return null;

      return {
        ...image,
        url
      };
    })
    .filter(Boolean) as Array<string | Record<string, any>>;
};

const normalizeArray = (input: any): any[] => {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const serializeVehicle = (vehicle: Vehicle): Record<string, any> => {
  const title = cleanString(vehicle.title) || buildVehicleTitle(vehicle);
  const images = normalizeImages((vehicle as any).images);
  const pictures = normalizePictures(vehicle.pictures);
  const coverImage = images.find((image) => typeof image === "string" || image?.url) || null;
  const coverPicture = pictures.find((picture) => picture.isCover) || pictures[0] || null;
  const coverUrl =
    typeof coverImage === "string"
      ? coverImage
      : cleanString((coverImage as any)?.url || (coverImage as any)?.source || (coverImage as any)?.secure_url);
  const numericPrice = vehicle.price !== null && vehicle.price !== undefined ? Number(vehicle.price) : null;

  return {
    id: vehicle.id,
    slug: vehicle.slug,
    source: vehicle.source,
    internalStatus: vehicle.internalStatus,
    status: vehicle.internalStatus,
    title,
    brand: vehicle.brand,
    marca: vehicle.brand,
    model: vehicle.model,
    modelo: vehicle.model,
    version: vehicle.version,
    year: vehicle.year,
    km: vehicle.km,
    price: numericPrice,
    precio: numericPrice,
    currency: vehicle.currency,
    condition: vehicle.condition,
    color: vehicle.color,
    fuel: vehicle.fuel,
    transmission: vehicle.transmission,
    doors: vehicle.doors,
    engine: vehicle.engine,
    traction: vehicle.traction,
    bodyType: vehicle.bodyType,
    vehicleType: vehicle.vehicleType,
    domain: vehicle.domain,
    patent: vehicle.patent,
    plate: vehicle.plate,
    vin: vehicle.vin,
    locationCity: vehicle.locationCity,
    locationState: vehicle.locationState,
    description: vehicle.description,
    images,
    pictures,
    imageUrl: coverUrl || coverPicture?.url || null,
    permalink: vehicle.meliPermalink || vehicle.permalink || null,
    publishToMeli: Boolean(vehicle.publishToMeli),
    meliItemId: vehicle.meliItemId,
    meliStatus: vehicle.meliStatus,
    meliPermalink: vehicle.meliPermalink,
    meliCategoryId: vehicle.meliCategoryId,
    meliDomainId: vehicle.meliDomainId,
    meliListingTypeId: vehicle.meliListingTypeId,
    meliAttributes: Array.isArray(vehicle.meliAttributes) ? vehicle.meliAttributes : [],
    meliPayloadDraft: vehicle.meliPayloadDraft,
    meliLastSyncAt: vehicle.meliLastSyncAt,
    meliLastError: vehicle.meliLastError,
    meliValidationErrors: Array.isArray(vehicle.meliValidationErrors) ? vehicle.meliValidationErrors : [],
    createdAt: vehicle.createdAt,
    updatedAt: vehicle.updatedAt,
    label: [vehicle.brand, vehicle.model, vehicle.version, vehicle.year].filter(Boolean).join(" ").trim() || title
  };
};

const validateRequiredFields = (body: any): string[] => {
  const missing: string[] = [];
  if (!cleanString(body.brand)) missing.push("brand");
  if (!cleanString(body.model)) missing.push("model");
  if (cleanNumber(body.year) === null) missing.push("year");
  if (cleanNumber(body.price) === null) missing.push("price");
  if (!["ARS", "USD"].includes(cleanString(body.currency).toUpperCase())) missing.push("currency");
  if (!["new", "used"].includes(cleanString(body.condition).toLowerCase())) missing.push("condition");
  return missing;
};

const buildPatch = (body: any, userId?: number, currentVehicle?: Vehicle): Record<string, any> => {
  const brand = cleanNullableString(body.brand) ?? currentVehicle?.brand ?? null;
  const model = cleanNullableString(body.model) ?? currentVehicle?.model ?? null;
  const version = cleanNullableString(body.version) ?? currentVehicle?.version ?? null;
  const year = body.year !== undefined ? cleanNumber(body.year) : currentVehicle?.year ?? null;
  const inputTitle = body.title !== undefined ? cleanString(body.title) : cleanString(currentVehicle?.title);
  const title = inputTitle || buildVehicleTitle({ brand, model, version, year: year as any }) || null;

  const inputSlug = body.slug !== undefined ? cleanString(body.slug) : cleanString(currentVehicle?.slug);
  const slugSource = inputSlug || title || [brand, model, year].filter(Boolean).join(" ");

  const patch: Record<string, any> = {
    slug: slugSource ? toSlug(slugSource) : null,
    source: cleanNullableString(body.source) ?? currentVehicle?.source ?? "wapro",
    internalStatus: cleanNullableString(body.internalStatus) ?? currentVehicle?.internalStatus ?? "draft",
    title,
    brand,
    model,
    version,
    year,
    km: body.km !== undefined ? cleanNumber(body.km) : currentVehicle?.km ?? null,
    price: body.price !== undefined ? cleanNumber(body.price) : currentVehicle?.price ?? null,
    currency: body.currency !== undefined ? cleanString(body.currency).toUpperCase() || null : currentVehicle?.currency ?? null,
    condition: body.condition !== undefined ? cleanString(body.condition).toLowerCase() || null : currentVehicle?.condition ?? null,
    color: body.color !== undefined ? cleanNullableString(body.color) : currentVehicle?.color ?? null,
    fuel: body.fuel !== undefined ? cleanNullableString(body.fuel) : currentVehicle?.fuel ?? null,
    transmission: body.transmission !== undefined ? cleanNullableString(body.transmission) : currentVehicle?.transmission ?? null,
    doors: body.doors !== undefined ? cleanNumber(body.doors) : currentVehicle?.doors ?? null,
    engine: body.engine !== undefined ? cleanNullableString(body.engine) : currentVehicle?.engine ?? null,
    traction: body.traction !== undefined ? cleanNullableString(body.traction) : currentVehicle?.traction ?? null,
    bodyType: body.bodyType !== undefined ? cleanNullableString(body.bodyType) : currentVehicle?.bodyType ?? null,
    vehicleType: body.vehicleType !== undefined ? cleanNullableString(body.vehicleType) : currentVehicle?.vehicleType ?? null,
    domain: body.domain !== undefined ? cleanNullableString(body.domain) : currentVehicle?.domain ?? null,
    patent: body.patent !== undefined ? cleanNullableString(body.patent) : currentVehicle?.patent ?? null,
    plate: body.plate !== undefined ? cleanNullableString(body.plate) : currentVehicle?.plate ?? null,
    vin: body.vin !== undefined ? cleanNullableString(body.vin) : currentVehicle?.vin ?? null,
    locationCity: body.locationCity !== undefined ? cleanNullableString(body.locationCity) : currentVehicle?.locationCity ?? null,
    locationState: body.locationState !== undefined ? cleanNullableString(body.locationState) : currentVehicle?.locationState ?? null,
    description: body.description !== undefined ? cleanNullableString(body.description) : currentVehicle?.description ?? null,
    images: body.images !== undefined ? normalizeImages(body.images) : normalizeImages((currentVehicle as any)?.images),
    pictures: body.pictures !== undefined ? normalizePictures(body.pictures) : normalizePictures(currentVehicle?.pictures),
    permalink: body.permalink !== undefined ? cleanNullableString(body.permalink) : currentVehicle?.permalink ?? null,
    publishToMeli: body.publishToMeli !== undefined ? Boolean(cleanBoolean(body.publishToMeli)) : Boolean(currentVehicle?.publishToMeli),
    meliItemId: body.meliItemId !== undefined ? cleanNullableString(body.meliItemId) : currentVehicle?.meliItemId ?? null,
    meliStatus: body.meliStatus !== undefined ? cleanNullableString(body.meliStatus) : currentVehicle?.meliStatus ?? null,
    meliPermalink: body.meliPermalink !== undefined ? cleanNullableString(body.meliPermalink) : currentVehicle?.meliPermalink ?? null,
    meliCategoryId: body.meliCategoryId !== undefined ? cleanNullableString(body.meliCategoryId) : currentVehicle?.meliCategoryId ?? null,
    meliDomainId: body.meliDomainId !== undefined ? cleanNullableString(body.meliDomainId) : currentVehicle?.meliDomainId ?? null,
    meliListingTypeId:
      body.meliListingTypeId !== undefined ? cleanNullableString(body.meliListingTypeId) : currentVehicle?.meliListingTypeId ?? null,
    meliAttributes: body.meliAttributes !== undefined ? normalizeArray(body.meliAttributes) : normalizeArray(currentVehicle?.meliAttributes),
    meliPayloadDraft: body.meliPayloadDraft !== undefined ? body.meliPayloadDraft : currentVehicle?.meliPayloadDraft ?? null,
    meliLastSyncAt: body.meliLastSyncAt !== undefined ? body.meliLastSyncAt || null : currentVehicle?.meliLastSyncAt ?? null,
    meliLastError: body.meliLastError !== undefined ? cleanNullableString(body.meliLastError) : currentVehicle?.meliLastError ?? null,
    meliValidationErrors:
      body.meliValidationErrors !== undefined
        ? normalizeArray(body.meliValidationErrors)
        : normalizeArray(currentVehicle?.meliValidationErrors),
    updatedByUserId: userId ?? currentVehicle?.updatedByUserId ?? null
  };

  if (!currentVehicle) {
    patch.id = cleanString(body.id) || uuidv4();
    patch.createdByUserId = userId ?? null;
  }

  return patch;
};

const persistMeliResult = async (vehicle: Vehicle, result: any, userId?: number) => {
  const patch: Record<string, any> = {
    meliPayloadDraft: result.payloadPreview,
    meliValidationErrors: Array.from(
      new Set([
        ...(Array.isArray(result.missingFields) ? result.missingFields : []),
        ...(Array.isArray(result.fatalErrors) ? result.fatalErrors : [])
      ])
    ),
    updatedByUserId: userId ?? vehicle.updatedByUserId ?? null
  };

  if (result.ok) {
    if (result.action === "validate" || result.action === "dry-run") {
      patch.meliValidationErrors = [];
    }
    patch.meliItemId = result.meliItemId ?? vehicle.meliItemId ?? null;
    patch.meliPermalink = result.permalink ?? vehicle.meliPermalink ?? null;
    patch.meliStatus = result.meliStatus ?? vehicle.meliStatus ?? null;
    patch.meliLastSyncAt = result.apiCalled ? new Date() : vehicle.meliLastSyncAt ?? null;
    patch.meliLastError = null;
    if (result.action === "publish" || result.action === "sync" || result.action === "reactivate") {
      patch.publishToMeli = true;
    }
    if (result.action === "pause") {
      patch.internalStatus = "paused";
    }
    if (result.action === "reactivate" && vehicle.internalStatus === "paused") {
      patch.internalStatus = "available";
    }
  } else {
    patch.meliLastError =
      result.error ||
      (Array.isArray(result.missingFields) ? result.missingFields.join(", ") : "") ||
      vehicle.meliLastError ||
      null;
  }

  await vehicle.update(patch as any);
  return vehicle;
};

const sendMeliActionResponse = async (
  req: Request,
  res: Response,
  vehicle: Vehicle,
  action: Promise<any>
): Promise<Response> => {
  try {
    const result = await action;
    await persistMeliResult(vehicle, result, (req as any).user?.id);

    const statusCode = result.statusCode || (result.ok ? 200 : result.apiCalled ? 502 : 400);
    return res.status(statusCode).json({
      vehicleId: vehicle.id,
      ok: result.ok,
      missingFields: result.missingFields,
      warnings: result.warnings,
      fatalErrors: Array.isArray(result.fatalErrors) ? result.fatalErrors : [],
      payloadPreview: result.payloadPreview,
      inputSnapshot: result.inputSnapshot || null,
      meliItemId: result.meliItemId ?? vehicle.meliItemId ?? null,
      permalink: result.permalink ?? vehicle.meliPermalink ?? null,
      meliStatus: result.meliStatus ?? vehicle.meliStatus ?? null,
      error: result.error || null
    });
  } catch (error) {
    logMeliVehicleError("vehicles.ml.action.failed", error);
    await vehicle.update({
      meliLastError: String((error as any)?.message || error || "meli_vehicle_action_failed"),
      updatedByUserId: (req as any).user?.id ?? vehicle.updatedByUserId ?? null
    } as any);
    return res.status(500).json({ ok: false, error: "meli_vehicle_action_failed" });
  }
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  try {
    const {
      q = "",
      brand,
      model,
      year,
      internalStatus,
      meliStatus,
      publishToMeli,
      currency,
      id,
      limit = "100"
    } = req.query as VehicleQuery;

    const where: any = {};
    const normalizedQ = cleanString(q);
    const normalizedId = cleanString(id);
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200);

    if (normalizedId) where.id = normalizedId;
    if (brand) where.brand = { [Op.iLike]: `%${cleanString(brand)}%` };
    if (model) where.model = { [Op.iLike]: `%${cleanString(model)}%` };
    if (cleanNumber(year) !== null) where.year = cleanNumber(year);
    if (internalStatus) where.internalStatus = cleanString(internalStatus);
    if (meliStatus) where.meliStatus = cleanString(meliStatus);
    if (currency) where.currency = cleanString(currency).toUpperCase();

    const publishToMeliBool = cleanBoolean(publishToMeli);
    if (publishToMeliBool !== null) where.publishToMeli = publishToMeliBool;

    if (normalizedQ) {
      where[Op.or] = [
        { title: { [Op.iLike]: `%${normalizedQ}%` } },
        { brand: { [Op.iLike]: `%${normalizedQ}%` } },
        { model: { [Op.iLike]: `%${normalizedQ}%` } },
        { version: { [Op.iLike]: `%${normalizedQ}%` } },
        { domain: { [Op.iLike]: `%${normalizedQ}%` } },
        { plate: { [Op.iLike]: `%${normalizedQ}%` } }
      ];
    }

    const vehicles = await Vehicle.findAll({
      where,
      order: [["updatedAt", "DESC"]],
      limit: safeLimit
    });

    return res.json({ vehicles: vehicles.map(serializeVehicle) });
  } catch (error) {
    logger.error({ error, query: req.query }, "vehicles.index.failed");
    return res.status(500).json({ vehicles: [], error: "vehicles_list_failed" });
  }
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  try {
    const vehicle = await Vehicle.findByPk(String(req.params.id));
    if (!vehicle) {
      return res.status(404).json({ ok: false, error: "vehicle_not_found" });
    }

    return res.json({ vehicle: serializeVehicle(vehicle) });
  } catch (error) {
    logger.error({ error, vehicleId: req.params.id }, "vehicles.show.failed");
    return res.status(500).json({ ok: false, error: "vehicle_show_failed" });
  }
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  try {
    const missingFields = validateRequiredFields(req.body || {});
    if (missingFields.length) {
      return res.status(400).json({ ok: false, error: "missing_required_fields", missingFields });
    }

    const patch = buildPatch(req.body || {}, (req as any).user?.id);
    const vehicle = await Vehicle.create(patch as any);

    return res.status(201).json({ vehicle: serializeVehicle(vehicle) });
  } catch (error) {
    logger.error({ error, body: req.body }, "vehicles.store.failed");
    return res.status(500).json({ ok: false, error: "vehicle_create_failed" });
  }
};

export const update = async (req: Request, res: Response): Promise<Response> => {
  try {
    const vehicle = await Vehicle.findByPk(String(req.params.id));
    if (!vehicle) {
      return res.status(404).json({ ok: false, error: "vehicle_not_found" });
    }

    const patch = buildPatch(req.body || {}, (req as any).user?.id, vehicle);

    logger.info(
      {
        vehicleId: String(req.params.id),
        incoming: {
          meliCategoryId: req.body?.meliCategoryId ?? "NOT_IN_BODY",
          condition: req.body?.condition ?? "NOT_IN_BODY",
          meliListingTypeId: req.body?.meliListingTypeId ?? "NOT_IN_BODY"
        },
        patch: {
          meliCategoryId: patch.meliCategoryId ?? null,
          condition: patch.condition ?? null,
          meliListingTypeId: patch.meliListingTypeId ?? null
        }
      },
      "vehicles.update.meli_fields"
    );

    await vehicle.update(patch as any);

    logger.info(
      {
        vehicleId: vehicle.id,
        saved: {
          meliCategoryId: vehicle.meliCategoryId ?? null,
          condition: vehicle.condition ?? null,
          meliListingTypeId: vehicle.meliListingTypeId ?? null
        }
      },
      "vehicles.update.meli_fields.saved"
    );

    return res.json({ vehicle: serializeVehicle(vehicle) });
  } catch (error) {
    logger.error({ error, vehicleId: req.params.id, body: req.body }, "vehicles.update.failed");
    return res.status(500).json({ ok: false, error: "vehicle_update_failed" });
  }
};

export const updateStatus = async (req: Request, res: Response): Promise<Response> => {
  try {
    const vehicle = await Vehicle.findByPk(String(req.params.id));
    if (!vehicle) {
      return res.status(404).json({ ok: false, error: "vehicle_not_found" });
    }

    const nextStatus = cleanString(req.body?.internalStatus || req.body?.status);
    if (!["available", "reserved", "sold", "paused", "draft"].includes(nextStatus)) {
      return res.status(400).json({ ok: false, error: "invalid_internal_status" });
    }

    await vehicle.update({
      internalStatus: nextStatus,
      updatedByUserId: (req as any).user?.id ?? vehicle.updatedByUserId
    } as any);

    return res.json({ vehicle: serializeVehicle(vehicle) });
  } catch (error) {
    logger.error({ error, vehicleId: req.params.id, body: req.body }, "vehicles.updateStatus.failed");
    return res.status(500).json({ ok: false, error: "vehicle_status_update_failed" });
  }
};

export const remove = async (req: Request, res: Response): Promise<Response> => {
  try {
    const vehicle = await Vehicle.findByPk(String(req.params.id));
    if (!vehicle) {
      return res.status(404).json({ ok: false, error: "vehicle_not_found" });
    }

    if (vehicle.meliItemId) {
      if (vehicle.internalStatus !== "paused") {
        await vehicle.update({
          internalStatus: "paused",
          updatedByUserId: (req as any).user?.id ?? vehicle.updatedByUserId
        } as any);

        return res.json({
          ok: true,
          action: "paused_instead_of_delete",
          message: "El vehículo tiene publicación ML asociada. Se pausó localmente en lugar de borrarse.",
          vehicle: serializeVehicle(vehicle)
        });
      }

      return res.status(409).json({
        ok: false,
        error: "vehicle_linked_to_meli",
        message: "El vehículo sigue vinculado a MercadoLibre. Primero cerrá o desvinculá la publicación."
      });
    }

    await Quotation.update(
      { vehicleRefId: null, vehicleLabel: null } as any,
      { where: { vehicleRefId: String(vehicle.id) } }
    );

    await vehicle.destroy();

    return res.json({ ok: true, deleted: String(req.params.id) });
  } catch (error) {
    logger.error({ error, vehicleId: req.params.id }, "vehicles.remove.failed");
    return res.status(500).json({ ok: false, error: "vehicle_delete_failed" });
  }
};

export const validateMeliPayload = async (req: Request, res: Response): Promise<Response> => {
  const vehicle = await Vehicle.findByPk(String(req.params.id));
  if (!vehicle) {
    return res.status(404).json({ ok: false, error: "vehicle_not_found" });
  }

  return sendMeliActionResponse(req, res, vehicle, validateVehicleForMeli(vehicle));
};

export const validateMl = async (req: Request, res: Response): Promise<Response> => validateMeliPayload(req, res);

export const dryRunMl = async (req: Request, res: Response): Promise<Response> => {
  const vehicle = await Vehicle.findByPk(String(req.params.id));
  if (!vehicle) {
    return res.status(404).json({ ok: false, error: "vehicle_not_found" });
  }

  return sendMeliActionResponse(req, res, vehicle, dryRunVehicleForMeli(vehicle));
};

export const clearMlError = async (req: Request, res: Response): Promise<Response> => {
  try {
    const vehicle = await Vehicle.findByPk(String(req.params.id));
    if (!vehicle) {
      return res.status(404).json({ ok: false, error: "vehicle_not_found" });
    }

    await vehicle.update({
      meliLastError: null,
      meliValidationErrors: [],
      updatedByUserId: (req as any).user?.id ?? vehicle.updatedByUserId ?? null
    } as any);

    return res.json({ ok: true, vehicle: serializeVehicle(vehicle) });
  } catch (error) {
    logger.error({ error, vehicleId: req.params.id }, "vehicles.ml.clearError.failed");
    return res.status(500).json({ ok: false, error: "vehicle_ml_clear_error_failed" });
  }
};

export const predictMlCategory = async (req: Request, res: Response): Promise<Response> => {
  try {
    const vehicle = await Vehicle.findByPk(String(req.params.id));
    if (!vehicle) {
      return res.status(404).json({ ok: false, error: "vehicle_not_found" });
    }

    const title = cleanString(vehicle.title) || buildVehicleTitle(vehicle);
    if (!title) {
      return res.status(400).json({ ok: false, error: "vehicle_title_required_for_category_prediction" });
    }

    const suggestions = await predictVehicleCategories(title);
    const shouldApply = Boolean(req.body?.apply);
    const selected = suggestions[0] || null;

    if (shouldApply && selected?.category_id) {
      await vehicle.update({
        meliCategoryId: selected.category_id,
        meliDomainId: selected.domain_id || vehicle.meliDomainId || null,
        meliLastError: null,
        updatedByUserId: (req as any).user?.id ?? vehicle.updatedByUserId ?? null
      } as any);
    }

    return res.json({
      ok: suggestions.length > 0,
      applied: Boolean(shouldApply && selected?.category_id),
      title,
      suggestions
    });
  } catch (error) {
    logger.error({ error, vehicleId: req.params.id }, "vehicles.ml.predictCategory.failed");
    return res.status(502).json({
      ok: false,
      error: String((error as any)?.message || error || "meli_category_predict_failed")
    });
  }
};

export const categoryRequirementsMl = async (req: Request, res: Response): Promise<Response> => {
  try {
    const vehicle = await Vehicle.findByPk(String(req.params.id));
    if (!vehicle) {
      return res.status(404).json({ ok: false, error: "vehicle_not_found" });
    }

    if (!cleanString(vehicle.meliCategoryId)) {
      return res.status(400).json({ ok: false, error: "vehicle_missing_meli_category_id" });
    }

    const requirements = await getVehicleCategoryRequirements(vehicle);
    return res.json({
      ok: true,
      ...requirements
    });
  } catch (error) {
    const message = String((error as any)?.message || error || "meli_category_requirements_failed");
    logger.error({ error, vehicleId: req.params.id }, "vehicles.ml.categoryRequirements.failed");
    return res.status(message === "vehicle_missing_meli_category_id" ? 400 : 502).json({
      ok: false,
      error: message
    });
  }
};

export const publishMl = async (req: Request, res: Response): Promise<Response> => {
  const vehicle = await Vehicle.findByPk(String(req.params.id));
  if (!vehicle) {
    return res.status(404).json({ ok: false, error: "vehicle_not_found" });
  }

  return sendMeliActionResponse(req, res, vehicle, publishVehicleToMeli(vehicle, (req as any).meliDeps));
};

export const syncMl = async (req: Request, res: Response): Promise<Response> => {
  const vehicle = await Vehicle.findByPk(String(req.params.id));
  if (!vehicle) {
    return res.status(404).json({ ok: false, error: "vehicle_not_found" });
  }

  return sendMeliActionResponse(req, res, vehicle, syncVehicleToMeli(vehicle, (req as any).meliDeps));
};

export const pauseMl = async (req: Request, res: Response): Promise<Response> => {
  const vehicle = await Vehicle.findByPk(String(req.params.id));
  if (!vehicle) {
    return res.status(404).json({ ok: false, error: "vehicle_not_found" });
  }

  return sendMeliActionResponse(req, res, vehicle, pauseVehicleOnMeli(vehicle, (req as any).meliDeps));
};

export const reactivateMl = async (req: Request, res: Response): Promise<Response> => {
  const vehicle = await Vehicle.findByPk(String(req.params.id));
  if (!vehicle) {
    return res.status(404).json({ ok: false, error: "vehicle_not_found" });
  }

  return sendMeliActionResponse(req, res, vehicle, reactivateVehicleOnMeli(vehicle, (req as any).meliDeps));
};

export const mlHealth = async (req: Request, res: Response): Promise<Response> => {
  try {
    const health = await getMeliHealthStatus();
    return res.json(health);
  } catch (error) {
    logger.error({ error }, "vehicles.ml.health.failed");
    return res.status(500).json({
      hasTokenRow: false,
      hasAccessToken: false,
      hasRefreshToken: false,
      expiresAt: null,
      isExpired: true,
      publishEnabled: process.env.MELI_PUBLISH_ENABLED === "true",
      canAttemptRefresh: false,
      error: "meli_health_failed"
    });
  }
};

export const debug = async (_req: Request, res: Response): Promise<Response> => {
  try {
    const count = await Vehicle.count();
    return res.json({
      ok: true,
      supabase: false,
      source: {
        schema: "public",
        table: "vehicles",
        mode: "sequelize"
      },
      count
    });
  } catch (error) {
    logger.error({ error }, "vehicles.debug.failed");
    return res.status(500).json({ ok: false, error: "catalog_debug_failed" });
  }
};
