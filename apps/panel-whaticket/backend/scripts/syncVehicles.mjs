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
    "sslmode", "ssl", "sslrootcert", "sslcert", "sslkey",
    "sslpassword", "uselibpqcompat",
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

/**
 * Build a map from lowercase column name → actual column name as stored in DB.
 * This is critical because PostgreSQL quoted identifiers are case-sensitive:
 * SELECT "km" fails if the actual column is "Km".
 */
function buildColMap(rows) {
  const map = new Map();
  rows.forEach((r) => map.set(String(r.column_name).toLowerCase(), r.column_name));
  return map;
}

/**
 * Return the actual column name (preserving original case) for the first
 * candidate that exists in the table.
 */
function firstExisting(colMap, candidates) {
  for (const c of candidates) {
    const actual = colMap.get(String(c).toLowerCase());
    if (actual !== undefined) return actual; // returns real DB name, e.g. "Km" not "km"
  }
  return null;
}

/**
 * Parse a full vehicle title into (model, version) components.
 * Example: "Renault Duster 1.6 GTF 2WD" with brand="Renault"
 *   → model="Duster", version="1.6 GTF 2WD"
 * Example: "Citroën C4 Lounge 1.6 Hdi 115 Feel Pack" with brand="Citroën"
 *   → model="C4 Lounge", version="1.6 Hdi 115 Feel Pack"
 */
function parseVehicleTitle(title, brand) {
  if (!title || !title.trim()) return { model: null, version: null };

  let rest = title.trim();

  // Remove brand prefix (case-insensitive)
  if (brand && brand.trim()) {
    const escaped = brand.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    rest = rest.replace(new RegExp("^" + escaped + "\\s*", "i"), "").trim();
  }

  if (!rest) return { model: null, version: null };

  const tokens = rest.split(/\s+/);
  let modelEnd = tokens.length; // default: entire rest = model

  // Known numeric model names that should NOT be treated as version starters
  const NUMERIC_MODELS = /^(1500|2500|3500|4runner|500|500x|208|308|408|508|2008|3008|5008|x1|x2|x3|x4|x5|x6|x7|q2|q3|q5|q7|q8|a1|a3|a4|a5|a6|a7|a8)$/i;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // Version section usually starts with an engine-size pattern: "1.6", "2.0T", "1.5"
    // But skip known numeric model names (e.g. "1500" in "Ram 1500")
    if (/^\d+[.,]\d*/.test(t) && !NUMERIC_MODELS.test(t)) {
      modelEnd = i;
      break;
    }
    // After 2 word tokens, treat the rest as version (e.g. "C4 Lounge")
    if (i >= 2) {
      modelEnd = i;
      break;
    }
  }

  const model = tokens.slice(0, modelEnd).join(" ").trim() || null;
  const version = tokens.slice(modelEnd).join(" ").trim() || null;

  return { model, version };
}

