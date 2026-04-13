import fetch from "node-fetch";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../lib/env.js";
import { pool, supabasePool } from "./db.js";

// Use supabasePool when available (direct Supabase connection, no sync needed).
// Falls back to the main Railway pool transparently.
const catalogPool = supabasePool ?? pool;
const preferSupabaseForCatalog = Boolean((env.supabaseDatabaseUrl || /\.supabase\.com/i.test(env.databaseUrl)) && (supabasePool || /\.supabase\.com/i.test(env.databaseUrl)));
const preferDbCatalog = process.env.CATALOG_PREFER_DB !== 'false';

/**
 * Catalog queries must stay pinned to the direct Supabase source when configured.
 * Falling back to Railway can silently return an outdated/empty public.vehicles table
 * and make stock "disappear" intermittently.
 */

// Track whether the current catalog load used a Supabase→Railway fallback.
// Reset per getCatalog() call so stale flags don't persist across cache refreshes.
let _catalogFallbackUsed = false;
let _catalogAlertThrottleAt = 0;

async function resilientCatalogQuery(sql: string, params?: any[]): Promise<{ rows: any[] }> {
  if (preferSupabaseForCatalog && supabasePool) {
    return supabasePool.query(sql, params);
  }
  if (supabasePool) {
    try {
      return await supabasePool.query(sql, params);
    } catch (err: any) {
      _catalogFallbackUsed = true;
      console.warn(`[catalog] supabasePool query failed (${err?.code ?? 'UNKNOWN'}: ${err?.message ?? err}), falling back to main pool`);
    }
  }
  return pool.query(sql, params);
}

/**
 * Emit a throttled ops-level alert when the catalog is empty after a Supabase failure.
 * Throttled to once per 5 minutes to avoid log spam during sustained outages.
 */
function emitCatalogEmptyAlert(context: string): void {
  const now = Date.now();
  if (now - _catalogAlertThrottleAt < 5 * 60 * 1000) return;
  _catalogAlertThrottleAt = now;
  console.error(
    `[CATALOG ALERT] ⚠️  Catalog is EMPTY after DB load (${context}). ` +
    'If Supabase is configured and unreachable, the bot will tell clients there is no stock. ' +
    'Investigate DB connectivity immediately.'
  );
}

// ─── Fuel normalizer ─────────────────────────────────────────────────────────

/**
 * normalizeFuel — normalizes raw fuel/combustible values from DB to a
 * consistent canonical form used throughout the bot's catalog filters.
 *
 * Without this, values like "Nafta/GNC", "gas natural", "GAS" all fail
 * to match the agent's filter for "gnc", causing false "no stock" answers.
 */
export function normalizeFuel(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const t = raw.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  if (/\b(gnc|gas\s*natural|gas\s*natural\s*comprimido)\b/.test(t) || t.includes('gnc')) return 'gnc';
  if (/\b(diesel|gasoil|gas\s*oil|turbo\s*diesel|tdi|gasoilero)\b/.test(t)) return 'diesel';
  if (/\b(electr[io]|ev|bev|zero\s*emission)\b/.test(t)) return 'electrico';
  if (/\b(hibrido|hybrid|hev|phev)\b/.test(t)) return 'hibrido';
  if (/\b(nafta|gasolina|naftero|naft)\b/.test(t)) return 'nafta';
  // Mixed fuels with GNC take priority
  if (t.includes('gnc') || t.includes('gas')) return 'gnc';
  return raw.trim() || undefined;
}

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
  /** Hasta 5 URLs de fotos del vehículo (para enviar por WhatsApp) */
  images?: string[];

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

// No sample/demo fallback — returning empty catalog is safer than returning wrong products.
// If the vehicles table is empty, the bot will indicate no stock rather than hallucinating items.
const EMPTY_CATALOG: CatalogItem[] = [];

let cached: CatalogItem[] | null = null;
let cachedAt = 0;
let cachedMeta: Record<string, any> | null = null;

