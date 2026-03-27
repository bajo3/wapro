import fetch from "node-fetch";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../lib/env.js";
import { pool } from "./db.js";

export type CatalogItem = {
  id: string;
  name: string;

  // Nuevo schema
  priceNumber?: number;
  currency?: "ARS" | "USD" | string;
  priceText?: string;

  inStock?: boolean;

  url?: string;
  image?: string;

  category?: string;
  description?: string; // limpio, sin hashtags ni prefijos
  descriptionRaw?: string; // opcional, backup

  // Vehicle-oriented optional fields (used when catalog comes from public.vehicles)
  brand?: string;
  model?: string;
  version?: string;
  year?: number;
  km?: number;
  /** true = 0km (nuevo), false = usado */
  isNew?: boolean;
  transmission?: string;
  engine?: string;
  fuel?: string;
  color?: string;
  /** Carrocería: suv | pickup | sedan | hatch | furgon | familiar | monovolumen | coupe */
  bodywork?: string;
};

const sample: CatalogItem[] = [
  { id: "ps5", name: "PlayStation 5 Slim", priceNumber: 999999, currency: "ARS", inStock: true, category: "consolas" },
  { id: "xbox", name: "Xbox Series X", priceNumber: 999999, currency: "ARS", inStock: true, category: "consolas" },
  { id: "headset", name: "Auriculares Gamer HyperX Cloud Stinger", priceNumber: 99999, currency: "ARS", inStock: true, category: "auriculares" },
  { id: "monitor", name: 'Monitor 24" 144Hz', priceNumber: 249999, currency: "ARS", inStock: true, category: "monitores" }
];

let cached: CatalogItem[] | null = null;
let cachedAt = 0;

type VehicleRow = {
  id: string;
  title: string | null;
  brand: string | null;
  model: string | null;
  version: string | null;
  year: number | null;
  price: string | number | null;
  currency: string | null;
  slug: string | null;
  pictures: string[] | null;
  permalink: string | null;
  status: string | null;
  // legacy columns
  Km: number | null;
  Motor: string | null;
  Caja: string | null;
  Combustible: string | null;
  // new-ish columns
  km: number | null;
  engine: string | null;
  transmission: string | null;
  color: string | null;
  bodywork: string | null;
};

function coerceNumber(v: any): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Infiere la carrocería del vehículo a partir de campos de texto.
 * Prioriza el campo explícito de DB; si falta, intenta parsear desde título/modelo/versión.
 */
function inferBodyworkFromRow(
  title: string,
  model: string,
  version: string | undefined,
  dbBodywork: string | null | undefined
): string | undefined {
  if (dbBodywork) {
    const b = dbBodywork.trim().toLowerCase();
    if (b) return b;
  }
  const txt = `${title} ${model} ${version ?? ""}`.toLowerCase();
  if (/\b(suv|crossover|4x4|awd|todoterreno)\b/.test(txt)) return "suv";
  if (/\b(pickup|pick\s*up|doble\s*cabina)\b/.test(txt)) return "pickup";
  if (/\b(sedan|4\s*puertas?)\b/.test(txt)) return "sedan";
  if (/\b(hatch|hatchback|3\s*puertas?)\b/.test(txt)) return "hatch";
  if (/\b(familiar|estate|sw|kombi|touring)\b/.test(txt)) return "familiar";
  if (/\b(monovolumen|minivan|van|mpv)\b/.test(txt)) return "monovolumen";
  if (/\b(furgon|utilitario|cargo)\b/.test(txt)) return "furgon";
  if (/\b(coupe|coup[eé]|2\s*puertas?)\b/.test(txt)) return "coupe";
  if (/\b(camioneta)\b/.test(txt)) return "pickup"; // camioneta → pickup
  return undefined;
}

