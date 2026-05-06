import { z } from "zod";

const optionalStr = (schema: z.ZodString) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url(),

  // API server
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  API_HOST: z.string().default("0.0.0.0"),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),

  // Encryption (for credential vault, Spec 02). Generate with: openssl rand -hex 32
  ENCRYPTION_KEY: z.string().length(64).regex(/^[0-9a-f]+$/i),

  // Anthropic (for adapters later)
  ANTHROPIC_API_KEY: optionalStr(z.string().startsWith("sk-ant-")),

  // Replicate
  REPLICATE_API_TOKEN: optionalStr(z.string().startsWith("r8_")),

  // DataForSEO
  DATAFORSEO_LOGIN: optionalStr(z.string()),
  DATAFORSEO_PASSWORD: optionalStr(z.string()),

  // Email / SMTP (Spec 11.5)
  SMTP_USER: optionalStr(z.string().email()),
  SMTP_APP_PASSWORD: optionalStr(z.string().min(8)),
  SMTP_FROM_NAME: z.string().default("Marketing Automation"),
  SMTP_HOST: z.string().default("smtp.gmail.com"),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(465),

  // Web Push VAPID keys (for Spec 41)
  VAPID_PUBLIC_KEY: optionalStr(z.string()),
  VAPID_PRIVATE_KEY: optionalStr(z.string()),
  VAPID_SUBJECT: optionalStr(z.string().regex(/^(mailto:|https:\/\/)/)),

  // Article pipeline scheduler (Spec 20) — disabled by default
  ARTICLE_SCHEDULER_ENABLED: z.coerce.boolean().default(false),

  // GitHub App for Astro sync (Spec 21) — see packages/adapters/astro-sync/SETUP-GITHUB-APP.md
  GITHUB_APP_ID: optionalStr(z.string().regex(/^\d+$/)),
  GITHUB_APP_PRIVATE_KEY_PATH: optionalStr(z.string().min(1)),

  // PageSpeed validation (Spec 22)
  PAGESPEED_WORK_DIR: z.string().default("/tmp/marketing-auto/pagespeed"),
  PAGESPEED_BUILD_TIMEOUT_MS: z.coerce.number().int().min(60_000).default(300_000),
  PAGESPEED_LIGHTHOUSE_TIMEOUT_MS: z.coerce.number().int().min(30_000).default(120_000),

  // Cloudflare R2 (Spec 12)
  R2_ACCOUNT_ID: optionalStr(z.string().min(1)),
  R2_ACCESS_KEY_ID: optionalStr(z.string().min(1)),
  R2_SECRET_ACCESS_KEY: optionalStr(z.string().min(1)),
  R2_BUCKET: optionalStr(z.string().min(1)),
  R2_PUBLIC_BASE_URL: optionalStr(z.string().url()),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (cachedEnv) return cachedEnv;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // console.error intentional: pino createLogger() calls getEnv(), so we can't use it here
    console.error("❌ Invalid environment variables:");
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment configuration");
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}

export function resetEnvCache(): void {
  cachedEnv = null;
}
