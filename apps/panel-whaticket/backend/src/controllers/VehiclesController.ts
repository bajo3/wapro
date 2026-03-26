import { Request, Response } from "express";
import sequelize from "../database";

// Robust best-effort catalog endpoint.
// Goal: keep the frontend contract stable:
//   { vehicles: [{ id, marca, modelo, version, precio, currency, year }] }
// while autodetecting the underlying table/columns without adding new ENV.

type Query = {
  q?: string;
  searchParam?: string;
  id?: string;
  limit?: string;
};

type ColumnMap = {
  id: string;
  brand?: string;
  model?: string;
  version?: string;
  title?: string;
  price?: string;
  currency?: string;
  year?: string;
  km?: string;
  transmission?: string;
  fuel?: string;
  color?: string;
  status?: string;
  image?: string;
  pictures?: string;
  permalink?: string;
  source?: string;
};

type CatalogSource = {
  schema: string;
  table: string;
  columns: string[];
  map: ColumnMap;
};

const CANDIDATE_TABLES = [
  "vehicles",
  "Vehicles",
  "vehicle",
  "autos",
  "cars",
  "car_stock",
  "stock_vehicles",
  "catalog",
  "vehiculos",
];

const COL_SYNONYMS: Record<keyof Omit<ColumnMap, "id">, string[]> = {
  brand: ["brand", "marca", "make"],
  model: ["model", "modelo"],
  version: ["version", "trim", "variant", "versión", "version_name"],
  title: ["title", "nombre", "name", "descripcion", "description"],
  price: ["price", "precio", "valor", "amount"],
  currency: ["currency", "moneda", "currency_code"],
  year: ["year", "anio", "año", "model_year"],
  km: ["km", "Km", "kms", "kilometers", "kilometros", "kilometraje", "mileage"],
  transmission: ["transmission", "caja", "gearbox"],
  fuel: ["fuel", "combustible"],
  color: ["color", "colour"],
  status: ["status", "estado"],
  image: ["image", "image_url", "cover", "cover_image", "thumbnail", "picture", "picture_url"],
  pictures: ["pictures", "images", "gallery", "photos"],
  permalink: ["permalink", "url", "link", "href"],
  source: ["source", "origin", "origen"],
};

const ID_SYNONYMS = ["id", "vehicle_id", "uuid", "uid"]; // prefer stable identifiers

let cache: { at: number; source: CatalogSource | null } = { at: 0, source: null };
const CACHE_TTL_MS = 60_000;

function pickFirstPresent(columns: string[], synonyms: string[]): string | undefined {
  const set = new Set(columns.map((c) => c.toLowerCase()));
  for (const s of synonyms) {
    if (set.has(s.toLowerCase())) {
      // return original case column name if possible
      const original = columns.find((c) => c.toLowerCase() === s.toLowerCase());
      return original || s;
    }
  }
  return undefined;
}

