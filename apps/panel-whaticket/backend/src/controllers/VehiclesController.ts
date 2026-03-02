import { Request, Response } from "express";
import sequelize from "../database";

// Robust best-effort catalog endpoint.
// Goal: keep the frontend contract stable:
//   { vehicles: [{ id, marca, modelo, version, precio, currency, year }] }
// while autodetecting the underlying table/columns without adding new ENV.

type Query = {
  q?: string;
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

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { q = "", limit = "200" } = req.query as Query;
  const lim = Math.min(Math.max(parseInt(String(limit), 10) || 200, 1), 1000);
  const term = String(q || "").trim();

  try {
    const source = await detectSource();
    if (!source) return res.json({ vehicles: [] });

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

    const priceExpr = map.price ? `COALESCE(${qi(map.price)}, 0)` : "0";
    const currencyExpr = map.currency ? `COALESCE(${qi(map.currency)}, 'USD')` : `'USD'`;
    const yearExpr = map.year ? qi(map.year) : "NULL";

    const whereParts: string[] = [];
    if (term) {
      const orParts: string[] = [];
      if (map.title) orParts.push(`${qi(map.title)} ILIKE :term`);
      if (map.brand) orParts.push(`${qi(map.brand)} ILIKE :term`);
      if (map.model) orParts.push(`${qi(map.model)} ILIKE :term`);
      if (map.version) orParts.push(`${qi(map.version)} ILIKE :term`);
      if (orParts.length) whereParts.push(`(${orParts.join(" OR ")})`);
    }

    const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

    const sql = `
      SELECT
        ${qi(map.id)} as id,
        ${brandExpr} as brand,
        ${modelExpr} as model,
        ${titleExpr} as title,
        ${priceExpr} as price,
        ${currencyExpr} as currency,
        ${yearExpr} as year
      FROM ${qi(schema)}.${qi(table)}
      ${whereSql}
      ORDER BY ${map.year ? `${qi(map.year)} DESC NULLS LAST,` : ""} ${qi(map.id)} DESC
      LIMIT :lim
    `;

    const [rows] = await sequelize.query(sql, {
      replacements: {
        term: `%${term}%`,
        lim,
      },
    });

    const vehicles = (Array.isArray(rows) ? rows : []).map((v: any) => ({
      id: v.id,
      marca: String(v.brand || "").trim(),
      modelo: String(v.model || "").trim(),
      version: String(v.title || "").trim(),
      precio: Number(v.price) || 0,
      currency: String(v.currency || "USD").toUpperCase(),
      year: v.year ?? null,
    }));

    return res.json({ vehicles });
  } catch {
    // Best-effort: never crash the panel.
    return res.json({ vehicles: [] });
  }
};