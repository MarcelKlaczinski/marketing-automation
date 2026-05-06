# Spec 22: PageSpeed Validation

**Phase:** 3 (Volume Production for KI-Wissensraum)
**Estimated Effort:** 1-1.5 days (split into 3 sessions)
**Dependencies:** Spec 05 (pipeline engine), Spec 21 (astro-sync — produces the commits this validates)
**Status:** Ready for implementation
**Recommended Model:** Sonnet 4.6 (mostly orchestration; no high-leverage architectural decisions)

---

## Goal

Build the **PageSpeed Validation Pipeline**: takes a `ready_to_publish` article (synced via Spec 21), runs a local Astro build, serves the build, runs Lighthouse CLI against the article URL, and decides whether the article passes quality gates.

**Pass** → article transitions to `published` status (signaling Astro CI/CD can deploy it).
**Fail** → article transitions to `blocked_by_pagespeed`, Marcel sees the blocker in DB / Web App.

The pipeline is the **last quality gate** before an article reaches real users. Without it, a slow/broken article could silently deploy and tank Lighthouse scores cluster-wide.

**Approach for MVP**: local Astro build + Lighthouse CLI (Option A from architecture discussion).
- Pro: fast (~30s/test), free, no cloud dependencies
- Con: measures local-build performance, not real CDN performance
- Mitigation: Lighthouse threshold accounts for this — a "Performance ≥ 90" locally usually means "≥ 95 production"

**In backlog (NOT this spec)**: Cloud-based validation against Vercel/Cloudflare Preview URLs (Option B) and Google PageSpeed Insights API (Option C). Documented at end of spec for Phase 4 / Web App reference.

## Lifecycle

```
final_review
   ↓ Marcel runs `article:sync`
ready_to_publish               ← Spec 21 commits to Astro repo
   ↓ Marcel runs `article:validate-pagespeed`  (or auto-trigger from Spec 21 — see Decision 3)
validating                     ← BullMQ job running
   ↓ Pass
published                       ← Astro CI/CD deploys it
   ↓ OR Fail
blocked_by_pagespeed            ← Marcel sees scores + issues in DB, fixes manually
                                  (re-sync + re-validate when ready)
```

The two new states (`validating`, `blocked_by_pagespeed`) get added to `articleStatusEnum`.

## What "Pass" means

The pipeline produces a Lighthouse JSON report. We extract four scores (Performance, Accessibility, Best Practices, SEO) and compare against project-configurable thresholds.

**Default thresholds** (per project, stored in `projects.pagespeedThresholds` jsonb):
```json
{
  "performance": 85,
  "accessibility": 90,
  "bestPractices": 90,
  "seo": 95
}
```

Why 85 for Performance and not 90? Because we run locally — `astro preview` doesn't have CDN compression, HTTP/3, or aggressive caching headers. Real production typically scores 5-10 points higher. We want to catch bad articles, not have false positives.

**Pass** = ALL four scores ≥ threshold.
**Fail** = ANY score < threshold.

We also collect Core Web Vitals (LCP, INP, CLS) for monitoring, but they don't gate. Lighthouse's overall score derivation is good enough.

## Non-Goals

