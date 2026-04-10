import { pool, supabasePool } from './db.js';
import { env } from '../lib/env.js';
import { extractLeadFields } from './extract.js';
import { sendTextAndPersist } from './panelPersistence.js';

/**
 * Always use the same pool as catalog.ts (supabasePool when available, pool otherwise).
 * The old `preferSupabaseVehicles` check was too strict: it required env.supabaseDatabaseUrl
 * to be explicitly set, which caused demands.ts to fall back to Railway even when supabasePool
 * was correctly initialized — making vehicle detection return 0 rows and killing all matches.
 */
const vehiclePool = supabasePool ?? pool;

async function vehicleQuery(sql: string, params?: any[]): Promise<{ rows: any[] }> {
  if (vehiclePool !== pool) {
    try {
      return await vehiclePool.query(sql, params);
    } catch (err: any) {
      console.warn(`[demands] vehiclePool query failed (${err?.code ?? '?'}: ${err?.message ?? err}), falling back to main pool`);
      return pool.query(sql, params);
    }
  }
  return pool.query(sql, params);
}

export type DemandStatus = 'open' | 'closed';

export type VehicleDemand = {
  id: number;
  status: DemandStatus;
  query: string;
  brand?: string | null;
  model?: string | null;
  transmission?: string | null;
  minYear?: number | null;
  maxYear?: number | null;
  maxPrice?: number | null;
  currency?: string | null;
  instance?: string | null;
  remoteJid?: string | null;
  contactName?: string | null;
  phone?: string | null;

  notifyOnMatch: boolean;
  notifyMinScore: number;
  notifyCooldownMin: number;
  lastNotifiedAt?: string | null;
  matchTemplate?: string | null;

  recontactEnabled: boolean;
  recontactEveryDays: number;
  recontactNextAt?: string | null;
  recontactCount: number;
  recontactMax: number;
  recontactTemplate?: string | null;

  createdAt: string;
  updatedAt: string;
};

export type DemandMatch = {
  id: number;
  demandId: number;
  vehicleId: string;
  score: number;
  reasons?: any;
  createdAt: string;
  notifiedAt?: string | null;
  lastSharedAt?: string | null;
  vehicle?: any;
};

export type DemandRecontact = {
  id: number;
  demandId: number;
  attempt: number;
  message: string;
  matchVehicleIds: string[];
  sentAt: string;
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
  slug?: string;
  permalink?: string;
  pictures?: string;
  updatedAt?: string;
  transmission?: string;
  fuel?: string;
};

type VehicleSource = {
  schema: string;
  table: string;
  columns: string[];
  map: ColumnMap;
};

const CANDIDATE_TABLES = [
  'vehicles',
  'Vehicles',
  'vehicle',
  'autos',
  'cars',
  'car_stock',
  'stock_vehicles',
  'catalog',
  'vehiculos',
];

const COL_SYNONYMS: Record<keyof Omit<ColumnMap, 'id'>, string[]> = {
  brand: ['brand', 'marca', 'make'],
  model: ['model', 'modelo'],
  version: ['version', 'trim', 'variant', 'versión', 'version_name'],
  title: ['title', 'nombre', 'name', 'descripcion', 'description'],
  price: ['price', 'precio', 'valor', 'amount'],
  currency: ['currency', 'moneda', 'currency_code'],
  year: ['year', 'anio', 'año', 'model_year'],
  slug: ['slug'],
  permalink: ['permalink', 'url', 'link'],
  pictures: ['pictures', 'images', 'fotos', 'photos'],
  updatedAt: ['updated_at', 'updatedat'],
  transmission: ['transmission', 'caja', 'gearbox'],
  fuel: ['fuel', 'combustible'],
};

const ID_SYNONYMS = ['id', 'vehicle_id', 'uuid', 'uid'];

let vehicleSourceCache: { at: number; source: VehicleSource | null } = { at: 0, source: null };
const VEHICLE_SOURCE_CACHE_MS = 60_000;
let lastGoodVehicleScan: { at: number; rows: any[] } = { at: 0, rows: [] };
const LAST_GOOD_SCAN_TTL_MS = 30 * 60_000;

function norm(s: any) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function qi(ident: string): string {
  return `"${String(ident).replace(/"/g, '""')}"`;
}

function pickFirstPresent(columns: string[], synonyms: string[]): string | undefined {
  const set = new Set(columns.map((c) => c.toLowerCase()));
  for (const s of synonyms) {
    if (set.has(s.toLowerCase())) {
      const original = columns.find((c) => c.toLowerCase() === s.toLowerCase());
      return original || s;
    }
  }
  return undefined;
}

async function getVehicleSource(): Promise<VehicleSource | null> {
  const now = Date.now();
  if (vehicleSourceCache.source && now - vehicleSourceCache.at < VEHICLE_SOURCE_CACHE_MS) {
    return vehicleSourceCache.source;
  }

  try {
    const tablesR = await vehicleQuery(
      `
      select table_schema, table_name
      from information_schema.tables
      where table_type = 'BASE TABLE'
        and table_schema not in ('pg_catalog','information_schema')
        and table_name = any($1::text[])
      order by
        case when table_schema = 'public' then 0 else 1 end,
        table_schema asc,
        table_name asc
      `,
      [CANDIDATE_TABLES]
    );

    const tables = (tablesR.rows ?? []).map((r: any) => ({
      schema: String(r.table_schema || 'public'),
      table: String(r.table_name || ''),
    })).filter((r: any) => r.table);

    const preferred = [{ schema: 'public', table: 'vehicles' }, ...tables];

    for (const t of preferred) {
      const colsR = await vehicleQuery(
        `
        select column_name
        from information_schema.columns
        where table_schema = $1 and table_name = $2
        `,
        [t.schema, t.table]
      );

      const cols = (colsR.rows ?? []).map((row: any) => String(row.column_name)).filter(Boolean);
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
        slug: pickFirstPresent(cols, COL_SYNONYMS.slug),
        permalink: pickFirstPresent(cols, COL_SYNONYMS.permalink),
        pictures: pickFirstPresent(cols, COL_SYNONYMS.pictures),
        updatedAt: pickFirstPresent(cols, COL_SYNONYMS.updatedAt),
        transmission: pickFirstPresent(cols, COL_SYNONYMS.transmission),
        fuel: pickFirstPresent(cols, COL_SYNONYMS.fuel),
      };

      const looksLikeVehicles = !!(map.title || map.version || (map.brand && map.model));
      const hasPriceOrYear = !!(map.price || map.year);
      if (!looksLikeVehicles || !hasPriceOrYear) continue;

      const source: VehicleSource = { schema: t.schema, table: t.table, columns: cols, map };
      vehicleSourceCache = { at: now, source };
      return source;
    }
  } catch (e) {
    console.error('[demands] detect vehicle source failed', e);
  }

  console.warn('[demands] getVehicleSource: no vehicle table found. Check that vehiclePool connects to the DB with the vehicles table. vehiclePool===pool:', vehiclePool === pool);
  vehicleSourceCache = { at: now, source: null };
  return null;
}