(async () => {
  console.log("syncVehicles.mjs: v2 - colMap + title parsing + canonical columns");

  await src.connect();
  await dst.connect();

  // Create destination table with canonical English column names (matches catalog.ts expectations)
  await dst.query(`
    CREATE TABLE IF NOT EXISTS public.vehicles (
      id           text PRIMARY KEY,
      brand        text,
      model        text,
      version      text,
      title        text,
      year         int,
      price        numeric,
      currency     text,
      km           numeric,
      engine       text,
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

  // Add missing columns (handles existing tables that may have old or partial schemas)
  await dst.query(`
    ALTER TABLE public.vehicles
      ADD COLUMN IF NOT EXISTS brand        text,
      ADD COLUMN IF NOT EXISTS model        text,
      ADD COLUMN IF NOT EXISTS price        numeric,
      ADD COLUMN IF NOT EXISTS engine       text,
      ADD COLUMN IF NOT EXISTS title        text,
      ADD COLUMN IF NOT EXISTS km           numeric,
      ADD COLUMN IF NOT EXISTS transmission text,
      ADD COLUMN IF NOT EXISTS fuel         text,
      ADD COLUMN IF NOT EXISTS color        text,
      ADD COLUMN IF NOT EXISTS status       text,
      ADD COLUMN IF NOT EXISTS image_url    text,
      ADD COLUMN IF NOT EXISTS pictures     text,
      ADD COLUMN IF NOT EXISTS permalink    text,
      ADD COLUMN IF NOT EXISTS source       text,
      ADD COLUMN IF NOT EXISTS year         int,
      ADD COLUMN IF NOT EXISTS currency     text,
      ADD COLUMN IF NOT EXISTS version      text
  `);

  // Migrate legacy Spanish column names → canonical English names (one-time data copy)
  await dst.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='vehicles' AND column_name='marca'
      ) THEN
        UPDATE public.vehicles SET brand = marca WHERE brand IS NULL AND marca IS NOT NULL;
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='vehicles' AND column_name='modelo'
      ) THEN
        UPDATE public.vehicles SET model = modelo WHERE model IS NULL AND modelo IS NOT NULL;
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='vehicles' AND column_name='precio'
      ) THEN
        UPDATE public.vehicles SET price = precio WHERE price IS NULL AND precio IS NOT NULL;
      END IF;
    END $$;
  `);

  // Detect actual Supabase source columns (preserving original case via colMap)
  const colsRes = await src.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name='vehicles'`
  );

  const colMap = buildColMap(colsRes.rows);
  if (!colMap.size) {
    console.error("Supabase table public.vehicles not found (no columns returned)");
    process.exit(2);
  }

  console.log("Supabase columns detected:", [...colMap.values()].join(", "));

  // Map source columns using actual case (fixes the case-sensitivity bug)
  const idCol          = firstExisting(colMap, ["id", "vehicle_id", "uuid"]) ?? "id";
  const brandCol       = firstExisting(colMap, ["brand", "marca", "make", "manufacturer"]);
  const modelCol       = firstExisting(colMap, ["model", "modelo"]);
  const versionCol     = firstExisting(colMap, ["version", "version_name", "trim", "variant"]);
  const titleCol       = firstExisting(colMap, ["title", "nombre", "name", "description", "descripcion"]);
  const yearCol        = firstExisting(colMap, ["year", "ano", "anio"]);
  const priceCol       = firstExisting(colMap, ["price", "precio", "amount"]);
  const currencyCol    = firstExisting(colMap, ["currency", "moneda", "curr"]);
  // For km/engine/transmission/fuel we need COALESCE because Supabase may have BOTH
  // lowercase (null) and capitalized ML-imported (filled) columns simultaneously.
  const kmColLower     = colMap.get("km")          ?? null;
  const kmColUpper     = colMap.get("Km")           ? colMap.get("Km")           : (colMap.get("kms") ?? colMap.get("kilometers") ?? colMap.get("kilometraje") ?? colMap.get("mileage") ?? null);
  const engineColLower = colMap.get("engine")       ?? null;
  const engineColUpper = colMap.get("Motor")        ? colMap.get("Motor")        : (colMap.get("motor") ?? colMap.get("cilindrada") ?? null);
  const transColLower  = colMap.get("transmission") ?? null;
  const transColUpper  = colMap.get("Caja")         ? colMap.get("Caja")         : (colMap.get("caja") ?? colMap.get("gearbox") ?? null);
  const fuelColLower   = colMap.get("fuel")         ?? null;
  const fuelColUpper   = colMap.get("Combustible")  ? colMap.get("Combustible")  : (colMap.get("combustible") ?? null);

  // Legacy single-column fallback (if only one variant exists)
  const kmCol          = kmColLower     || kmColUpper     || firstExisting(colMap, ["km", "Km", "kms", "kilometers", "kilometraje", "mileage"]);
  const engineCol      = engineColLower || engineColUpper || firstExisting(colMap, ["engine", "motor", "Motor", "cilindrada"]);
  const transmissionCol = transColLower || transColUpper  || firstExisting(colMap, ["transmission", "caja", "Caja", "gearbox"]);
  const fuelCol        = fuelColLower   || fuelColUpper   || firstExisting(colMap, ["fuel", "combustible", "Combustible"]);
  const colorCol       = firstExisting(colMap, ["color", "Color"]);
  const statusCol      = firstExisting(colMap, ["status", "estado"]);
  const imageCol       = firstExisting(colMap, ["image_url", "image", "cover", "cover_image", "thumbnail", "picture_url"]);
  const picturesCol    = firstExisting(colMap, ["pictures", "images", "photos", "gallery"]);
  const permalinkCol   = firstExisting(colMap, ["permalink", "url", "link"]);
  const sourceCol      = firstExisting(colMap, ["source", "origin", "origen"]);

  console.log("Column mapping:", {
    id: idCol, brand: brandCol, model: modelCol, version: versionCol,
    title: titleCol, km: kmCol, engine: engineCol, transmission: transmissionCol,
    fuel: fuelCol, price: priceCol,
  });

  const selectParts = [
    `"${idCol}" AS id`,
    brandCol       ? `"${brandCol}" AS brand`       : `NULL::text    AS brand`,
    modelCol       ? `"${modelCol}" AS model`        : `NULL::text    AS model`,
    versionCol     ? `"${versionCol}" AS version`    : `NULL::text    AS version`,
    titleCol       ? `"${titleCol}" AS title`        : `NULL::text    AS title`,
    yearCol        ? `"${yearCol}" AS year`          : `NULL::int     AS year`,
    priceCol       ? `"${priceCol}" AS price`        : `NULL::numeric AS price`,
    currencyCol    ? `"${currencyCol}" AS currency`  : `NULL::text    AS currency`,
    // COALESCE both column variants: prefer lowercase (standard) but fall back to capitalized (ML-imported)
    (kmColLower && kmColUpper)
      ? `COALESCE("${kmColLower}", "${kmColUpper}") AS km`
      : (kmCol ? `"${kmCol}" AS km` : `NULL::numeric AS km`),
    (engineColLower && engineColUpper)
      ? `COALESCE("${engineColLower}", "${engineColUpper}") AS engine`
      : (engineCol ? `"${engineCol}" AS engine` : `NULL::text AS engine`),
    (transColLower && transColUpper)
      ? `COALESCE("${transColLower}", "${transColUpper}") AS transmission`
      : (transmissionCol ? `"${transmissionCol}" AS transmission` : `NULL::text AS transmission`),
    (fuelColLower && fuelColUpper)
      ? `COALESCE("${fuelColLower}", "${fuelColUpper}") AS fuel`
      : (fuelCol ? `"${fuelCol}" AS fuel` : `NULL::text AS fuel`),
    colorCol       ? `"${colorCol}" AS color`        : `NULL::text    AS color`,
    statusCol      ? `"${statusCol}" AS status`      : `'active'::text AS status`,
    imageCol       ? `"${imageCol}" AS image_url`    : `NULL::text    AS image_url`,
    picturesCol    ? `"${picturesCol}" AS pictures`  : `NULL::text    AS pictures`,
    permalinkCol   ? `"${permalinkCol}" AS permalink`: `NULL::text    AS permalink`,
    sourceCol      ? `"${sourceCol}" AS source`      : `NULL::text    AS source`,
  ];

  const res = await src.query(`SELECT ${selectParts.join(", ")} FROM public.vehicles`);
  console.log(`Fetched ${res.rows.length} vehicles from Supabase`);

  const upsert = `
    INSERT INTO public.vehicles (
      id, brand, model, version, title, year, price, currency,
      km, engine, transmission, fuel, color, status, image_url, pictures, permalink, source
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    ON CONFLICT (id) DO UPDATE SET
      brand        = EXCLUDED.brand,
      model        = EXCLUDED.model,
      version      = EXCLUDED.version,
      title        = EXCLUDED.title,
      year         = EXCLUDED.year,
      price        = EXCLUDED.price,
      currency     = EXCLUDED.currency,
      km           = EXCLUDED.km,
      engine       = EXCLUDED.engine,
      transmission = EXCLUDED.transmission,
      fuel         = EXCLUDED.fuel,
      color        = EXCLUDED.color,
      status       = EXCLUDED.status,
      image_url    = EXCLUDED.image_url,
      pictures     = EXCLUDED.pictures,
      permalink    = EXCLUDED.permalink,
      source       = EXCLUDED.source
  `;

  // Collect all IDs from Supabase — used later to delete stale rows from Railway
  const supabaseIds = res.rows.map((r) => str(r.id)).filter(Boolean);

  let ok = 0;
  let titleParsed = 0;
  for (const r of res.rows) {
    if (!r.id) continue;

    const price = r.price !== null && r.price !== undefined ? Number(r.price) : null;
    // Currency heuristic:
    // - If source says "USD" → trust it
    // - If source says "ARS" but price < 500,000 → likely USD (used cars from ML often mistagged)
    // - If no currency → infer from price threshold
    const rawCurrency = str(r.currency || "").toUpperCase();
    let currency;
    if (rawCurrency === "USD") {
      currency = "USD";
    } else if (price !== null && price > 0 && price < 500_000) {
      // Sub-500k almost certainly USD in Argentina auto market (even cheapest cars are > 500k ARS)
      currency = "USD";
    } else if (rawCurrency) {
      currency = rawCurrency;
    } else {
      currency = price !== null && price < 1_000_000 ? "USD" : "ARS";
    }

    let brand = r.brand ?? null;
    let model = r.model ?? null;
    let version = r.version ?? null;
    const title = r.title ?? null;

    // Infer model/version from title when source DB doesn't have them as separate columns
    if (!model && title) {
      const parsed = parseVehicleTitle(title, brand);
      model = parsed.model;
      if (!version) version = parsed.version;
      titleParsed++;
    }

    await dst.query(upsert, [
      str(r.id),
      brand,
      model,
      version,
      title,
      r.year !== null && r.year !== undefined ? Number(r.year) : null,
      price,
      currency,
      r.km !== null && r.km !== undefined ? Number(r.km) : null,
      r.engine ?? null,
      r.transmission ?? null,
      r.fuel ?? null,
      r.color ?? null,
      r.status ?? "active",
      r.image_url ?? null,
      r.pictures ?? null,
      r.permalink ?? null,
      r.source ?? null,
    ]);

    // Registrar en historial de precios si hubo cambio (función definida en migración 014)
    if (price !== null && Number.isFinite(price)) {
      await dst.query(
        `SELECT record_vehicle_price_change($1, $2, $3, $4, $5, $6, $7, 'sync')`,
        [str(r.id), title, brand, model, r.year ? Number(r.year) : null, price, currency]
      ).catch(() => { /* no bloquear si función no existe aún */ });
    }

    ok++;
  }

  console.log(`Synced vehicles: ${ok} upserted (${titleParsed} model/version inferred from title)`);

  // ── Borrar de Railway los autos que ya no existen en Supabase ────────────────
  // Si Supabase tiene 0 vehículos (algo salió mal en la consulta), NO borramos
  // nada para evitar borrar todo por error de conexión.
  if (supabaseIds.length > 0) {
    const delRes = await dst.query(
      `DELETE FROM public.vehicles WHERE id != ALL($1::text[]) RETURNING id`,
      [supabaseIds]
    );
    const deleted = delRes.rowCount ?? 0;
    if (deleted > 0) {
      const deletedIds = delRes.rows.map((r) => r.id).join(", ");
      console.log(`Deleted ${deleted} stale vehicle(s) from Railway: ${deletedIds}`);
    } else {
      console.log("No stale vehicles to delete.");
    }
  } else {
    console.warn("Supabase returned 0 vehicles — skipping delete step to avoid wiping Railway.");
  }

  await src.end();
  await dst.end();
})().catch(async (e) => {
  console.error(e);
  try { await src.end(); } catch {}
  try { await dst.end(); } catch {}
  process.exit(1);
});