- **No real-CDN testing** (deferred to backlog)
- **No Google PageSpeed API** (deferred to backlog — would need a deployed URL to test, chicken-and-egg)
- **No screenshot diffs / visual regression** (separate concern, future spec)
- **No accessibility deep-dive** (Lighthouse Accessibility audit is sufficient for now; axe-core could be added later)
- **No A/B testing of articles** (out of scope)
- **No automatic rewrite/refix** if validation fails. Marcel reads the issues and decides. We don't auto-edit articles based on Lighthouse output.
- **No SEO content analysis** (e.g., "is the title length good?"). Lighthouse covers technical SEO; content-SEO is what Spec 20 already does.
- **No multi-page testing** (just the article URL, not the homepage / cluster index / etc.)

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│              PageSpeedValidationPipeline (BullMQ)                │
│                                                                  │
│  ┌──────────────────┐    ┌──────────────────────────┐           │
│  │ LoadArticleStep  │ →  │ CloneOrUpdateAstroRepoStep│           │
│  │ (DB + Git ref)   │    │ (git clone or pull main)  │           │
│  └──────────────────┘    └──────────────────────────┘           │
│                                                                  │
│  ┌──────────────────┐    ┌──────────────────────────┐           │
│  │ AstroBuildStep   │ →  │ AstroPreviewServerStep    │           │
│  │ (npm install +   │    │ (boot preview server,     │           │
│  │  astro build)    │    │  wait for ready)          │           │
│  └──────────────────┘    └──────────────────────────┘           │
│                                                                  │
│  ┌──────────────────┐    ┌──────────────────────────┐           │
│  │ LighthouseStep   │ →  │ EvaluateAndPersistStep    │           │
│  │ (run CLI on URL, │    │ (compare scores vs        │           │
│  │  parse JSON)     │    │  thresholds, update DB)   │           │
│  └──────────────────┘    └──────────────────────────┘           │
└──────────────────────────────────────────────────────────────────┘
```

The preview server is started in `AstroPreviewServerStep` and shut down in `EvaluateAndPersistStep` via a finally-block. Each pipeline run gets a fresh checkout/build to avoid stale dependencies.

**Working directory**: `/tmp/marketing-auto/pagespeed/<projectSlug>/<runId>/` — isolated per run, deletable after.

## Detailed Implementation

### Schema additions

**Add to `articleStatusEnum`** (`packages/db/src/schema/_enums.ts`):

```typescript
export const articleStatusEnum = pgEnum("article_status", [
  // ... existing
  "validating",            // NEW: PageSpeed validation in progress
  "blocked_by_pagespeed",  // NEW: failed thresholds, awaiting Marcel
]);
```

Migration choreography per Spec 14/20 lessons (DROP DEFAULT → SET DATA TYPE text → DROP TYPE → CREATE TYPE → SET DATA TYPE → restore default). Manual SQL likely needed.

**Add to `articles`** (`packages/db/src/schema/content.ts`):

```typescript
// PageSpeed validation results
pagespeedValidatedAt: timestamp("pagespeed_validated_at"),
pagespeedScores: jsonb("pagespeed_scores").$type<{
  performance: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
} | null>().default(null),
pagespeedCoreWebVitals: jsonb("pagespeed_core_web_vitals").$type<{
  lcp: number;        // milliseconds
  inp: number | null; // ms; sometimes null in lab data
  cls: number;        // unitless
} | null>().default(null),
pagespeedFailedThresholds: jsonb("pagespeed_failed_thresholds").$type<string[] | null>().default(null),
pagespeedReportUrl: text("pagespeed_report_url"),  // path to JSON report on disk OR R2 URL if uploaded
pagespeedAstroCommitSha: text("pagespeed_astro_commit_sha"),  // which commit was tested
```

**Add to `projects`** (`packages/db/src/schema/projects.ts`):

```typescript
pagespeedThresholds: jsonb("pagespeed_thresholds").$type<{
  performance: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
}>().default({
  performance: 85,
  accessibility: 90,
  bestPractices: 90,
  seo: 95,
}),
```

**New table** `pagespeed_runs` for audit (`packages/db/src/schema/operations.ts`):

```typescript
export const pagespeedRuns = pgTable("pagespeed_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  articleId: uuid("article_id").notNull(),
  pipelineRunId: uuid("pipeline_run_id"),

  status: text("status").$type<"pending" | "succeeded" | "failed" | "errored">().notNull(),
  /** "succeeded" = pass; "failed" = ran but didn't meet thresholds; "errored" = pipeline crashed */
  outcome: text("outcome").$type<"pass" | "fail" | "error" | null>().default(null),

  scores: jsonb("scores").$type<Record<string, number> | null>().default(null),
  coreWebVitals: jsonb("core_web_vitals").$type<Record<string, number> | null>().default(null),
  thresholdsUsed: jsonb("thresholds_used").$type<Record<string, number> | null>().default(null),
  failedCategories: jsonb("failed_categories").$type<string[] | null>().default(null),

  errorMessage: text("error_message"),
  errorStage: text("error_stage").$type<"clone" | "build" | "preview" | "lighthouse" | "evaluate" | null>(),

  reportPath: text("report_path"),         // local FS path or R2 key
  astroCommitSha: text("astro_commit_sha"),
  testedUrl: text("tested_url"),

  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
}, (table) => ({
  articleIdx: index("pagespeed_runs_article_idx").on(table.articleId),
  projectStatusIdx: index("pagespeed_runs_project_status_idx").on(table.projectId, table.status),
}));
```

Note: per Spec 21 lesson #3, all project-scoped FKs use `{ onDelete: "cascade" }`.

### Package Setup

`packages/adapters/pagespeed/package.json`:

```json
{
  "name": "@marketing-auto/adapter-pagespeed",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "cd ../../.. && bun test packages/adapters/pagespeed/test"
  },
  "dependencies": {
    "@marketing-auto/shared": "workspace:*",
    "@marketing-auto/db": "workspace:*",
    "lighthouse": "^12.0.0",
    "puppeteer-core": "^23.0.0",
    "@puppeteer/browsers": "^2.0.0"
  },
  "devDependencies": {
    "drizzle-orm": "^0.36.0"
  }
}
```

**About Puppeteer dependency**: Lighthouse CLI internally uses Puppeteer to drive Chrome. For Bun compatibility, we use `puppeteer-core` (lighter, no browser bundled) plus `@puppeteer/browsers` (manages Chrome installation separately). On first run, the package downloads Chrome to `~/.cache/puppeteer` (~150MB, one-time).

`tsconfig.json`: same pattern as other adapters (extends root, `noEmit: true`, etc.).

### Required tooling on the host machine

Marcel needs these installed on his Mac (one-time):

1. **Node.js** (18+) — Astro build requires it. Already installed.
2. **Git** — for cloning Astro repos. Already installed.
3. **Chrome / Chromium** — Puppeteer downloads this on first adapter use. ~150MB.

The adapter's first-run setup script handles Chrome installation:

```bash
bun --filter @marketing-auto/adapter-pagespeed install-chrome
```

`packages/adapters/pagespeed/src/scripts/install-chrome.ts`:

```typescript
#!/usr/bin/env bun
import { install, computeExecutablePath, Browser } from "@puppeteer/browsers";
import { homedir } from "node:os";
import { join } from "node:path";

const CHROME_VERSION = "stable";
const CACHE_DIR = join(homedir(), ".cache", "puppeteer");

console.log(`Installing Chrome ${CHROME_VERSION} to ${CACHE_DIR}...`);

const installed = await install({
  cacheDir: CACHE_DIR,
  browser: Browser.CHROME,
  buildId: CHROME_VERSION,
});

console.log(`✅ Chrome installed at: ${installed.executablePath}`);

const verified = computeExecutablePath({
  cacheDir: CACHE_DIR,
  browser: Browser.CHROME,
  buildId: CHROME_VERSION,
});
console.log(`✅ Verified path: ${verified}`);
process.exit(0);
```

Add to package.json scripts:
```json
"install-chrome": "bun --env-file ../../../.env src/scripts/install-chrome.ts"
```

### Environment

Optional env vars (none required — sensible defaults):

```typescript
// packages/shared/src/config.ts
PAGESPEED_WORK_DIR: z.string().default("/tmp/marketing-auto/pagespeed"),
PAGESPEED_BUILD_TIMEOUT_MS: z.coerce.number().int().min(60_000).default(300_000),  // 5 min
PAGESPEED_LIGHTHOUSE_TIMEOUT_MS: z.coerce.number().int().min(30_000).default(120_000),  // 2 min
```

### Types

`packages/adapters/pagespeed/src/types.ts`:

```typescript
import { z } from "zod";

export const PagespeedScoresSchema = z.object({
  performance: z.number().min(0).max(100),
  accessibility: z.number().min(0).max(100),
  bestPractices: z.number().min(0).max(100),
  seo: z.number().min(0).max(100),
});
export type PagespeedScores = z.infer<typeof PagespeedScoresSchema>;

