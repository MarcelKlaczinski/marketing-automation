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

  // Encryption (for credential vault later)
  ENCRYPTION_KEY: optionalStr(z.string().length(64)),

  // Anthropic (for adapters later)
  ANTHROPIC_API_KEY: optionalStr(z.string().startsWith("sk-ant-")),

  // Replicate
  REPLICATE_API_TOKEN: optionalStr(z.string().startsWith("r8_")),

  // DataForSEO
  DATAFORSEO_LOGIN: optionalStr(z.string()),
  DATAFORSEO_PASSWORD: optionalStr(z.string()),

  // Resend (for magic link auth, Spec 04)
  RESEND_API_KEY: optionalStr(z.string().startsWith("re_")),
  RESEND_FROM_EMAIL: optionalStr(z.string().email()),

  // Web Push VAPID keys (for Spec 41)
  VAPID_PUBLIC_KEY: optionalStr(z.string()),
  VAPID_PRIVATE_KEY: optionalStr(z.string()),
  VAPID_SUBJECT: optionalStr(z.string().email()),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (cachedEnv) return cachedEnv;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
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
