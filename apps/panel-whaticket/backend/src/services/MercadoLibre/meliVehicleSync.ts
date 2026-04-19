import Vehicle from "../../models/Vehicle";
import { meliApiRequest } from "./meliClient";

const BATCH_SIZE = 20;

type MeliUser = {
  id: number;
  nickname: string;
};

type MeliSearchResult = {
  results: string[];
  paging: { total: number; offset: number; limit: number };
};

type MeliAttribute = {
  id: string;
  name: string;
  value_name: string | null;
};

type MeliPicture = {
  url: string;
  secure_url?: string;
};

type MeliItem = {
  id: string;
  title: string;
  price: number;
  currency_id: string;
  status: string;
  permalink: string;
  thumbnail?: string;
  pictures: MeliPicture[];
  attributes: MeliAttribute[];
  seller_id: number;
};

const attrValue = (attrs: MeliAttribute[], id: string): string | null => attrs.find((a) => a.id === id)?.value_name ?? null;

const mapItemToVehiclePatch = (item: MeliItem): Record<string, any> => {
  const attrs = item.attributes ?? [];
  const rawPictures = item.pictures ?? [];
  const pictures =
    rawPictures.length > 0
      ? rawPictures.map((picture, index) => ({
          url: picture.url || picture.secure_url,
          source: "meli",
          order: index,
          alt: "",
          isCover: index === 0
        }))
      : item.thumbnail
        ? [{ url: item.thumbnail, source: "meli", order: 0, alt: "", isCover: true }]
        : [];

  const yearStr = attrValue(attrs, "VEHICLE_YEAR");
  const kmStr = attrValue(attrs, "VEHICLE_MILEAGE");

  return {
    title: item.title,
    price: item.price,
    currency: item.currency_id === "ARS" ? "ARS" : item.currency_id,
    internalStatus: item.status === "active" ? "available" : "paused",
    meliItemId: item.id,
    meliPermalink: item.permalink,
    meliStatus: item.status,
    brand: attrValue(attrs, "BRAND"),
    model: attrValue(attrs, "MODEL"),
    version: attrValue(attrs, "TRIM") || attrValue(attrs, "VERSION"),
    year: yearStr ? parseInt(yearStr, 10) : null,
    km: kmStr ? parseFloat(kmStr.replace(/\D/g, "")) : null,
    fuel: attrValue(attrs, "FUEL_TYPE"),
    transmission: attrValue(attrs, "TRANSMISSION"),
    color: attrValue(attrs, "COLOR"),
    engine: attrValue(attrs, "ENGINE_DISPLACEMENT"),
    pictures
  };
};

export const getMeliUser = async (): Promise<MeliUser> => {
  const response = await meliApiRequest("/users/me");
  if (!response.ok) throw new Error(`MercadoLibre /users/me failed (${response.status})`);
  return response.body as MeliUser;
};

export const getMeliItemIds = async (userId: number): Promise<string[]> => {
  const ids: string[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const response = await meliApiRequest(`/users/${userId}/items/search?limit=${limit}&offset=${offset}`);
    if (!response.ok) {
      throw new Error(`MercadoLibre items/search failed (${response.status})`);
    }

    const data = response.body as MeliSearchResult;
    ids.push(...(data.results || []));

    const fetched = offset + (data.results || []).length;
    if (fetched >= data.paging.total || (data.results || []).length === 0) break;
    offset = fetched;
  }

  return ids;
};

export const getMeliItemsByIds = async (ids: string[]): Promise<MeliItem[]> => {
  const items: MeliItem[] = [];

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const response = await meliApiRequest(`/items?ids=${batch.join(",")}`);
    if (!response.ok) {
      throw new Error(`MercadoLibre items multiget failed (${response.status})`);
    }

    const data = response.body as Array<{ code: number; body: MeliItem }>;
    for (const entry of data || []) {
      if (entry.code === 200 && entry.body) items.push(entry.body);
    }
  }

  return items;
};

export const syncVehicleSnapshotFromMeli = async (vehicle: Vehicle): Promise<Vehicle> => {
  if (!vehicle.meliItemId) {
    throw new Error("vehicle_has_no_meli_item");
  }

  const response = await meliApiRequest(`/items/${vehicle.meliItemId}`);
  if (!response.ok) {
    throw new Error(`MercadoLibre fetch item failed (${response.status})`);
  }

  const patch = mapItemToVehiclePatch(response.body as MeliItem);
  await vehicle.update(patch as any);
  return vehicle;
};