export const CoreWebVitalsSchema = z.object({
  lcp: z.number().min(0),
  inp: z.number().min(0).nullable(),
  cls: z.number().min(0),
});
export type CoreWebVitals = z.infer<typeof CoreWebVitalsSchema>;

export type PagespeedOutcome = "pass" | "fail" | "error";

export class PagespeedError extends Error {
  constructor(
    message: string,
    public readonly stage: "clone" | "build" | "preview" | "lighthouse" | "evaluate" | "config",
    public readonly originalCause?: unknown,
  ) {
    super(message);
    this.name = "PagespeedError";
  }
}
```

`originalCause` not `cause` — per Spec 12/13/14/20/21 lesson.

### Pipeline Step: LoadArticle

`packages/adapters/pagespeed/src/steps/load-article.ts`:

```typescript
import { z } from "zod";
import { eq } from "drizzle-orm";
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { db, articles, projects } from "@marketing-auto/db";
import { PagespeedError, PagespeedScoresSchema } from "../types.ts";
import { AstroRepoConfigSchema } from "@marketing-auto/adapter-astro-sync";

const InputSchema = z.object({
  articleId: z.string().uuid(),
});

const OutputSchema = z.object({
  article: z.object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    slug: z.string(),
    astroCommitSha: z.string(),
  }),
  astroRepo: AstroRepoConfigSchema,
  thresholds: PagespeedScoresSchema,
  workDir: z.string(),
}) as z.ZodType<{
  article: {
    id: string;
    projectId: string;
    slug: string;
    astroCommitSha: string;
  };
  astroRepo: z.infer<typeof AstroRepoConfigSchema>;
  thresholds: z.infer<typeof PagespeedScoresSchema>;
  workDir: string;
}>;
// ZodType cast per Spec 21 lesson #6 (default fields cause _input variance)

export class LoadArticleStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "load-article";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0; }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const [article] = await db.select().from(articles).where(eq(articles.id, input.articleId)).limit(1);
    if (!article) throw new PagespeedError(`Article ${input.articleId} not found`, "config");

    if (article.status !== "ready_to_publish" && article.status !== "blocked_by_pagespeed") {
      throw new PagespeedError(
        `Article status is "${article.status}", expected "ready_to_publish" or "blocked_by_pagespeed" (re-run after fix)`,
        "config",
      );
    }
    if (!article.astroCommitSha) {
      throw new PagespeedError(
        `Article has no astroCommitSha — sync via Spec 21 first`,
        "config",
      );
    }

    const [project] = await db.select().from(projects).where(eq(projects.id, article.projectId)).limit(1);
    if (!project) throw new PagespeedError(`Project ${article.projectId} not found`, "config");
    if (!project.astroRepo) {
      throw new PagespeedError(
        `Project "${project.slug}" has no astroRepo configured (set via Spec 21 setup)`,
        "config",
      );
    }

    const env = (await import("@marketing-auto/shared")).getEnv();
    const workDir = `${env.PAGESPEED_WORK_DIR}/${project.slug}/${ctx.pipelineRunId ?? input.articleId}`;

    return {
      article: {
        id: article.id,
        projectId: article.projectId,
        slug: article.slug,
        astroCommitSha: article.astroCommitSha,
      },
      astroRepo: AstroRepoConfigSchema.parse(project.astroRepo),
      thresholds: PagespeedScoresSchema.parse(project.pagespeedThresholds),
      workDir,
    };
  }
}
```

### Pipeline Step: CloneOrUpdateAstroRepo

`packages/adapters/pagespeed/src/steps/clone-or-update.ts`:

```typescript
import { z } from "zod";
import { spawn } from "node:child_process";
import { mkdir, access } from "node:fs/promises";
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { PagespeedError } from "../types.ts";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("pagespeed:clone");

const InputSchema = z.object({
  workDir: z.string(),
  astroRepoOwner: z.string(),
  astroRepoName: z.string(),
  astroCommitSha: z.string(),
});

const OutputSchema = z.object({
  repoPath: z.string(),
  checkedOutSha: z.string(),
});

export class CloneOrUpdateAstroRepoStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "clone-or-update";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0; }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    await mkdir(input.workDir, { recursive: true });
    const repoPath = `${input.workDir}/repo`;

    const exists = await fileExists(repoPath);
    const cloneUrl = `https://github.com/${input.astroRepoOwner}/${input.astroRepoName}.git`;

    if (!exists) {
      log.info({ cloneUrl, repoPath }, "Cloning Astro repo");
      await runCmd("git", ["clone", "--depth=50", cloneUrl, repoPath], { cwd: input.workDir });
    } else {
      log.info({ repoPath }, "Repo exists, fetching");
      await runCmd("git", ["fetch", "origin"], { cwd: repoPath });
    }

    log.info({ sha: input.astroCommitSha }, "Checking out commit");
    await runCmd("git", ["checkout", input.astroCommitSha], { cwd: repoPath });

    return {
      repoPath,
      checkedOutSha: input.astroCommitSha,
    };
  }
}

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

function runCmd(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeoutMs?: number } = { cwd: process.cwd() },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd: opts.cwd });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += String(d); });
    proc.stderr.on("data", (d) => { stderr += String(d); });

    const timeout = opts.timeoutMs
      ? setTimeout(() => {
          proc.kill("SIGKILL");
          reject(new PagespeedError(`${cmd} timed out after ${opts.timeoutMs}ms`, "clone"));
        }, opts.timeoutMs)
      : null;

    proc.on("close", (code) => {
      if (timeout) clearTimeout(timeout);
      if (code !== 0) {
        reject(new PagespeedError(
          `${cmd} ${args.join(" ")} failed (exit ${code}):\n${stderr}`,
          "clone",
        ));
      } else {
        resolve({ stdout, stderr });
      }
    });
    proc.on("error", (err) => {
      if (timeout) clearTimeout(timeout);
      reject(new PagespeedError(`${cmd} spawn error: ${err.message}`, "clone", err));
    });
  });
}

export { runCmd };  // re-exported for use in other steps
```

### Pipeline Step: AstroBuild

`packages/adapters/pagespeed/src/steps/astro-build.ts`:

```typescript
import { z } from "zod";
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { PagespeedError } from "../types.ts";
import { runCmd } from "./clone-or-update.ts";
import { createLogger, getEnv } from "@marketing-auto/shared";

