import pg from "pg";

const { Client } = pg;

const SRC = process.env.SUPABASE_DATABASE_URL; // Supabase Postgres connection string
const DST = process.env.RAILWAY_DATABASE_URL;  // Railway Postgres connection string

if (!SRC || !DST) {
  console.error("Missing SUPABASE_DATABASE_URL or RAILWAY_DATABASE_URL");
  process.exit(1);
}

// Supabase pooler generally requires SSL.
const src = new Client({ connectionString: SRC, ssl: { rejectUnauthorized: false } });
const dst = new Client({ connectionString: DST, ssl: { rejectUnauthorized: false } });

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
  await src.connect();
  await dst.connect();

  // Destination table (minimum contract the panel expects)
  await dst.query(`
    CREATE TABLE IF NOT EXISTS public.vehicles (
      id       text PRIMARY KEY,
      marca    text,
      modelo   text,
      version  text,
      year     int,
      precio   numeric,
      currency text
    )
  `);

  // Detect available columns in Supabase public.vehicles to avoid selecting non-existent columns.
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
  const yearCol = firstExisting(colSet, ["year", "ano", "anio"]);
  const precioCol = firstExisting(colSet, ["precio", "price", "amount"]);
  const currencyCol = firstExisting(colSet, ["currency", "moneda", "curr"]);

  // Build safe SELECT using only detected columns
  const selectParts = [
    `"${idCol}" AS id`,
    marcaCol ? `"${marcaCol}" AS marca` : `NULL::text AS marca`,
    modeloCol ? `"${modeloCol}" AS modelo` : `NULL::text AS modelo`,
    versionCol ? `"${versionCol}" AS version` : `NULL::text AS version`,
    yearCol ? `"${yearCol}" AS year` : `NULL::int AS year`,
    precioCol ? `"${precioCol}" AS precio` : `NULL::numeric AS precio`,
    currencyCol ? `"${currencyCol}" AS currency` : `'ARS'::text AS currency`,
  ];

  const res = await src.query(`SELECT ${selectParts.join(", ")} FROM public.vehicles`);

  const upsert = `
    INSERT INTO public.vehicles (id, marca, modelo, version, year, precio, currency)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (id) DO UPDATE SET
      marca=EXCLUDED.marca,
      modelo=EXCLUDED.modelo,
      version=EXCLUDED.version,
      year=EXCLUDED.year,
      precio=EXCLUDED.precio,
      currency=EXCLUDED.currency
  `;

  let ok = 0;
  for (const r of res.rows) {
    if (!r.id) continue;
    await dst.query(upsert, [
      str(r.id),
      r.marca ?? null,
      r.modelo ?? null,
      r.version ?? null,
      r.year !== null && r.year !== undefined ? Number(r.year) : null,
      r.precio !== null && r.precio !== undefined ? Number(r.precio) : null,
      r.currency ?? "ARS",
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