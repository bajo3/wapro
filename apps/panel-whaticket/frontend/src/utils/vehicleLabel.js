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
  const version = normalizeVehicleToken(vehicle.version);
  const title = normalizeVehicleToken(vehicle.title || vehicle.name);
  const explicitLabel = normalizeVehicleToken(vehicle.label);

  const base = compactUniqueVehicleParts([brand, model]);
  const baseNorm = normalizeVehicleCompare(base.join(" "));
  const extras = [];

  const versionNorm = normalizeVehicleCompare(version);
  if (version && versionNorm && !baseNorm.includes(versionNorm)) extras.push(version);

  const titleNorm = normalizeVehicleCompare(title);
  if (title && titleNorm && !baseNorm.includes(titleNorm) && !extras.some((x) => normalizeVehicleCompare(x) === titleNorm)) {
    extras.push(title);
  }

  return (
    compactUniqueVehicleParts([...base, ...extras]).join(" ").trim() ||
    explicitLabel ||
    title ||
    compactUniqueVehicleParts([brand, model, version]).join(" ").trim()
  );
};