const log = createLogger("pagespeed:build");

const InputSchema = z.object({
  repoPath: z.string(),
});

const OutputSchema = z.object({
  buildSucceeded: z.literal(true),
  buildOutputDir: z.string(),
});

export class AstroBuildStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "astro-build";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0; }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const env = getEnv();
    const timeoutMs = env.PAGESPEED_BUILD_TIMEOUT_MS;

    // 1. Install dependencies. Detect npm vs pnpm vs yarn.
    const packageMgr = await detectPackageManager(input.repoPath);
    log.info({ packageMgr, repoPath: input.repoPath }, "Installing dependencies");

    const installArgs: Record<string, string[]> = {
      npm: ["ci"],
      pnpm: ["install", "--frozen-lockfile"],
      yarn: ["install", "--frozen-lockfile"],
    };
    await runCmd(packageMgr, installArgs[packageMgr]!, {
      cwd: input.repoPath,
      timeoutMs,
    });

    // 2. Run astro build
    log.info({ repoPath: input.repoPath }, "Running astro build");
    await runCmd(packageMgr, ["run", "build"], {
      cwd: input.repoPath,
      timeoutMs,
    });

    return {
      buildSucceeded: true as const,
      buildOutputDir: `${input.repoPath}/dist`,
    };
  }
}

async function detectPackageManager(repoPath: string): Promise<"npm" | "pnpm" | "yarn"> {
  const fs = await import("node:fs/promises");
  if (await exists(`${repoPath}/pnpm-lock.yaml`)) return "pnpm";
  if (await exists(`${repoPath}/yarn.lock`)) return "yarn";
  return "npm";  // package-lock.json or none → npm
}

async function exists(p: string): Promise<boolean> {
  const { access } = await import("node:fs/promises");
  try { await access(p); return true; } catch { return false; }
}
```

### Pipeline Step: AstroPreviewServer

This step is special — it starts a long-running server process and returns BEFORE the next step runs. The server stays alive across `LighthouseStep`. It's shut down by the **pipeline's** finally-block, not the step itself.

`packages/adapters/pagespeed/src/steps/preview-server.ts`:

```typescript
import { z } from "zod";
import { spawn, type ChildProcess } from "node:child_process";
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { PagespeedError } from "../types.ts";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("pagespeed:preview");

const InputSchema = z.object({
  repoPath: z.string(),
});

const OutputSchema = z.object({
  serverUrl: z.string().url(),
  serverPid: z.number(),
});

/**
 * Astro preview servers default to port 4321. We let it choose freely and parse the
 * actual URL from stdout. This avoids port conflicts when multiple validations run.
 *
 * NOTE: PID is returned to the pipeline so the FINALLY block can kill the process.
 * Steps in BullMQ jobs cannot rely on `setTimeout` survival — process state must
 * be re-derived from the PID.
 */
export class AstroPreviewServerStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "preview-server";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0; }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const proc = spawn("npx", ["astro", "preview", "--port", "0"], {
      cwd: input.repoPath,
      detached: false,
    });

    let serverUrl: string | null = null;
    let stderr = "";
    let stdout = "";

    proc.stdout.on("data", (d) => {
      const s = String(d);
      stdout += s;
      // Astro logs "Local: http://localhost:XXXX/" — capture it
      const m = s.match(/Local:\s+(http:\/\/localhost:\d+\/?)/);
      if (m && !serverUrl) serverUrl = m[1]!;
    });
    proc.stderr.on("data", (d) => { stderr += String(d); });

    // Wait up to 30s for the server URL to appear
    const startTimeout = 30_000;
    const startTime = Date.now();
    while (!serverUrl) {
      if (Date.now() - startTime > startTimeout) {
        proc.kill("SIGKILL");
        throw new PagespeedError(
          `Astro preview server did not start within ${startTimeout}ms.\nstderr: ${stderr}\nstdout: ${stdout}`,
          "preview",
        );
      }
      await sleep(200);
    }

    log.info({ serverUrl, pid: proc.pid }, "Astro preview server started");

    if (!proc.pid) throw new PagespeedError("Preview server has no PID", "preview");

    return {
      serverUrl: serverUrl as string,
      serverPid: proc.pid,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
```

### Pipeline Step: Lighthouse

`packages/adapters/pagespeed/src/steps/lighthouse.ts`:

```typescript
import { z } from "zod";
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { PagespeedError, PagespeedScoresSchema, CoreWebVitalsSchema } from "../types.ts";
import { writeFile, mkdir } from "node:fs/promises";
import { createLogger, getEnv } from "@marketing-auto/shared";

const log = createLogger("pagespeed:lighthouse");

const InputSchema = z.object({
  serverUrl: z.string().url(),
  articleSlug: z.string(),
  workDir: z.string(),
});

const OutputSchema = z.object({
  scores: PagespeedScoresSchema,
  coreWebVitals: CoreWebVitalsSchema,
  reportPath: z.string(),
  testedUrl: z.string().url(),
});

export class LighthouseStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "lighthouse";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0; }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const env = getEnv();
    const baseUrl = input.serverUrl.replace(/\/$/, "");
    const testedUrl = `${baseUrl}/blog/${input.articleSlug}`;
    log.info({ testedUrl }, "Running Lighthouse");

    // Dynamic import of lighthouse — it's ESM-only and somewhat heavy
    const lighthouse = (await import("lighthouse")).default;
    const { launch } = await import("@puppeteer/browsers");
    const { computeExecutablePath, Browser } = await import("@puppeteer/browsers");
    const puppeteer = await import("puppeteer-core");

    const { homedir } = await import("node:os");
    const cacheDir = `${homedir()}/.cache/puppeteer`;
    const executablePath = computeExecutablePath({
      cacheDir,
      browser: Browser.CHROME,
      buildId: "stable",
    });

    const browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    try {
      const port = new URL(browser.wsEndpoint()).port;
      const result = await lighthouse(testedUrl, {
        port: Number(port),
        output: "json",
        logLevel: "error",
        // Use Lighthouse defaults for desktop emulation. Mobile is more demanding;
        // we use desktop because most KI-Wissensraum traffic is desktop. Add mobile
        // as separate step later if needed.
        formFactor: "desktop",
        screenEmulation: {
          mobile: false,
          width: 1350,
          height: 940,
          deviceScaleFactor: 1,
          disabled: false,
        },
        throttling: {
          rttMs: 40,
          throughputKbps: 10240,
          cpuSlowdownMultiplier: 1,
          requestLatencyMs: 0,
          downloadThroughputKbps: 0,
          uploadThroughputKbps: 0,
        },
      });

      if (!result?.lhr) {
        throw new PagespeedError("Lighthouse returned no result", "lighthouse");
      }

      const lhr = result.lhr;

      // Extract category scores (Lighthouse returns 0-1; we expose 0-100)
      const scores = {
        performance: Math.round((lhr.categories.performance?.score ?? 0) * 100),
        accessibility: Math.round((lhr.categories.accessibility?.score ?? 0) * 100),
        bestPractices: Math.round((lhr.categories["best-practices"]?.score ?? 0) * 100),
        seo: Math.round((lhr.categories.seo?.score ?? 0) * 100),
      };

      // Extract Core Web Vitals from audits
      const lcp = (lhr.audits["largest-contentful-paint"]?.numericValue ?? 0);
      const cls = (lhr.audits["cumulative-layout-shift"]?.numericValue ?? 0);
      // INP is not always present in Lighthouse lab data
      const inpAudit = lhr.audits["interaction-to-next-paint"];
      const inp = inpAudit?.numericValue ?? null;

      const coreWebVitals = { lcp, cls, inp };

      // Persist the full report JSON to disk
      await mkdir(input.workDir, { recursive: true });
      const reportPath = `${input.workDir}/lighthouse-report.json`;
      await writeFile(reportPath, typeof result.report === "string" ? result.report : JSON.stringify(result.report), "utf-8");

      log.info({ scores, coreWebVitals, reportPath }, "Lighthouse complete");

      return {
        scores,
        coreWebVitals,
        reportPath,
        testedUrl,
      };
    } finally {
      await browser.close();
    }
  }
}
```

### Pipeline Step: EvaluateAndPersist

`packages/adapters/pagespeed/src/steps/evaluate-and-persist.ts`:

```typescript
import { z } from "zod";
import { eq } from "drizzle-orm";
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { db, articles, pagespeedRuns } from "@marketing-auto/db";
import {
  PagespeedScoresSchema,
  CoreWebVitalsSchema,
  type PagespeedOutcome,
} from "../types.ts";

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  scores: PagespeedScoresSchema,
  coreWebVitals: CoreWebVitalsSchema,
  thresholds: PagespeedScoresSchema,
  reportPath: z.string(),
  testedUrl: z.string().url(),
  astroCommitSha: z.string(),
});

