import { QueryTypes } from "sequelize";
import sequelize from ".";
import { describeDatabaseTarget, getDatabaseUrlSource } from "../config/resolveDatabaseUrl";

const REQUIRED_TABLES = ["Users", "Contacts", "Tickets", "Whatsapps", "Queues"];

export async function ensureCoreTables(): Promise<void> {
  await sequelize.authenticate();

  const rows = await sequelize.query(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        AND table_name IN (:requiredTables)
    `,
    {
      replacements: { requiredTables: REQUIRED_TABLES },
      type: QueryTypes.SELECT
    }
  );

  const existing = new Set(
    (Array.isArray(rows) ? rows : []).map((row: any) => String(row.table_name))
  );
  const missing = REQUIRED_TABLES.filter(table => !existing.has(table));

  if (missing.length === 0) return;

  throw new Error(
    [
      `Missing core tables: ${missing.join(", ")}`,
      `db=${describeDatabaseTarget()}`,
      `source=${getDatabaseUrlSource()}`,
      "Expected Whaticket schema was not found after migrations."
    ].join(" | ")
  );
}

export { REQUIRED_TABLES };
