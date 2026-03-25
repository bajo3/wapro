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

  // remove params that can influence ssl semantics in some parsers
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

// Supabase: SSL sí (pooler)
const src = new Client(
  clientConfigFromUrl(SRC_RAW, { forceSslNoVerify: true })
);

// Railway: también forzamos SSL sin validar (evita SELF_SIGNED_CERT_IN_CHAIN)
const dst = new Client(
  clientConfigFromUrl(DST_RAW, { forceSslNoVerify: true })
);

function str(v) {
  if (v === null || v === undefined) return null;
  return String(v);
}

function has(colSet, name) {
  return colSet.has(String(name).toLowerCase());
}

function firstExisting(colSet, candidates) {
  for (const c of candidates) {
    if (has(colSet, c)) return c;
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
      color        text,
      status       text,
      image_url    text,
      pictures     text,
      permalink    text,
      source       text
    )
  `);

  await dst.query(`
    ALTER TABLE public.vehicles
      ADD COLUMN IF NOT EXISTS title text,
      ADD COLUMN IF NOT EXISTS km numeric,
      ADD COLUMN IF NOT EXISTS transmission text,
      ADD COLUMN IF NOT EXISTS fuel text,
      ADD COLUMN IF NOT EXISTS color text,
      ADD COLUMN IF NOT EXISTS status text,
      ADD COLUMN IF NOT EXISTS image_url text,
      ADD COLUMN IF NOT EXISTS pictures text,
      ADD COLUMN IF NOT EXISTS permalink text,
      ADD COLUMN IF NOT EXISTS source text
  `);

  const colsRes = await src.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name='vehicles'`
  );

  const colSet = new Set(colsRes.rows.map((r) => String(r.column_name).toLowerCase()));
  if (!colSet.size) {
    console.error("Supabase table public.vehicles not found (no columns returned)");
    process.exit(2);
  }

  const idCol = firstExisting(colSet, ["id", "vehicle_id", "uuid"]) ?? "id";
  const marcaCol = firstExisting(colSet, ["marca", "brand", "make", "manufacturer"]);
  const modeloCol = firstExisting(colSet, ["modelo", "model"]);
  const versionCol = firstExisting(colSet, ["version", "version_name", "trim", "variant"]);
  const titleCol = firstExisting(colSet, ["title", "nombre", "name", "description", "descripcion"]);
  const yearCol = firstExisting(colSet, ["year", "ano", "anio"]);
  const precioCol = firstExisting(colSet, ["precio", "price", "amount"]);
  const currencyCol = firstExisting(colSet, ["currency", "moneda", "curr"]);
  const kmCol = firstExisting(colSet, ["km", "Km", "kms", "kilometers", "kilometraje", "mileage"]);
  const transmissionCol = firstExisting(colSet, ["transmission", "caja", "Caja", "gearbox"]);
  const fuelCol = firstExisting(colSet, ["fuel", "combustible", "Combustible"]);
  const colorCol = firstExisting(colSet, ["color", "Color"]);
  const statusCol = firstExisting(colSet, ["status", "estado"]);
  const imageCol = firstExisting(colSet, ["image_url", "image", "cover", "cover_image", "thumbnail", "picture_url"]);
  const picturesCol = firstExisting(colSet, ["pictures", "images", "photos", "gallery"]);
  const permalinkCol = firstExisting(colSet, ["permalink", "url", "link"]);
  const sourceCol = firstExisting(colSet, ["source", "origin", "origen"]);

  const selectParts = [
    `"${idCol}" AS id`,
    marcaCol ? `"${marcaCol}" AS marca` : `NULL::text AS marca`,
    modeloCol ? `"${modeloCol}" AS modelo` : `NULL::text AS modelo`,
    versionCol ? `"${versionCol}" AS version` : `NULL::text AS version`,
    titleCol ? `"${titleCol}" AS title` : `NULL::text AS title`,
    yearCol ? `"${yearCol}" AS year` : `NULL::int AS year`,
    precioCol ? `"${precioCol}" AS precio` : `NULL::numeric AS precio`,
    currencyCol ? `"${currencyCol}" AS currency` : `NULL::text AS currency`,
    kmCol ? `"${kmCol}" AS km` : `NULL::numeric AS km`,
    transmissionCol ? `"${transmissionCol}" AS transmission` : `NULL::text AS transmission`,
    fuelCol ? `"${fuelCol}" AS fuel` : `NULL::text AS fuel`,
    colorCol ? `"${colorCol}" AS color` : `NULL::text AS color`,
    statusCol ? `"${statusCol}" AS status` : `'active'::text AS status`,
    imageCol ? `"${imageCol}" AS image_url` : `NULL::text AS image_url`,
    picturesCol ? `"${picturesCol}" AS pictures` : `NULL::text AS pictures`,
    permalinkCol ? `"${permalinkCol}" AS permalink` : `NULL::text AS permalink`,
    sourceCol ? `"${sourceCol}" AS source` : `NULL::text AS source`,
  ];

  const res = await src.query(`SELECT ${selectParts.join(", ")} FROM public.vehicles`);

  const upsert = `
    INSERT INTO public.vehicles (
      id, marca, modelo, version, title, year, precio, currency,
      km, transmission, fuel, color, status, image_url, pictures, permalink, source
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
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
      color=EXCLUDED.color,
      status=EXCLUDED.status,
      image_url=EXCLUDED.image_url,
      pictures=EXCLUDED.pictures,
      permalink=EXCLUDED.permalink,
      source=EXCLUDED.source
  `;

  let ok = 0;
  for (const r of res.rows) {
    if (!r.id) continue;
    const price = r.precio !== null && r.precio !== undefined ? Number(r.precio) : null;
    const currency = str(r.currency || "").toUpperCase() || (price !== null && price < 1000000 ? "USD" : "ARS");
    await dst.query(upsert, [
      str(r.id),
      r.marca ?? null,
      r.modelo ?? null,
      r.version ?? null,
      r.title ?? null,
      r.year !== null && r.year !== undefined ? Number(r.year) : null,
      price,
      currency,
      r.km !== null && r.km !== undefined ? Number(r.km) : null,
      r.transmission ?? null,
      r.fuel ?? null,
      r.color ?? null,
      r.status ?? "active",
      r.image_url ?? null,
      r.pictures ?? null,
      r.permalink ?? null,
      r.source ?? null,
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