const OutputSchema = z.object({
  outcome: z.enum(["pass", "fail"]),
  failedThresholds: z.array(z.string()),
  pagespeedRunId: z.string().uuid(),
});

export class EvaluateAndPersistStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "evaluate-and-persist";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0; }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const failed: string[] = [];
    if (input.scores.performance < input.thresholds.performance) failed.push("performance");
    if (input.scores.accessibility < input.thresholds.accessibility) failed.push("accessibility");
    if (input.scores.bestPractices < input.thresholds.bestPractices) failed.push("bestPractices");
    if (input.scores.seo < input.thresholds.seo) failed.push("seo");

    const outcome: PagespeedOutcome = failed.length === 0 ? "pass" : "fail";
    const newStatus = outcome === "pass" ? "published" : "blocked_by_pagespeed";

    const now = new Date();

    await db.update(articles).set({
      status: newStatus,
      pagespeedValidatedAt: now,
      pagespeedScores: input.scores,
      pagespeedCoreWebVitals: input.coreWebVitals,
      pagespeedFailedThresholds: failed.length > 0 ? failed : null,
      pagespeedReportUrl: input.reportPath,
      pagespeedAstroCommitSha: input.astroCommitSha,
      updatedAt: now,
    }).where(eq(articles.id, input.articleId));

    const [run] = await db.insert(pagespeedRuns).values({
      projectId: input.projectId,
      articleId: input.articleId,
      pipelineRunId: ctx.pipelineRunId ?? null,
      status: "succeeded",
      outcome,
      scores: input.scores,
      coreWebVitals: input.coreWebVitals,
      thresholdsUsed: input.thresholds,
      failedCategories: failed.length > 0 ? failed : null,
      reportPath: input.reportPath,
      astroCommitSha: input.astroCommitSha,
      testedUrl: input.testedUrl,
      finishedAt: now,
    }).returning();

    return {
      outcome,
      failedThresholds: failed,
      pagespeedRunId: run!.id,
    };
  }
}
```

### Pipeline Definition

`packages/adapters/pagespeed/src/pipeline.ts`:

```typescript
import { z } from "zod";
import { Pipeline } from "@marketing-auto/pipelines/engine";
import { LoadArticleStep } from "./steps/load-article.ts";
import { CloneOrUpdateAstroRepoStep } from "./steps/clone-or-update.ts";
import { AstroBuildStep } from "./steps/astro-build.ts";
import { AstroPreviewServerStep } from "./steps/preview-server.ts";
import { LighthouseStep } from "./steps/lighthouse.ts";
import { EvaluateAndPersistStep } from "./steps/evaluate-and-persist.ts";

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
});

const OutputSchema = z.object({
  outcome: z.enum(["pass", "fail"]),
  failedThresholds: z.array(z.string()),
  pagespeedRunId: z.string().uuid(),
});

