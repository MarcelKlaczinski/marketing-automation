import { getEnv } from "@marketing-auto/shared/config";
import { defineConfig } from "drizzle-kit";

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