async function detectSource(): Promise<CatalogSource | null> {
  const now = Date.now();
  if (cache.source && now - cache.at < CACHE_TTL_MS) return cache.source;

  try {
    // List candidate tables across *any* non-system schema.
    // Some installs use custom schemas (e.g. "public", "app", "crm").
    const [rows] = await sequelize.query(
      `
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_type = 'BASE TABLE'
        AND table_schema NOT IN ('pg_catalog','information_schema')
        AND table_name IN (:names)
      ORDER BY
        CASE WHEN table_schema = 'public' THEN 0 ELSE 1 END,
        table_schema ASC,
        table_name ASC
    `,
      { replacements: { names: CANDIDATE_TABLES } }
    );

    const tables = (Array.isArray(rows) ? rows : []) as Array<{ table_schema: string; table_name: string }>;

    // Also attempt the canonical table first (public.vehicles) even if not in candidates
    const preferred = [{ table_schema: "public", table_name: "vehicles" }, ...tables];

    for (const t of preferred) {
      const schema = String(t.table_schema || "public");
      const table = String(t.table_name || "");
      if (!table) continue;

      const [cRows] = await sequelize.query(
        `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = :schema AND table_name = :table
      `,
        { replacements: { schema, table } }
      );

      const cols = (Array.isArray(cRows) ? cRows : [])
        .map((r: any) => String(r.column_name))
        .filter(Boolean);
      if (!cols.length) continue;

      const idCol = pickFirstPresent(cols, ID_SYNONYMS);
      if (!idCol) continue;

      const map: ColumnMap = {
        id: idCol,
        brand: pickFirstPresent(cols, COL_SYNONYMS.brand),
        model: pickFirstPresent(cols, COL_SYNONYMS.model),
        version: pickFirstPresent(cols, COL_SYNONYMS.version),
        title: pickFirstPresent(cols, COL_SYNONYMS.title),
        price: pickFirstPresent(cols, COL_SYNONYMS.price),
        currency: pickFirstPresent(cols, COL_SYNONYMS.currency),
        year: pickFirstPresent(cols, COL_SYNONYMS.year),
        km: pickFirstPresent(cols, COL_SYNONYMS.km),
        transmission: pickFirstPresent(cols, COL_SYNONYMS.transmission),
        fuel: pickFirstPresent(cols, COL_SYNONYMS.fuel),
        color: pickFirstPresent(cols, COL_SYNONYMS.color),
        status: pickFirstPresent(cols, COL_SYNONYMS.status),
        image: pickFirstPresent(cols, COL_SYNONYMS.image),
        pictures: pickFirstPresent(cols, COL_SYNONYMS.pictures),
        permalink: pickFirstPresent(cols, COL_SYNONYMS.permalink),
        source: pickFirstPresent(cols, COL_SYNONYMS.source),
      };

      // Heuristic: require *at least* (brand+model) OR title so it isn't some unrelated table.
      const looksLikeVehicles = !!(map.title || (map.brand && map.model));
      if (!looksLikeVehicles) continue;

      const source: CatalogSource = { schema, table, columns: cols, map };
      cache = { at: now, source };
      return source;
    }

    // Fallback: scan for any table that looks like a vehicles catalog.
    // We only do this if candidates were not found.
    if (!tables.length) {
      const [maybe] = await sequelize.query(
        `
        SELECT c.table_schema, c.table_name,
               array_agg(c.column_name) as columns
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE t.table_type = 'BASE TABLE'
          AND c.table_schema NOT IN ('pg_catalog','information_schema')
        GROUP BY c.table_schema, c.table_name
      `
      );

      const all = (Array.isArray(maybe) ? maybe : []) as Array<{ table_schema: string; table_name: string; columns: string[] }>;
      for (const t of all) {
        const schema = String(t.table_schema || "public");
        const table = String(t.table_name || "");
        const cols = (Array.isArray(t.columns) ? t.columns : []).map(String).filter(Boolean);
        if (!cols.length) continue;

        const idCol = pickFirstPresent(cols, ID_SYNONYMS);
        if (!idCol) continue;

        const map: ColumnMap = {
          id: idCol,
          brand: pickFirstPresent(cols, COL_SYNONYMS.brand),
          model: pickFirstPresent(cols, COL_SYNONYMS.model),
          version: pickFirstPresent(cols, COL_SYNONYMS.version),
          title: pickFirstPresent(cols, COL_SYNONYMS.title),
          price: pickFirstPresent(cols, COL_SYNONYMS.price),
          currency: pickFirstPresent(cols, COL_SYNONYMS.currency),
          year: pickFirstPresent(cols, COL_SYNONYMS.year),
          km: pickFirstPresent(cols, COL_SYNONYMS.km),
          transmission: pickFirstPresent(cols, COL_SYNONYMS.transmission),
          fuel: pickFirstPresent(cols, COL_SYNONYMS.fuel),
          color: pickFirstPresent(cols, COL_SYNONYMS.color),
          status: pickFirstPresent(cols, COL_SYNONYMS.status),
          image: pickFirstPresent(cols, COL_SYNONYMS.image),
          pictures: pickFirstPresent(cols, COL_SYNONYMS.pictures),
          permalink: pickFirstPresent(cols, COL_SYNONYMS.permalink),
          source: pickFirstPresent(cols, COL_SYNONYMS.source),
        };

        const looksLikeVehicles = !!(map.title || (map.brand && map.model));
        const hasPriceOrYear = !!(map.price || map.year);
        if (!looksLikeVehicles || !hasPriceOrYear) continue;

        const source: CatalogSource = { schema, table, columns: cols, map };
        cache = { at: now, source };
        return source;
      }
    }
  } catch {
    // ignore
  }

  cache = { at: now, source: null };
  return null;
}

function qi(ident: string): string {
  // Quote identifiers defensively (handles case-sensitive columns/tables).
  return `"${String(ident).replace(/"/g, '""')}"`;
}


function normalizeLabelToken(value: any): string {
  return String(value ?? "").trim();
}