function buildVehicleTitle(row: any) {
  // Construir siempre un label estructurado con brand+model+version+year cuando estén disponibles.
  // Preferirlo sobre title si es más rico (title puede ser solo la marca o solo "BAIC").
  const structured = [row.brand, row.model, row.version, row.year]
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
    .join(' ');

  const titleStr = String(row.title ?? '').trim();

  // Usar el más informativo: structured si tiene al menos brand+model (>=2 tokens),
  // de lo contrario caer a title o version como fallback.
  const structuredTokens = structured.split(/\s+/).filter(Boolean).length;
  if (structuredTokens >= 2) return structured;
  if (titleStr && titleStr.split(/\s+/).filter(Boolean).length > 1) return titleStr;
  return structured || titleStr || String(row.version ?? '').trim() || String(row.id ?? '');
}

async function listVehiclesForScan(since?: Date) {
  const source = await getVehicleSource();
  if (!source) return [];

  const { schema, table, map } = source;
  const brandExpr = map.brand ? qi(map.brand) : `NULL::text`;
  const modelExpr = map.model ? qi(map.model) : `NULL::text`;
  const titleExpr = map.title
    ? qi(map.title)
    : map.version
      ? qi(map.version)
      : `TRIM(CONCAT(COALESCE(${brandExpr}::text, ''), ' ', COALESCE(${modelExpr}::text, '')))`;
  const yearExpr = map.year ? `${qi(map.year)}::int` : `NULL::int`;
  const priceExpr = map.price ? `NULLIF(${qi(map.price)}::text, '')::numeric` : `NULL::numeric`;
  const currencyExpr = map.currency ? `COALESCE(${qi(map.currency)}::text, 'ARS')` : `'ARS'::text`;

  const fields = [
    `${qi(map.id)}::text as id`,
    `${titleExpr} as title`,
    `${brandExpr} as brand`,
    `${modelExpr} as model`,
    `${yearExpr} as year`,
    `${priceExpr} as price`,
    `${currencyExpr} as currency`,
    map.slug ? `${qi(map.slug)} as slug` : `NULL::text as slug`,
    map.permalink ? `${qi(map.permalink)} as permalink` : `NULL::text as permalink`,
    map.pictures ? `${qi(map.pictures)} as pictures` : `NULL::jsonb as pictures`,
    map.transmission ? `${qi(map.transmission)} as transmission` : `NULL::text as transmission`,
    map.fuel ? `${qi(map.fuel)} as fuel` : `NULL::text as fuel`
  ];

  const params: any[] = [];
  const whereClauses: string[] = [];

  // Only match active/available vehicles — same filter catalog.ts uses
  const statusCol = source.columns.find(c => ['status', 'estado'].includes(c.toLowerCase()));
  if (statusCol) {
    whereClauses.push(`(${qi(statusCol)} is null or btrim(${qi(statusCol)}::text) = '' or lower(${qi(statusCol)}::text) not in ('inactive', 'archived', 'deleted', 'sold', 'paused'))`);
  }

  // Apply since filter only if the table has an updatedAt column
  if (since && map.updatedAt) {
    params.push(since.toISOString());
    whereClauses.push(`${qi(map.updatedAt)} >= $${params.length}`);
  }

  const whereExpr = whereClauses.length ? `where ${whereClauses.join(' and ')}` : '';

  const sql = `
    select ${fields.join(', ')}
    from ${qi(schema)}.${qi(table)}
    ${whereExpr}
    order by ${map.updatedAt ? `${qi(map.updatedAt)} desc nulls last,` : ''} ${qi(map.id)} desc
    limit 2000
  `;
  // Pre-filter diagnostic: count total rows (ignoring since/status filters) so
  // "vehicles=0" logs are actionable — shows whether the table is empty vs filtered.
  let totalInTable = -1;
  try {
    const countR = await vehicleQuery(`SELECT COUNT(*) AS cnt FROM ${qi(schema)}.${qi(table)}`, []);
    totalInTable = Number(countR.rows[0]?.cnt ?? -1);
  } catch { /* best-effort */ }

  const r = await vehicleQuery(sql, params);
  const rows = (r.rows ?? []).map((row: any) => ({
    id: String(row.id),
    title: buildVehicleTitle(row),
    brand: row.brand,
    model: row.model,
    year: row.year ? Number(row.year) : null,
    price: row.price == null ? null : Number(row.price),
    currency: String(row.currency || 'ARS').toUpperCase(),
    slug: row.slug,
    permalink: row.permalink,
    pictures: row.pictures,
    transmission: row.transmission,
    fuel: row.fuel
  }));

  const sinceLabel = since ? since.toISOString() : 'all';
  const updatedAtFilter = since && map.updatedAt ? `updatedAt>=${sinceLabel}` : 'no-since-filter';

  if (rows.length > 0) {
    lastGoodVehicleScan = { at: Date.now(), rows };
  } else if (lastGoodVehicleScan.rows.length && Date.now() - lastGoodVehicleScan.at < LAST_GOOD_SCAN_TTL_MS) {
    console.warn(`[demands] scan 0 from ${schema}.${table} (total_in_table=${totalInTable} filter=${updatedAtFilter} status_col=${statusCol ?? 'none'}); reusing last good scan (${lastGoodVehicleScan.rows.length})`);
    console.log(`[demands] scan source=${schema}.${table} vehicles=${lastGoodVehicleScan.rows.length} since=${sinceLabel} strategy=last-good-cache`);
    return lastGoodVehicleScan.rows;
  } else if (rows.length === 0) {
    console.warn(`[demands] vehicles=0 source=${schema}.${table} total_in_table=${totalInTable} filter=${updatedAtFilter} status_col=${statusCol ?? 'none'} updatedAt_col=${map.updatedAt ?? 'none'} vehiclePool_is_supabase=${vehiclePool !== pool}`);
  }
  console.log(`[demands] scan source=${schema}.${table} vehicles=${rows.length} since=${sinceLabel} strategy=full-inventory`);
  return rows;
}

