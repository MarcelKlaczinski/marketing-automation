import { z } from "zod";

const optionalStr = (schema: z.ZodString) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),

  // Deployment mode — "lokal" (default) or "self_hosted"
  DEPLOYMENT_MODE: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(["lokal", "self_hosted"]).optional()
  ),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url(),

  // API server
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  API_HOST: z.string().default("0.0.0.0"),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  CORS_ORIGIN: z.string().url().default("http://localhost:3051"),

  // Encryption (for credential vault, Spec 02). Generate with: openssl rand -hex 32
  ENCRYPTION_KEY: z
    .string()
    .length(64)
    .regex(/^[0-9a-f]+$/i),

  // Anthropic (for adapters later)
  ANTHROPIC_API_KEY: optionalStr(z.string().startsWith("sk-ant-")),
  // Dev-mode fixture cache (Spec 22.6). Default "off" = production-safe.
  ANTHROPIC_CACHE_MODE: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(["off", "replay", "record", "auto"]).optional()
  ),

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

  // PageSpeed validation (Spec 22 + 22.5)
  PAGESPEED_WORK_DIR: z.string().default("/tmp/marketing-auto/pagespeed"),
  PAGESPEED_BUILD_TIMEOUT_MS: z.coerce.number().int().min(60_000).default(300_000),
  PAGESPEED_LIGHTHOUSE_TIMEOUT_MS: z.coerce.number().int().min(30_000).default(120_000),
  // Optional: 25k requests/day with key, 400/day without
  PAGESPEED_INSIGHTS_API_KEY: optionalStr(z.string().min(1)),

  // Signal collector cron (Spec 54.4) — default: daily at 00:30 UTC
  SIGNAL_COLLECTOR_CRON: optionalStr(z.string().min(1)),

  // Spec 63.4: TREND_SYNTHESIZER_CRON env was removed when the worker moved to
  // the per-project cron_state pattern (cf. seedTrendSynthesizerCron). Configure
  // the cadence per project in SettingsPlannerPage.

  // Voyage AI (Spec 54.5) — text embeddings for trend synthesis coverage check
  VOYAGE_API_KEY: optionalStr(z.string().min(1)),

  // Spec 64.6: Google Gemini Image API (Nano Banana 2) — hero-image generation
  // Vault key: ('nano-banana', 'api_key'). Env var is the dev fallback.
  GOOGLE_GEMINI_API_KEY: optionalStr(z.string().min(1)),

  // Batch API feature flag (Spec 61.4) — set to "true" to show LLM Mode toggle in UI
  BATCH_API_ENABLED: z.coerce.boolean().default(false),

  // Spec 64.11: stalled-render reconciliation + pipeline-completion push notifications
  // — `RENDER_RECONCILIATION_TIMEOUT_MINUTES` controls how stale a `rendering` /
  //   `running` row must be before worker startup resets it (default 15 — Remotion
  //   renders top out near 10 min, BullMQ `lockDuration` is 10 min, +5 min buffer).
  // — `PIPELINE_NOTIFICATIONS_ENABLED` kills the BullMQ completion listeners
  //   without redeploying (e.g. local-dev quiet mode). Default true.
  RENDER_RECONCILIATION_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(15),
  PIPELINE_NOTIFICATIONS_ENABLED: z.coerce.boolean().default(true),

  // Spec 64.15 Phase B: how many past weekly plans to consider when applying
  // cross-week topic diversity in the Floor selector. Default 3 covers typical
  // recency-bias without forcing long-running projects to compete against
  // multi-month-old topics. Set 0 to disable cross-week diversity (within-plan
  // diversity from 63.5 still runs). SnapshotInputsStep freezes the value into
  // `plannerConfigSnapshot.planDiversityLookbackWeeks` at plan-generation time,
  // mirroring 62.5.1/63.5/64.6b SSoT discipline so replays reproduce the same picks.
  PLAN_DIVERSITY_LOOKBACK_WEEKS: z.coerce.number().int().min(0).default(3),

  // Spec 64.20: cron pattern for the GitHub-inventory refresh worker. Worker
  // ticks every 15 min by default and scans `content_source_inventory` for rows
  // whose `refresh_interval_hours` has elapsed. Per-row interval is the user-tunable
  // knob; this env controls cron cadence.
  INVENTORY_REFRESH_CRON_PATTERN: optionalStr(z.string().min(1).regex(/^[\d*\/,\-\s]+$/)),

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