async function loadVehiclesFromDb(timeoutMs: number): Promise<CatalogItem[]> {
  const where: string[] = ["status = 'active'"];
  const params: any[] = [];

  if (env.catalogDealershipId) {
    params.push(env.catalogDealershipId);
    where.push(`dealership_id = $${params.length}`);
  }

  const sql = `
    select
      id,
      title,
      brand,
      model,
      version,
      year,
      price,
      currency,
      slug,
      pictures,
      permalink,
      status,
      "Km" as "Km",
      "Motor" as "Motor",
      "Caja" as "Caja",
      "Combustible" as "Combustible",
      km,
      engine,
      transmission,
      color,
      bodywork
    from public.vehicles
    where ${where.join(" and ")}
    order by updated_at desc nulls last
    limit 500
  `;

  const q = pool.query<VehicleRow>(sql, params);
  const r = await Promise.race([
    q,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("vehicles query timeout")), timeoutMs))
  ]);

  const rows = (r as any).rows as VehicleRow[];

  return rows
    .map((row) => {
      const title = (row.title ?? "").trim();
      const brand = (row.brand ?? "").trim();
      const model = (row.model ?? "").trim();
      const version = (row.version ?? "").trim() || undefined;

      const structuredName = [brand, model, version].filter(Boolean).join(" ");
      const name = structuredName || title || row.id;
      const year = row.year ?? undefined;
      const km = coerceNumber(row.km ?? row.Km);
      // isNew: km === 0 explícito, o status contiene "0km" / "nuevo" / "new"
      const statusStr = (row.status ?? "").toLowerCase();
      const isNew: boolean = km === 0 || /\b(0\s*km|nuevo|new)\b/.test(statusStr);
      const transmission = (row.transmission ?? row.Caja ?? undefined)?.toString().trim();
      const engine = (row.engine ?? row.Motor ?? undefined)?.toString().trim();
      const fuel = (row.Combustible ?? undefined)?.toString().trim();
      const color = (row.color ?? undefined)?.toString().trim();
      const bodywork = inferBodyworkFromRow(title, model, version, row.bodywork);

      const priceNumber = coerceMoneyNumber(row.price);
      // Heurística de moneda:
      // - Si currency ya dice USD → USD
      // - Si currency dice ARS pero el precio es < 1.000.000 Y no es 0km → sospecha USD
      //   (un 0km en ARS puede valer menos de 1M en versiones baratas, no confundir)
      // - Si currency dice ARS y el precio es < 50.000 → casi seguro USD (nunca ARS tan bajo)
      const rawCurrency = (row.currency ?? 'ARS') as string;
      const currency = ((): string => {
        if (rawCurrency.toUpperCase() === 'USD') return 'USD';
        if (priceNumber !== undefined) {
          if (priceNumber < 10_000) return 'USD'; // por debajo de 10k ARS es claramente USD
          if (!isNew && priceNumber < 500_000) return 'USD'; // usado < 500k ARS → sospecha USD
        }
        return rawCurrency;
      })() as any;

      const url = row.permalink
        ? String(row.permalink)
        : env.publicUrl && row.slug
          ? `${env.publicUrl.replace(/\/$/, "")}/autos/${row.slug}`
          : undefined;

      const pics = Array.isArray(row.pictures) ? row.pictures : [];
      const image = normalizeImageUrl(pics[0] ?? pics[1], url);

      const parts: string[] = [];
      if (year) parts.push(String(year));
      if (isNew) {
        parts.push("0 km");
      } else if (km !== undefined) {
        parts.push(`${Math.round(km).toLocaleString("es-AR")} km`);
      } else {
        parts.push("km sin datos");
      }
      if (transmission) parts.push(transmission);
      if (fuel) parts.push(fuel);
      if (engine) parts.push(engine);
      if (color) parts.push(color);

      const description = parts.length ? parts.join(" · ") : undefined;

      return {
        id: String(row.id),
        name,
        priceNumber,
        currency,
        inStock: true,
        url,
        image,
        category: brand || "autos",
        description,
        descriptionRaw: undefined,
        brand: brand || undefined,
        model: model || undefined,
        version,
        year,
        km,
        isNew,
        transmission,
        engine,
        fuel,
        color,
        bodywork
      } as CatalogItem;
    })
    .filter((x) => x.id && x.name);
}