function normalizeForCompare(value: any): string {
  return normalizeLabelToken(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function compactUnique(parts: Array<any>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const value = normalizeLabelToken(part);
    const key = normalizeForCompare(value);
    if (!value || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}


function parseMaybeJson(value: any): any {
  if (value == null) return null;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith("{") && trimmed.endsWith("}")))) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function pickImage(value: any): string | null {
  const parsed = parseMaybeJson(value);
  if (!parsed) return null;
  if (typeof parsed === "string") return parsed.trim() || null;
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const img = pickImage(item);
      if (img) return img;
    }
  }
  if (typeof parsed === "object") {
    const direct = [parsed.url, parsed.secure_url, parsed.src, parsed.link].find(Boolean);
    if (typeof direct === "string" && direct.trim()) return direct.trim();
  }
  return null;
}

function asCleanString(value: any): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function inferCurrency(currency: any, price: number): string {
  const current = asCleanString(currency).toUpperCase();
  if (current === "USD" || current === "US$" || current === "ARS") return current === "US$" ? "USD" : current;
  if (price > 0 && price < 1_000_000) return "USD";
  return current || "ARS";
}

function parseTitleParts(row: any): { brand: string; model: string; version: string; title: string } {
  const title = asCleanString(row.title ?? row.name);
  const brand = asCleanString(row.brand ?? row.marca);
  let model = asCleanString(row.model ?? row.modelo);
  let version = asCleanString(row.version);

  if (title) {
    const normalizedTitle = title.replace(/\s+/g, " ").trim();
    const lowerBrand = brand.toLowerCase();
    let rest = normalizedTitle;
    if (brand && normalizedTitle.toLowerCase().startsWith(lowerBrand)) {
      rest = normalizedTitle.slice(brand.length).trim();
    }
    if (!model && rest) {
      const restTokens = rest.split(/\s+/).filter(Boolean);
      if (restTokens.length >= 2) {
        model = restTokens.slice(0, 2).join(" ");
        version = version || restTokens.slice(2).join(" ");
      } else if (restTokens.length === 1) {
        model = restTokens[0];
      }
    }
    if (model && !version && rest) {
      const modelNorm = normalizeForCompare(model);
      const restNorm = normalizeForCompare(rest);
      if (modelNorm && restNorm.startsWith(modelNorm)) {
        const leftover = rest.slice(model.length).trim();
        if (leftover) version = leftover;
      }
    }
  }

  if (!model && version && brand) {
    const v = version.trim();
    if (!v.toLowerCase().startsWith(brand.toLowerCase())) {
      model = v;
      version = "";
    }
  }

  return {
    brand,
    model,
    version,
    title,
  };
}

