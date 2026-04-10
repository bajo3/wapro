/**
 * meliSync.ts
 *
 * Syncs MercadoLibre listings → Supabase `vehicles` table.
 *
 * Flow:
 *   1. Get ML user_id from /users/me
 *   2. Paginate /users/{id}/items/search → collect all item IDs
 *   3. Fetch item detail in batches of 20 (ML multiget endpoint)
 *   4. Map → vehicles schema
 *   5. Upsert to Supabase
 *
 * Run:
 *   node dist/services/meliSync.js
 *
 * Env vars:
 *   SUPABASE_DATABASE_URL or DATABASE_URL
 *   MELI_CLIENT_ID
 *   MELI_CLIENT_SECRET
 */

import pg from 'pg';
import { meliFetch } from './meliClient.js';

const MELI_API = 'https://api.mercadolibre.com';
const BATCH_SIZE = 20; // ML multiget limit

// ── ML API types ───────────────────────────────────────────────────────────────

interface MeliUser {
  id: number;
  nickname: string;
}

interface MeliSearchResult {
  results: string[];
  paging: { total: number; offset: number; limit: number };
}

interface MeliAttribute {
  id: string;
  name: string;
  value_name: string | null;
}

interface MeliPicture {
  url: string;
  secure_url?: string;
}

interface MeliItem {
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
}

// ── Vehicles schema mapping ────────────────────────────────────────────────────

interface VehicleRow {
  id: string;
  title: string;
  price: number;
  currency: string;
  status: string;
  permalink: string;
  images: string[];
  source: string;
  brand: string | null;
  model: string | null;
  version: string | null;
  year: number | null;
  km: number | null;
  fuel: string | null;
  transmission: string | null;
  color: string | null;
  engine: string | null;
}

const ATTR_MAP: Record<string, keyof VehicleRow> = {
  BRAND:              'brand',
  MODEL:              'model',
  TRIM:               'version',
  VERSION:            'version',
  VEHICLE_YEAR:       'year',
  VEHICLE_MILEAGE:    'km',
  FUEL_TYPE:          'fuel',
  TRANSMISSION:       'transmission',
  COLOR:              'color',
  ENGINE_DISPLACEMENT:'engine'
};

function attrValue(attrs: MeliAttribute[], id: string): string | null {
  return attrs.find((a) => a.id === id)?.value_name ?? null;
}

function mapItem(item: MeliItem): VehicleRow {
  const attrs = item.attributes ?? [];

  const rawPictures = item.pictures ?? [];
  console.log(`[meliSync] ML pictures for ${item.id}: ${rawPictures.length}`);
  let images: string[] = rawPictures.map((p) => p.url).filter(Boolean);
  if (images.length === 0 && item.thumbnail) {
    images = [item.thumbnail];
  }

  const raw: Record<string, string | null> = {};
  for (const [meliId, field] of Object.entries(ATTR_MAP)) {
    raw[field] = attrValue(attrs, meliId);
  }

  const yearStr = raw['year'];
  const kmStr = raw['km'];

  return {
    id:           item.id,
    title:        item.title,
    price:        item.price,
    currency:     item.currency_id === 'ARS' ? 'ARS' : 'USD',
    status:       item.status === 'active' ? 'available' : 'sold',
    permalink:    item.permalink,
    images,
    source:       'meli',
    brand:        raw['brand'] ?? null,
    model:        raw['model'] ?? null,
    version:      (raw['version'] as string | null) ?? null,
    year:         yearStr ? parseInt(yearStr, 10) : null,
    km:           kmStr ? parseFloat(kmStr.replace(/\D/g, '')) : null,
    fuel:         raw['fuel'] ?? null,
    transmission: raw['transmission'] ?? null,
    color:        raw['color'] ?? null,
    engine:       raw['engine'] ?? null
  };
}

// ── ML API helpers ─────────────────────────────────────────────────────────────

async function getMeliUserId(): Promise<number> {
  const res = await meliFetch(`${MELI_API}/users/me`);
  if (!res.ok) throw new Error(`[meliSync] /users/me failed: ${res.status}`);
  const data = await res.json() as MeliUser;
  return data.id;
}