async function loadVehiclesFromSimpleDb(timeoutMs: number): Promise<CatalogItem[]> {
  const sql = `
    select
      id,
      marca,
      modelo,
      version,
      year,
      precio,
      currency
    from public.vehicles
    limit 500
  `;

  const q = pool.query(sql);
  const r = await Promise.race([
    q,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("vehicles simple query timeout")), timeoutMs))
  ]);

  const rows = (r as any).rows ?? [];

  return rows
    .map((row: any) => {
      const brand = String(row.marca ?? '').trim();
      const model = String(row.modelo ?? '').trim();
      const version = String(row.version ?? '').trim();
      const year = coerceNumber(row.year);
      const priceNumber = coerceMoneyNumber(row.precio);
      const currency = String(row.currency ?? (priceNumber !== undefined ? 'ARS' : '')).trim() || undefined;
      const name = [brand, model, version].filter(Boolean).join(' ').trim() || String(row.id ?? '');
      return {
        id: String(row.id ?? ''),
        name,
        priceNumber,
        currency,
        inStock: true,
        category: brand || 'autos',
        brand: brand || undefined,
        model: model || undefined,
        year
      } as CatalogItem;
    })
    .filter((x: CatalogItem) => x.id && x.name);
}

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}+/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Lightweight synonym handling (no LLM, low-cost).
 */