function buildVehicleLabel(row: any): string {
  if (!row || typeof row !== "object") return "";
  const parsed = parseTitleParts(row);
  const brand = normalizeLabelToken(parsed.brand);
  const model = normalizeLabelToken(parsed.model);
  const year = normalizeLabelToken(row.year);
  const version = normalizeLabelToken(parsed.version);
  const title = normalizeLabelToken(parsed.title);

  const base = compactUnique([brand, model, year]);
  const titleNorm = normalizeForCompare(title);
  const versionNorm = normalizeForCompare(version);
  const baseNorm = normalizeForCompare(base.join(" "));

  const extras: string[] = [];
  if (version && versionNorm && !baseNorm.includes(versionNorm)) extras.push(version);
  if (title && titleNorm && !baseNorm.includes(titleNorm) && !extras.some((x) => normalizeForCompare(x) === titleNorm)) {
    extras.push(title);
  }

  const label = compactUnique([...base, ...extras]).join(" ").trim();
  return label || title || compactUnique([brand, model, version, year]).join(" ").trim();
}

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { q = "", searchParam = "", id = "", limit = "200" } = req.query as Query;
  const lim = Math.min(Math.max(parseInt(String(limit), 10) || 200, 1), 1000);
  const term = String(q || searchParam || "").trim();
  const exactId = String(id || "").trim();

  try {
    const source = await detectSource();
    if (!source) {
      // Return empty array (preserves frontend contract) but expose diagnostic
      // via a non-breaking field so the panel can show a warning.
      return res.json({ vehicles: [], _catalogError: "no_source_detected" });
    }

    const { schema, table, map } = source;

    // Build SELECT with best-effort fallbacks.
    const brandExpr = map.brand ? qi(map.brand) : "''";
    const modelExpr = map.model ? qi(map.model) : "''";

    // Prefer title if it exists, otherwise version, otherwise concat brand+model.
    const titleExpr = map.title
      ? qi(map.title)
      : map.version
        ? qi(map.version)
        : `TRIM(CONCAT(${brandExpr}, ' ', ${modelExpr}))`;
    const versionExpr = map.version ? qi(map.version) : "''";

    const priceExpr = map.price ? `COALESCE(${qi(map.price)}, 0)` : "0";
    const currencyExpr = map.currency ? `COALESCE(${qi(map.currency)}, '')` : `''`;
    const yearExpr = map.year ? qi(map.year) : "NULL";
    const kmExpr = map.km ? qi(map.km) : "NULL";
    const transmissionExpr = map.transmission ? qi(map.transmission) : "NULL";
    const fuelExpr = map.fuel ? qi(map.fuel) : "NULL";
    const colorExpr = map.color ? qi(map.color) : "NULL";
    const statusExpr = map.status ? qi(map.status) : `'active'`;
    const imageExpr = map.image ? qi(map.image) : "NULL";
    const picturesExpr = map.pictures ? qi(map.pictures) : "NULL";
    const permalinkExpr = map.permalink ? qi(map.permalink) : "NULL";
    const sourceExpr = map.source ? qi(map.source) : "NULL";

    const whereParts: string[] = [];
    if (exactId) {
      whereParts.push(`${qi(map.id)}::text = :exactId`);
    }
    if (term) {
      const orParts: string[] = [];
      if (map.title) orParts.push(`${qi(map.title)} ILIKE :term`);
      if (map.brand) orParts.push(`${qi(map.brand)} ILIKE :term`);
      if (map.model) orParts.push(`${qi(map.model)} ILIKE :term`);
      if (map.version) orParts.push(`${qi(map.version)} ILIKE :term`);
      orParts.push(`TRIM(CONCAT(${brandExpr}, ' ', ${modelExpr}, ' ', ${titleExpr})) ILIKE :term`);
      if (orParts.length) whereParts.push(`(${orParts.join(" OR ")})`);
    }

    const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

    const sql = `
      SELECT
        ${qi(map.id)} as id,
        ${brandExpr} as brand,
        ${modelExpr} as model,
        ${titleExpr} as title,
        ${versionExpr} as version,
        ${priceExpr} as price,
        ${currencyExpr} as currency,
        ${yearExpr} as year,
        ${kmExpr} as km,
        ${transmissionExpr} as transmission,
        ${fuelExpr} as fuel,
        ${colorExpr} as color,
        ${statusExpr} as status,
        ${imageExpr} as image,
        ${picturesExpr} as pictures,
        ${permalinkExpr} as permalink,
        ${sourceExpr} as source
      FROM ${qi(schema)}.${qi(table)}
      ${whereSql}
      ORDER BY ${map.year ? `${qi(map.year)} DESC NULLS LAST,` : ""} ${qi(map.id)} DESC
      LIMIT :lim
    `;

    const [rows] = await sequelize.query(sql, {
      replacements: {
        term: `%${term}%`,
        exactId,
        lim,
      },
    });

    const vehicles = (Array.isArray(rows) ? rows : []).map((v: any) => {
      const parsed = parseTitleParts(v);
      const price = Number(v.price) || 0;
      const imageUrl = pickImage(v.image) || pickImage(v.pictures);
      const base = {
        id: String(v.id ?? "").trim(),
        marca: parsed.brand,
        modelo: parsed.model,
        version: parsed.version,
        title: parsed.title,
        precio: price,
        currency: inferCurrency(v.currency, price),
        year: v.year ?? null,
        km: v.km ?? null,
        transmission: asCleanString(v.transmission),
        fuel: asCleanString(v.fuel),
        color: asCleanString(v.color),
        status: asCleanString(v.status) || "active",
        imageUrl,
        pictures: parseMaybeJson(v.pictures),
        permalink: asCleanString(v.permalink),
        source: asCleanString(v.source),
      };
      return {
        ...base,
        label: buildVehicleLabel(base)
      };
    });

    return res.json({ vehicles });
  } catch (err) {
    console.error("[vehicles#index] lookup failed", err);
    // Preserve frontend contract but expose error type for diagnostics.
    const msg = err instanceof Error ? err.message : String(err);
    return res.json({ vehicles: [], _catalogError: msg || "lookup_failed" });
  }
};    