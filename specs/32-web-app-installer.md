# Spec 32: Installer / First-Run Wizard

**Phase:** 4 (Web App Foundation Wave 1)
**Estimated Effort:** 2.5-3 days (3-4 sessions)
**Dependencies:** Spec 30 (web app shell), Spec 31 (auth + guards), Spec 02 (credential vault — backend already exists)
**Status:** Ready for implementation
**Recommended Model:** Opus 4.7 (architectural integration with strong UX implications)

---

## Goal

Build the **installer / first-run wizard**: a guided onboarding flow that walks Marcel through configuring every external service (Anthropic, Replicate, R2, DataForSEO, SMTP, GitHub App, plus core infrastructure). The installer is the **first impression** of the tool — it must be clear, forgiving, and unblock the user as fast as possible.

After this spec, Marcel can:
- Open `/installer` (auto-redirected if core services aren't ready)
- Run through 8 setup steps with inline guidance + "Verify" buttons
- **Skip any optional step** with explicit acknowledgment of the consequences
- Re-enter the installer at any time to complete skipped steps
- See, on every page of the app, which features are unlocked vs. locked and why
- Test each adapter connection without leaving the wizard

The installer **also** powers the per-adapter settings sub-pages in Spec 33 — Spec 33 reuses these forms in a non-wizard layout. So building Spec 32 well makes Spec 33 mostly free.

## Architecture Decisions

**Decision 1: Step-based wizard with explicit skip.**
Each step has three end-states: ✅ Configured + Verified, ⏭ Skipped (with reason), or ⏸ Pending. Marcel can move forward without completing a step, but skipped steps are highlighted in the inbox and on settings pages until completed.

**Decision 2: Two storage destinations for credentials.**
- **Foundation infra (Postgres, Redis)**: env-vars only. Cannot be configured via UI for safety/sanity reasons (changing DB connection requires app restart and migration runs).
- **Service credentials (API keys, tokens)**: stored encrypted in the `project_credentials` vault from Spec 02 (extended to also store global, non-project-scoped credentials). UI writes to vault.

For the GitHub App private key, the file path is stored as a credential value (the file itself stays on disk in lokal mode; in self-hosted mode this becomes a vault-stored PEM string — Mode-aware, see "Mode-Awareness" below).

**Decision 3: Backend adds three new endpoint categories.**
- `GET /api/system/status` (already stubbed in Spec 30) → returns full configured/verified status per adapter
- `POST /api/system/credentials` → set or update a credential
- `POST /api/system/verify/:adapter` → run the adapter's verify routine, return success/failure + diagnostic
- `POST /api/system/initialize` → one-time after first wizard run, marks the system as "initialized" + creates the platform project if needed

**Decision 4: Verify is its own action, not auto-run on Save.**
After saving credentials, Marcel clicks "Verify" to test connection. Reasons: (1) verifying may take 5-30 seconds (e.g., GitHub App auth), so we don't want to delay save; (2) Marcel may save partial progress and verify later; (3) network-flaky verifies shouldn't make save look broken.

**Decision 5: Each adapter step has the SAME shape: form + verify button + status indicator.**
Consistency reduces UX cognitive load. Differences live in the form fields and the verify-routine, but the wrapping pattern is uniform.

**Decision 6: Skip with explicit consequences.**
"Skip for now" button shows a modal listing exactly which features will be unavailable. Marcel must click "I understand, skip" to proceed. No accidental skips.

**Decision 7: Wizard is linear but exits per step.**
Marcel can leave at any point. Returning to `/installer` resumes at the next pending step, or shows the summary if all steps are at least decided (configured or skipped).

**Decision 8: Wizard layout uses the AuthLayout (no sidebar).**
Same layout as login. Installer is a focused flow — sidebar nav would invite Marcel to leave halfway and end up confused. Once the system is `requiredCoreReady`, the wizard can be re-accessed from `/settings`, which uses the main layout.

**Decision 9: Backend tracks "system initialized" status.**
A boolean in a new `system_settings` table or in the platform project. Once initialized, the installer's auto-redirect rule (Spec 31's guard: `requiredCoreReady ? /installer`) loosens to "only redirect if there's a critical issue, not on every fresh boot".

**Decision 10: Form values do NOT pre-populate from vault.**
For security: credentials are write-only via UI. Marcel sees "✅ Anthropic configured 3 days ago" instead of the raw API key. To rotate, he enters a new key (which overwrites). To remove, he uses an explicit "Disconnect" button.

## Mode-Awareness

The installer must work in both lokal and self-hosted modes:

| Aspect | Lokal | Self-hosted |
|---|---|---|
| **GitHub App private key** | UI accepts a filesystem path; backend reads file at runtime | UI accepts the PEM content (paste or file upload); backend stores PEM in vault |
| **Chrome installation** (PageSpeed) | UI shows a "Install Chrome" button that calls a backend script | UI shows "Chrome must be installed in container — see deployment docs" message |
| **R2 / Replicate / Anthropic / DataForSEO** | Identical (these are pure API key flows) | Identical |
| **SMTP** | Same form (host/port/user/password) | Same |
| **Postgres / Redis** | UI shows current connection status; can't reconfigure (env-only) | Same |

Mode is detected at runtime via `process.env.DEPLOYMENT_MODE` (default `lokal`). Backend exposes mode via `GET /api/system/info` (added by this spec). Frontend reads it on boot, keeps in `system-status` store, conditionally renders mode-specific form variants.

## Non-Goals

- **No one-click cloud setup** — Marcel still has to create accounts at Anthropic / Replicate / etc. The installer just collects the credentials they generate
- **No bulk import** of credentials from `.env` file — UI is form-by-form
- **No multi-tenant credential management** — each tenant uses the same global credentials (Anthropic API key shared across all projects). Spec 33 may add per-project overrides; not in this spec
- **No automated "set up GitHub App" flow** — the GitHub App creation is genuinely manual (10 mins of clicks at github.com/settings/apps/new). Installer just collects the result
- **No environment-variable-set form** — env vars are env vars, set in `.env` or process env. The installer reads them but doesn't write them
- **No re-running of migrations from UI** — migrations remain a CLI operation (`bun --filter @marketing-auto/db migrate`)
- **No installer for the platform-project seed** — automated as part of `POST /api/system/initialize` after final wizard step

## Detailed Implementation

### Backend: Schema additions

**New table `system_settings`**:

```typescript
// packages/db/src/schema/operations.ts
export const systemSettings = pgTable("system_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  value: jsonb("value").$type<unknown>(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

Initial keys (seeded at first run):
- `installed_at` — null initially, set to now() on `POST /system/initialize`
- `deployment_mode` — `"lokal"` or `"self_hosted"`
- `last_verified_at_per_adapter` — JSON object keyed by adapter name

**Extension to `project_credentials`** (from Spec 02):

The vault was scoped to projects. We need global credentials too. Add an `is_global` boolean column or convention: `project_id = NULL` means global. Schema decision per existing Spec 02 design — pick whichever Spec 02 chose. If `project_id` is non-nullable today, add a new column `global_credentials` table OR migrate `project_id` to nullable with a CHECK constraint that requires either project_id or `is_global = true`.

For Spec 32, the simpler path is **`global_credentials`** as a separate table mirroring `project_credentials`'s structure but without the `project_id` foreign key. This keeps existing per-project credentials untouched and isolates global ones.

```typescript
export const globalCredentials = pgTable("global_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  service: text("service").notNull(),  // e.g., "anthropic", "replicate", "github_app"
  key: text("key").notNull(),           // e.g., "api_key", "private_key_path"
  encryptedValue: text("encrypted_value").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  serviceKeyUnique: uniqueIndex("global_credentials_service_key_unique").on(table.service, table.key),
}));
```

The credential service (in `packages/credentials/`) gains:
- `getGlobal(service, key): Promise<string | null>`
- `setGlobal(service, key, value, metadata?): Promise<void>`
- `deleteGlobal(service, key): Promise<void>`
- `listGlobal(service?): Promise<{key, metadata}[]>` (no values returned, just metadata)

Encryption uses the same key as project credentials (Spec 02's logic).

### Backend: Adapter Verify Functions

Each adapter exposes a `verify()` function that returns `{ ok: boolean, message: string, details?: Record<string, unknown> }`. The verify routine should be cheap (no LLM calls, no expensive API operations).

For each existing adapter:

`packages/adapters/anthropic/src/verify.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";