async function getVehiclesByIds(vehicleIds: string[]) {
  const ids = Array.from(new Set((vehicleIds || []).map((x) => String(x)).filter(Boolean)));
  if (!ids.length) return new Map<string, any>();
  const source = await getVehicleSource();
  if (!source) return new Map<string, any>();

  const { schema, table, map } = source;
  const brandExpr = map.brand ? qi(map.brand) : `NULL::text`;
  const modelExpr = map.model ? qi(map.model) : `NULL::text`;
  const titleExpr = map.title
    ? qi(map.title)
    : map.version
      ? qi(map.version)
      : `TRIM(CONCAT(COALESCE(${brandExpr}::text, ''), ' ', COALESCE(${modelExpr}::text, '')))`;
  const yearExpr = map.year ? `${qi(map.year)}::int` : `NULL::int`;
  const priceExpr = map.price ? `NULLIF(${qi(map.price)}::text, '')::numeric` : `NULL::numeric`;
  const currencyExpr = map.currency ? `COALESCE(${qi(map.currency)}::text, 'ARS')` : `'ARS'::text`;

  const sql = `
    select
      ${qi(map.id)}::text as id,
      ${titleExpr} as title,
      ${brandExpr} as brand,
      ${modelExpr} as model,
      ${yearExpr} as year,
      ${priceExpr} as price,
      ${currencyExpr} as currency,
      ${map.slug ? qi(map.slug) : 'NULL::text'} as slug,
      ${map.permalink ? qi(map.permalink) : 'NULL::text'} as permalink,
      ${map.pictures ? qi(map.pictures) : 'NULL::jsonb'} as pictures,
      ${map.fuel ? qi(map.fuel) : 'NULL::text'} as fuel
    from ${qi(schema)}.${qi(table)}
    where ${qi(map.id)}::text = any($1::text[])
  `;
  const r = await vehicleQuery(sql, [ids]);
  return new Map(
    (r.rows ?? []).map((row: any) => [String(row.id), {
      id: String(row.id),
      title: buildVehicleTitle(row),
      brand: row.brand,
      model: row.model,
      year: row.year ? Number(row.year) : null,
      price: row.price == null ? null : Number(row.price),
      currency: String(row.currency || 'ARS').toUpperCase(),
      slug: row.slug,
      permalink: row.permalink,
      pictures: row.pictures,
      fuel: row.fuel
    }])
  );
}

function tokenSet(s: string) {
  const toks = norm(s).split(' ').filter(Boolean);
  return new Set(toks);
}

const SYNONYMS: Record<string, string[]> = {
  suv: ['camioneta', 'crossover', 'utilitario', '4x4', 'todoterreno'],
  camioneta: ['suv', 'crossover', 'utilitario', '4x4', 'pickup'],
  pickup: ['pick up', 'doble cabina', 'camioneta'],
  automatico: ['automatica', 'at', 'tiptronic', 'dsg', 'cvt', 'multitronic'],
  automatica: ['automatico', 'at', 'tiptronic', 'dsg', 'cvt'],
  manual: ['mt', 'caja', 'caja manual', 'sincronico'],
  '4x4': ['4wd', 'awd', 'cuatro por cuatro'],
  nafta: ['gasolina', 'naftero'],
  gasolina: ['nafta', 'naftero'],
  diesel: ['gasoil', 'gas oil', 'turbodiesel'],
  gnc: ['gas natural', 'gas'],
  volkswagen: ['vw', 'volk'],
  chevrolet: ['chevy', 'chevi'],
  mercedes: ['merc', 'benz'],
  hilux: ['hi lux', 'hi-lux'],
  ecosport: ['eco sport'],
  frontier: ['frontera'],
};

function expandTokens(set: Set<string>): Set<string> {
  const out = new Set<string>(set);
  for (const t of set) {
    const syns = SYNONYMS[t];
    if (!syns) continue;
    for (const s of syns) {
      for (const tt of tokenSet(s)) out.add(tt);
    }
  }
  return out;
}

function dice(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  const inter = [...a].filter((x) => b.has(x)).length;
  return (2 * inter) / (a.size + b.size);
}

function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size && !b.size) return 1;
  const inter = [...a].filter((x) => b.has(x)).length;
  const uni = new Set([...a, ...b]).size;
  return uni ? inter / uni : 0;
}