type CatalogVehicleSource = {
  schema: string;
  table: string;
  columns: string[];
};

let vehicleSourceCache: { at: number; source: CatalogVehicleSource | null } = { at: 0, source: null };
const VEHICLE_SOURCE_CACHE_MS = 60_000;

function qi(ident: string): string {
  return `"${String(ident).replace(/"/g, '""')}"`;
}

function pickFirstPresent(columns: string[], synonyms: string[]): string | undefined {
  const set = new Set(columns.map((c) => c.toLowerCase()));
  for (const s of synonyms) {
    if (!set.has(s.toLowerCase())) continue;
    const original = columns.find((c) => c.toLowerCase() === s.toLowerCase());
    if (original) return original;
  }
  return undefined;
}

async function detectVehicleSource(): Promise<CatalogVehicleSource | null> {
  const now = Date.now();
  if (vehicleSourceCache.source && now - vehicleSourceCache.at < VEHICLE_SOURCE_CACHE_MS) {
    return vehicleSourceCache.source;
  }

  const candidateTables = ['vehicles', 'Vehicles', 'vehicle', 'autos', 'cars', 'vehiculos', 'catalog'];

  try {
    const tablesR = await resilientCatalogQuery(
      `
      select table_schema, table_name
      from information_schema.tables
      where table_type = 'BASE TABLE'
        and table_schema not in ('pg_catalog', 'information_schema')
        and table_name = any($1::text[])
      order by case when table_schema = 'public' then 0 else 1 end, table_schema asc, table_name asc
      `,
      [candidateTables]
    );

    for (const row of tablesR.rows ?? []) {
      const schema = String(row.table_schema || 'public');
      const table = String(row.table_name || '');
      if (!table) continue;

      const colsR = await resilientCatalogQuery(
        `select column_name from information_schema.columns where table_schema = $1 and table_name = $2`,
        [schema, table]
      );
      const columns = (colsR.rows ?? []).map((r: any) => String(r.column_name)).filter(Boolean);
      const idCol = pickFirstPresent(columns, ['id', 'vehicle_id', 'uuid', 'uid']);
      const titleCol = pickFirstPresent(columns, ['title', 'name', 'nombre', 'descripcion', 'description']);
      const brandCol = pickFirstPresent(columns, ['brand', 'marca', 'make']);
      const modelCol = pickFirstPresent(columns, ['model', 'modelo']);
      const priceCol = pickFirstPresent(columns, ['price', 'precio', 'valor']);
      if (!idCol || (!titleCol && !(brandCol && modelCol)) || !priceCol) {
        continue;
      }
      const source = { schema, table, columns };
      vehicleSourceCache = { at: now, source };
      return source;
    }
  } catch (err) {
    console.error('[catalog] detectVehicleSource failed', err);
  }

  vehicleSourceCache = { at: now, source: null };
  return null;
}

function parsePictures(value: any): string[] {
  if (Array.isArray(value)) return value.map((x) => String(x)).filter(Boolean);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x)).filter(Boolean);
    } catch {
      return trimmed ? [trimmed] : [];
    }
  }
  return [];
}