export async function verifyAnthropic(apiKey: string): Promise<{ ok: boolean; message: string; details?: Record<string, unknown> }> {
  const client = new Anthropic({ apiKey });
  try {
    // Cheapest valid API call: get models list (no tokens consumed)
    // If models endpoint isn't available, do a 1-token completion as fallback.
    // For Spec 32, a 1-token completion is fine (~$0.0001).
    const result = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
    return {
      ok: true,
      message: "Anthropic API key works",
      details: { model: result.model, latencyMs: 0 /* TODO time it */ },
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
```

Similar `verify()` for each adapter (`packages/adapters/*/src/verify.ts`):
- **Replicate**: list models endpoint, no inference
- **R2**: HEAD on bucket
- **DataForSEO**: account info endpoint (free)
- **SMTP**: open connection, do EHLO, close (no email sent)
- **GitHub App**: `GET /app` endpoint (no installation calls)

These verify functions become the reusable backbone that the installer + the future settings page both call.

### Backend: System Routes

Replace the stub `apps/api/src/routes/system.ts` with the full implementation:

```typescript
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { db, systemSettings, globalCredentials, projects } from "@marketing-auto/db";
import { eq, and, isNull } from "drizzle-orm";
import { encryptValue, decryptValue } from "@marketing-auto/credentials";
import { verifyAnthropic } from "@marketing-auto/adapter-anthropic/verify";
import { verifyReplicate } from "@marketing-auto/adapter-replicate/verify";
import { verifyR2 } from "@marketing-auto/adapter-replicate/verify-r2";  // R2 logic lives in replicate adapter per Spec 12
import { verifyDataForSeo } from "@marketing-auto/adapter-dataforseo/verify";
import { verifySmtp } from "@marketing-auto/adapter-email/verify";
import { verifyGitHubApp } from "@marketing-auto/adapter-astro-sync/verify";

export const systemRoutes = new Hono();

// ───── GET /api/system/info ─────────────────────────────────────────────
// Returns deployment mode and basic system metadata. No auth.

systemRoutes.get("/info", (c) => {
  const mode = process.env.DEPLOYMENT_MODE === "self_hosted" ? "self_hosted" : "lokal";
  return c.json({
    deploymentMode: mode,
    nodeVersion: process.version,
    apiVersion: "0.1.0",
  });
});

// ───── GET /api/system/status ───────────────────────────────────────────
// Returns full configured/verified status per adapter. No auth (needed for installer redirect).

systemRoutes.get("/status", async (c) => {
  // Check core infrastructure
  const postgres = await checkPostgres();
  const redis = await checkRedis();

  // For each adapter, check if credentials exist + last verify result
  const adapters = {
    anthropic: await getAdapterStatus("anthropic", ["api_key"]),
    replicate: await getAdapterStatus("replicate", ["api_token"]),
    r2: await getAdapterStatus("r2", ["account_id", "access_key_id", "secret_access_key", "bucket", "public_base_url"]),
    dataforseo: await getAdapterStatus("dataforseo", ["login", "password"]),
    smtp: await getAdapterStatus("smtp", ["host", "port", "user", "password", "from_address"]),
    githubApp: await getAdapterStatus("github_app", ["app_id", "private_key_path"]),  // path in lokal; pem in self-hosted
  };

  // Whether the system has been initialized at least once
  const [initRow] = await db.select().from(systemSettings).where(eq(systemSettings.key, "installed_at")).limit(1);
  const initialized = !!initRow?.value;

  return c.json({
    loading: false,
    initialized,
    postgres,
    redis,
    adapters,
  });
});

// ───── POST /api/system/credentials ─────────────────────────────────────
// Save or update a credential. Authenticated (only logged-in users can change credentials).

const credentialSchema = z.object({
  service: z.enum([
    "anthropic", "replicate", "r2", "dataforseo", "smtp", "github_app",
  ]),
  key: z.string().min(1).max(100),
  value: z.string().min(1).max(10_000),  // 10k for PEM keys etc
  metadata: z.record(z.unknown()).optional(),
});

// Add requireAuth middleware once auth is wired:
systemRoutes.post("/credentials", zValidator("json", credentialSchema), async (c) => {
  const input = c.req.valid("json");
  const encrypted = await encryptValue(input.value);

  await db.insert(globalCredentials).values({
    service: input.service,
    key: input.key,
    encryptedValue: encrypted,
    metadata: input.metadata ?? {},
  }).onConflictDoUpdate({
    target: [globalCredentials.service, globalCredentials.key],
    set: {
      encryptedValue: encrypted,
      metadata: input.metadata ?? {},
      updatedAt: new Date(),
    },
  });

  return c.json({ ok: true }, 200);
});

// ───── DELETE /api/system/credentials/:service/:key ─────────────────────

systemRoutes.delete("/credentials/:service/:key", async (c) => {
  const service = c.req.param("service");
  const key = c.req.param("key");
  await db.delete(globalCredentials)
    .where(and(eq(globalCredentials.service, service), eq(globalCredentials.key, key)));
  return c.json({ ok: true }, 200);
});

// ───── POST /api/system/verify/:adapter ─────────────────────────────────

const adapterEnumSchema = z.enum([
  "anthropic", "replicate", "r2", "dataforseo", "smtp", "github_app",
]);

systemRoutes.post("/verify/:adapter", async (c) => {
  const adapter = c.req.param("adapter");
  const parsed = adapterEnumSchema.safeParse(adapter);
  if (!parsed.success) {
    return c.json({ ok: false, message: `Unknown adapter: ${adapter}` }, 400);
  }

  try {
    const result = await runVerifyByAdapter(parsed.data);

    // Update last_verified_at metadata
    await db.insert(systemSettings).values({
      key: `last_verified_${parsed.data}`,
      value: { at: new Date().toISOString(), ok: result.ok, message: result.message },
    }).onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: { at: new Date().toISOString(), ok: result.ok, message: result.message }, updatedAt: new Date() },
    });

    return c.json(result, result.ok ? 200 : 400);
  } catch (e) {
    return c.json({
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    }, 500);
  }
});

// ───── POST /api/system/initialize ──────────────────────────────────────
// Mark the system as initialized; ensure platform project exists.

systemRoutes.post("/initialize", async (c) => {
  // Idempotent — safe to call repeatedly
  await db.insert(systemSettings).values({
    key: "installed_at",
    value: new Date().toISOString(),
  }).onConflictDoUpdate({
    target: systemSettings.key,
    set: { value: new Date().toISOString(), updatedAt: new Date() },
  });

  // Create platform project if absent
  const PLATFORM_PROJECT_ID = "00000000-0000-0000-0000-000000000001";
  await db.insert(projects).values({
    id: PLATFORM_PROJECT_ID,
    slug: "_platform",
    name: "Platform (synthetic)",
    industry: "other",
    pipelineTemplate: "educational",
    costLimits: { daily: { smtp: 0 }, monthly: { smtp: 0 } },
  }).onConflictDoNothing();

  return c.json({ ok: true });
});

// ───── Helper: getAdapterStatus ─────────────────────────────────────────

async function getAdapterStatus(service: string, requiredKeys: string[]): Promise<{
  configured: boolean;
  verified: boolean | null;
  lastVerifiedAt: string | null;
  missingKeys: string[];
}> {
  const rows = await db.select({ key: globalCredentials.key })
    .from(globalCredentials)
    .where(eq(globalCredentials.service, service));

  const presentKeys = new Set(rows.map((r) => r.key));
  const missingKeys = requiredKeys.filter((k) => !presentKeys.has(k));
  const configured = missingKeys.length === 0;

  // Last verify
  const [verifyRow] = await db.select().from(systemSettings)
    .where(eq(systemSettings.key, `last_verified_${service}`)).limit(1);
  const verifyValue = verifyRow?.value as { at: string; ok: boolean } | undefined;

  return {
    configured,
    verified: verifyValue?.ok ?? null,
    lastVerifiedAt: verifyValue?.at ?? null,
    missingKeys,
  };
}

// ───── Helper: checkPostgres / checkRedis ───────────────────────────────

async function checkPostgres(): Promise<{ configured: boolean; verified: boolean; lastVerifiedAt: string | null }> {
  // Postgres is "configured" if DATABASE_URL is set AND a query succeeds
  if (!process.env.DATABASE_URL) {
    return { configured: false, verified: false, lastVerifiedAt: null };
  }
  try {
    await db.execute("SELECT 1");
    return { configured: true, verified: true, lastVerifiedAt: new Date().toISOString() };
  } catch {
    return { configured: true, verified: false, lastVerifiedAt: new Date().toISOString() };
  }
}

async function checkRedis(): Promise<{ configured: boolean; verified: boolean; lastVerifiedAt: string | null }> {
  if (!process.env.REDIS_URL) {
    return { configured: false, verified: false, lastVerifiedAt: null };
  }
  try {
    const { createClient } = await import("redis");
    const client = createClient({ url: process.env.REDIS_URL });
    await client.connect();
    await client.ping();
    await client.disconnect();
    return { configured: true, verified: true, lastVerifiedAt: new Date().toISOString() };
  } catch {
    return { configured: true, verified: false, lastVerifiedAt: new Date().toISOString() };
  }
}

// ───── Helper: runVerifyByAdapter ───────────────────────────────────────

async function runVerifyByAdapter(adapter: z.infer<typeof adapterEnumSchema>) {
  // Read all credential keys for the adapter, decrypt, pass to verify function
  const rows = await db.select().from(globalCredentials).where(eq(globalCredentials.service, adapter));
  const creds: Record<string, string> = {};
  for (const row of rows) {
    creds[row.key] = await decryptValue(row.encryptedValue);
  }

  switch (adapter) {
    case "anthropic":
      if (!creds.api_key) return { ok: false, message: "API key not set" };
      return verifyAnthropic(creds.api_key);
    case "replicate":
      if (!creds.api_token) return { ok: false, message: "API token not set" };
      return verifyReplicate(creds.api_token);
    case "r2":
      return verifyR2(creds);
    case "dataforseo":
      if (!creds.login || !creds.password) return { ok: false, message: "Login or password missing" };
      return verifyDataForSeo(creds.login, creds.password);
    case "smtp":
      return verifySmtp(creds);
    case "github_app":
      return verifyGitHubApp(creds);
  }
}
```

Mount in `apps/api/src/index.ts`:
```typescript
import { systemRoutes } from "./routes/system";
app.route("/api/system", systemRoutes);
```

The `/credentials/*` and `/verify/*` endpoints should require auth (Marcel must be logged in to manage credentials). The `/info`, `/status`, `/initialize` endpoints are unauthenticated for the bootstrap case.

### Adapter Loading Refactor

Existing adapters today read credentials from env vars. After Spec 32, they should prefer vault credentials, falling back to env vars (for backward compat in lokal mode where Marcel might still set env vars manually).

`packages/adapters/anthropic/src/client.ts` (modify existing):

```typescript
import { getGlobal } from "@marketing-auto/credentials";

async function getApiKey(): Promise<string> {
  // Prefer vault, fall back to env
  const fromVault = await getGlobal("anthropic", "api_key");
  if (fromVault) return fromVault;
  const fromEnv = process.env.ANTHROPIC_API_KEY;
  if (fromEnv) return fromEnv;
  throw new Error("Anthropic API key not configured (vault or ANTHROPIC_API_KEY env)");
}
```

Apply the same pattern to all adapters. This is a moderate refactor — list of files in Implementation Order.

### Frontend: i18n keys

`apps/web/src/i18n/de/installer.ts` — full content:

```typescript
export default {
  title: "Erste Einrichtung",
  intro: "Dieser Assistent führt dich durch die Einrichtung aller externen Dienste. Du kannst einzelne Schritte überspringen und später nachholen.",
  alreadyInitialized: "Das System wurde bereits eingerichtet. Du kannst hier einzelne Adapter neu konfigurieren oder verifizieren.",

  step: "Schritt {current} von {total}",
  back: "Zurück",
  next: "Weiter",
  skip: "Überspringen",
  finish: "Fertig",

  status: {
    pending: "Ausstehend",
    configured: "Konfiguriert",
    verified: "Verifiziert",
    failed: "Verifizierung fehlgeschlagen",
    skipped: "Übersprungen",
  },

  verify: {
    button: "Jetzt verifizieren",
    inProgress: "Wird verifiziert...",
    success: "Verbindung erfolgreich",
    failure: "Verbindung fehlgeschlagen: {message}",
  },

  skipDialog: {
    title: "Schritt überspringen?",
    intro: "Wenn du diesen Schritt überspringst, sind die folgenden Funktionen nicht verfügbar:",
    confirm: "Verstanden, überspringen",
    cancel: "Abbrechen",
  },

  steps: {
    intro: {
      title: "Willkommen",
      description: "Diese Plattform automatisiert SEO- und Content-Workflows. Bevor du loslegen kannst, müssen einige externe Dienste eingerichtet werden.",
      timeEstimate: "Geschätzte Dauer: 30-60 Minuten",
    },
    core: {
      title: "Kern-Infrastruktur",
      description: "Datenbank und Redis. Diese sind über Umgebungsvariablen konfiguriert und können nicht im Browser geändert werden.",
      postgresLabel: "PostgreSQL",
      redisLabel: "Redis",
      configHint: "Setze DATABASE_URL und REDIS_URL in der `.env` und starte den API-Server neu.",
    },
    smtp: {
      title: "E-Mail (SMTP)",
      description: "Wird für Magic-Link-Anmeldung benötigt. Empfohlen: Gmail mit App-Password.",
      consequenceIfSkipped: "Magic-Link-Login wird in der Konsole protokolliert (Dev-Modus). Cost-Alerts und Benachrichtigungen werden nicht versendet.",
      fields: {
        host: "SMTP-Host",
        port: "Port",
        user: "Benutzername",
        password: "Passwort",
        fromAddress: "Absender-Adresse",
      },
      hint: "Gmail-Setup: Aktiviere 2-Faktor-Auth, dann erstelle ein App-Passwort unter https://myaccount.google.com/apppasswords",
    },
    anthropic: {
      title: "Anthropic API",
      description: "Wird für Cold-Start-Synthese, Article-Generierung und Schema-Erweiterungen benötigt.",
      consequenceIfSkipped: "Folgende Funktionen sind nicht verfügbar: Cold-Start, Article-Generierung, Schema-Extraktion, Internal Linking. Tatsächlich: fast alles.",
      fields: {
        apiKey: "API-Key",
      },
      hint: "Erhalte den Key unter https://console.anthropic.com/settings/keys",
    },
    replicate: {
      title: "Replicate",
      description: "Wird für die Generierung von Hero-Bildern (Flux 1.1 Pro) verwendet.",
      consequenceIfSkipped: "Hero-Image-Generierung im Article-Pipeline ist nicht verfügbar. Articles werden ohne Hero-Image erstellt.",
      fields: {
        apiToken: "API-Token",
      },
      hint: "Token erhältlich unter https://replicate.com/account/api-tokens",
    },
    r2: {
      title: "Cloudflare R2",
      description: "Speicher für generierte Hero-Bilder. Wird in Astro Sync direkt referenziert.",
      consequenceIfSkipped: "Replicate funktioniert nicht ohne R2 (Bilder können nicht gespeichert werden). Indirekte Konsequenz: keine Article-Generierung.",
      fields: {
        accountId: "Account ID",
        accessKeyId: "Access Key ID",
        secretAccessKey: "Secret Access Key",
        bucket: "Bucket Name",
        publicBaseUrl: "Public Base URL",
      },
      hint: "Erstelle Bucket + R2-Token unter https://dash.cloudflare.com/?to=/:account/r2",
    },
    dataforseo: {
      title: "DataForSEO",
      description: "Liefert SERP-Daten und Keyword-Volumen für Cold-Start und Article-Research.",
      consequenceIfSkipped: "Cold-Start Wettbewerber-Analyse, Cluster-Plan, und Article-Research funktionieren nicht. Cold-Start ist faktisch blockiert.",
      fields: {
        login: "Login",
        password: "Passwort",
      },
      hint: "Account mit $50 Deposit unter https://app.dataforseo.com/register",
    },
    githubApp: {
      title: "GitHub App",
      description: "Push von Articles in das Astro-Repository.",
      consequenceIfSkipped: "Astro-Sync-Funktion ist nicht verfügbar. Articles bleiben in der DB, müssen manuell ins Astro-Repo kopiert werden.",
      fields: {
        appId: "App ID",
        privateKeyPath: "Pfad zum Private Key (.pem)",
        privateKeyContent: "Private Key Inhalt (PEM)",
      },
      hint: "Setup-Anleitung: packages/adapters/astro-sync/SETUP-GITHUB-APP.md",
      modeNoteLokal: "Lokaler Modus: Pfad zur PEM-Datei auf deinem Mac.",
      modeNoteSelfHosted: "Self-Hosted-Modus: Inhalt der PEM-Datei einfügen (wird verschlüsselt gespeichert).",
    },
    summary: {
      title: "Zusammenfassung",
      readyTitle: "Du kannst loslegen",
      readyDescription: "Alle Pflicht-Adapter sind konfiguriert. Klicke auf Fertig um zur App zu wechseln.",
      partialTitle: "Setup teilweise abgeschlossen",
      partialDescription: "Einige Adapter sind übersprungen. Du kannst sie unter Einstellungen jederzeit nachholen.",
      finishButton: "Fertig — zur App",
    },
  },
};
```

### Frontend: Installer Page

`apps/web/src/pages/InstallerPage.vue`:

```vue
<template>
  <div class="installer">
    <q-stepper
      v-model="currentStep"
      vertical
      header-nav
      color="primary"
      animated
      class="bg-transparent"
    >
      <q-step
        v-for="(step, idx) in steps"
        :key="step.id"
        :name="step.id"
        :title="$t(`installer.steps.${step.id}.title`)"
        :icon="step.icon"
        :done="step.status === 'configured' || step.status === 'skipped'"
        :error="step.status === 'failed'"
        :caption="getStatusCaption(step)"
      >
        <component
          :is="getComponentForStep(step.id)"
          :step="step"
          @configured="onStepConfigured(step.id)"
          @skipped="onStepSkipped(step.id)"
        />

        <q-stepper-navigation>
          <q-btn
            flat
            :label="$t('installer.back')"
            :disable="idx === 0"
            class="q-mr-md"
            @click="goPrev"
          />
          <q-btn
            v-if="step.status === 'configured' || step.status === 'skipped'"
            color="primary"
            :label="$t('installer.next')"
            @click="goNext"
          />
        </q-stepper-navigation>
      </q-step>

      <!-- Summary step -->
      <q-step
        name="summary"
        :title="$t('installer.steps.summary.title')"
        icon="check_circle"
        :done="false"
      >
        <InstallerSummary @finish="onFinish" />
      </q-step>
    </q-stepper>
  </div>
</template>

<script lang="ts">
import { defineComponent, defineAsyncComponent } from 'vue';
import { useSystemStatusStore } from 'src/stores/system-status';
import { api } from 'src/lib/api-client';
import { useNotify } from 'src/composables/useNotify';
import InstallerSummary from 'src/components/installer/InstallerSummary.vue';

const stepDefinitions = [
  { id: 'intro', icon: 'rocket_launch' },
  { id: 'core', icon: 'storage' },
  { id: 'smtp', icon: 'mail' },
  { id: 'anthropic', icon: 'psychology' },
  { id: 'replicate', icon: 'image' },
  { id: 'r2', icon: 'cloud' },
  { id: 'dataforseo', icon: 'search' },
  { id: 'githubApp', icon: 'code' },
];

type StepStatus = 'pending' | 'configured' | 'failed' | 'skipped';

interface StepState {
  id: string;
  icon: string;
  status: StepStatus;
}

export default defineComponent({
  name: 'InstallerPage',

  components: {
    InstallerSummary,
    StepIntro: defineAsyncComponent(() => import('src/components/installer/StepIntro.vue')),
    StepCore: defineAsyncComponent(() => import('src/components/installer/StepCore.vue')),
    StepSmtp: defineAsyncComponent(() => import('src/components/installer/StepSmtp.vue')),
    StepAnthropic: defineAsyncComponent(() => import('src/components/installer/StepAnthropic.vue')),
    StepReplicate: defineAsyncComponent(() => import('src/components/installer/StepReplicate.vue')),
    StepR2: defineAsyncComponent(() => import('src/components/installer/StepR2.vue')),
    StepDataforseo: defineAsyncComponent(() => import('src/components/installer/StepDataforseo.vue')),
    StepGithubApp: defineAsyncComponent(() => import('src/components/installer/StepGithubApp.vue')),
  },

  setup() {
    return {
      systemStatusStore: useSystemStatusStore(),
      notify: useNotify(),
    };
  },

  data: () => ({
    currentStep: 'intro' as string,
  }),

  computed: {
    steps(): StepState[] {
      const status = this.systemStatusStore;
      const map: Record<string, StepStatus> = {
        intro: 'configured', // intro is always done
        core: status.requiredCoreReady ? 'configured' : 'pending',
        smtp: this.statusToStepStatus(status.adapters.smtp),
        anthropic: this.statusToStepStatus(status.adapters.anthropic),
        replicate: this.statusToStepStatus(status.adapters.replicate),
        r2: this.statusToStepStatus(status.adapters.r2),
        dataforseo: this.statusToStepStatus(status.adapters.dataforseo),
        githubApp: this.statusToStepStatus(status.adapters.githubApp),
      };
      return stepDefinitions.map((def) => ({
        id: def.id,
        icon: def.icon,
        status: map[def.id] ?? 'pending',
      }));
    },
  },

  async created() {
    await this.systemStatusStore.fetchStatus();
    // Resume at first non-done step
    const firstPending = this.steps.find((s) => s.status === 'pending' || s.status === 'failed');
    if (firstPending) {
      this.currentStep = firstPending.id;
    }
  },

  methods: {
    statusToStepStatus(s: { configured: boolean; verified: boolean | null }): StepStatus {
      if (!s.configured) return 'pending';
      if (s.verified === false) return 'failed';
      return 'configured';
    },

    getStatusCaption(step: StepState): string {
      return this.$t(`installer.status.${step.status}`);
    },

    getComponentForStep(id: string): string {
      const map: Record<string, string> = {
        intro: 'StepIntro',
        core: 'StepCore',
        smtp: 'StepSmtp',
        anthropic: 'StepAnthropic',
        replicate: 'StepReplicate',
        r2: 'StepR2',
        dataforseo: 'StepDataforseo',
        githubApp: 'StepGithubApp',
      };
      return map[id] ?? 'StepIntro';
    },

    goNext(): void {
      const idx = stepDefinitions.findIndex((s) => s.id === this.currentStep);
      if (idx < stepDefinitions.length - 1) {
        this.currentStep = stepDefinitions[idx + 1]!.id;
      } else {
        this.currentStep = 'summary';
      }
    },

    goPrev(): void {
      const idx = stepDefinitions.findIndex((s) => s.id === this.currentStep);
      if (idx > 0) {
        this.currentStep = stepDefinitions[idx - 1]!.id;
      }
    },

    async onStepConfigured(stepId: string): Promise<void> {
      await this.systemStatusStore.fetchStatus();
      // Auto-advance to next step
      this.goNext();
    },

    onStepSkipped(_stepId: string): void {
      this.goNext();
    },

    async onFinish(): Promise<void> {
      try {
        await api.post('/system/initialize');
        await this.systemStatusStore.fetchStatus();
        void this.$router.push({ name: 'inbox' });
      } catch {
        this.notify.error('Initialisierung fehlgeschlagen — bitte API-Server prüfen');
      }
    },
  },
});
</script>

<style lang="scss" scoped>
.installer {
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem;
}
</style>
```

### Frontend: Step Components — Reusable Pattern

Each adapter step uses the same structure. Define a base component, parameterize it.

`apps/web/src/components/installer/StepBase.vue`:

```vue
<template>
  <div>
    <p class="text-body1 q-mb-md">{{ description }}</p>

    <q-banner v-if="modeNote" class="q-mb-md bg-blue-grey-1">
      <template v-slot:avatar>
        <q-icon name="info" />
      </template>
      {{ modeNote }}
    </q-banner>

    <q-banner
      v-if="status.verified === true"
      class="q-mb-md bg-positive text-white"
    >
      <template v-slot:avatar>
        <q-icon name="check_circle" />
      </template>
      <div>{{ $t('installer.verify.success') }}</div>
      <div v-if="status.lastVerifiedAt" class="text-caption">
        Zuletzt verifiziert: {{ formatDate(status.lastVerifiedAt) }}
      </div>
    </q-banner>

    <q-banner
      v-if="status.verified === false"
      class="q-mb-md bg-negative text-white"
    >
      <template v-slot:avatar>
        <q-icon name="error" />
      </template>
      {{ $t('installer.verify.failure', { message: lastVerifyMessage }) }}
    </q-banner>

    <q-form @submit.prevent="onSave">
      <slot :loading="loading" />

      <div class="row q-gutter-md q-mt-md">
        <q-btn
          type="submit"
          color="primary"
          :label="status.configured ? 'Aktualisieren' : 'Speichern'"
          :loading="saving"
        />
        <q-btn
          v-if="status.configured"
          color="secondary"
          outline
          :label="$t('installer.verify.button')"
          :loading="verifying"
          @click="onVerify"
        />
        <q-space />
        <q-btn
          flat
          :label="$t('installer.skip')"
          @click="onSkipClick"
        />
      </div>
    </q-form>

    <q-dialog v-model="skipDialogOpen">
      <q-card>
        <q-card-section>
          <div class="text-h6">{{ $t('installer.skipDialog.title') }}</div>
          <p class="q-mt-md">{{ $t('installer.skipDialog.intro') }}</p>
          <p class="text-body2 text-grey-7">{{ consequenceIfSkipped }}</p>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat :label="$t('installer.skipDialog.cancel')" v-close-popup />
          <q-btn flat color="negative" :label="$t('installer.skipDialog.confirm')" @click="confirmSkip" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import { api } from 'src/lib/api-client';
import { useNotify } from 'src/composables/useNotify';
import { HttpError } from 'src/lib/http-error';

interface AdapterStatus {
  configured: boolean;
  verified: boolean | null;
  lastVerifiedAt: string | null;
}

export default defineComponent({
  name: 'StepBase',

  props: {
    service: { type: String, required: true },
    description: { type: String, required: true },
    consequenceIfSkipped: { type: String, required: true },
    modeNote: { type: String, default: '' },
    status: { type: Object as PropType<AdapterStatus>, required: true },
    fields: { type: Array as PropType<{ key: string; value: string }[]>, required: true },
  },

  emits: ['configured', 'skipped', 'verify-result'],

  setup() {
    return { notify: useNotify() };
  },

  data: () => ({
    saving: false,
    verifying: false,
    loading: false,
    skipDialogOpen: false,
    lastVerifyMessage: '',
  }),

  methods: {
    async onSave(): Promise<void> {
      this.saving = true;
      try {
        for (const field of this.fields) {
          if (!field.value) continue; // skip empty fields (e.g., re-saving)
          await api.post('/system/credentials', {
            service: this.service,
            key: field.key,
            value: field.value,
          });
        }
        this.notify.success('Gespeichert');
        this.$emit('configured');
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      } finally {
        this.saving = false;
      }
    },

    async onVerify(): Promise<void> {
      this.verifying = true;
      try {
        const res = await api.post<{ ok: boolean; message: string }>(`/system/verify/${this.service}`);
        this.lastVerifyMessage = res.data.message;
        if (res.data.ok) {
          this.notify.success(this.$t('installer.verify.success'));
        } else {
          this.notify.error(this.$t('installer.verify.failure', { message: res.data.message }));
        }
        this.$emit('verify-result', res.data);
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      } finally {
        this.verifying = false;
      }
    },

    onSkipClick(): void {
      this.skipDialogOpen = true;
    },

    confirmSkip(): void {
      this.skipDialogOpen = false;
      this.$emit('skipped');
    },

    formatDate(iso: string): string {
      return new Date(iso).toLocaleString();
    },
  },
});
</script>
```

Then each step (e.g. `StepAnthropic.vue`) is small:

```vue
<template>
  <StepBase
    service="anthropic"
    :description="$t('installer.steps.anthropic.description')"
    :consequence-if-skipped="$t('installer.steps.anthropic.consequenceIfSkipped')"
    :status="systemStatusStore.adapters.anthropic"
    :fields="fields"
    @configured="$emit('configured')"
    @skipped="$emit('skipped')"
  >
    <template #default>
      <q-input
        v-model="apiKey"
        :label="$t('installer.steps.anthropic.fields.apiKey')"
        type="password"
        :rules="[(v: string) => !!v || 'API-Key erforderlich']"
        autocomplete="off"
      />
      <p class="text-caption q-mt-sm">{{ $t('installer.steps.anthropic.hint') }}</p>
    </template>
  </StepBase>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useSystemStatusStore } from 'src/stores/system-status';
import StepBase from './StepBase.vue';

export default defineComponent({
  name: 'StepAnthropic',
  components: { StepBase },
  emits: ['configured', 'skipped'],
  setup() { return { systemStatusStore: useSystemStatusStore() }; },
  data: () => ({ apiKey: '' }),
  computed: {
    fields(): { key: string; value: string }[] {
      return [{ key: 'api_key', value: this.apiKey }];
    },
  },
});
</script>
```

The other adapter step components follow the same pattern (StepReplicate, StepR2, StepDataforseo, StepSmtp, StepGithubApp). Variations:
- StepR2 has 5 fields instead of 1
- StepSmtp has 5 fields, password input
- StepGithubApp has mode-aware variant: lokal shows "private key path" input, self-hosted shows multi-line "private key content" input + file upload
- StepCore has no form — just status indicators for Postgres + Redis + a "configHint" with env-var instructions

### Frontend: InstallerSummary Component

`apps/web/src/components/installer/InstallerSummary.vue`:

```vue
<template>
  <div>
    <q-banner v-if="allRequiredReady" class="bg-positive text-white q-mb-md">
      <template v-slot:avatar>
        <q-icon name="check_circle" />
      </template>
      <div class="text-h6">{{ $t('installer.steps.summary.readyTitle') }}</div>
      <p class="q-mt-sm">{{ $t('installer.steps.summary.readyDescription') }}</p>
    </q-banner>

    <q-banner v-else class="bg-warning text-dark q-mb-md">
      <template v-slot:avatar>
        <q-icon name="warning" />
      </template>
      <div class="text-h6">{{ $t('installer.steps.summary.partialTitle') }}</div>
      <p class="q-mt-sm">{{ $t('installer.steps.summary.partialDescription') }}</p>
    </q-banner>

    <q-list bordered class="rounded-borders q-mb-md">
      <q-item
        v-for="(adapter, key) in systemStatusStore.adapters"
        :key="key"
      >
        <q-item-section avatar>
          <q-icon
            :name="getIcon(adapter)"
            :color="getColor(adapter)"
          />
        </q-item-section>
        <q-item-section>
          <q-item-label>{{ key }}</q-item-label>
          <q-item-label caption>{{ getDescription(adapter) }}</q-item-label>
        </q-item-section>
      </q-item>
    </q-list>

    <q-btn
      color="primary"
      size="lg"
      :label="$t('installer.steps.summary.finishButton')"
      class="full-width"
      @click="$emit('finish')"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useSystemStatusStore } from 'src/stores/system-status';

interface AdapterStatus {
  configured: boolean;
  verified: boolean | null;
}

export default defineComponent({
  name: 'InstallerSummary',
  emits: ['finish'],
  setup() { return { systemStatusStore: useSystemStatusStore() }; },
  computed: {
    allRequiredReady(): boolean {
      return this.systemStatusStore.adapters.anthropic.configured;
      // Pragmatic: anthropic is the only truly required adapter to do *anything* useful
    },
  },
  methods: {
    getIcon(a: AdapterStatus): string {
      if (a.verified === true) return 'check_circle';
      if (a.configured) return 'help';
      return 'remove_circle_outline';
    },
    getColor(a: AdapterStatus): string {
      if (a.verified === true) return 'positive';
      if (a.configured) return 'warning';
      return 'grey-5';
    },
    getDescription(a: AdapterStatus): string {
      if (a.verified === true) return 'Konfiguriert und verifiziert';
      if (a.configured) return 'Konfiguriert, nicht verifiziert';
      return 'Nicht konfiguriert';
    },
  },
});
</script>
```

## Acceptance Criteria

### Backend
- [ ] `system_settings` table created
- [ ] `global_credentials` table created
- [ ] `verify*` functions exist for all 6 adapters
- [ ] `GET /api/system/info` returns deployment mode
- [ ] `GET /api/system/status` returns full status with `configured`, `verified`, `lastVerifiedAt`, `missingKeys` per adapter
- [ ] `POST /api/system/credentials` upserts a credential (encrypted)
- [ ] `POST /api/system/verify/:adapter` runs verify, returns `{ok, message}`, persists `last_verified_*`
- [ ] `POST /api/system/initialize` is idempotent, sets `installed_at`, ensures platform project
- [ ] Adapters now load credentials from vault first, env-var fallback

### Frontend
- [ ] `/installer` route renders the wizard
- [ ] All 8 stepper sections render (intro, core, smtp, anthropic, replicate, r2, dataforseo, githubApp)
- [ ] Step state reflects backend status correctly
- [ ] Submitting an adapter step saves credentials, verifies, and advances
- [ ] Skip button shows confirmation dialog with consequences
- [ ] After all steps, summary shows ready or partial state
- [ ] Clicking Finish calls `/api/system/initialize` and redirects to `/inbox`
- [ ] When `requiredCoreReady` is false, all routes redirect to `/installer` (Spec 31 guard already does this; verify with running app)
- [ ] When `initialized` is true, route guard does NOT force `/installer` redirect anymore (manual access only via Settings)

### Mode-awareness
- [ ] StepGithubApp shows path-input in lokal mode, content-textarea+upload in self-hosted mode

## Testing Strategy

Manual smoke tests:

1. **Fresh install**: Drop the `system_settings` table, restart, visit any route. Must redirect to `/installer`. Walk through all 8 steps, including skipping at least one. Click Finish. Verify `/inbox` loads.

2. **Resumption**: Mid-installer, navigate away (e.g., `/inbox`). Visit `/installer` again. Must resume at the next pending step.

3. **Verify success**: Configure Anthropic with valid key. Click Verify. See success banner. Last-verified-at timestamp persisted (refresh page, banner still shows green).

4. **Verify failure**: Configure Anthropic with invalid key. Click Verify. See failure banner with error message. Rotate to valid key. Re-verify. Now succeeds.

5. **Skip flow**: At Replicate step, click Skip. Modal shows "image generation not available". Confirm. Step status now "skipped". Advance to next step.

6. **Re-enter installer post-init**: Visit `/installer` after init. See "system already initialized" banner. Can still re-configure adapters.

7. **Adapter loading**: After installer, run `bun --filter @marketing-auto/api article:generate ...` (CLI). Verify adapters load credentials from vault, not env.

## Open Questions / Decisions Made

**Decision 1: One credential row per (service, key) pair.**
Allows updating fields independently. Rotating just the Anthropic key doesn't touch the Replicate token.

**Decision 2: Verify is opt-in, not auto-on-save.**
Per architecture decision 4. Users can save partial progress and verify later.

**Decision 3: Marketing context (per project) is NOT part of installer.**
Installer is global; project-marketing-context is per-project. Spec 34 (Project Management) handles that. Keeps installer focused.

**Decision 4: No "uninstall" or "factory reset" feature.**
If Marcel wants to start over: drop the database. The installer doesn't need a destructive UI.

**Decision 5: Forced `/installer` redirect uses `requiredCoreReady`, not `allConfigured`.**
Postgres + Redis must work for the app to function at all. Other adapters: optional. Forcing redirect on every missing adapter would prevent Marcel from completing the wizard (the wizard itself needs the API to work).

**Decision 6: Step order is fixed.**
Core → SMTP → Anthropic → Replicate → R2 → DataForSEO → GitHub App. Reasoning: SMTP is for auth (might block re-login), Anthropic is the "powers everything" key, Replicate+R2 are paired (R2 needed for Replicate output storage), DataForSEO and GitHub App are last because cold-start and astro-sync come later in user workflow.

**Decision 7: System status endpoint returns missingKeys.**
Helpful for the UI to show "you've set 3 of 5 R2 fields" without re-fetching specific credentials.

**Decision 8: Credential values are write-only via UI.**
Spec 02's vault is read-only externally for security. The installer never reads back values — only writes/deletes.

**Decision 9: No JSON-import "bulk credentials" feature.**
Marketing Automation isn't multi-tenant SaaS. Per-form is fine.

**Decision 10: Adapter `verify()` functions live in each adapter package, not centralized.**
Each adapter knows its own connection patterns. Centralizing would couple them. The system route imports them all and dispatches.

## Implementation Order

**Recommend 4 sessions.**

**Session 1: Backend infrastructure (~5-6h)**
1. Schema migrations: `system_settings`, `global_credentials`
2. Extend credentials package with `getGlobal/setGlobal/deleteGlobal/listGlobal`
3. Implement `verify*` functions for all 6 adapters (mostly thin wrappers around existing SDK calls)
4. Create `apps/api/src/routes/system.ts` with all endpoints
5. Mount route, test each endpoint manually with curl
6. Commit: `feat(api): system status, credentials, verify endpoints (spec 32)`

**Session 2: Adapter loading refactor (~3-4h)**
1. Update each adapter (anthropic, replicate, r2-storage, dataforseo, email, astro-sync) to prefer vault over env
2. Update CLAUDE.md files for each
3. Run integration tests against live adapters with new vault-loaded creds
4. Commit: `refactor(adapters): prefer vault credentials over env vars (spec 32)`

**Session 3: Frontend wizard (~5-6h)**
1. Create `apps/web/src/components/installer/` directory with StepBase + 8 step components + InstallerSummary
2. Replace `InstallerPage.vue` stub with full implementation
3. Update i18n bundle
4. Manual smoke test through full wizard
5. Commit: `feat(web): installer wizard (spec 32)`

**Session 4: Polish + edge cases (~2-3h)**
1. Mode-aware GitHub App step variant
2. Re-entry / resumption logic verification
3. Skip dialog UX polish
4. Verify-button caching (don't re-verify on quick clicks)
5. Final smoke tests
6. Commit: `feat(web): installer polish + mode-awareness (spec 32)`

Total: 15-19 hours.

## Splitting Plan

See "Implementation Order" — 4 sessions with `/clear` between.

## Discovered During Implementation

**Session 1 (Backend infrastructure)**

- `optionalStr()` in `packages/shared/src/config.ts` only accepts `ZodString`, not `ZodEnum`. `DEPLOYMENT_MODE` must use `z.preprocess((v) => (v === "" ? undefined : v), z.enum([...]).optional())` directly.
- Adapter subpath exports (`"./verify"` in `package.json`) require matching `paths` entries in every consumer's `tsconfig.json`. `moduleResolution: "bundler"` resolves at runtime but TypeScript type-checking still needs explicit path mappings.
- `ioredis` is installed inside `packages/pipelines/node_modules/` (not hoisted to root) and lacks types visible to the API package. The Redis reachability check was implemented via a raw `node:net` TCP connection instead — cheaper and zero extra dependency.
- Verify functions call external APIs (Anthropic, Replicate, etc.) without going through the cost-tracker. This is intentional: the installer has no `project_id` context to attribute costs to, and each verify call is a cheap existence check (≤1 LLM token for Anthropic). Accepted as a known gap.
- The spec referenced `@marketing-auto/credentials` as the import path for `encrypt`/`decrypt`. The actual package is `@marketing-auto/core` (credentials live in `packages/core/src/credentials/`).
- The spec placed `verifyR2` in `@marketing-auto/adapter-replicate/verify-r2`. R2 storage is in `packages/adapters/storage`; the verify function lives at `@marketing-auto/adapter-storage/verify`.

**Session 2 (Adapter loading refactor)**

- Making an adapter client factory async (to support the vault lookup) requires ALL internal callers within that file to `await` the factory. The DataForSEO adapter's double-await pattern — `(await getSerpApi()).methodName()` — is the correct idiom when a method is called immediately after the factory resolves.
- The storage adapter's formerly synchronous helpers (`getFile`, `presignedUrl`, `deleteObject`) became async because credential resolution is async and must complete before the `S3Client` is constructed. This is a breaking change to the public API of those three functions. Any callers that relied on synchronous return values will silently receive a `Promise` instead; TypeScript's strict mode catches this at compile time. The storage test was updated accordingly.
- The storage adapter required a new `getClientAndConfig()` helper returning `{ client, config }` rather than just `getClient()` returning the client. The `publicUrlFor()` helper needs the resolved `R2Config` (specifically `publicBaseUrl` and `accountId`) which are only available after the async vault resolution. Caching both together in `_client`/`_config` avoids redundant lookups.
- The email adapter's `getTransporter()` does not cache the "SMTP unconfigured" state. In dev mode (no vault credentials, no SMTP env vars), every `sendEmail()` call re-queries the vault. This is a known, accepted trade-off — magic-link emails are rare enough that the overhead is negligible, and fixing it would require an additional `_smtpChecked` sentinel.

## Deviations

**Helper functions extracted to `src/lib/system-service.ts`**
The spec wrote `getAdapterStatus`, `checkPostgres`, `checkRedis`, `readAdapterCreds`, etc. directly inside `system.ts`. During review, these were extracted to `apps/api/src/lib/system-service.ts` to comply with the "routes are thin glue" rule. Behaviour is identical.

**`requireAuth` added to credential/verify endpoints**
The spec noted these endpoints "should require auth" but left it as a comment. During implementation, `requireAuth` was applied per-route on `POST /credentials`, `DELETE /credentials/:service/:key`, and `POST /verify/:adapter`. `GET /status`, `GET /info`, and `POST /initialize` remain public.

**Session 3 (Frontend wizard)**

- `q-stepper` was replaced with a fully custom sidebar-nav + content layout. The stepper's Material Design aesthetics were too strong and not overridable at the CSS level without fighting the component internals. The custom layout (`InstallerLayout.vue` + two-column flex) is simpler, fully styleable, and produces a modern Linear/Vercel-like wizard feel.
- `InstallerLayout.vue` was created (full-width, no sidebar, no header) instead of reusing `AuthLayout`. `AuthLayout` constrains to `col-lg-4` (~400px) which is too narrow for a two-column wizard layout.
- Back/Next page navigation was moved out of each step component into a shared page-level footer in `InstallerPage.vue`. Each step component now only owns its form actions (Save, Verify, Skip dialog). This resolved the "four buttons in one row" UX problem the spec design would have produced.
- `InstallerSummary` no longer owns the Finish button — it was moved to the `InstallerPage` footer alongside Back/Next. The summary component is now a pure display component.
- `@skipped` emit from `StepBase` carries no payload. `InstallerPage.onStepSkipped()` uses `this.currentStep` as the step identifier rather than receiving it as an event argument.
- `q-banner` was replaced throughout with hand-rolled CSS alert boxes (left-border accent, tinted background). `q-banner` forces the Material Design balloon shape and icon placement that contributes to the Google look.
- Quasar `hint` prop on `q-input` is user-visible and requires `:hint="$t('...')"`. Bare `hint="text"` looks like an HTML attribute but renders below the field. Added hardcoded hint strings in `StepGithubApp` were caught in review and moved to i18n.
- `toLocaleString()` must derive locale from `this.$i18n.locale`, not hardcode `'de-DE'`. Hardcoding was caught in review.

**Session 4 (Polish)**

- `installer.validation.required` was used in validator rule functions inside step components (StepAnthropic, StepSmtp, StepReplicate) during Session 3 but never added to the i18n bundles. The key resolved silently to `undefined` at runtime (Quasar validator receives the string `"undefined"`, which is truthy, so validation never fires). Fixed in Session 4 by adding the key to both `de/installer.ts` and `en/installer.ts`. Lesson: when writing `$t('...')` inside Quasar rule functions, immediately add the key to the bundle — the TypeScript augmentation does not catch missing keys inside inline lambdas.
