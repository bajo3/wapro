const DATABASE_URL_KEYS = [
  "PANEL_DATABASE_URL",
  "RAILWAY_DATABASE_URL",
  "DATABASE_URL",
  "DB_URL"
] as const;

function firstNonEmptyEnv(keys: readonly string[]): string {
  for (const key of keys) {
    const value = String(process.env[key] || "").trim();
    if (value) return value;
  }
  return "";
}

export function resolveDatabaseUrl(): string {
  return firstNonEmptyEnv(DATABASE_URL_KEYS);
}

export function describeDatabaseTarget(rawUrl?: string): string {
  const value = String(rawUrl || resolveDatabaseUrl() || "").trim();
  if (!value) return "env:DB_HOST/DB_NAME";

  try {
    const url = new URL(value);
    const host = url.hostname || "unknown-host";
    const db = url.pathname.replace(/^\//, "") || "unknown-db";
    return `${host}/${db}`;
  } catch {
    return "env:DATABASE_URL";
  }
}

export function getDatabaseUrlSource(): string {
  for (const key of DATABASE_URL_KEYS) {
    if (String(process.env[key] || "").trim()) return key;
  }
  return "DB_HOST/DB_NAME";
}