type VehicleRow = {
  id: string;
  title: string | null;
  brand: string | null;
  model: string | null;
  version: string | null;
  year: number | null;
  price: string | number | null;
  currency: string | null;
  pictures: string[] | null;
  permalink: string | null;
  status: string | null;
  km: number | null;
  engine: string | null;
  transmission: string | null;
  fuel: string | null;
  color: string | null;
  // Capitalized ML-imported columns (fallback when lowercase are null)
  Km: number | null;
  Motor: string | null;
  Caja: string | null;
  Combustible: string | null;
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
  const source = await detectVehicleSource();
  const defaultTableSql = `
    select
      id,
      title,
      brand,
      model,
      version,
      year,
      price,
      currency,
      pictures,
      permalink,
      status,
      COALESCE(km, "Km") as km,
      COALESCE(engine, "Motor") as engine,
      COALESCE(transmission, "Caja") as transmission,
      COALESCE(fuel, "Combustible") as fuel,
      color
    from public.vehicles
    where (status is null or btrim(status::text) = '' or lower(status::text) not in ('inactive', 'archived', 'deleted', 'sold', 'paused'))
    order by id
    limit 500
  `;

  let sql = defaultTableSql;
  let params: any[] = [];
  let sourceLabel = 'public.vehicles';

  if (source) {
    const cols = source.columns;
    const idCol = pickFirstPresent(cols, ['id', 'vehicle_id', 'uuid', 'uid'])!;
    const titleCol = pickFirstPresent(cols, ['title', 'name', 'nombre', 'descripcion', 'description']);
    const brandCol = pickFirstPresent(cols, ['brand', 'marca', 'make']);
    const modelCol = pickFirstPresent(cols, ['model', 'modelo']);
    const versionCol = pickFirstPresent(cols, ['version', 'trim', 'variant', 'versión']);
    const yearCol = pickFirstPresent(cols, ['year', 'anio', 'año', 'model_year']);
    const priceCol = pickFirstPresent(cols, ['price', 'precio', 'valor']);
    const currencyCol = pickFirstPresent(cols, ['currency', 'moneda', 'currency_code']);
    const picturesCol = pickFirstPresent(cols, ['pictures', 'images', 'photos', 'fotos']);
    const permalinkCol = pickFirstPresent(cols, ['permalink', 'url', 'link']);
    const statusCol = pickFirstPresent(cols, ['status', 'estado']);
    const kmCol = pickFirstPresent(cols, ['km', 'Km', 'kilometers', 'kilometraje']);
    const engineCol = pickFirstPresent(cols, ['engine', 'Motor', 'motor']);
    const transmissionCol = pickFirstPresent(cols, ['transmission', 'Caja', 'caja', 'gearbox']);
    const fuelCol = pickFirstPresent(cols, ['fuel', 'Combustible', 'combustible']);
    const colorCol = pickFirstPresent(cols, ['color']);
    const dealershipCol = pickFirstPresent(cols, ['dealership_id']);

    const fields = [
      `${qi(idCol)}::text as id`,
      titleCol ? `${qi(titleCol)}::text as title` : `NULL::text as title`,
      brandCol ? `${qi(brandCol)}::text as brand` : `NULL::text as brand`,
      modelCol ? `${qi(modelCol)}::text as model` : `NULL::text as model`,
      versionCol ? `${qi(versionCol)}::text as version` : `NULL::text as version`,
      yearCol ? `NULLIF(${qi(yearCol)}::text, '')::int as year` : `NULL::int as year`,
      priceCol ? `${qi(priceCol)}::text as price` : `NULL::text as price`,
      currencyCol ? `${qi(currencyCol)}::text as currency` : `NULL::text as currency`,
      picturesCol ? `${qi(picturesCol)} as pictures` : `NULL::text as pictures`,
      permalinkCol ? `${qi(permalinkCol)}::text as permalink` : `NULL::text as permalink`,
      statusCol ? `${qi(statusCol)}::text as status` : `NULL::text as status`,
      kmCol ? `NULLIF(${qi(kmCol)}::text, '')::numeric as km` : `NULL::numeric as km`,
      engineCol ? `${qi(engineCol)}::text as engine` : `NULL::text as engine`,
      transmissionCol ? `${qi(transmissionCol)}::text as transmission` : `NULL::text as transmission`,
      fuelCol ? `${qi(fuelCol)}::text as fuel` : `NULL::text as fuel`,
      colorCol ? `${qi(colorCol)}::text as color` : `NULL::text as color`,
    ];

    const where: string[] = [];
    if (statusCol) {
      where.push(`(${qi(statusCol)} is null or btrim(${qi(statusCol)}::text) = '' or lower(${qi(statusCol)}::text) not in ('inactive', 'archived', 'deleted', 'sold', 'paused'))`);
    }
    if (env.catalogDealershipId && dealershipCol) {
      params.push(env.catalogDealershipId);
      where.push(`${qi(dealershipCol)}::text = $${params.length}`);
    }

    sql = `
      select ${fields.join(', ')}
      from ${qi(source.schema)}.${qi(source.table)}
      ${where.length ? `where ${where.join(' and ')}` : ''}
      order by ${qi(idCol)} desc
      limit 500
    `;
    sourceLabel = `${source.schema}.${source.table}`;
  }

  const q = resilientCatalogQuery(sql, params);
  const r = await Promise.race([
    q,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('vehicles query timeout')), timeoutMs))
  ]);

  const rows = (r as any).rows as VehicleRow[];
  console.log(`[catalog] loaded ${rows.length} vehicles from ${sourceLabel}`);

  const items = rows
    .map((row) => {
      const title = (row.title ?? '').trim();
      const brand = (row.brand ?? '').trim();
      const model = (row.model ?? '').trim();
      const version = (row.version ?? '').trim() || undefined;
      const structuredName = [brand, model, version].filter(Boolean).join(' ');
      const hasModel = model.length > 0;
      const name = (hasModel && structuredName) ? structuredName : (title || structuredName || String(row.id));
      const year = row.year ?? undefined;
      const km = coerceNumber(row.km);
      const statusStr = (row.status ?? '').toLowerCase();
      const isNew: boolean = km === 0 || /\b(0\s*km|nuevo|new)\b/.test(statusStr) || /\b(0\s*km|nuevo|new)\b/.test((title || '').toLowerCase());
      const transmission = (row.transmission ?? undefined)?.toString().trim();
      const engine = (row.engine ?? undefined)?.toString().trim();
      // Normalize fuel to canonical form (gnc/diesel/nafta/electrico/hibrido)
      // so agent filters work regardless of how the DB stores the value.
      const fuel = normalizeFuel((row.fuel ?? undefined)?.toString());
      const color = (row.color ?? undefined)?.toString().trim();
      const bodywork = inferBodyworkFromRow(title, model, version, null);
      const priceNumber = coerceMoneyNumber(row.price);
      const rawCurrency = (row.currency ?? 'ARS') as string;
      const currency = (() => {
        if (rawCurrency.toUpperCase() === 'USD') return 'USD';
        if (priceNumber !== undefined) {
          if (priceNumber < 10_000) return 'USD';
          if (!isNew && priceNumber < 500_000) return 'USD';
        }
        return rawCurrency || 'ARS';
      })() as any;
      const url = row.permalink ? String(row.permalink) : undefined;
      const pics = parsePictures((row as any).pictures);
      const image = normalizeImageUrl(pics[0] ?? pics[1], url);
      const images = pics
        .slice(0, 5)
        .map(p => normalizeImageUrl(p, undefined))
        .filter((u): u is string => Boolean(u));
      const parts: string[] = [];
      if (year) parts.push(String(year));
      if (isNew) parts.push('0 km');
      else if (km !== undefined) parts.push(`${Math.round(km).toLocaleString('es-AR')} km`);
      else parts.push('km sin datos');
      if (transmission) parts.push(transmission);
      if (fuel) parts.push(fuel);
      if (engine) parts.push(engine);
      if (color) parts.push(color);
      const description = parts.length ? parts.join(' · ') : undefined;
      return {
        id: String(row.id),
        name,
        priceNumber,
        currency,
        inStock: true,
        url,
        image,
        images: images.length > 0 ? images : undefined,
        category: brand || 'autos',
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

  cachedMeta = { source: sourceLabel, count: items.length, at: new Date().toISOString(), directSupabase: preferSupabaseForCatalog };
  return items;
}


async function loadVehiclesFromSimpleDb(timeoutMs: number): Promise<CatalogItem[]> {
  // Fallback ligero: usa nombres canónicos (schema actual post-sync).
  // Si falla, se maneja en getCatalog().
  const sql = `
    select
      id,
      brand,
      model,
      version,
      year,
      price::text as price,
      currency,
      title
    from public.vehicles
    limit 500
  `;

  const q = resilientCatalogQuery(sql);
  const r = await Promise.race([
    q,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("vehicles simple query timeout")), timeoutMs))
  ]);

  const rows = (r as any).rows ?? [];

  return rows
    .map((row: any) => {
      const brand = String(row.brand ?? '').trim();
      const model = String(row.model ?? '').trim();
      const version = String(row.version ?? '').trim();
      const title = String(row.title ?? '').trim();
      const year = coerceNumber(row.year);
      const priceNumber = coerceMoneyNumber(row.price);
      const currency = String(row.currency ?? (priceNumber !== undefined ? 'ARS' : '')).trim() || undefined;
      const name = [brand, model, version].filter(Boolean).join(' ').trim() || title || String(row.id ?? '');
      return {
        id: String(row.id ?? ''),
        name,
        priceNumber,
        currency,
        inStock: true,
        category: brand || 'autos',
        brand: brand || undefined,
        model: model || undefined,
        version: version || undefined,
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
 * Lightweight automotive synonym normalization (no LLM, low-cost).
 * Expands common abbreviations and regional terms to canonical forms
 * so catalog search matches correctly across user phrasing.
 */
function applySynonyms(text: string): string {
  return text
    // Carrocería
    .replace(/\b(cross\s*over|crossover|4x4|awd|todoterreno|campo)\b/gi, "suv")
    .replace(/\b(pick\s*up|camioneta|doble\s*cabina)\b/gi, "pickup")
    .replace(/\b(hatchback|hatch\s*back)\b/gi, "hatch")
    .replace(/\b(familiar|estate|kombi|touring)\b/gi, "familiar")
    .replace(/\b(minivan|monovolumen|mpv|van)\b/gi, "monovolumen")
    .replace(/\b(utilitario|furgon|cargo)\b/gi, "furgon")
    // Transmisión
    .replace(/\b(automatico|automatica|auto)\b/gi, "automatico")
    .replace(/\b(mecanico|mecanica|manual)\b/gi, "mecanico")
    // Combustible
    .replace(/\b(nafta|gasolina|naftero)\b/gi, "nafta")
    .replace(/\b(diesel|gasoil|gasoilero)\b/gi, "diesel")
    .replace(/\b(gnc|gas\s*natural)\b/gi, "gnc")
    // Estado
    .replace(/\b(cero\s*km|0\s*km|nuevo|nueva|0km)\b/gi, "0km")
    .replace(/\b(usado|usada|segunda\s*mano)\b/gi, "usado");
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

  // Prefer DB whenever possible. This avoids stale CATALOG_JSON_URL snapshots
  // masking real Supabase/Railway stock.
  if (!env.catalogJsonUrl || preferDbCatalog) {
    if (cached && now - cachedAt < ttlMs) return cached;

    // Reset fallback flag before each fresh load attempt
    _catalogFallbackUsed = false;

    try {
      const items = await loadVehiclesFromDb(timeoutMs);
      if (items.length) {
        cached = items;
        cachedAt = now;
        return items;
      }
      // 0 items: check if a Supabase fallback happened (could be silent stock loss)
      if (_catalogFallbackUsed) {
        emitCatalogEmptyAlert('loadVehiclesFromDb — Supabase failed, Railway returned 0 rows');
      } else {
        console.warn('[catalog] fresh DB read returned 0 vehicles — DB table may be empty');
      }
      if (cached?.length) {
        console.warn('[catalog] fresh DB read returned 0 vehicles, reusing last good cache');
        return cached;
      }
    } catch (err) {
      if (cached?.length) {
        console.warn('[catalog] fresh DB read failed, reusing last good cache:', err);
        return cached;
      }
    }

    try {
      const simpleItems = await loadVehiclesFromSimpleDb(timeoutMs);
      if (simpleItems.length) {
        cached = simpleItems;
        cachedAt = now;
        cachedMeta = { source: 'public.vehicles(simple)', count: simpleItems.length, at: new Date().toISOString(), directSupabase: preferSupabaseForCatalog };
        return simpleItems;
      }
    } catch {
      // fall back below
    }

    // Fallback: if a JSON URL exists and DB-first failed, try the JSON source.
    if (env.catalogJsonUrl) {
      try {
        const json = (await fetchJsonWithTimeout(env.catalogJsonUrl, timeoutMs)) as any;
        if (Array.isArray(json)) {
          cached = mapRawCatalog(json);
          cachedAt = now;
          cachedMeta = { source: 'catalog_json_url', count: cached.length, at: new Date().toISOString(), directSupabase: preferSupabaseForCatalog };
          return cached;
        }
      } catch (err) {
        console.warn('[CATALOG] DB-first mode: JSON fallback failed:', err);
      }
    }

    // Fallback: try local JSON catalog file; if none found, return empty catalog.
    // Returning empty is correct — the bot will say "no hay stock disponible" rather
    // than returning gaming demo products unrelated to automotive.
    const local = await tryLoadLocalCatalog();
    if (!local) {
      emitCatalogEmptyAlert('all sources exhausted — no vehicles in DB, no local catalog.json');
      console.warn("[CATALOG] No vehicles in DB and no local catalog.json found. Returning empty catalog.");
      return EMPTY_CATALOG;
    }
    try {
      const items = mapRawCatalog(local);
      if (!items.length) {
        console.warn("[CATALOG] Local catalog.json parsed but contained 0 valid items. Returning empty catalog.");
        return EMPTY_CATALOG;
      }
      cached = items;
      cachedAt = now;
      return items;
    } catch {
      console.warn("[CATALOG] Failed to parse local catalog.json. Returning empty catalog.");
      return EMPTY_CATALOG;
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
    console.warn("[CATALOG] CATALOG_JSON_URL fetch failed and no cached catalog. Returning empty catalog.");
    return EMPTY_CATALOG;
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

export function getCatalogDebug() {
  return {
    cachedCount: cached?.length ?? 0,
    cachedAt: cachedAt ? new Date(cachedAt).toISOString() : null,
    source: cachedMeta?.source ?? null,
    sourceCount: cachedMeta?.count ?? null,
    sourceAt: cachedMeta?.at ?? null,
    directSupabase: preferSupabaseForCatalog,
    hasSupabasePool: Boolean(supabasePool),
    hasCatalogJsonUrl: Boolean(env.catalogJsonUrl),
    catalogDealershipId: env.catalogDealershipId ?? null,
  };
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

/**
 * Formatea una línea de catálogo para pasar como contexto a GPT.
 * No incluye URL por defecto para evitar que el modelo la repita
 * en la respuesta al cliente (y evitar links de MercadoLibre como muleta).
 */
export function formatItemLine(item: CatalogItem, idx: number, usdToArs?: number) {
  const price = (() => {
    if (typeof item.priceNumber === "number") {
      const isUsd = (item.currency ?? "ARS").toUpperCase() === "USD";
      if (isUsd && usdToArs && usdToArs > 0) {
        const ars = Math.round(item.priceNumber * usdToArs);
        console.info(`[catalog] USD→ARS conversion: ${item.name} USD ${item.priceNumber} × ${usdToArs} = ARS ${ars}`);
        return `— ARS ${ars.toLocaleString("es-AR")}`;
      }
      return `— ${item.currency ?? "ARS"} ${Number(item.priceNumber).toLocaleString("es-AR")}`;
    }
    return item.priceText ? `— ${item.priceText}` : "";
  })();

  const specs = (() => {
    const parts: string[] = [];
    if (item.year) parts.push(String(item.year));
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

  return `${idx + 1}) ${item.name} ${price}`.trim() + specs;
}