function textSim(a: Set<string>, b: Set<string>): number {
  return dice(a, b) * 0.6 + jaccard(a, b) * 0.4;
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function inferVehicleFuel(vehicle: any): string {
  const txt = norm(`${vehicle?.fuel ?? ''} ${vehicle?.title ?? ''}`);
  if (!txt) return '';
  if (txt.includes('gnc') || txt.includes('gas natural')) return 'gnc';
  if (txt.includes('diesel') || txt.includes('gasoil') || txt.includes('turbodiesel')) return 'diesel';
  if (txt.includes('nafta') || txt.includes('gasolina') || txt.includes('naftero')) return 'nafta';
  if (txt.includes('hibrid') || txt.includes('hybrid')) return 'hibrido';
  if (txt.includes('electr') || /\bev\b/.test(txt)) return 'electrico';
  return '';
}

function inferVehicleBodywork(vehicle: any): string {
  const txt = norm(`${vehicle?.title ?? ''} ${vehicle?.brand ?? ''} ${vehicle?.model ?? ''}`);
  if (!txt) return '';
  if (/\b(suv|crossover|todoterreno|4x4|awd|4wd)\b/.test(txt)) return 'suv';
  if (/\b(pickup|pick up|doble cabina)\b/.test(txt)) return 'pickup';
  if (/\b(sedan|4 puertas)\b/.test(txt)) return 'sedan';
  if (/\b(hatch|hatchback|3 puertas)\b/.test(txt)) return 'hatch';
  if (/\b(furgon|utilitario)\b/.test(txt)) return 'furgon';
  return '';
}

function inferDemandContext(demand: VehicleDemand) {
  const extracted = extractLeadFields(String(demand.query || ''));
  return {
    brand: demand.brand || extracted.brand || undefined,
    model: demand.model || extracted.model || undefined,
    transmission: demand.transmission || extracted.transmission || undefined,
    minYear: demand.minYear ?? extracted.minYear ?? undefined,
    maxYear: demand.maxYear ?? extracted.maxYear ?? undefined,
    maxPrice: demand.maxPrice ?? extracted.maxPrice ?? extracted.amount ?? undefined,
    fuel: extracted.fuel || (extracted.gnc ? 'gnc' : undefined),
    bodywork: extracted.bodywork || undefined,
    gnc: extracted.gnc === true
  };
}

function mapDemandRow(row: any): VehicleDemand {
  return {
    id: Number(row.id),
    status: row.status,
    query: row.query,
    brand: row.brand,
    model: row.model,
    transmission: row.transmission,
    minYear: row.min_year,
    maxYear: row.max_year,
    maxPrice: row.max_price,
    currency: row.currency,
    instance: row.instance,
    remoteJid: row.remote_jid,
    contactName: row.contact_name,
    phone: row.phone,
    notifyOnMatch: Boolean(row.notify_on_match),
    notifyMinScore: Number(row.notify_min_score ?? 0.58),
    notifyCooldownMin: Number(row.notify_cooldown_min ?? 240),
    lastNotifiedAt: row.last_notified_at ? row.last_notified_at.toISOString?.() ?? String(row.last_notified_at) : null,
    matchTemplate: row.match_template ?? null,
    recontactEnabled: Boolean(row.recontact_enabled),
    recontactEveryDays: Number(row.recontact_every_days ?? 7),
    recontactNextAt: row.recontact_next_at ? row.recontact_next_at.toISOString?.() ?? String(row.recontact_next_at) : null,
    recontactCount: Number(row.recontact_count ?? 0),
    recontactMax: Number(row.recontact_max ?? 5),
    recontactTemplate: row.recontact_template ?? null,
    createdAt: row.created_at?.toISOString?.() ?? String(row.created_at),
    updatedAt: row.updated_at?.toISOString?.() ?? String(row.updated_at)
  };
}

function mapRecontactRow(row: any): DemandRecontact {
  let ids: string[] = [];
  try {
    if (Array.isArray(row.match_vehicle_ids)) ids = row.match_vehicle_ids.map(String);
    else if (typeof row.match_vehicle_ids === 'string' && row.match_vehicle_ids.trim()) ids = JSON.parse(row.match_vehicle_ids);
  } catch {
    ids = [];
  }
  return {
    id: Number(row.id),
    demandId: Number(row.demand_id),
    attempt: Number(row.attempt ?? 0),
    message: String(row.message ?? ''),
    matchVehicleIds: ids,
    sentAt: row.sent_at?.toISOString?.() ?? String(row.sent_at)
  };
}

export function getDemandVehicleScanDebug() {
  return {
    vehiclePoolIsSameAsMainPool: vehiclePool === pool,
    hasSupabasePool: Boolean(supabasePool),
    vehicleSourceCached: Boolean(vehicleSourceCache.source),
    vehicleSourceTable: vehicleSourceCache.source ? `${vehicleSourceCache.source.schema}.${vehicleSourceCache.source.table}` : null,
    vehicleSourceCachedAt: vehicleSourceCache.at ? new Date(vehicleSourceCache.at).toISOString() : null,
    lastGoodVehicleScanCount: lastGoodVehicleScan.rows.length,
    lastGoodVehicleScanAt: lastGoodVehicleScan.at ? new Date(lastGoodVehicleScan.at).toISOString() : null
  };
}

/** Force clear the vehicle source cache so next scan re-detects the table. */
export function clearVehicleSourceCache() {
  vehicleSourceCache = { at: 0, source: null };
  lastGoodVehicleScan = { at: 0, rows: [] };
}

export async function createVehicleDemand(input: any): Promise<VehicleDemand> {
  const instance = (String(input.instance ?? env.instanceName ?? '').trim()) || env.instanceName;
  const remoteJid = input.remoteJid ? String(input.remoteJid).trim() : null;
  const contactName = typeof input.contactName === 'string' ? input.contactName.trim() : null;
  const phone = typeof input.phone === 'string' ? input.phone.trim() : null;
  const query = String(input.query ?? '').trim();
  const brand = input.brand ? String(input.brand).trim() : null;
  const model = input.model ? String(input.model).trim() : null;
  const transmission = input.transmission ? String(input.transmission).trim() : null;
  const year = input.year !== undefined && input.year !== null ? Number(input.year) : undefined;
  const minYear = input.minYear !== undefined && input.minYear !== null ? Number(input.minYear) : year;
  const maxYear = input.maxYear !== undefined && input.maxYear !== null ? Number(input.maxYear) : year;
  const maxPrice = input.maxPrice !== undefined && input.maxPrice !== null ? Number(input.maxPrice) : null;
  const currency = input.currency ? String(input.currency).trim().toUpperCase() : null;
  const notifyOnMatch = input.notifyOnMatch !== undefined ? Boolean(input.notifyOnMatch) : true;
  const notifyMinScore = Number.isFinite(Number(input.notifyMinScore)) ? Number(input.notifyMinScore) : 0.58;
  const notifyCooldownMin = Number.isFinite(Number(input.notifyCooldownMin)) ? Number(input.notifyCooldownMin) : 240;
  const matchTemplate = typeof input.matchTemplate === 'string' ? input.matchTemplate : null;
  const recontactEnabled = input.recontactEnabled !== undefined ? Boolean(input.recontactEnabled) : false;
  const recontactEveryDays = Number.isFinite(Number(input.recontactEveryDays)) ? Number(input.recontactEveryDays) : 7;
  const recontactMaxDefault = Number(process.env.RECONTACT_MAX_DEFAULT ?? '3');
  const recontactMax = Number.isFinite(Number(input.recontactMax))
    ? Number(input.recontactMax)
    : (Number.isFinite(recontactMaxDefault) && recontactMaxDefault > 0 ? recontactMaxDefault : 5);
  const recontactTemplate = typeof input.recontactTemplate === 'string' ? input.recontactTemplate : null;
  const recontactNextAt = recontactEnabled
    ? new Date(Date.now() + Math.max(1, recontactEveryDays) * 24 * 60 * 60 * 1000).toISOString()
    : null;

  const sql = `
    insert into vehicle_demands (
      status, query, brand, model, transmission, min_year, max_year, max_price, currency,
      instance, remote_jid, contact_name, phone,
      notify_on_match, notify_min_score, notify_cooldown_min, match_template,
      recontact_enabled, recontact_every_days, recontact_next_at, recontact_max, recontact_template
    ) values (
      'open', $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12,
      $13, $14, $15, $16,
      $17, $18, $19, $20, $21
    )
    returning *
  `;

  const params = [
    query, brand, model, transmission,
    Number.isFinite(minYear as any) ? minYear : null,
    Number.isFinite(maxYear as any) ? maxYear : null,
    maxPrice, currency, instance, remoteJid, contactName, phone,
    notifyOnMatch, notifyMinScore, notifyCooldownMin, matchTemplate,
    recontactEnabled, recontactEveryDays, recontactNextAt, recontactMax, recontactTemplate
  ];

  const r = await pool.query(sql, params);
  return mapDemandRow(r.rows[0]);
}

export async function updateVehicleDemand(id: number, patch: any): Promise<VehicleDemand> {
  const fields: string[] = [];
  const values: any[] = [];
  const set = (col: string, v: any) => {
    values.push(v);
    fields.push(`${col} = $${values.length}`);
  };

  if (patch.status) set('status', String(patch.status));
  if (patch.query !== undefined) set('query', String(patch.query ?? '').trim());
  if (patch.brand !== undefined) set('brand', patch.brand ? String(patch.brand).trim() : null);
  if (patch.model !== undefined) set('model', patch.model ? String(patch.model).trim() : null);
  if (patch.transmission !== undefined) set('transmission', patch.transmission ? String(patch.transmission).trim() : null);
  if (patch.minYear !== undefined) set('min_year', patch.minYear !== null ? Number(patch.minYear) : null);
  if (patch.maxYear !== undefined) set('max_year', patch.maxYear !== null ? Number(patch.maxYear) : null);
  if (patch.maxPrice !== undefined) set('max_price', patch.maxPrice !== null ? Number(patch.maxPrice) : null);
  if (patch.currency !== undefined) set('currency', patch.currency ? String(patch.currency).toUpperCase() : null);
  if (patch.instance !== undefined) set('instance', patch.instance ? String(patch.instance).trim() : env.instanceName);
  if (patch.remoteJid !== undefined) set('remote_jid', patch.remoteJid ? String(patch.remoteJid).trim() : null);
  if (patch.contactName !== undefined) set('contact_name', patch.contactName ? String(patch.contactName).trim() : null);
  if (patch.phone !== undefined) set('phone', patch.phone ? String(patch.phone).trim() : null);
  if (patch.notifyOnMatch !== undefined) set('notify_on_match', Boolean(patch.notifyOnMatch));
  if (patch.notifyMinScore !== undefined) set('notify_min_score', Number(patch.notifyMinScore));
  if (patch.notifyCooldownMin !== undefined) set('notify_cooldown_min', Number(patch.notifyCooldownMin));
  if (patch.matchTemplate !== undefined) set('match_template', patch.matchTemplate ? String(patch.matchTemplate) : null);
  if (patch.recontactEnabled !== undefined) set('recontact_enabled', Boolean(patch.recontactEnabled));
  if (patch.recontactEveryDays !== undefined) set('recontact_every_days', Number(patch.recontactEveryDays));
  if (patch.recontactMax !== undefined) set('recontact_max', Number(patch.recontactMax));
  if (patch.recontactTemplate !== undefined) set('recontact_template', patch.recontactTemplate ? String(patch.recontactTemplate) : null);
  if (patch.recontactEnabled === true && patch.recontactNextAt === undefined) {
    const every = Number.isFinite(Number(patch.recontactEveryDays)) ? Number(patch.recontactEveryDays) : 7;
    set('recontact_next_at', new Date(Date.now() + Math.max(1, every) * 24 * 60 * 60 * 1000).toISOString());
  }
  if (patch.recontactNextAt !== undefined) set('recontact_next_at', patch.recontactNextAt);

  if (!fields.length) {
    const cur = await pool.query('select * from vehicle_demands where id = $1', [id]);
    return mapDemandRow(cur.rows[0]);
  }

  values.push(id);
  const sql = `update vehicle_demands set ${fields.join(', ')}, updated_at = now() where id = $${values.length} returning *`;
  const r = await pool.query(sql, values);
  return mapDemandRow(r.rows[0]);
}

export async function closeVehicleDemand(id: number) {
  await pool.query(`update vehicle_demands set status='closed', updated_at=now() where id=$1`, [id]);
}

export async function listVehicleDemands(params: { status?: DemandStatus; limit?: number }) {
  const status = params.status ?? 'open';
  const limit = Math.max(1, Math.min(500, Number(params.limit ?? 100)));
  const r = await pool.query(`select * from vehicle_demands where status = $1 order by updated_at desc limit $2`, [status, limit]);
  return r.rows.map(mapDemandRow);
}

export async function listDemandMatches(demandId: number, limit = 20) {
  const lim = Math.max(1, Math.min(100, Number(limit)));
  const r = await pool.query(
    `
      select id, demand_id, vehicle_id, score, reasons, created_at, notified_at, last_shared_at
      from vehicle_demand_matches
      where demand_id = $1
      order by score desc, created_at desc
      limit $2
    `,
    [demandId, lim]
  );

  const ids = (r.rows ?? []).map((row: any) => String(row.vehicle_id));
  const vehicles = await getVehiclesByIds(ids);

  return (r.rows ?? []).map((row: any) => ({
    id: Number(row.id),
    demandId: Number(row.demand_id),
    vehicleId: String(row.vehicle_id),
    score: Number(row.score),
    reasons: row.reasons,
    createdAt: row.created_at?.toISOString?.() ?? String(row.created_at),
    notifiedAt: row.notified_at?.toISOString?.() ?? (row.notified_at ? String(row.notified_at) : null),
    lastSharedAt: row.last_shared_at?.toISOString?.() ?? (row.last_shared_at ? String(row.last_shared_at) : null),
    vehicle: vehicles.get(String(row.vehicle_id)) ?? null
  } as DemandMatch));
}

export async function listDemandRecontacts(demandId: number, limit = 50): Promise<DemandRecontact[]> {
  const lim = Math.max(1, Math.min(200, Number(limit)));
  const r = await pool.query(`select * from vehicle_demand_recontacts where demand_id=$1 order by sent_at desc limit $2`, [demandId, lim]);
  return r.rows.map(mapRecontactRow);
}

function fmtPrice(price: any, currency: any): string {
  const n = Number(price);
  if (!Number.isFinite(n) || n <= 0) return '';
  const cur = String(currency || '').toUpperCase() || 'ARS';
  try {
    return `${cur} ${n.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`;
  } catch {
    return `${cur} ${n}`;
  }
}

function buildMatchMessage(demand: VehicleDemand, vehicles: any[], scores: number[]): string {
  const name = demand.contactName ? ` ${demand.contactName}` : '';
  const tpl = (demand.matchTemplate ?? '').trim();

  const lines = vehicles.map((v, i) => {
    const title = String(v?.title || `${v?.brand || ''} ${v?.model || ''}`.trim() || 'Vehículo').trim();
    const year = v?.year ? ` ${v.year}` : '';
    const priceStr = fmtPrice(v?.price, v?.currency);
    const url = v?.permalink ? String(v.permalink) : env.publicUrl && v?.slug ? `${env.publicUrl.replace(/\/$/, '')}/autos/${v.slug}` : '';
    const pct = Math.round((scores[i] ?? 0) * 100);
    const parts = [`${i + 1}. *${title}${year}*`];
    if (priceStr) parts.push(`   💰 ${priceStr}`);
    if (url) parts.push(`   🔗 ${url}`);
    parts.push(`   ✅ Coincidencia: ${pct}%`);
    return parts.join('\n');
  });

  if (tpl && vehicles.length === 1) {
    const v = vehicles[0];
    const title = String(v?.title || `${v?.brand || ''} ${v?.model || ''}`.trim() || 'Vehículo').trim();
    const year = v?.year ? String(v.year) : '';
    const url = v?.permalink ?? (env.publicUrl && v?.slug ? `${env.publicUrl.replace(/\/$/, '')}/autos/${v.slug}` : '');
    return tpl
      .replaceAll('{name}', demand.contactName ?? '')
      .replaceAll('{query}', demand.query)
      .replaceAll('{title}', title)
      .replaceAll('{year}', year)
      .replaceAll('{price}', fmtPrice(v?.price, v?.currency))
      .replaceAll('{currency}', String(v?.currency ?? ''))
      .replaceAll('{score}', String(Math.round((scores[0] ?? 0) * 100)))
      .replaceAll('{url}', url ?? '');
  }

  const count = vehicles.length;
  const plural = count === 1 ? 'una opción' : `${count} opciones`;
  return `🚗 Hola${name}! Encontré ${plural} que se acerca a lo que buscabas:\n` +
    `_${"\""}${demand.query}${"\""}_\n\n` +
    lines.join('\n\n') +
    '\n\n¿Te interesa alguna? Puedo darte más info o buscar alternativas.';
}

export async function scanRecentVehiclesForDemandMatches(params: { since: Date; threshold: number }) {
  // Default 0.38 (was 0.45). Rationale: demands are often expressed in natural language
  // without explicit brand/model fields. The old threshold caused 0 matches for most real-world
  // demands like "quiero un auto familiar" or "necesito una Hilux usada".
  const threshold = clamp01(Number(params.threshold ?? 0.38));
  const since = params.since;

  const demandsR = await pool.query(`select * from vehicle_demands where status='open'`);
  const demands = demandsR.rows.map(mapDemandRow);
  const vehicles = await listVehiclesForScan(since);

  let matchesInserted = 0;
  let notificationsSent = 0;

  const vTok = new Map<string, Set<string>>();
  for (const v of vehicles) {
    const txt = `${v.title ?? ''} ${v.brand ?? ''} ${v.model ?? ''} ${v.transmission ?? ''} ${v.fuel ?? ''} ${inferVehicleBodywork(v)}`;
    vTok.set(String(v.id), tokenSet(txt));
  }

  for (const d of demands) {
    const demandCtx = inferDemandContext(d);
    const demandText = [d.query, demandCtx.brand, demandCtx.model, demandCtx.transmission, demandCtx.fuel, demandCtx.bodywork].filter(Boolean).join(' ');
    const dSet = expandTokens(tokenSet(demandText));
    const candidates: { matchId: number; vehicle: any; score: number }[] = [];
    // Collect matches to batch-insert after scoring all vehicles (avoids N+1 queries)
    const pendingMatches: { vehicle: any; score: number; reasons: any }[] = [];

    for (const v of vehicles) {
      const reasons: any = {};
      let score = 0;

      if (demandCtx.brand && v.brand) {
        const db = norm(demandCtx.brand);
        const vb = norm(v.brand);
        if (db === vb) {
          score += 0.25;
          reasons.brand = 'exact';
        } else if (vb.includes(db) || db.includes(vb)) {
          score += 0.12;
          reasons.brand = 'partial';
        }
      }

      if (demandCtx.model && v.model) {
        const dm = norm(demandCtx.model);
        const vm = norm(String(v.model ?? ''));
        const vt = norm(String(v.title ?? ''));
        if (dm === vm) {
          score += 0.20;
          reasons.model = 'exact';
        } else if (vm.includes(dm) || dm.includes(vm) || vt.includes(dm)) {
          score += 0.12;
          reasons.model = 'partial';
        }
      }

      const vSet = expandTokens(vTok.get(String(v.id)) ?? new Set());
      const sim = textSim(dSet, vSet);
      score += sim * 0.35;
      reasons.textSim = Math.round(sim * 100) / 100;
      if (!demandCtx.brand && !demandCtx.model && sim >= 0.18) {
        // Generic demand (no brand/model) — give a bigger boost so it can pass the threshold
        // with just meaningful text similarity. A demand like "quiero una Hilux" extracts
        // model=hilux via extractLeadFields, so this boost applies only to truly generic demands.
        score += 0.12;
        reasons.genericIntentBoost = true;
      }

      const vy = v.year ? Number(v.year) : null;
      if (vy && (demandCtx.minYear || demandCtx.maxYear)) {
        const minY = demandCtx.minYear ?? demandCtx.maxYear ?? vy;
        const maxY = demandCtx.maxYear ?? demandCtx.minYear ?? vy;
        let yScore = 0;
        if (vy >= minY && vy <= maxY) yScore = 1;
        else {
          const dist = Math.min(Math.abs(vy - minY), Math.abs(vy - maxY));
          yScore = dist === 1 ? 0.7 : dist === 2 ? 0.45 : dist === 3 ? 0.2 : 0;
        }
        score += yScore * 0.15;
        reasons.year = { vy, minY, maxY, yScore: Math.round(yScore * 100) / 100 };
      }

      if (demandCtx.maxPrice && v.price) {
        const vp = Number(v.price);
        if (Number.isFinite(vp) && vp > 0) {
          const extendedMax = demandCtx.maxPrice * 1.10;
          if (vp <= demandCtx.maxPrice) {
            const ratio = vp / demandCtx.maxPrice;
            score += ratio >= 0.75 ? 0.12 : 0.08;
            reasons.price = 'ok';
          } else if (vp <= extendedMax) {
            // Dentro del 10% extra: no penalizar, puntaje neutro
            score += 0.04;
            reasons.price = 'ok_extended';
          } else {
            const over = (vp - extendedMax) / extendedMax;
            score -= Math.min(0.10, over * 0.15);
            reasons.price = `over_${Math.round(over * 100)}pct`;
          }
        }
      }

      if (demandCtx.transmission) {
        const dt = norm(demandCtx.transmission);
        const vt = norm(String(v.transmission ?? v.title ?? ''));
        const syns = [dt, ...(SYNONYMS[dt] ?? [])];
        if (syns.some((s) => vt.includes(norm(s)))) {
          score += 0.07;
          reasons.transmission = true;
        } else if (vt) {
          score -= 0.03;
          reasons.transmission = 'mismatch';
        }
      }

      if (demandCtx.fuel) {
        const vehicleFuel = inferVehicleFuel(v);
        const demandFuel = norm(String(demandCtx.fuel));
        if (vehicleFuel && vehicleFuel === demandFuel) {
          score += 0.08;
          reasons.fuel = vehicleFuel;
        } else if (vehicleFuel && demandFuel) {
          score -= 0.05;
          reasons.fuel = `mismatch_${vehicleFuel}`;
        }
      } else if (demandCtx.gnc) {
        const vehicleFuel = inferVehicleFuel(v);
        if (vehicleFuel === 'gnc') {
          score += 0.08;
          reasons.gnc = true;
        } else if (vehicleFuel) {
          score -= 0.05;
          reasons.gnc = 'mismatch';
        }
      }

      if (demandCtx.bodywork) {
        const vehicleBodywork = inferVehicleBodywork(v);
        const demandBodywork = norm(String(demandCtx.bodywork));
        if (vehicleBodywork && vehicleBodywork === demandBodywork) {
          score += 0.08;
          reasons.bodywork = vehicleBodywork;
        } else if (vehicleBodywork && demandBodywork) {
          score -= 0.04;
          reasons.bodywork = `mismatch_${vehicleBodywork}`;
        }
      }

      score = clamp01(score);
      if (score < threshold) continue;
      pendingMatches.push({ vehicle: v, score, reasons });
    }

    // Batch-insert all matches for this demand in a single query
    if (pendingMatches.length > 0) {
      const values: any[] = [];
      const placeholders = pendingMatches.map((m, i) => {
        const base = i * 4;
        values.push(d.id, String(m.vehicle.id), m.score, m.reasons);
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
      });
      const batchRes = await pool.query(
        `
          insert into vehicle_demand_matches (demand_id, vehicle_id, score, reasons)
          values ${placeholders.join(', ')}
          on conflict (demand_id, vehicle_id)
          do update set score = greatest(vehicle_demand_matches.score, excluded.score), reasons = excluded.reasons
          returning id, vehicle_id, notified_at
        `,
        values
      );
      matchesInserted += batchRes.rows.length;

      // Build notification candidates from batch results
      const notifyMinScore = clamp01(d.notifyMinScore);
      for (const row of batchRes.rows) {
        const match = pendingMatches.find((m) => String(m.vehicle.id) === String(row.vehicle_id));
        if (!match) continue;
        const alreadyNotified = !!row.notified_at;
        if (d.notifyOnMatch && d.remoteJid && d.instance && match.score >= notifyMinScore && !alreadyNotified) {
          candidates.push({ matchId: Number(row.id), vehicle: match.vehicle, score: match.score });
        }
      }
    }

    if (candidates.length > 0 && d.remoteJid && d.instance && d.notifyOnMatch) {
      const last = d.lastNotifiedAt ? new Date(d.lastNotifiedAt).getTime() : 0;
      const cooldownMs = Math.max(0, d.notifyCooldownMin) * 60_000;
      if (!last || Date.now() - last >= cooldownMs) {
        const top = candidates.sort((a, b) => b.score - a.score).slice(0, 3);
        try {
          const number = String(d.remoteJid).split('@')[0];
          const msg = buildMatchMessage(d, top.map((c) => c.vehicle), top.map((c) => c.score));
          await sendTextAndPersist(d.instance, d.remoteJid, msg);
          notificationsSent += 1;
          await pool.query(`update vehicle_demand_matches set notified_at = now() where id = any($1::bigint[])`, [top.map((x) => x.matchId)]);
          await pool.query(`update vehicle_demands set last_notified_at = now(), updated_at=now() where id = $1`, [d.id]);
          d.lastNotifiedAt = new Date().toISOString();
        } catch (e) {
          console.error('Demand notify failed', e);
        }
      }
    }
  }

  return { vehicles: vehicles.length, demands: demands.length, matches: matchesInserted, notificationsSent };
}

export async function runRecontactJob() {
  const limit = 50;
  const r = await pool.query(
    `
      select * from vehicle_demands
      where status='open'
        and recontact_enabled = true
        and remote_jid is not null
        and instance is not null
        and recontact_next_at is not null
        and (recontact_count < recontact_max)
        and recontact_next_at <= now()
      order by recontact_next_at asc
      limit $1
    `,
    [limit]
  );

  console.log(`[recontact] ${r.rows.length} demands due for recontact`);
  let sent = 0;
  for (const row of r.rows) {
    const d = mapDemandRow(row);
    try {
      const number = String(d.remoteJid!).split('@')[0];
      const lastR = await pool.query(`select sent_at from vehicle_demand_recontacts where demand_id=$1 order by sent_at desc limit 1`, [d.id]);
      const lastSentAt = lastR.rows?.[0]?.sent_at ? new Date(lastR.rows[0].sent_at).toISOString() : '1970-01-01T00:00:00.000Z';
      const mr = await pool.query(
        `
          select vehicle_id, score, created_at
          from vehicle_demand_matches
          where demand_id=$1 and created_at > $2
          order by score desc
          limit 3
        `,
        [d.id, lastSentAt]
      );
      const matchIds = (mr.rows ?? []).map((m: any) => String(m.vehicle_id));
      const vehicleMap = await getVehiclesByIds(matchIds);
      const newMatches = (mr.rows ?? []).map((m: any) => ({ ...m, ...(vehicleMap.get(String(m.vehicle_id)) ?? {}) }));
      const matchBlock = newMatches.length
        ? `\n\nEncontré estas opciones nuevas que se acercan:\n\n${newMatches
            .map((m: any, i: number) => {
              const title = (m.title ?? `${m.brand ?? ''} ${m.model ?? ''}`.trim()) || m.vehicle_id;
              const year = m.year ? ` (${m.year})` : '';
              const price = m.price ? ` - ${m.currency ?? ''} ${m.price}` : '';
              const url = m.permalink || m.url ? `\n${m.permalink || m.url}` : '';
              const scoreTxt = `${Math.round(Number(m.score) * 100)}%`;
              return `${i + 1}) ${title}${year}${price}${url}\nScore: ${scoreTxt}`;
            })
            .join('\n\n')}`
        : '';

      const tpl = (d.recontactTemplate ?? '').trim();
      let msg = tpl
        ? tpl.replaceAll('{name}', d.contactName ?? '').replaceAll('{query}', d.query).replaceAll('{count}', String(d.recontactCount + 1)).replaceAll('{match}', matchBlock.trim())
        : `Hola${d.contactName ? ' ' + d.contactName : ''}! 👋\nSigo atento por lo de: ${d.query}.\nSi querés, decime presupuesto y forma de pago así te filtro mejores opciones.`;

      if (matchBlock && !tpl.includes('{match}')) msg = `${msg}${matchBlock}`;

      console.log(`[recontact] sending to ${number} demand=${d.id} matches=${newMatches.length}`);
      await sendTextAndPersist(d.instance!, d.remoteJid!, msg);
      sent += 1;

      try {
        await pool.query(`insert into vehicle_demand_recontacts (demand_id, attempt, message, match_vehicle_ids) values ($1,$2,$3,$4)`, [d.id, d.recontactCount + 1, msg, JSON.stringify(newMatches.map((m: any) => String(m.vehicle_id))) ]);
        if (newMatches.length) {
          await pool.query(`update vehicle_demand_matches set last_shared_at = now() where demand_id=$1 and vehicle_id = any($2::text[])`, [d.id, newMatches.map((m: any) => String(m.vehicle_id))]);
        }
      } catch {
        // ignore
      }

      const next = new Date(Date.now() + Math.max(1, d.recontactEveryDays) * 24 * 60 * 60 * 1000).toISOString();
      await pool.query(`update vehicle_demands set recontact_count = recontact_count + 1, recontact_next_at = $2, updated_at = now() where id = $1`, [d.id, next]);
    } catch (e) {
      console.error('Recontact failed', e);
    }
  }
  console.log(`[recontact] done: due=${r.rows.length} sent=${sent}`);
  return { due: r.rows.length, sent };
}