function applySynonyms(text: string): string {
  return text
    .replace(/\b(play\s*station\s*5|play\s*5|ps\s*5)\b/g, "ps5")
    .replace(/\b(play\s*station\s*4|play\s*4|ps\s*4)\b/g, "ps4")
    .replace(/\b(auris|auri|auricular(?:es)?|headset)\b/g, "auriculares")
    .replace(/\b(mando|control)\b/g, "joystick");
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: "GET", signal: controller.signal as any });
    if (!r.ok) throw new Error(`CATALOG_JSON_URL fetch failed: ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

function isNonEmptyString(v: any): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function slugToTitle(slug: string) {
  const s = slug
    .replace(/\?.*$/, "")
    .replace(/#.*$/, "")
    .replace(/\.(json|html?)$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function tryDeriveNameFromUrl(u?: string) {
  if (!u) return "";
  try {
    const url = new URL(u);
    const parts = url.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] ?? "";
    return slugToTitle(last);
  } catch {
    const last = String(u).split("/").filter(Boolean).pop() ?? "";
    return slugToTitle(last);
  }
}

function normalizeImageUrl(image?: string, productUrl?: string): string | undefined {
  if (!image) return undefined;
  const raw = String(image).trim();
  if (!raw) return undefined;
  // Already absolute
  if (/^https?:\/\//i.test(raw)) return raw;
  // Try to resolve relative paths against product URL origin
  if (productUrl) {
    try {
      const resolved = new URL(raw, productUrl);
      return resolved.toString();
    } catch {
      // fall through
    }
  }
  // Unknown base: return as-is (Evolution may still accept it if reachable)
  return raw;
}

function stripHashtags(text: string) {
  return (text || "").replace(/#[\p{L}0-9_]+/gu, " ");
}

function stripDescriptionPrefix(text: string) {
  return (text || "").replace(/^\s*descripci[oó]n\s+del\s+producto\s*/i, "");
}

function cleanDescription(text?: string) {
  if (!text) return undefined;
  const cleaned = stripHashtags(stripDescriptionPrefix(text))
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || undefined;
}

function coerceMoneyNumber(v: any): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "number" && Number.isFinite(v)) return v;

  // ejemplo "$ 70.500,00" -> 70500
  const s = String(v).trim();
  if (!s) return undefined;

  // Si viene con miles "." y decimales "," (es-AR), convertimos bien
  // 70.500,00 -> 70500.00
  const normalized = s
    .replace(/[^\d.,-]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "") // quita separadores de miles "."
    .replace(",", "."); // decimal a "."

  const n = Number(normalized);
  return Number.isFinite(n) ? n : undefined;
}

function coerceBoolean(v: any): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "si", "sí", "1", "in_stock", "stock", "available"].includes(s)) return true;
    if (["false", "no", "0", "out_of_stock", "sin_stock", "unavailable"].includes(s)) return false;
  }
  return undefined;
}

async function tryLoadLocalCatalog(): Promise<any[] | null> {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    // Este archivo está en apps/bot/services/ -> el JSON está en apps/bot/catalog/
    const candidates = [
      path.resolve(__dirname, "../catalog/catalog.json"),
      path.resolve(__dirname, "../catalog.json"),

      // por si el cwd es repo root
      path.resolve(process.cwd(), "apps/bot/catalog/catalog.json"),
      path.resolve(process.cwd(), "apps/bot/catalog.json"),

      // por si el cwd ya es apps/bot
      path.resolve(process.cwd(), "catalog/catalog.json"),
      path.resolve(process.cwd(), "catalog.json")
    ];

    for (const p of candidates) {
      try {
        const raw = await fs.readFile(p, "utf8");
        const json = JSON.parse(raw);
        if (Array.isArray(json)) return json;
      } catch {
        // continue
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function getCatalog(): Promise<CatalogItem[]> {
  const ttlMs = Number.isFinite(env.catalogCacheTtlMs) ? env.catalogCacheTtlMs : 300000;
  const timeoutMs = Number.isFinite(env.catalogFetchTimeoutMs) ? env.catalogFetchTimeoutMs : 4000;

  const now = Date.now();

  // If no JSON URL is configured, use the vehicles table from the connected Postgres DB.
  if (!env.catalogJsonUrl) {
    if (cached && now - cachedAt < ttlMs) return cached;
    try {
      const items = await loadVehiclesFromDb(timeoutMs);
      if (items.length) {
        cached = items;
        cachedAt = now;
        return items;
      }
    } catch {
      // fall back below
    }

    try {
      const simpleItems = await loadVehiclesFromSimpleDb(timeoutMs);
      if (simpleItems.length) {
        cached = simpleItems;
        cachedAt = now;
        return simpleItems;
      }
    } catch {
      // fall back below
    }

    // Dev fallback: if DB has no vehicles, try local JSON; otherwise sample.
    const local = await tryLoadLocalCatalog();
    if (!local) return sample;
    try {
      const items = mapRawCatalog(local);
      cached = items;
      cachedAt = now;
      return items;
    } catch {
      return sample;
    }
  }

  if (cached && now - cachedAt < ttlMs) return cached;

  try {
    const json = (await fetchJsonWithTimeout(env.catalogJsonUrl, timeoutMs)) as any;
    if (!Array.isArray(json)) throw new Error("CATALOG_JSON_URL must return a JSON array");

    cached = mapRawCatalog(json);
    cachedAt = now;
    return cached;
  } catch {
    if (cached) return cached;
    return sample;
  }
}

function mapRawCatalog(json: any[]): CatalogItem[] {
  return json
    .map((x) => {
      const url = isNonEmptyString(x.url)
        ? x.url
        : isNonEmptyString(x.productUrl)
          ? x.productUrl
          : undefined;

      const name = isNonEmptyString(x.name)
        ? x.name
        : isNonEmptyString(x.title)
          ? x.title
          : tryDeriveNameFromUrl(url);

      const id = isNonEmptyString(x.id)
        ? x.id
        : isNonEmptyString(x.sku)
          ? x.sku
          : isNonEmptyString(x.slug)
            ? x.slug
            : name || String(url ?? "");

      const descriptionRaw = isNonEmptyString(x.descriptionRaw) ? x.descriptionRaw : isNonEmptyString(x.description) ? x.description : undefined;
      const description = cleanDescription(isNonEmptyString(x.description) ? x.description : descriptionRaw);

      const priceNumber =
        coerceMoneyNumber(x.priceNumber) ??
        coerceMoneyNumber(x.priceArs) ?? // compat viejo
        coerceMoneyNumber(x.price) ??
        coerceMoneyNumber(x.price_ars) ??
        coerceMoneyNumber(x.precio) ??
        undefined;

      const priceText = isNonEmptyString(x.priceText) ? x.priceText : isNonEmptyString(x.priceFormatted) ? x.priceFormatted : undefined;
      const currency = isNonEmptyString(x.currency) ? x.currency : (priceNumber !== undefined ? "ARS" : undefined);

      const rawImage = isNonEmptyString(x.image) ? x.image : isNonEmptyString(x.imageUrl) ? x.imageUrl : undefined;
      const image = normalizeImageUrl(rawImage, url);
      const category = isNonEmptyString(x.category) ? x.category : undefined;

      const inStock =
        coerceBoolean(x.inStock) ??
        coerceBoolean(x.stock) ?? // si algún día ponés stock number, esto lo toma como boolean
        undefined;

      return {
        id: String(id),
        name: String(name ?? "").trim(),
        url,
        image,
        category,
        description,
        descriptionRaw,
        priceNumber,
        priceText,
        currency,
        inStock
      } as CatalogItem;
    })
    .filter((x) => x.id && x.name)
    // si querés filtrar sin stock acá:
    .filter((x) => x.inStock !== false);
}

/**
 * Expansión de sinónimos para búsqueda vehicular.
 * Mapea términos coloquiales a sus equivalentes normalizados.
 */
const VEHICLE_SEARCH_SYNONYMS: Record<string, string[]> = {
  suv: ["crossover", "4x4", "cuatro por cuatro", "todoterreno"],
  pickup: ["camioneta", "pick up", "doble cabina"],
  sedan: ["4 puertas"],
  hatch: ["hatchback", "3 puertas"],
  familiar: ["estate", "sw", "kombi"],
  monovolumen: ["minivan", "van", "mpv"],
  automatico: ["automatica", "tiptronic", "dsg", "cvt"],
  manual: ["sincronico"],
  nafta: ["gasolina", "naftero"],
  diesel: ["gasoil", "turbodiesel"],
  nuevo: ["0km", "cero km", "okm"],
  usado: ["segunda mano"],
};

function applyVehicleSynonyms(text: string): string {
  let t = text;
  for (const [canonical, aliases] of Object.entries(VEHICLE_SEARCH_SYNONYMS)) {
    for (const alias of aliases) {
      const re = new RegExp(`\\b${alias.replace(/\s+/g, "\\s+")}\\b`, "g");
      t = t.replace(re, canonical);
    }
  }
  return t;
}

export function searchCatalog(items: CatalogItem[], q: string, limit = 5): CatalogItem[] {
  const normalized = applyVehicleSynonyms(applySynonyms(normalizeText(q)));
  if (!normalized) return [];

  const tokens = normalized.split(/\s+/).filter(Boolean);

  // Detectar si la búsqueda pide un tipo de carrocería específico
  const bodyworkTokens = new Set(["suv", "pickup", "sedan", "hatch", "familiar", "monovolumen", "furgon", "coupe"]);
  const queriedBodywork = tokens.find((t) => bodyworkTokens.has(t));

  // Detectar si busca 0km o usado
  const queriesNew = tokens.some((t) => ["nuevo", "0km", "cero"].includes(t));
  const queriesUsed = tokens.some((t) => t === "usado");

  // Detectar combustible o caja en la query
  const fuelTokens = new Set(["nafta", "diesel", "gnc", "hibrido", "electrico"]);
  const txTokens = new Set(["automatico", "manual"]);
  const queriedFuel = tokens.find((t) => fuelTokens.has(t));
  const queriedTx = tokens.find((t) => txTokens.has(t));

  const scored = items
    .map((item) => {
      if (item.inStock === false) return { item, score: 0 };

      const versionNorm = normalizeText(item.version ?? "");
      const bodyworkNorm = normalizeText(item.bodywork ?? "");
      const fuelNorm = normalizeText(item.fuel ?? "");
      const txNorm = normalizeText(item.transmission ?? "");

      const hay = applyVehicleSynonyms(
        applySynonyms(
          normalizeText(
            `${item.id} ${item.name} ${item.brand ?? ""} ${item.model ?? ""} ${item.version ?? ""} ${item.year ?? ""} ${item.km ?? ""} ${item.transmission ?? ""} ${item.engine ?? ""} ${item.fuel ?? ""} ${item.color ?? ""} ${item.bodywork ?? ""} ${item.category ?? ""} ${item.description ?? ""}`
          )
        )
      );

      let score = 0;

      // Boost por match en name/brand/model (campos de alta densidad semántica)
      const nameHay = applySynonyms(normalizeText(item.name));
      const brandHay = normalizeText(item.brand ?? "");
      const modelHay = normalizeText(item.model ?? "");

      for (const t of tokens) {
        if (nameHay.includes(t)) score += 5;
        else if (brandHay.includes(t)) score += 4;
        else if (modelHay.includes(t)) score += 4;
        else if (versionNorm.includes(t)) score += 3;
        else if (hay.includes(t)) score += 2;

        if (t.length >= 4) {
          const prefix = t.slice(0, Math.min(6, t.length));
          if (nameHay.includes(prefix) || brandHay.includes(prefix) || modelHay.includes(prefix)) score += 2;
          else if (hay.includes(prefix)) score += 1;
        }
      }

      if (hay.includes(normalized)) score += 2;
      if (hay.includes(` ${normalized} `)) score += 1;

      // Boost por bodywork match
      if (queriedBodywork && bodyworkNorm) {
        if (bodyworkNorm.includes(queriedBodywork)) score += 4;
        else score -= 1; // penalizar levemente si buscó un tipo y este no lo es
      }

      // Boost por combustible
      if (queriedFuel && fuelNorm) {
        if (fuelNorm.includes(queriedFuel)) score += 3;
        else score -= 1;
      }

      // Boost por caja
      if (queriedTx && txNorm) {
        if (txNorm.includes(queriedTx)) score += 3;
        else score -= 1;
      }

      // Boost por 0km / usado
      if (queriesNew && item.isNew === true) score += 3;
      if (queriesUsed && item.isNew === false) score += 2;

      return { item, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.item);

  return scored;
}

export function formatItemLine(item: CatalogItem, idx: number) {
  const price =
    typeof item.priceNumber === "number"
      ? `— ${item.currency ?? "ARS"} ${Number(item.priceNumber).toLocaleString("es-AR")}`
      : item.priceText
        ? `— ${item.priceText}`
        : "";

  const url = item.url ? `\n${item.url}` : "";

  const specs = (() => {
    const parts: string[] = [];
    if (item.year) parts.push(String(item.year));
    // 0km explícito > km numérico
    if (item.isNew) {
      parts.push("0 km");
    } else if (typeof item.km === "number" && Number.isFinite(item.km)) {
      parts.push(`${Math.round(item.km).toLocaleString("es-AR")} km`);
    } else {
      parts.push("km sin datos");
    }
    if (item.version) parts.push(item.version);
    if (item.transmission) parts.push(item.transmission);
    if (item.fuel) parts.push(item.fuel);
    if (item.engine) parts.push(item.engine);
    return parts.length ? `\n${parts.join(" · ")}` : "";
  })();

  return `${idx}) ${item.name} ${price}`.trim() + specs + url;
}
