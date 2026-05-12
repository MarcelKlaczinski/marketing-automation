import { createLogger } from "@marketing-auto/shared";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./client.ts";

const log = createLogger("db:migrate");

async function main() {
  log.info("Starting migrations...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  log.info("Migrations completed");
  process.exit(0);
}

main().catch((err) => {
  log.error({ err }, "Migration failed");
  process.exit(1);
});
