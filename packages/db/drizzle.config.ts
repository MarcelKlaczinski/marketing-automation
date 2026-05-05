import { defineConfig } from "drizzle-kit";
import { getEnv } from "@marketing-auto/shared/config";

const env = getEnv();

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: env.DATABASE_URL,
  },
  verbose: true,
  strict: true,
});