export class PageSpeedValidationPipeline extends Pipeline<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "article:pagespeed-validation";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;
  readonly steps = [
    new LoadArticleStep(),
    new CloneOrUpdateAstroRepoStep(),
    new AstroBuildStep(),
    new AstroPreviewServerStep(),
    new LighthouseStep(),
    new EvaluateAndPersistStep(),
  ] as const;

  /** Track the preview server PID so we can kill it in afterComplete/afterError. */
  private previewServerPid: number | null = null;

  override bridge(
    fromStep: { name: string },
    toStep: { name: string },
    output: unknown,
    pipelineInput: z.infer<typeof InputSchema>,
    getStepOutput: <T = unknown>(name: string) => T | undefined,
  ): unknown {
    if (fromStep.name === "load-article" && toStep.name === "clone-or-update") {
      const out = output as {
        astroRepo: { owner: string; name: string };
        article: { astroCommitSha: string };
        workDir: string;
      };
      return {
        workDir: out.workDir,
        astroRepoOwner: out.astroRepo.owner,
        astroRepoName: out.astroRepo.name,
        astroCommitSha: out.article.astroCommitSha,
      };
    }
    if (fromStep.name === "clone-or-update" && toStep.name === "astro-build") {
      return { repoPath: (output as { repoPath: string }).repoPath };
    }
    if (fromStep.name === "astro-build" && toStep.name === "preview-server") {
      const clone = getStepOutput<{ repoPath: string }>("clone-or-update")!;
      return { repoPath: clone.repoPath };
    }
    if (fromStep.name === "preview-server" && toStep.name === "lighthouse") {
      const out = output as { serverUrl: string; serverPid: number };
      this.previewServerPid = out.serverPid;
      const load = getStepOutput<{ article: { slug: string }; workDir: string }>("load-article")!;
      return {
        serverUrl: out.serverUrl,
        articleSlug: load.article.slug,
        workDir: load.workDir,
      };
    }
    if (fromStep.name === "lighthouse" && toStep.name === "evaluate-and-persist") {
      const out = output as {
        scores: unknown;
        coreWebVitals: unknown;
        reportPath: string;
        testedUrl: string;
      };
      const load = getStepOutput<{
        article: { id: string; astroCommitSha: string };
        thresholds: unknown;
      }>("load-article")!;
      return {
        articleId: load.article.id,
        projectId: pipelineInput.projectId,
        scores: out.scores,
        coreWebVitals: out.coreWebVitals,
        thresholds: load.thresholds,
        reportPath: out.reportPath,
        testedUrl: out.testedUrl,
        astroCommitSha: load.article.astroCommitSha,
      };
    }
    return output;
  }

  /**
   * Always-runs cleanup. Kills the preview server if still alive.
   * Per Spec 20 lesson #6: wrap in try-catch so cleanup failures don't retry the pipeline.
   */
  override async afterComplete(): Promise<void> {
    await this.killPreviewServer();
  }

  override async afterError(): Promise<void> {
    await this.killPreviewServer();
  }

  private async killPreviewServer(): Promise<void> {
    if (!this.previewServerPid) return;
    try {
      process.kill(this.previewServerPid, "SIGTERM");
      // Give it 2s to exit gracefully, then SIGKILL
      await new Promise((r) => setTimeout(r, 2000));
      try {
        process.kill(this.previewServerPid, "SIGKILL");
      } catch {
        // Process already exited, fine
      }
    } catch (e) {
      // PID no longer exists, nothing to do
    }
  }
}
```

### Service Layer (Web-App-Ready Trigger)

`packages/adapters/pagespeed/src/trigger.ts`:

```typescript
import { eq } from "drizzle-orm";
import { db, articles, pagespeedRuns } from "@marketing-auto/db";
import { enqueuePipeline } from "@marketing-auto/pipelines/engine";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("pagespeed:trigger");

export async function enqueueArticleValidation(input: {
  articleId: string;
  projectId: string;
}): Promise<{ pagespeedRunId: string; jobId: string }> {
  const [article] = await db.select().from(articles).where(eq(articles.id, input.articleId)).limit(1);
  if (!article) throw new Error(`Article ${input.articleId} not found`);

  if (article.status !== "ready_to_publish" && article.status !== "blocked_by_pagespeed") {
    throw new Error(
      `Article status is "${article.status}", expected "ready_to_publish" or "blocked_by_pagespeed"`,
    );
  }

  const [run] = await db.insert(pagespeedRuns).values({
    projectId: input.projectId,
    articleId: input.articleId,
    status: "pending",
  }).returning();

  // Transition article to validating
  await db.update(articles).set({
    status: "validating",
    updatedAt: new Date(),
  }).where(eq(articles.id, input.articleId));

  const { jobId } = await enqueuePipeline({
    pipelineName: "article:pagespeed-validation",
    projectId: input.projectId,
    input: { articleId: input.articleId, projectId: input.projectId },
    jobOptions: { jobId: `pagespeed-${input.articleId}` },
  });

  log.info({ articleId: input.articleId, runId: run!.id, jobId }, "PageSpeed validation enqueued");

  return { pagespeedRunId: run!.id, jobId };
}
```

### CLI Script

`apps/api/src/scripts/article/validate-pagespeed.ts`:

```typescript
#!/usr/bin/env bun
import { eq } from "drizzle-orm";
import { db, articles } from "@marketing-auto/db";
import { enqueueArticleValidation } from "@marketing-auto/adapter-pagespeed";

const slug = process.argv[2];
if (!slug) {
  console.error("Usage: bun ... article:validate-pagespeed <article-slug>");
  process.exit(1);
}

const all = await db.select({
  id: articles.id,
  projectId: articles.projectId,
  status: articles.status,
}).from(articles).where(eq(articles.slug, slug));

if (all.length === 0) {
  console.error(`No article found with slug "${slug}"`);
  process.exit(1);
}
const article = all[0]!;

if (article.status !== "ready_to_publish" && article.status !== "blocked_by_pagespeed") {
  console.error(
    `Article status "${article.status}" — needs "ready_to_publish" or "blocked_by_pagespeed"`,
  );
  process.exit(1);
}

const result = await enqueueArticleValidation({
  articleId: article.id,
  projectId: article.projectId,
});

console.log(`✅ PageSpeed validation enqueued
   Article ID: ${article.id}
   Run ID: ${result.pagespeedRunId}
   Job ID: ${result.jobId}

Pipeline runs ~2-5 min (clone + npm install + build + preview + lighthouse).
Check articles.pagespeed_scores and articles.status when complete.

Outcomes:
  - status = "published" → all thresholds passed
  - status = "blocked_by_pagespeed" → see articles.pagespeed_failed_thresholds`);