export async function getMeliItems(userId: number): Promise<string[]> {
  const ids: string[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const url = `${MELI_API}/users/${userId}/items/search?limit=${limit}&offset=${offset}`;
    const res = await meliFetch(url);
    if (!res.ok) {
      console.error(`[meliSync] items/search failed at offset ${offset}: ${res.status}`);
      break;
    }
    const data = await res.json() as MeliSearchResult;
    ids.push(...data.results);

    const fetched = offset + data.results.length;
    if (fetched >= data.paging.total || data.results.length === 0) break;
    offset = fetched;
  }

  return ids;
}

export async function getMeliItemDetail(ids: string[]): Promise<MeliItem[]> {
  const items: MeliItem[] = [];

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const url = `${MELI_API}/items?ids=${batch.join(',')}`;

    const res = await meliFetch(url);
    if (!res.ok) {
      console.error(`[meliSync] /items multiget failed: ${res.status}`);
      continue;
    }

    const data = await res.json() as Array<{ code: number; body: MeliItem }>;
    for (const entry of data) {
      if (entry.code === 200 && entry.body) {
        items.push(entry.body);
      } else {
        console.warn(`[meliSync] Item returned code ${entry.code}, skipping`);
      }
    }
  }

  return items;
}

// ── Supabase upsert ────────────────────────────────────────────────────────────

function buildPool(): pg.Pool {
  const rawUrl = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
  if (!rawUrl) throw new Error('[meliSync] SUPABASE_DATABASE_URL or DATABASE_URL is required');
  const ssl = /supabase\.com|sslmode=require/i.test(rawUrl) ? { rejectUnauthorized: false } : undefined;
  return new pg.Pool({ connectionString: rawUrl, ssl, max: 3 });
}

let _pool: pg.Pool | null = null;
function getPool(): pg.Pool {
  if (!_pool) _pool = buildPool();
  return _pool;
}

async function upsertVehicles(vehicles: VehicleRow[]): Promise<number> {
  if (vehicles.length === 0) return 0;

  const pool = getPool();
  let upserted = 0;

  for (const v of vehicles) {
    await pool.query(
      `INSERT INTO vehicles
         (id, title, price, currency, status, permalink, images, source,
          brand, model, version, year, km, fuel, transmission, color, engine,
          created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,now(),now())
       ON CONFLICT (id) DO UPDATE SET
         title        = EXCLUDED.title,
         price        = EXCLUDED.price,
         currency     = EXCLUDED.currency,
         status       = EXCLUDED.status,
         permalink    = EXCLUDED.permalink,
         images       = EXCLUDED.images,
         source       = EXCLUDED.source,
         brand        = EXCLUDED.brand,
         model        = EXCLUDED.model,
         version      = EXCLUDED.version,
         year         = EXCLUDED.year,
         km           = EXCLUDED.km,
         fuel         = EXCLUDED.fuel,
         transmission = EXCLUDED.transmission,
         color        = EXCLUDED.color,
         engine       = EXCLUDED.engine,
         updated_at   = now()`,
      [
        v.id, v.title, v.price, v.currency, v.status, v.permalink,
        v.images, v.source, v.brand, v.model, v.version, v.year,
        v.km, v.fuel, v.transmission, v.color, v.engine
      ]
    );
    upserted++;
  }

  return upserted;
}

// ── Main sync ──────────────────────────────────────────────────────────────────

export async function runMeliSync(): Promise<void> {
  console.log('[meliSync] Starting sync...');

  try {
    const userId = await getMeliUserId();
    console.log(`[meliSync] ML user_id: ${userId}`);

    const itemIds = await getMeliItems(userId);
    console.log(`[meliSync] Found ${itemIds.length} items`);
    if (itemIds.length === 0) return;

    const items = await getMeliItemDetail(itemIds);
    console.log(`[meliSync] Fetched detail for ${items.length} items`);

    const vehicles = items.map(mapItem);
    const count = await upsertVehicles(vehicles);

    console.log(`[meliSync] Done — upserted ${count} vehicles`);
  } catch (err) {
    console.error('[meliSync] Sync failed:', err);
    process.exitCode = 1;
  } finally {
    if (_pool) await _pool.end();
  }
}

// ── Entry point (cron) ─────────────────────────────────────────────────────────

// Runs when called directly: node dist/services/meliSync.js
const isMain = process.argv[1]?.endsWith('meliSync.js') ||
               process.argv[1]?.endsWith('meliSync.ts');
if (isMain) {
  runMeliSync().then(() => process.exit(process.exitCode ?? 0));
}
