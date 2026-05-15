import { createLogger, getEnv } from "@marketing-auto/shared";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.ts";

const log = createLogger("db");
const env = getEnv();

const queryClient = postgres(env.DATABASE_URL, {
  max: 20,
  idle_timeout: 20,
  connect_timeout: 10,
  onnotice: (n) => log.debug({ notice: n }, "PG notice"),
});

export const db = drizzle(queryClient, {
  schema,
  logger: env.NODE_ENV === "development",
});

export type DB = typeof db;
export type Transaction = Parameters<Parameters<DB["transaction"]>[0]>[0];
export { schema };
