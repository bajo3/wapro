export const normalizeVehicleToken = (value) => {
  const text = String(value ?? "").trim();
  if (!text) return "";

  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

  if (["-", "—", "--", "s/d", "sd", "n/a", "na", "null", "undefined", "sin datos", "a consultar"].includes(normalized)) {
    return "";
  }

  return text.replace(/\s+/g, " ");
};

export const normalizeVehicleCompare = (value) =>
  normalizeVehicleToken(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const compactUniqueVehicleParts = (parts) => {
  const seen = new Set();
  return (parts || []).reduce((acc, part) => {
    const value = normalizeVehicleToken(part);
    const key = normalizeVehicleCompare(value);
    if (!value || !key || seen.has(key)) return acc;
    seen.add(key);
    acc.push(value);
    return acc;
  }, []);
};

export const buildVehicleLabel = (vehicle) => {
  if (!vehicle) return "";

  const brand = normalizeVehicleToken(vehicle.marca || vehicle.brand);
  const model = normalizeVehicleToken(vehicle.modelo || vehicle.model);
  const year = normalizeVehicleToken(vehicle.year);
  const version = normalizeVehicleToken(vehicle.version);
  const title = normalizeVehicleToken(vehicle.title || vehicle.name);
  const explicitLabel = normalizeVehicleToken(vehicle.label);

  const base = compactUniqueVehicleParts([brand, model, year]);
  const baseNorm = normalizeVehicleCompare(base.join(" "));
  const extras = [];

  // Agregar version solo si no está contenida en base.
  const versionNorm = normalizeVehicleCompare(version);
  if (version && versionNorm && !baseNorm.includes(versionNorm)) extras.push(version);

  // Agregar title solo si aporta info no cubierta por brand+model+version+year.
  // Si title empieza por brand+model (normalizado), ya está cubierto.
  const brandModelNorm = normalizeVehicleCompare([brand, model].filter(Boolean).join(" "));
  const titleNorm = normalizeVehicleCompare(title);
  const titleStartsWithBrandModel = brandModelNorm && titleNorm.startsWith(brandModelNorm);
  const extrasNorm = extras.map((x) => normalizeVehicleCompare(x));
  const titleAlreadyCovered = titleStartsWithBrandModel || extrasNorm.some((x) => x === titleNorm);

  if (title && titleNorm && !titleAlreadyCovered) {
    extras.push(title);
  }

  return (
    compactUniqueVehicleParts([...base, ...extras]).join(" ").trim() ||
    explicitLabel ||
    title ||
    compactUniqueVehicleParts([brand, model, version, year]).join(" ").trim()
  );
};
