import pkg from "pg";
const { Client } = pkg;

const SRC_RAW = process.env.SUPABASE_DATABASE_URL;
const DST_RAW = process.env.RAILWAY_DATABASE_URL;

if (!SRC_RAW || !DST_RAW) {
  console.error("Missing SUPABASE_DATABASE_URL or RAILWAY_DATABASE_URL");
  process.exit(1);
}

function clientConfigFromUrl(conn, { forceSslNoVerify }) {
  const u = new URL(conn);

  const toDelete = [
    "sslmode",
    "ssl",
    "sslrootcert",
    "sslcert",
    "sslkey",
    "sslpassword",
    "uselibpqcompat",
  ];
  for (const k of toDelete) u.searchParams.delete(k);

  const cfg = {
    host: u.hostname,
    port: u.port ? Number(u.port) : 5432,
    user: decodeURIComponent(u.username || ""),
    password: decodeURIComponent(u.password || ""),
    database: u.pathname?.replace(/^\//, "") || "",
  };

  if (forceSslNoVerify) {
    cfg.ssl = { rejectUnauthorized: false };
  }

  return cfg;
}

const src = new Client(clientConfigFromUrl(SRC_RAW, { forceSslNoVerify: true }));
const dst = new Client(clientConfigFromUrl(DST_RAW, { forceSslNoVerify: true }));

function str(v) {
  if (v === null || v === undefined) return null;
  return String(v);
}

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function qi(ident) {
  return `"${String(ident).replace(/"/g, '""')}"`;
}

function buildColumnLookup(rows) {
  const byLower = new Map();
  for (const row of rows) {
    const original = String(row.column_name || "").trim();
    if (!original) continue;
    byLower.set(original.toLowerCase(), original);
  }
  return byLower;
}

function firstExisting(byLower, candidates) {
  for (const c of candidates) {
    const hit = byLower.get(String(c).toLowerCase());
    if (hit) return hit;
  }
  return null;
}

(async () => {
  console.log("syncVehicles.mjs: url-parsed ssl-no-verify");

  await src.connect();
  await dst.connect();

  await dst.query(`
    CREATE TABLE IF NOT EXISTS public.vehicles (
      id           text PRIMARY KEY,
      marca        text,
      modelo       text,
      version      text,
      title        text,
      year         int,
      precio       numeric,
      currency     text,
      km           numeric,
      transmission text,
      fuel         text,
      status       text,
      color        text,
      slug         text,
      permalink    text,
      image        text
    )
  `);

  await dst.query(`ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS title text`);
  await dst.query(`ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS km numeric`);
  await dst.query(`ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS transmission text`);
  await dst.query(`ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS fuel text`);
  await dst.query(`ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS status text`);
  await dst.query(`ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS color text`);
  await dst.query(`ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS slug text`);
  await dst.query(`ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS permalink text`);
  await dst.query(`ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS image text`);

  const colsRes = await src.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name='vehicles'`
  );

  const byLower = buildColumnLookup(colsRes.rows);
  if (!byLower.size) {
    console.error("Supabase table public.vehicles not found (no columns returned)");
    process.exit(2);
  }

  const idCol = firstExisting(byLower, ["id", "vehicle_id", "uuid"]) ?? "id";
  const marcaCol = firstExisting(byLower, ["marca", "brand", "make", "manufacturer"]);
  const modeloCol = firstExisting(byLower, ["modelo", "model"]);
  const versionCol = firstExisting(byLower, ["version", "version_name", "trim", "variant"]);
  const titleCol = firstExisting(byLower, ["title", "name", "nombre"]);
  const yearCol = firstExisting(byLower, ["year", "ano", "anio", "año"]);
  const precioCol = firstExisting(byLower, ["precio", "price", "amount"]);
  const currencyCol = firstExisting(byLower, ["currency", "moneda", "curr"]);
  const kmCol = firstExisting(byLower, ["km", "Km", "mileage", "kilometers", "kilometres"]);
  const transmissionCol = firstExisting(byLower, ["transmission", "caja", "gearbox", "Caja"]);
  const fuelCol = firstExisting(byLower, ["fuel", "combustible", "Combustible"]);
  const statusCol = firstExisting(byLower, ["status", "state", "availability"]);
  const colorCol = firstExisting(byLower, ["color", "colour"]);
  const slugCol = firstExisting(byLower, ["slug"]);
  const permalinkCol = firstExisting(byLower, ["permalink", "url"]);
  const imageCol = firstExisting(byLower, ["image", "image_url", "photo", "thumbnail"]);

  const selectParts = [
    `${qi(idCol)} AS id`,
    marcaCol ? `${qi(marcaCol)} AS marca` : `NULL::text AS marca`,
    modeloCol ? `${qi(modeloCol)} AS modelo` : `NULL::text AS modelo`,
    versionCol ? `${qi(versionCol)} AS version` : `NULL::text AS version`,
    titleCol ? `${qi(titleCol)} AS title` : `NULL::text AS title`,
    yearCol ? `${qi(yearCol)} AS year` : `NULL::int AS year`,
    precioCol ? `${qi(precioCol)} AS precio` : `NULL::numeric AS precio`,
    currencyCol ? `${qi(currencyCol)} AS currency` : `'ARS'::text AS currency`,
    kmCol ? `${qi(kmCol)} AS km` : `NULL::numeric AS km`,
    transmissionCol ? `${qi(transmissionCol)} AS transmission` : `NULL::text AS transmission`,
    fuelCol ? `${qi(fuelCol)} AS fuel` : `NULL::text AS fuel`,
    statusCol ? `${qi(statusCol)} AS status` : `NULL::text AS status`,
    colorCol ? `${qi(colorCol)} AS color` : `NULL::text AS color`,
    slugCol ? `${qi(slugCol)} AS slug` : `NULL::text AS slug`,
    permalinkCol ? `${qi(permalinkCol)} AS permalink` : `NULL::text AS permalink`,
    imageCol ? `${qi(imageCol)} AS image` : `NULL::text AS image`,
  ];

  const res = await src.query(`SELECT ${selectParts.join(", ")} FROM public.vehicles`);

  const upsert = `
    INSERT INTO public.vehicles (
      id, marca, modelo, version, title, year, precio, currency,
      km, transmission, fuel, status, color, slug, permalink, image
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    ON CONFLICT (id) DO UPDATE SET
      marca=EXCLUDED.marca,
      modelo=EXCLUDED.modelo,
      version=EXCLUDED.version,
      title=EXCLUDED.title,
      year=EXCLUDED.year,
      precio=EXCLUDED.precio,
      currency=EXCLUDED.currency,
      km=EXCLUDED.km,
      transmission=EXCLUDED.transmission,
      fuel=EXCLUDED.fuel,
      status=EXCLUDED.status,
      color=EXCLUDED.color,
      slug=EXCLUDED.slug,
      permalink=EXCLUDED.permalink,
      image=EXCLUDED.image
  `;

  let ok = 0;
  for (const r of res.rows) {
    if (!r.id) continue;
    await dst.query(upsert, [
      str(r.id),
      str(r.marca),
      str(r.modelo),
      str(r.version),
      str(r.title),
      num(r.year),
      num(r.precio),
      str(r.currency) || "ARS",
      num(r.km),
      str(r.transmission),
      str(r.fuel),
      str(r.status),
      str(r.color),
      str(r.slug),
      str(r.permalink),
      str(r.image),
    ]);
    ok++;
  }

  console.log(`Synced vehicles: ${ok}`);

  await src.end();
  await dst.end();
})().catch(async (e) => {
  console.error(e);
  try { await src.end(); } catch {}
  try { await dst.end(); } catch {}
  process.exit(1);
});
