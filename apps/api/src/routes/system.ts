import { zValidator } from "@hono/zod-validator";
import { encrypt } from "@marketing-auto/core";
import { db, globalCredentials, projects, systemSettings } from "@marketing-auto/db";
import { createLogger, getEnv } from "@marketing-auto/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  checkPostgres,
  checkRedis,
  getAllAdapterStatuses,
  getInitializedFlag,
  readAdapterCreds,
} from "../lib/system-service.ts";
import { requireAuth } from "../middleware/auth.ts";

// Spec 32: adapter verify functions are called from routes rather than via core services.
// Justified by spec Decision 10: each adapter owns its verify logic; the installer has no
// pipeline/worker context, so there is no core service abstraction to route through.
import { verifyAnthropic } from "@marketing-auto/adapter-anthropic/verify";
import { verifyGitHubApp } from "@marketing-auto/adapter-astro-sync/verify";
import { verifyDataForSeo } from "@marketing-auto/adapter-dataforseo/verify";
import { verifySmtp } from "@marketing-auto/adapter-email/verify";
import { verifyNanoBanana } from "@marketing-auto/adapter-nano-banana/verify";
import { verifyPexels } from "@marketing-auto/adapter-pexels/verify";
import { verifyPixabay } from "@marketing-auto/adapter-pixabay/verify";
import { verifyProductHunt } from "@marketing-auto/adapter-producthunt/verify";
import { verifyReplicate } from "@marketing-auto/adapter-replicate/verify";
import { verifyReddit } from "@marketing-auto/adapter-reddit/verify";
import { verifyGitHub } from "@marketing-auto/adapter-github-trending/verify";
import { verifyR2 } from "@marketing-auto/adapter-storage/verify";
import { verifyUnsplash } from "@marketing-auto/adapter-unsplash/verify";
import { verifyVoyage } from "@marketing-auto/adapter-voyage/verify";

export const systemRoutes = new Hono();

const log = createLogger("system-routes");

// ───── GET /api/system/info ─────────────────────────────────────────────────
// Public — needed before login to detect deployment mode.

systemRoutes.get("/info", (c) => {
  const env = getEnv();
  const mode = env.DEPLOYMENT_MODE ?? "lokal";
  return c.json({
    ok: true,
    data: {
      deploymentMode: mode,
      apiVersion: "0.1.0",
      nodeVersion: process.version,
    },
  });
});

// ───── GET /api/system/status ───────────────────────────────────────────────
// Public — needed by route guard before auth is established.

systemRoutes.get("/status", async (c) => {
  const [postgres, redis, adapters, initialized] = await Promise.all([
    checkPostgres(),
    checkRedis(),
    getAllAdapterStatuses(),
    getInitializedFlag(),
  ]);

  return c.json({
    ok: true,
    data: {
      loading: false,
      initialized,
      postgres,
      redis,
      adapters,
    },
  });
});

// ───── POST /api/system/credentials ─────────────────────────────────────────
// Auth required — only logged-in users may write credentials.

const credentialSchema = z.object({
  service: z.enum(["anthropic", "replicate", "nano-banana", "r2", "dataforseo", "smtp", "github_app", "producthunt", "voyage", "reddit", "github", "pexels", "unsplash", "pixabay"]),
  key: z.string().min(1).max(100),
  value: z.string().min(1).max(10_000),
  metadata: z.record(z.unknown()).optional(),
});

systemRoutes.post("/credentials", requireAuth, zValidator("json", credentialSchema), async (c) => {
  const input = c.req.valid("json");
  const encryptedValue = encrypt(input.value);

  await db
    .insert(globalCredentials)
    .values({
      service: input.service,
      key: input.key,
      encryptedValue,
      metadata: input.metadata ?? {},
    })
    .onConflictDoUpdate({
      target: [globalCredentials.service, globalCredentials.key],
      set: {
        encryptedValue,
        metadata: input.metadata ?? {},
        updatedAt: new Date(),
      },
    });

  return c.json({ ok: true });
});

// ───── DELETE /api/system/credentials/:service/:key ─────────────────────────
// Auth required.

systemRoutes.delete("/credentials/:service/:key", requireAuth, async (c) => {
  const service = c.req.param("service");
  const key = c.req.param("key");
  await db
    .delete(globalCredentials)
    .where(and(eq(globalCredentials.service, service), eq(globalCredentials.key, key)));
  return c.json({ ok: true });
});

// ───── DELETE /api/system/credentials/:service ──────────────────────────────
// Auth required — removes all credentials for a service and clears its verify status.

const validServices = ["anthropic", "replicate", "nano-banana", "r2", "dataforseo", "smtp", "github_app", "producthunt", "voyage", "reddit", "github", "pexels", "unsplash", "pixabay"] as const;

