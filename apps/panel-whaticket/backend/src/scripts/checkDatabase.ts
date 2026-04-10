import "../bootstrap";
import { ensureCoreTables } from "../database/ensureCoreTables";

async function run(): Promise<void> {
  await ensureCoreTables();
  console.log("[db-check] core tables OK");
}

run().catch(err => {
  console.error("[db-check] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