process.exit(0);
```

Add to `apps/api/package.json`:
```json
"article:validate-pagespeed": "bun --env-file ../../.env src/scripts/article/validate-pagespeed.ts"
```

### HTTP Endpoint Stub

In `apps/api/src/routes/articles.ts`:

```typescript
articleRoutes.post("/articles/:articleId/validate-pagespeed", async (c) => {
  const articleId = c.req.param("articleId");
  const [a] = await db.select({ projectId: articles.projectId }).from(articles).where(eq(articles.id, articleId)).limit(1);
  if (!a) return c.json({ error: "Article not found" }, 404);
  try {
    const result = await enqueueArticleValidation({ articleId, projectId: a.projectId });
    return c.json(result, 202);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
```

### Public API & CLAUDE.md

`packages/adapters/pagespeed/src/index.ts`:
```typescript
export { enqueueArticleValidation } from "./trigger.ts";
export { PageSpeedValidationPipeline } from "./pipeline.ts";
export { PagespeedError, type PagespeedScores, type CoreWebVitals } from "./types.ts";
```

`packages/adapters/pagespeed/CLAUDE.md`:

```markdown
# PageSpeed Validation Adapter

Local Astro build + Lighthouse CLI validation pipeline. Last quality gate before
articles transition to `published` status.

## Hard Rules

- Only validates articles in `ready_to_publish` or `blocked_by_pagespeed` status
- Runs Astro build locally — do NOT replace with Vercel/Cloudflare-API in MVP
- All work happens in `/tmp/marketing-auto/pagespeed/<projectSlug>/<runId>/`,
  cleaned up by OS or Marcel as needed
- Preview server PID is tracked on the pipeline instance and killed in afterComplete/afterError
- Lighthouse uses desktop emulation (KI-Wissensraum's primary audience). Mobile testing
  is a future enhancement.

## Required Setup

Before first run, install Chrome:
```bash
bun --filter @marketing-auto/adapter-pagespeed install-chrome
```

Marcel-machine prerequisites: Node.js 18+, git, ~150MB free space for Chrome.

## Performance Notes

- Cold run: ~3-5 min (git clone + npm install + astro build + lighthouse)
- Warm run (repo already cloned): ~1-2 min (git fetch + maybe partial install + build + lighthouse)
- Disk: ~200MB per project per run (cleared between runs is optional)

## Common Mistakes

- DO NOT skip the chrome install step on a fresh machine
- DO NOT validate an article that hasn't been synced via Spec 21 — `astroCommitSha` will be missing
- DO NOT run multiple validations in parallel against the same project — they share the workDir
  (could collide). Pipeline has no built-in lock; the BullMQ jobId dedup catches same-article retries.
- DO NOT manually kill the preview server during a run — the pipeline expects to own its lifecycle.
```

## Acceptance Criteria

### Schema & setup
- [ ] `articleStatusEnum` includes `validating` and `blocked_by_pagespeed`
- [ ] `articles` has all 7 new pagespeed columns
- [ ] `projects` has `pagespeedThresholds` with default values
- [ ] `pagespeed_runs` table exists, FK on project with `onDelete: "cascade"`
- [ ] `install-chrome` script downloads Chrome successfully on first run

### Pipeline
- [ ] LoadArticleStep refuses articles in wrong status
- [ ] LoadArticleStep refuses articles without `astroCommitSha`
- [ ] CloneOrUpdateAstroRepoStep clones if absent, fetches if present
- [ ] AstroBuildStep handles npm/pnpm/yarn projects (detection works)
- [ ] AstroPreviewServerStep extracts URL from stdout, returns PID
- [ ] LighthouseStep produces 4 scores (0-100) and 3 Core Web Vitals
- [ ] EvaluateAndPersistStep correctly compares scores vs thresholds
- [ ] On pass: article status = `published`
- [ ] On fail: article status = `blocked_by_pagespeed`, `pagespeedFailedThresholds` populated
- [ ] Preview server killed in afterComplete (verified via `ps aux | grep astro`)
- [ ] Preview server killed in afterError too

### CLI & HTTP
- [ ] `article:validate-pagespeed <slug>` enqueues, returns IDs
- [ ] HTTP endpoint returns 202 on success, 400 on bad state, 404 on missing article

### Errors
- [ ] Missing Chrome → clear error from LighthouseStep with hint to run install-chrome
- [ ] Astro build failure → error stage = "build", message includes stderr
- [ ] Preview server doesn't start within 30s → error stage = "preview"
- [ ] Lighthouse internal failure → error stage = "lighthouse"

## Testing Strategy

**Unit tests** (always run):
- Threshold-comparison logic in EvaluateAndPersistStep (mock scores, verify pass/fail)
- Package manager detection (`detectPackageManager`)

**Integration test** (gated by `RUN_LIVE_PAGESPEED=1`):
1. Use the ki-wissensraum-v2 test repo from Spec 21
2. Sync a test article via Spec 21 first
3. Run pagespeed validation
4. Assert: scores object populated, status transitioned correctly
5. Cleanup workDir
Cost: €0. Time: 2-5 min.

## Open Questions / Decisions Made

**Decision 1: Local build, not cloud preview.**
For MVP. Cloud preview (Vercel/Cloudflare-Preview-Deployment) and Google PageSpeed Insights API
move to backlog (see "Future Enhancements" below). Local is fast, free, and good enough for
quality gating.

**Decision 2: Desktop emulation default.**
KI-Wissensraum traffic is primarily desktop. Mobile is a future enhancement (additional
LighthouseStep variant, run as separate validation if `projects.pagespeedTestMobile` is true).

**Decision 3: NOT auto-triggered after Spec 21 sync.**
Marcel must manually run `article:validate-pagespeed` after sync. Reason: PageSpeed validation
takes 2-5 minutes and is heavyweight (npm install, build). Marcel may want to batch validations.
A future Spec 22.5 or Web App could add auto-trigger as a per-project setting.

**Decision 4: Thresholds in projects table, not project marketing context.**
Thresholds are technical, not editorial. They live in the DB schema, editable via SQL or future
project-settings UI.

**Decision 5: Save full Lighthouse JSON to disk, not DB.**
JSON reports are 200KB-2MB. DB rows would bloat. Disk path stored in `pagespeedReportUrl`.
Future enhancement (Spec 22.5 if useful): upload to R2 for cloud-accessible report viewing.

**Decision 6: Two new statuses (`validating`, `blocked_by_pagespeed`), not one.**
We could collapse them, but `validating` (in-progress) and `blocked_by_pagespeed` (failed,
needs Marcel intervention) are semantically different — one is transient, one is sticky.

**Decision 7: Re-validation allowed by re-running on `blocked_by_pagespeed`.**
Marcel can fix an issue (e.g., re-generate the article via Spec 20 with better outline,
re-sync via Spec 21), then re-run validation. The article re-enters `validating`, gets
re-tested. This is built into LoadArticleStep's status check.

**Decision 8: SIGTERM-then-SIGKILL pattern for preview server.**
Graceful first, force after 2s. Prevents zombie processes if Astro preview hangs.

**Decision 9: Lighthouse runs through Puppeteer, not chrome-launcher.**
Lighthouse supports both, but Puppeteer is more battle-tested in our context.
`puppeteer-core` + `@puppeteer/browsers` separates the package size from Chrome itself.

**Decision 10: No retry on Lighthouse internal failures.**
BullMQ's default retry-3-times policy applies. If Lighthouse legitimately fails 3x,
the network or Chrome is broken — Marcel needs to debug, not auto-retry endlessly.

## Future Enhancements (Backlog, Phase 4+)

These are explicitly NOT in Spec 22:

- **B: Cloud Preview** — Watch Astro CI/CD's webhook for the preview URL of each commit,
  Lighthouse against that URL. Real-CDN performance. Requires Vercel/Cloudflare integration
  per project. ~1-2 days to add as Spec 22.5 or in Web App phase.

- **C: Google PageSpeed Insights API** — After deployment, fire PageSpeed API on the
  production URL, store the field-data scores. Uses real-user CrUX data when available.
  Requires Google API key. ~½ day to add. Best for tracking long-term performance trends.

- **Mobile validation variant** — Same pipeline with mobile emulation, gated per-project.

- **Visual regression** — Screenshot diffs against last validated version. Catches CSS bugs.
  ~1 day, separate spec.

- **Auto-trigger after Spec 21 sync** — As project-level setting. Today: manual.

## Implementation Order

**Recommend 3 sessions.**

**Session 1: Schema + setup (~3-4h)**
1. Migration: enum extension, articles columns, projects column, pagespeed_runs table
2. Create package, types.ts, install Chrome script
3. Marcel runs `install-chrome` to verify ~150MB Chrome download
4. Commit: `feat(pagespeed): schema + chrome setup (spec 22)`

**Session 2: Pipeline steps (~4-5h)**
1. Implement LoadArticleStep, CloneOrUpdateAstroRepoStep, AstroBuildStep
2. Implement AstroPreviewServerStep (the trickiest — async stdout parsing)
3. Implement LighthouseStep
4. Implement EvaluateAndPersistStep
5. Wire pipeline with bridges + afterComplete/afterError
6. Commit: `feat(pagespeed): pipeline steps (spec 22)`

**Session 3: Trigger + CLI + HTTP + integration test (~3-4h)**
1. Implement service layer + trigger
2. CLI script
3. HTTP endpoint (extend articles.ts)
4. Manual end-to-end test on ki-wissensraum-v2 (one synced article)
5. Verify both pass and fail cases (artificially lower a threshold to force fail)
6. Commit: `feat(pagespeed): trigger + cli + integration test (spec 22)`

Total: 10-13 hours. Cost: €0.

## Splitting Plan

See "Implementation Order" — three sessions with `/clear` between.

## Discovered During Implementation

**Session 1 (Schema + Setup)**

- `pagespeedThresholds` on `projects` should be `notNull()` — the spec omitted it, but a nullable
  threshold column would let a bad UPDATE silently break `LoadArticleStep`'s `PagespeedScoresSchema.parse()`
  at runtime. `NOT NULL DEFAULT '{"performance":85,...}'::jsonb` is safe for existing rows.

**Session 2 (Pipeline Steps)**

- `Pipeline` base class had no `afterError` hook — only `afterComplete`. Added
  `afterError?(error, input): Promise<void>` to the base class and runner (same try-catch semantics
  as `afterComplete`) so pipelines with cleanup concerns don't have to invent workarounds.

- `AstroRepoConfigSchema` was not exported from `@marketing-auto/adapter-astro-sync`. Added it to
  that package's `index.ts` so `LoadArticleStep` can import it without reaching into internals.

- `--port 0` is NOT supported by Astro CLI for dynamic port binding. The spec proposed it to avoid
  port conflicts; in practice Astro ignores the flag and defaults to 4321. Used fixed port **14321**
  instead. Parallel validation runs against the same project would still collide — the BullMQ
  jobId dedup (`pagespeed-<articleId>`) prevents same-article simultaneous runs; true parallel
  multi-article validation is a known limitation deferred to Phase 4.

- `runCmd` helper in `clone-or-update.ts` takes a `stage: RunCmdStage` parameter (not in spec).
  The spec hardcoded `"clone"` as the error stage inside `runCmd`, which would misreport errors
  from `AstroBuildStep`. Making it configurable keeps error messages accurate without breaking
  the exported contract.

## Deviations

**`pagespeedThresholds` is `notNull()`** (spec had no `.notNull()`)
Added during code review. Migration is safe: existing rows receive the default automatically.

**Preview server uses fixed port 14321** (spec proposed `--port 0`)
Astro CLI does not support `--port 0` for dynamic OS-assigned ports. Fixed port avoids the
silent default-to-4321 behaviour. Documented in `packages/adapters/pagespeed/CLAUDE.md`.

**`runCmd` takes `stage` parameter** (spec hardcoded `"clone"`)
Avoids misleading `stage: "clone"` on build-phase errors. Purely additive — callers that
previously didn't need it just pass `stage: "build"` / `"clone"` etc.