systemRoutes.delete("/credentials/:service", requireAuth, async (c) => {
  const service = c.req.param("service");
  if (!(validServices as readonly string[]).includes(service)) {
    return c.json({ ok: false, error: `Unknown service: ${service}` }, 400);
  }

  await db.delete(globalCredentials).where(eq(globalCredentials.service, service));
  await db.delete(systemSettings).where(eq(systemSettings.key, `last_verified_${service}`));

  return c.json({ ok: true, data: { service } });
});

// ───── POST /api/system/verify/:adapter ─────────────────────────────────────
// Auth required — verifying runs a live network call against a configured credential.

const adapterEnum = z.enum(["anthropic", "replicate", "nano-banana", "r2", "dataforseo", "smtp", "github_app", "producthunt", "voyage", "reddit", "github", "pexels", "unsplash", "pixabay"]);

systemRoutes.post("/verify/:adapter", requireAuth, async (c) => {
  const parsed = adapterEnum.safeParse(c.req.param("adapter"));
  if (!parsed.success) {
    return c.json({ ok: false, error: `Unknown adapter: ${c.req.param("adapter")}` }, 400);
  }

  const adapter = parsed.data;

  try {
    const creds = await readAdapterCreds(adapter);
    const result = await runVerifyByAdapter(adapter, creds);

    const verifyMeta = { at: new Date().toISOString(), ok: result.ok, message: result.message };
    await db
      .insert(systemSettings)
      .values({ key: `last_verified_${adapter}`, value: verifyMeta })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: verifyMeta, updatedAt: new Date() },
      });

    return c.json({ ok: true, data: result }, result.ok ? 200 : 400);
  } catch (e) {
    log.error({ err: e, adapter }, "Verify failed with exception");
    return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// ───── POST /api/system/initialize ──────────────────────────────────────────
// Public — called at the end of the installer wizard (before the user is established).
// Idempotent — safe to call multiple times.

systemRoutes.post("/initialize", async (c) => {
  const now = new Date().toISOString();

  await db
    .insert(systemSettings)
    .values({ key: "installed_at", value: now })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: now, updatedAt: new Date() },
    });

  const PLATFORM_PROJECT_ID = "00000000-0000-0000-0000-000000000001";
  await db
    .insert(projects)
    .values({
      id: PLATFORM_PROJECT_ID,
      slug: "_platform",
      name: "Platform (synthetic)",
      industry: "other",
      pipelineTemplate: "educational",
      costLimits: {},
    })
    .onConflictDoNothing();

  return c.json({ ok: true });
});

// ───── Dispatch helper ───────────────────────────────────────────────────────

async function runVerifyByAdapter(
  adapter: z.infer<typeof adapterEnum>,
  creds: Record<string, string>
) {
  switch (adapter) {
    case "anthropic":
      if (!creds.api_key) return { ok: false, message: "API key not set" };
      return verifyAnthropic(creds.api_key);
    case "replicate":
      if (!creds.api_token) return { ok: false, message: "API token not set" };
      return verifyReplicate(creds.api_token);
    case "nano-banana":
      if (!creds.api_key) return { ok: false, message: "API key not set" };
      return verifyNanoBanana(creds.api_key);
    case "r2":
      return verifyR2(creds);
    case "dataforseo":
      if (!creds.login || !creds.password)
        return { ok: false, message: "Login or password missing" };
      return verifyDataForSeo(creds.login, creds.password);
    case "smtp":
      return verifySmtp(creds);
    case "github_app":
      return verifyGitHubApp(creds);
    case "producthunt":
      if (!creds.api_key || !creds.api_secret) return { ok: false, message: "API key and API secret required" };
      return verifyProductHunt(creds.api_key, creds.api_secret);
    case "voyage":
      if (!creds.api_key) return { ok: false, message: "API key not set" };
      return verifyVoyage(creds.api_key);
    case "reddit":
      if (!creds.client_id || !creds.client_secret || !creds.user_agent)
        return { ok: false, message: "client_id, client_secret, and user_agent required" };
      return verifyReddit({ clientId: creds.client_id, clientSecret: creds.client_secret, userAgent: creds.user_agent });
    case "github":
      if (!creds.personal_access_token)
        return { ok: false, message: "personal_access_token required" };
      return verifyGitHub({ personalAccessToken: creds.personal_access_token });
    case "pexels":
      if (!creds.api_key) return { ok: false, message: "API key not set" };
      return verifyPexels({ apiKey: creds.api_key });
    case "unsplash":
      // Spec 65.8: only `access_key` is used by the read-only Search API
      // (Client-ID auth); `application_id` + `secret_key` are stored for
      // potential future OAuth. Verify gates on access_key alone — the
      // configured-badge in getAllAdapterStatuses requires all 3, so a
      // partial vault state surfaces in the UI before this code path runs.
      if (!creds.access_key) return { ok: false, message: "Access key not set" };
      return verifyUnsplash({ accessKey: creds.access_key });
    case "pixabay":
      if (!creds.api_key) return { ok: false, message: "API key not set" };
      return verifyPixabay({ apiKey: creds.api_key });
  }
}
