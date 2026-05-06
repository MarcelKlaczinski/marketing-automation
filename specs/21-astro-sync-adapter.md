# Spec 21: Astro Markdown Sync Adapter

**Phase:** 3 (Volume Production for KI-Wissensraum)
**Estimated Effort:** 2-3 days (split into 4 sessions)
**Dependencies:** Spec 01 (DB schema), Spec 02 (credential vault), Spec 05 (pipeline engine), Spec 12 (R2 — for hero image source URLs), Spec 20 (article pipeline — produces the articles this syncs)
**Status:** Ready for implementation
**Recommended Model:** Opus 4.7 (multi-system integration: Octokit + dynamic schema parsing + binary image handling)

---

## Goal

Build the **Astro Markdown Sync Adapter**: takes a `final_review` article from the DB and produces an `.mdx` file in the project's Astro repository, with the hero image downloaded as an Astro asset. The adapter commits and pushes directly to `main` via the GitHub App API.

**Architecture model**: DB is the source of truth. Astro is the static renderer. The `.mdx` file is generated content that should never be hand-edited — manual edits are overwritten on next sync. This is **Modell C** from the architecture discussion: clean separation, Astro stays 100% static, no runtime DB dependency.

**Scope decision (locked-in)**:
- **Blog collection only** for Spec 21
- **Glossar/Case-Studies/Tools** are deferred to a separate spec (~25-26 in backlog)
- The `articles.collection_type` column gets added with default `"blog"` (forward-compat for the future glossar pipeline)

After this spec, the workflow becomes:

```
1. Marcel reviews article in Drizzle Studio (final_review status)
2. Marcel runs `bun --filter @marketing-auto/api article:sync <slug>` (or via Web App later)
3. Spec 21 reads article from DB
4. Spec 21 reads project's Astro repo to discover the blog content collection schema (dynamic)
5. Spec 21 downloads hero image from R2, stages it as Astro asset
6. Spec 21 generates .mdx with valid frontmatter (matching the discovered schema)
7. Spec 21 commits .mdx + hero image + updates index in single GitHub commit
8. Article status transitions: final_review → ready_to_publish → published (after deployment)
9. Astro CI/CD picks up the commit, deploys site
```

## Why GitHub API and not local filesystem

Marcel chose GitHub App authentication. Reasoning:
- **Multi-tenant**: each Astro repo gets its own GitHub App installation, with its own access token. Permission per-repo, not global.
- **Future-proof**: when the marketing tool is hosted server-side (Phase 5+), there's no local filesystem with the Astro repo. GitHub API works the same.
- **Audit trail**: GitHub logs which app made what commit. Manual debugging is easier.
- **Better rate limits**: 15,000 requests/hour for GitHub Apps vs 5,000 for PATs.

The filesystem alternative was rejected as unnecessary local-only optimization.

## Non-Goals

- **No internal links**: Articles sync without internal cross-links. Spec 24+ adds a separate "rebuild internal links" pipeline that runs cluster-wide after each new sync.
- **No image variants**: Pipeline only produces a single hero image. Astro's `<Image>` component handles WebP/AVIF/responsive sizing at build time.
- **No pull requests / branches**: All commits go directly to `main`. Solo-dev workflow. PR-based syncing can be added in Spec 21.5 if needed for collaboration later.
- **No auto-trigger after `final_review`**: Pipeline does NOT auto-sync articles when they reach `final_review`. Marcel explicitly runs `article:sync <slug>` (or clicks a button in the future Web App). Auto-publish is risky.
- **No Glossar/Case-Studies/Tools collections**: Hardcoded `collection_type: "blog"` for now. Other collections need their own pipelines (different content shapes, different schemas).
- **No de-publish / unpublish**: This adapter only PUSHES content. Removing a published article is a manual git operation.
- **No PageSpeed validation**: That's Spec 22, runs after sync but before deployment.
- **No commit-message templating customization**: Format is fixed. If you want variable messages, edit the template constant.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                  ArticleSyncPipeline (BullMQ)                   │
│                                                                 │
│  ┌──────────────────┐    ┌──────────────────┐                  │
│  │ LoadArticleStep  │ →  │ ResolveSchemaStep│                  │
│  │ (DB read)        │    │ (read Astro repo │                  │
│  │                  │    │  content/config) │                  │
│  └──────────────────┘    └──────────────────┘                  │
│                                                                 │
│  ┌──────────────────┐    ┌──────────────────┐                  │
│  │ DownloadHeroStep │ →  │ RenderMdxStep    │                  │
│  │ (R2 → buffer)    │    │ (article + schema│                  │
│  │                  │    │  → .mdx + frontm.│                  │
│  └──────────────────┘    └──────────────────┘                  │
│                                                                 │
│  ┌──────────────────┐    ┌──────────────────┐                  │
│  │ CommitToGitHub   │ →  │ UpdateDbStatus   │                  │
│  │ (multi-file blob │    │ (ready_to_publish│                  │
│  │  + tree + commit)│    │  + commit_sha)   │                  │
│  └──────────────────┘    └──────────────────┘                  │
└─────────────────────────────────────────────────────────────────┘
```

## Detailed Implementation

### Schema additions

**Add to `articles` table** (extend `packages/db/src/schema/content.ts`):

```typescript
collectionType: text("collection_type").$type<"blog" | "glossar" | "case_study" | "tool">().notNull().default("blog"),

// Astro sync tracking
astroSyncedAt: timestamp("astro_synced_at"),
astroCommitSha: text("astro_commit_sha"),
astroPullRequestUrl: text("astro_pull_request_url"),  // null in direct-to-main mode; populated if PR mode used in future
astroAssetPaths: jsonb("astro_asset_paths").$type<{ heroImage?: string }>(),
astroFrontmatter: jsonb("astro_frontmatter").$type<Record<string, unknown>>(),  // exact frontmatter that was committed (for drift detection)
```

The status enum (added in Spec 20) already has `ready_to_publish` and `published` — no enum change needed.

**Add to `projects` table** (extend `packages/db/src/schema/projects.ts`):

```typescript
astroRepo: jsonb("astro_repo").$type<{
  owner: string;        // GitHub owner (e.g. "marcel-bauer")
  name: string;         // GitHub repo name (e.g. "ki-wissensraum-astro")
  installationId: number;  // GitHub App installation ID for this repo
  defaultBranch: string;   // e.g. "main"
  contentRoot: string;     // path within repo, e.g. "src/content"
  assetsRoot: string;      // path within repo, e.g. "src/assets"
}>().default(null),
```

`null` means the project hasn't been wired to an Astro repo yet — Spec 21 throws a clear error if someone tries to sync without this.

**New table** `astro_sync_runs` for audit (`packages/db/src/schema/operations.ts`):

```typescript
export const astroSyncRuns = pgTable("astro_sync_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  articleId: uuid("article_id").notNull(),  // plain UUID, no FK (avoids circular dep — same pattern as Spec 20)
  pipelineRunId: uuid("pipeline_run_id"),   // plain UUID, no FK

  status: text("status").$type<"pending" | "succeeded" | "failed">().notNull(),
  commitSha: text("commit_sha"),
  errorMessage: text("error_message"),
  errorStage: text("error_stage").$type<"load" | "schema" | "image" | "render" | "commit" | "db_update">(),

  filesCommitted: jsonb("files_committed").$type<string[]>(),  // paths within Astro repo
  bytesCommitted: integer("bytes_committed"),

  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
}, (table) => ({
  articleIdx: index("astro_sync_runs_article_idx").on(table.articleId),
  projectStatusIdx: index("astro_sync_runs_project_status_idx").on(table.projectId, table.status),
}));
```

Migration: this is multi-table changes plus `articles` enum-untouched. Per Spec 20's discovery #2 (drizzle-kit interactive issues), if `generate` doesn't run cleanly in a non-TTY context, write the migration SQL manually + append to `_journal.json`.

### Package Setup

`packages/adapters/astro-sync/package.json`:

```json
{
  "name": "@marketing-auto/adapter-astro-sync",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "cd ../../.. && bun test packages/adapters/astro-sync/test"
  },
  "dependencies": {
    "@marketing-auto/shared": "workspace:*",
    "@marketing-auto/db": "workspace:*",
    "@marketing-auto/cost-tracker": "workspace:*",
    "@octokit/app": "^15.1.0",
    "@octokit/auth-app": "^7.1.0",
    "octokit": "^4.0.0",
    "yaml": "^2.6.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "drizzle-orm": "^0.36.0"
  }
}
```

`tsconfig.json`: same pattern as other adapters (extend root, `noEmit: true`, `allowImportingTsExtensions: true`, no `types: ["bun"]`).

### GitHub App Setup (one-time, manual)

Spec 21 requires Marcel to set up a GitHub App **before** the adapter works. This is a one-time ~10-minute task in the GitHub UI.

`packages/adapters/astro-sync/SETUP-GITHUB-APP.md`:

```markdown
# GitHub App Setup for Astro Sync

This is a one-time setup. After completion, all your Astro repos can be synced through this single App.

## Step 1: Create the GitHub App

1. Go to https://github.com/settings/apps/new (for personal account) or 
   https://github.com/organizations/<org>/settings/apps/new (for organization)

2. Fill in:
   - **GitHub App name**: `Marketing Automation Sync` (or any unique name)
   - **Homepage URL**: `https://github.com/<your-username>` (placeholder)
   - **Webhook**: UNCHECK "Active" — we don't use webhooks
   - **Repository permissions**:
     - Contents: **Read and write** (required: commit files)
     - Metadata: **Read-only** (default, required by all apps)
     - Pull requests: **Read and write** (forward-compat for Spec 21.5)
   - **Account permissions**: leave all "No access"
   - **Where can this GitHub App be installed?**: "Only on this account"

3. Click "Create GitHub App"

## Step 2: Generate a private key

1. After creation, scroll down to "Private keys"
2. Click "Generate a private key"
3. A `.pem` file will download. Save it as `~/.config/marketing-auto/github-app.pem`
   (or any path you'll reference in `.env`)

## Step 3: Note the App ID

On the App settings page, copy the "App ID" (a 6-digit number near the top).

## Step 4: Install on your Astro repos

1. In the App settings, click "Install App" in the left sidebar
2. Click "Install" next to your account
3. Choose "Only select repositories"
4. Select your Astro repo(s): `ki-wissensraum-astro`, etc.
5. Click "Install"

## Step 5: Get installation IDs

For each Astro repo, you need its installation ID. Two ways:

**Easy way** (per repo):
```bash
# Run a one-time script after .env is configured (Step 6)
bun --filter @marketing-auto/adapter-astro-sync list-installations
```

This prints something like:
```
Installation 12345678 — repos: ki-wissensraum-astro
Installation 87654321 — repos: bellemann-astro
```

**Manual way**: visit `https://api.github.com/repos/<owner>/<repo>/installation` while authenticated as the GitHub App. Returns JSON with `id` field.

## Step 6: Configure environment

Add to `.env`:

```bash
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY_PATH=/Users/marcel/.config/marketing-auto/github-app.pem
```

Then for each project, set `projects.astro_repo` in the DB (via Drizzle Studio or a project-edit script) with the discovered installation ID.

## Verification

```bash
bun --filter @marketing-auto/adapter-astro-sync verify-app
```

Expected output: lists all installations and accessible repos. If you see your Astro repos, you're done.
```

### Environment configuration

`packages/shared/src/config.ts` adds:

```typescript
GITHUB_APP_ID: optionalStr(z.string().regex(/^\d+$/)),
GITHUB_APP_PRIVATE_KEY_PATH: optionalStr(z.string()),
```

Both optional — adapter throws clear error at runtime if used without them set.

### Types

`packages/adapters/astro-sync/src/types.ts`:

```typescript
import { z } from "zod";

// ───── Project Astro repo config ─────────────────────────────────────────────

export const AstroRepoConfigSchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
  installationId: z.number().int().positive(),
  defaultBranch: z.string().default("main"),
  contentRoot: z.string().default("src/content"),
  assetsRoot: z.string().default("src/assets"),
});
export type AstroRepoConfig = z.infer<typeof AstroRepoConfigSchema>;

// ───── Frontmatter discovered from Astro repo's content/config.ts ────────────

/**
 * Field type info derived from the Astro content collection schema.
 * Conservative: covers the field shapes we know how to populate.
 */
export const FrontmatterFieldSchema = z.object({
  name: z.string(),
  type: z.enum([
    "string", "number", "boolean", "date", "image",
    "string_array", "object", "unknown",
  ]),
  required: z.boolean(),
  hasDefault: z.boolean(),
});
export type FrontmatterField = z.infer<typeof FrontmatterFieldSchema>;

export const ContentCollectionInfoSchema = z.object({
  collectionName: z.literal("blog"),  // hardcoded for Spec 21
  fields: z.array(FrontmatterFieldSchema),
});
export type ContentCollectionInfo = z.infer<typeof ContentCollectionInfoSchema>;

// ───── Sync result ────────────────────────────────────────────────────────────

export type SyncResult = {
  articleId: string;
  commitSha: string;
  filesCommitted: string[];
  bytesCommitted: number;
  pullRequestUrl: string | null;  // null in direct-to-main mode
};

// ───── Errors ─────────────────────────────────────────────────────────────────

export class AstroSyncError extends Error {
  constructor(
    message: string,
    public readonly stage: "load" | "schema" | "image" | "render" | "commit" | "db_update" | "auth" | "config",
    public readonly originalCause?: unknown,
  ) {
    super(message);
    this.name = "AstroSyncError";
  }
}
```

Note: `originalCause` not `cause` — per Spec 12/13/14/20 lesson.

### GitHub App authentication

`packages/adapters/astro-sync/src/github-auth.ts`:

```typescript
import { App } from "octokit";
import { readFile } from "node:fs/promises";
import { getEnv, createLogger } from "@marketing-auto/shared";
import { AstroSyncError } from "./types.ts";

const log = createLogger("astro-sync:auth");

let _app: App | null = null;

export async function getGitHubApp(): Promise<App> {
  if (_app) return _app;

  const env = getEnv();
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY_PATH) {
    throw new AstroSyncError(
      "GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY_PATH must be set. " +
      "See packages/adapters/astro-sync/SETUP-GITHUB-APP.md",
      "auth",
    );
  }

  let privateKey: string;
  try {
    privateKey = await readFile(env.GITHUB_APP_PRIVATE_KEY_PATH, "utf-8");
  } catch (e) {
    throw new AstroSyncError(
      `Failed to read GitHub App private key from ${env.GITHUB_APP_PRIVATE_KEY_PATH}: ${e instanceof Error ? e.message : String(e)}`,
      "auth",
      e,
    );
  }

  _app = new App({
    appId: env.GITHUB_APP_ID,
    privateKey,
  });

  log.debug({ appId: env.GITHUB_APP_ID }, "GitHub App initialized");
  return _app;
}

/**
 * Returns an Octokit client authenticated as the installation for a specific repo.
 * Caches per installation ID to avoid re-issuing tokens for every call.
 */
const _installationCache = new Map<number, Awaited<ReturnType<App["getInstallationOctokit"]>>>();

export async function getInstallationOctokit(installationId: number) {
  if (_installationCache.has(installationId)) {
    return _installationCache.get(installationId)!;
  }
  const app = await getGitHubApp();
  const octokit = await app.getInstallationOctokit(installationId);
  _installationCache.set(installationId, octokit);
  return octokit;
}
```

### Helper scripts (one-time admin)

`packages/adapters/astro-sync/src/scripts/list-installations.ts`:

```typescript
#!/usr/bin/env bun
import { getGitHubApp } from "../github-auth.ts";

const app = await getGitHubApp();

console.log("Listing all installations of this GitHub App:\n");

for await (const { installation } of app.eachInstallation.iterator()) {
  const octokit = await app.getInstallationOctokit(installation.id);
  const { data: { repositories } } = await octokit.request(
    "GET /installation/repositories",
    { per_page: 100 },
  );

  const repoNames = repositories.map((r) => `${r.full_name}`).join(", ");
  console.log(
    `Installation ${installation.id}\n  Account: ${
      "login" in (installation.account ?? {})
        ? (installation.account as { login: string }).login
        : "?"
    }\n  Repos: ${repoNames}\n`,
  );
}

process.exit(0);
```

`packages/adapters/astro-sync/src/scripts/verify-app.ts`:

```typescript
#!/usr/bin/env bun
import { getGitHubApp } from "../github-auth.ts";

try {
  const app = await getGitHubApp();
  const { data } = await app.octokit.request("GET /app");
  console.log(`✅ GitHub App authenticated: ${data.slug} (id: ${data.id})`);
  console.log(`   Owner: ${data.owner?.login ?? "?"}`);
  console.log(`   Permissions: ${JSON.stringify(data.permissions)}`);
  process.exit(0);
} catch (e) {
  console.error(`❌ GitHub App auth failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
```

Add to `package.json`:
```json
"scripts": {
  ...
  "list-installations": "bun --env-file ../../../.env src/scripts/list-installations.ts",
  "verify-app": "bun --env-file ../../../.env src/scripts/verify-app.ts"
}
```

### Pipeline Step: LoadArticle

`packages/adapters/astro-sync/src/steps/load-article.ts`:

```typescript
import { z } from "zod";
import { eq } from "drizzle-orm";
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { db, articles, projects, clusters } from "@marketing-auto/db";
import { AstroSyncError, AstroRepoConfigSchema, type AstroRepoConfig } from "../types.ts";

const InputSchema = z.object({
  articleId: z.string().uuid(),
});

const OutputSchema = z.object({
  article: z.object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    slug: z.string(),
    title: z.string(),
    metaDescription: z.string(),
    bodyMd: z.string(),
    cornerstoneKeyword: z.string(),
    heroImagePublicUrl: z.string().url(),
    heroImageAltText: z.string(),
    schemaJsonLd: z.record(z.unknown()),
    collectionType: z.string(),
    wordCount: z.number(),
  }),
  cluster: z.object({
    name: z.string(),
    pillar: z.string(),
  }).nullable(),
  astroRepo: AstroRepoConfigSchema,
});

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
    if (!article) throw new AstroSyncError(`Article ${input.articleId} not found`, "load");

    if (article.status !== "final_review" && article.status !== "ready_to_publish") {
      throw new AstroSyncError(
        `Article status is "${article.status}", expected "final_review" or "ready_to_publish"`,
        "load",
      );
    }

    if (!article.bodyMd || !article.heroImagePublicUrl || !article.title) {
      throw new AstroSyncError(
        `Article missing required fields (bodyMd, heroImagePublicUrl, or title)`,
        "load",
      );
    }

    const [project] = await db.select().from(projects).where(eq(projects.id, article.projectId)).limit(1);
    if (!project) throw new AstroSyncError(`Project ${article.projectId} not found`, "load");

    if (!project.astroRepo) {
      throw new AstroSyncError(
        `Project "${project.slug}" has no astroRepo configured. Set projects.astro_repo first.`,
        "config",
      );
    }

    const astroRepo = AstroRepoConfigSchema.parse(project.astroRepo);

    let cluster: { name: string; pillar: string } | null = null;
    if (article.clusterId) {
      const [c] = await db.select().from(clusters).where(eq(clusters.id, article.clusterId)).limit(1);
      if (c) cluster = { name: c.name, pillar: c.pillar ?? "general" };
    }

    return {
      article: {
        id: article.id,
        projectId: article.projectId,
        slug: article.slug,
        title: article.title,
        metaDescription: article.metaDescription ?? "",
        bodyMd: article.bodyMd,
        cornerstoneKeyword: article.cornerstoneKeyword,
        heroImagePublicUrl: article.heroImagePublicUrl,
        heroImageAltText: article.heroImageAltText ?? article.title,
        schemaJsonLd: article.schemaJsonLd ?? {},
        collectionType: article.collectionType,
        wordCount: article.wordCount ?? article.bodyMd.split(/\s+/).length,
      },
      cluster,
      astroRepo,
    };
  }
}
```

### Pipeline Step: ResolveSchema (dynamic schema discovery)

This is the trickiest part. We need to read the Astro repo's `src/content/config.ts` and figure out what fields the `blog` collection accepts.

Two approaches:

**Approach 1 (chosen)**: Fetch the file via GitHub API, parse it as text, look for the schema definition. Use a conservative regex/AST-light approach to identify field names + types. We do NOT execute the TypeScript — that would require compiling Astro's whole content config (which depends on `astro:content` runtime).

**Approach 2 (rejected)**: Use a TypeScript Compiler API (ts.createSourceFile + AST walk). More robust but adds significant complexity. Worth doing only if Approach 1 fails on real-world configs.

For Spec 21, we ship Approach 1 with clear failure modes. If it can't parse a config, it falls back to a "permissive" mode that emits frontmatter for known-required fields + the project's `astroFrontmatterDefaults` (a JSON column on `projects` we'll add for overrides).

`packages/adapters/astro-sync/src/steps/resolve-schema.ts`:

```typescript
import { z } from "zod";
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { getInstallationOctokit } from "../github-auth.ts";
import {
  AstroSyncError,
  type AstroRepoConfig,
  type ContentCollectionInfo,
  type FrontmatterField,
} from "../types.ts";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("astro-sync:schema");

const InputSchema = z.object({
  astroRepo: z.unknown(),  // typed as AstroRepoConfig at call sites
});

const OutputSchema = z.object({
  collectionInfo: z.object({
    collectionName: z.literal("blog"),
    fields: z.array(z.object({
      name: z.string(),
      type: z.string(),
      required: z.boolean(),
      hasDefault: z.boolean(),
    })),
  }),
  configFileSha: z.string(),  // for cache invalidation later
});

export class ResolveSchemaStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "resolve-schema";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0; }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const repo = input.astroRepo as AstroRepoConfig;
    const octokit = await getInstallationOctokit(repo.installationId);

    // Fetch src/content/config.ts (or .mjs/.js)
    const configPaths = [
      `${repo.contentRoot}/config.ts`,
      `${repo.contentRoot}/config.mjs`,
      `${repo.contentRoot}/config.js`,
    ];

    let content: string | null = null;
    let sha: string | null = null;
    let foundPath: string | null = null;

    for (const path of configPaths) {
      try {
        const res = await octokit.request(
          "GET /repos/{owner}/{repo}/contents/{path}",
          { owner: repo.owner, repo: repo.name, path, ref: repo.defaultBranch },
        );
        if (Array.isArray(res.data)) continue;  // it's a directory
        if (res.data.type !== "file" || !res.data.content) continue;

        content = Buffer.from(res.data.content, "base64").toString("utf-8");
        sha = res.data.sha;
        foundPath = path;
        break;
      } catch (e) {
        // 404 — try next path
        const err = e as { status?: number };
        if (err.status !== 404) throw new AstroSyncError(`Failed to fetch ${path}`, "schema", e);
      }
    }

    if (!content || !sha || !foundPath) {
      throw new AstroSyncError(
        `Could not find Astro content config in ${repo.contentRoot}/. Tried: ${configPaths.join(", ")}`,
        "schema",
      );
    }

    log.debug({ foundPath, contentLength: content.length }, "Astro content config loaded");

    const fields = parseBlogSchema(content);

    return {
      collectionInfo: {
        collectionName: "blog" as const,
        fields,
      },
      configFileSha: sha,
    };
  }
}

/**
 * Conservative TypeScript-string parser for Astro content collection schemas.
 *
 * Looks for a `defineCollection({ schema: ... })` call where the schema is `z.object({ ... })`,
 * extracts top-level field names + types.
 *
 * Limitations (acceptable for Spec 21):
 * - Doesn't support nested schemas
 * - Doesn't fully understand z.union, z.discriminatedUnion, z.intersection
 * - Falls back to "unknown" type for fields it can't classify
 *
 * Robust enough for typical Astro blog schemas. If a project has more complex schemas,
 * the renderer is permissive: unknown fields just don't get populated.
 */
export function parseBlogSchema(configSource: string): FrontmatterField[] {
  // Locate the blog collection definition
  // Heuristic: look for `blog` or `blog:` or similar identifier near defineCollection
  // Try multiple patterns conservatively

  const blogCollectionMatch = configSource.match(
    /(?:const|let|var)\s+blog\s*=\s*defineCollection\s*\(\s*\{[\s\S]*?schema\s*:\s*([^{]+|\([^)]*\)\s*=>\s*)z\.object\s*\(\s*\{([\s\S]*?)\}\s*\)/,
  );

  let schemaBody: string | null = null;
  if (blogCollectionMatch) {
    schemaBody = blogCollectionMatch[2] ?? null;
  } else {
    // Fallback: scan for any `z.object({ ... })` that follows a "blog" reference
    const blogRefIdx = configSource.indexOf("blog");
    if (blogRefIdx >= 0) {
      const afterBlog = configSource.slice(blogRefIdx);
      const objMatch = afterBlog.match(/z\.object\s*\(\s*\{([\s\S]*?)\}\s*\)/);
      if (objMatch) schemaBody = objMatch[1] ?? null;
    }
  }

  if (!schemaBody) {
    log.warn("Could not parse blog schema; will use permissive frontmatter rendering");
    return [];
  }

  const fields: FrontmatterField[] = [];

  // Match field definitions: `fieldName: z.type()...` or `fieldName: z.type().optional()` etc.
  // Comments and whitespace are tolerated.
  const fieldRegex = /(?:^|,)\s*([a-zA-Z_$][\w$]*)\s*:\s*([^,\n]+(?:\([^)]*\)[^,\n]*)*)/g;
  let m: RegExpExecArray | null;

  while ((m = fieldRegex.exec(schemaBody)) !== null) {
    const name = m[1]!;
    const definition = m[2]!;
    fields.push(classifyField(name, definition));
  }

  return fields;
}

function classifyField(name: string, definition: string): FrontmatterField {
  const isOptional = /\.optional\(\)/.test(definition);
  const hasDefault = /\.default\(/.test(definition);
  const isNullable = /\.nullable\(\)/.test(definition);

  let type: FrontmatterField["type"] = "unknown";
  if (/z\.string\(\)/.test(definition)) type = "string";
  else if (/z\.number\(\)/.test(definition)) type = "number";
  else if (/z\.boolean\(\)/.test(definition)) type = "boolean";
  else if (/z\.date\(\)/.test(definition)) type = "date";
  else if (/^image\(\)/.test(definition.trim()) || /\bimage\(\)/.test(definition)) type = "image";
  else if (/z\.array\s*\(\s*z\.string\(\)\s*\)/.test(definition)) type = "string_array";
  else if (/z\.object\(/.test(definition)) type = "object";

  return {
    name,
    type,
    required: !isOptional && !isNullable && !hasDefault,
    hasDefault,
  };
}
```

The regex parser is **best-effort**. For unusual configs, the renderer (next step) populates the fields it knows + emits warnings for unknown required fields. Marcel can either fix the schema parser or set `astroFrontmatterDefaults` in `projects` to provide manual values.

### Pipeline Step: DownloadHero

`packages/adapters/astro-sync/src/steps/download-hero.ts`:

```typescript
import { z } from "zod";
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { AstroSyncError } from "../types.ts";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("astro-sync:hero");

const InputSchema = z.object({
  heroImagePublicUrl: z.string().url(),
  articleSlug: z.string(),
});

const OutputSchema = z.object({
  /** Base64-encoded image bytes (for GitHub API commit). */
  base64: z.string(),
  /** Path within Astro repo, e.g. "src/assets/articles/<slug>/hero.png". */
  astroAssetPath: z.string(),
  bytes: z.number(),
  contentType: z.string(),
});

export class DownloadHeroStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "download-hero";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0; }  // R2 egress is free with us as customer

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    log.debug({ url: input.heroImagePublicUrl }, "Downloading hero image");

    const res = await fetch(input.heroImagePublicUrl);
    if (!res.ok) {
      throw new AstroSyncError(
        `Failed to download hero image: HTTP ${res.status}`,
        "image",
      );
    }

    const contentType = res.headers.get("content-type") ?? "image/png";
    const ext = guessExtension(contentType);
    const buffer = Buffer.from(await res.arrayBuffer());
    const base64 = buffer.toString("base64");

    // Astro asset convention: src/assets/articles/<slug>/hero.<ext>
    // assetsRoot is "src/assets" by default — combined with sub-path for sanity
    const astroAssetPath = `src/assets/articles/${input.articleSlug}/hero.${ext}`;

    log.info({ bytes: buffer.length, astroAssetPath }, "Hero image downloaded");

    return {
      base64,
      astroAssetPath,
      bytes: buffer.length,
      contentType,
    };
  }
}

function guessExtension(contentType: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/avif": "avif",
    "image/gif": "gif",
  };
  return map[contentType.toLowerCase()] ?? "png";
}
```

### Pipeline Step: RenderMdx

`packages/adapters/astro-sync/src/steps/render-mdx.ts`:

```typescript
import { z } from "zod";
import yaml from "yaml";
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { AstroSyncError, type ContentCollectionInfo, type FrontmatterField } from "../types.ts";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("astro-sync:render");

const InputSchema = z.object({
  article: z.object({
    title: z.string(),
    slug: z.string(),
    metaDescription: z.string(),
    bodyMd: z.string(),
    cornerstoneKeyword: z.string(),
    heroImageAltText: z.string(),
    schemaJsonLd: z.record(z.unknown()),
    wordCount: z.number(),
  }),
  cluster: z.object({
    name: z.string(),
    pillar: z.string(),
  }).nullable(),
  collectionInfo: z.object({
    collectionName: z.literal("blog"),
    fields: z.array(z.object({
      name: z.string(),
      type: z.string(),
      required: z.boolean(),
      hasDefault: z.boolean(),
    })),
  }),
  heroAstroAssetPath: z.string(),
  astroRepoRoot: z.string(),  // contentRoot, e.g. "src/content"
});

const OutputSchema = z.object({
  /** Path within Astro repo, e.g. "src/content/blog/<slug>.mdx". */
  mdxPath: z.string(),
  /** Full file content (frontmatter + body). */
  mdxContent: z.string(),
  /** The frontmatter object (as committed) — saved to articles.astroFrontmatter for drift detection. */
  frontmatter: z.record(z.unknown()),
  /** Names of required schema fields we couldn't populate — surfaced to the user as warnings. */
  unpopulatedRequired: z.array(z.string()),
});

const AUTO_GENERATED_HEADER = `<!--
  ⚠️  AUTO-GENERATED by Marketing Automation Platform.
      Source of truth: DB articles table.
      Manual edits will be overwritten on the next sync.
-->`;

export class RenderMdxStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "render-mdx";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0; }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const fm = buildFrontmatter(input);
    const unpopulatedRequired = input.collectionInfo.fields
      .filter((f) => f.required && !(f.name in fm))
      .map((f) => f.name);

    if (unpopulatedRequired.length > 0) {
      log.warn(
        { unpopulatedRequired },
        "Could not populate some required schema fields. " +
        "Astro build may fail. Add values via projects.astroFrontmatterDefaults.",
      );
    }

    // Convert frontmatter to YAML
    // For "image" type fields, Astro expects relative file paths from src/content/<collection>/<file>.mdx
    // to the asset. Compute that here.
    const mdxPath = `${input.astroRepoRoot}/blog/${input.article.slug}.mdx`;
    const fmWithImagePaths = transformImageFields(
      fm,
      input.collectionInfo.fields,
      mdxPath,
      input.heroAstroAssetPath,
    );

    const yamlBody = yaml.stringify(fmWithImagePaths, {
      lineWidth: -1,         // no line wrapping
      defaultStringType: "QUOTE_DOUBLE",
    }).trimEnd();

    const fullContent = [
      "---",
      yamlBody,
      "---",
      "",
      AUTO_GENERATED_HEADER,
      "",
      input.article.bodyMd.trim(),
      "",
    ].join("\n");

    return {
      mdxPath,
      mdxContent: fullContent,
      frontmatter: fmWithImagePaths,
      unpopulatedRequired,
    };
  }
}

/**
 * Build frontmatter object based on what fields the Astro schema expects.
 * Populates known fields from the article, leaves unknown/non-required out.
 */
function buildFrontmatter(input: z.infer<typeof InputSchema>): Record<string, unknown> {
  const fm: Record<string, unknown> = {};
  const known: Record<string, unknown> = {
    title: input.article.title,
    description: input.article.metaDescription,
    slug: input.article.slug,
    publishDate: new Date().toISOString().split("T")[0],
    publishedAt: new Date().toISOString().split("T")[0],
    pubDate: new Date().toISOString().split("T")[0],   // common Astro convention
    updatedDate: new Date().toISOString().split("T")[0],
    heroImage: "<placeholder — replaced below>",
    heroImageAlt: input.article.heroImageAltText,
    cluster: input.cluster?.name ?? "",
    pillar: input.cluster?.pillar ?? "",
    cornerstoneKeyword: input.article.cornerstoneKeyword,
    wordCount: input.article.wordCount,
    schema: input.article.schemaJsonLd,
    schemaJsonLd: input.article.schemaJsonLd,
    tags: [] as string[],
    draft: false,
  };

  // Populate fields that exist in the discovered schema
  for (const field of input.collectionInfo.fields) {
    if (field.name in known) {
      fm[field.name] = known[field.name];
    }
  }

  // If we couldn't parse the schema (empty fields array), populate everything we know.
  // Astro will reject extras only if collection has `strict: true`, which is uncommon.
  if (input.collectionInfo.fields.length === 0) {
    log.warn("Schema parse returned no fields; emitting permissive frontmatter");
    return known;
  }

  return fm;
}

/**
 * For schema fields of type "image", Astro expects a path relative to the .mdx file.
 * Compute the relative path from the .mdx to the asset.
 */
function transformImageFields(
  fm: Record<string, unknown>,
  fields: FrontmatterField[],
  mdxPath: string,
  assetPath: string,
): Record<string, unknown> {
  const out = { ...fm };
  const imageFieldNames = new Set(
    fields.filter((f) => f.type === "image").map((f) => f.name),
  );

  // Common heroImage names to default to image-relative-path if schema didn't tell us
  const heroImageCandidates = ["heroImage", "hero_image", "image", "cover"];
  if (imageFieldNames.size === 0) {
    // No image-type fields detected — but if heroImage is present, treat it as an image
    for (const candidate of heroImageCandidates) {
      if (candidate in out) imageFieldNames.add(candidate);
    }
  }

  if (imageFieldNames.size === 0) return out;

  const relPath = computeRelative(mdxPath, assetPath);

  for (const name of imageFieldNames) {
    if (name in out) {
      out[name] = relPath;  // e.g. "../../assets/articles/<slug>/hero.png"
    }
  }

  return out;
}

function computeRelative(fromFile: string, toFile: string): string {
  const fromParts = fromFile.split("/").slice(0, -1);  // dir of from
  const toParts = toFile.split("/");
  let i = 0;
  while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) i++;
  const upCount = fromParts.length - i;
  const ups = upCount === 0 ? "./" : "../".repeat(upCount);
  return ups + toParts.slice(i).join("/");
}
```

### Pipeline Step: CommitToGitHub

This is the most complex step. To commit multiple files (mdx + image) atomically, we use GitHub's git-data API: create blobs → create tree → create commit → update ref.

`packages/adapters/astro-sync/src/steps/commit-to-github.ts`:

```typescript
import { z } from "zod";
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { getInstallationOctokit } from "../github-auth.ts";
import { AstroSyncError, type AstroRepoConfig } from "../types.ts";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("astro-sync:commit");

const InputSchema = z.object({
  astroRepo: z.unknown(),
  files: z.array(z.object({
    path: z.string(),
    /** Either text content or base64-encoded binary. */
    contentType: z.enum(["text", "base64"]),
    content: z.string(),
  })),
  commitMessage: z.string(),
});

const OutputSchema = z.object({
  commitSha: z.string(),
  commitUrl: z.string().url(),
  filesCommitted: z.array(z.string()),
  bytesCommitted: z.number(),
});

export class CommitToGitHubStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "commit-to-github";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0; }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const repo = input.astroRepo as AstroRepoConfig;
    const octokit = await getInstallationOctokit(repo.installationId);
    const { owner, name: repoName, defaultBranch } = repo;

    // 1. Get current ref (SHA of main branch tip)
    const { data: ref } = await octokit.request(
      "GET /repos/{owner}/{repo}/git/ref/{ref}",
      { owner, repo: repoName, ref: `heads/${defaultBranch}` },
    );
    const baseCommitSha = ref.object.sha;

    // 2. Get the base tree SHA
    const { data: baseCommit } = await octokit.request(
      "GET /repos/{owner}/{repo}/git/commits/{commit_sha}",
      { owner, repo: repoName, commit_sha: baseCommitSha },
    );
    const baseTreeSha = baseCommit.tree.sha;

    // 3. Create blobs for each file
    log.debug({ count: input.files.length }, "Creating blobs");
    const blobs = await Promise.all(
      input.files.map(async (file) => {
        const { data } = await octokit.request(
          "POST /repos/{owner}/{repo}/git/blobs",
          {
            owner, repo: repoName,
            content: file.content,
            encoding: file.contentType === "text" ? "utf-8" : "base64",
          },
        );
        return { path: file.path, sha: data.sha, size: data.size ?? 0 };
      }),
    );

    // 4. Create tree (all files at given paths, mode 100644 = normal file)
    const { data: tree } = await octokit.request(
      "POST /repos/{owner}/{repo}/git/trees",
      {
        owner, repo: repoName,
        base_tree: baseTreeSha,
        tree: blobs.map((b) => ({
          path: b.path,
          mode: "100644" as const,
          type: "blob" as const,
          sha: b.sha,
        })),
      },
    );

    // 5. Create commit
    const { data: newCommit } = await octokit.request(
      "POST /repos/{owner}/{repo}/git/commits",
      {
        owner, repo: repoName,
        message: input.commitMessage,
        tree: tree.sha,
        parents: [baseCommitSha],
      },
    );

    // 6. Update ref to point at new commit
    await octokit.request(
      "PATCH /repos/{owner}/{repo}/git/refs/{ref}",
      {
        owner, repo: repoName,
        ref: `heads/${defaultBranch}`,
        sha: newCommit.sha,
        force: false,
      },
    );

    const bytesCommitted = blobs.reduce((sum, b) => sum + b.size, 0);
    const commitUrl = `https://github.com/${owner}/${repoName}/commit/${newCommit.sha}`;

    log.info({
      commitSha: newCommit.sha,
      filesCommitted: input.files.length,
      bytesCommitted,
    }, "Astro repo commit successful");

    return {
      commitSha: newCommit.sha,
      commitUrl,
      filesCommitted: input.files.map((f) => f.path),
      bytesCommitted,
    };
  }
}
```

### Pipeline Step: UpdateDbStatus

`packages/adapters/astro-sync/src/steps/update-db-status.ts`:

```typescript
import { z } from "zod";
import { eq } from "drizzle-orm";
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { db, articles, astroSyncRuns } from "@marketing-auto/db";

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  commitSha: z.string(),
  filesCommitted: z.array(z.string()),
  bytesCommitted: z.number(),
  frontmatter: z.record(z.unknown()),
  heroAstroAssetPath: z.string(),
});

const OutputSchema = z.object({
  articleId: z.string().uuid(),
  syncRunId: z.string().uuid(),
});

export class UpdateDbStatusStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "update-db-status";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0; }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const now = new Date();

    await db.update(articles).set({
      status: "ready_to_publish",
      astroSyncedAt: now,
      astroCommitSha: input.commitSha,
      astroFrontmatter: input.frontmatter,
      astroAssetPaths: { heroImage: input.heroAstroAssetPath },
      updatedAt: now,
    }).where(eq(articles.id, input.articleId));

    const [syncRun] = await db.insert(astroSyncRuns).values({
      projectId: input.projectId,
      articleId: input.articleId,
      pipelineRunId: ctx.pipelineRunId ?? null,
      status: "succeeded",
      commitSha: input.commitSha,
      filesCommitted: input.filesCommitted,
      bytesCommitted: input.bytesCommitted,
      finishedAt: now,
    }).returning();

    return {
      articleId: input.articleId,
      syncRunId: syncRun!.id,
    };
  }
}
```

### Pipeline Definition

`packages/adapters/astro-sync/src/pipeline.ts`:

```typescript
import { z } from "zod";
import { Pipeline } from "@marketing-auto/pipelines/engine";
import { LoadArticleStep } from "./steps/load-article.ts";
import { ResolveSchemaStep } from "./steps/resolve-schema.ts";
import { DownloadHeroStep } from "./steps/download-hero.ts";
import { RenderMdxStep } from "./steps/render-mdx.ts";
import { CommitToGitHubStep } from "./steps/commit-to-github.ts";
import { UpdateDbStatusStep } from "./steps/update-db-status.ts";

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
});

const OutputSchema = z.object({
  articleId: z.string().uuid(),
  syncRunId: z.string().uuid(),
});

export class ArticleSyncPipeline extends Pipeline<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "article:astro-sync";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;
  readonly steps = [
    new LoadArticleStep(),
    new ResolveSchemaStep(),
    new DownloadHeroStep(),
    new RenderMdxStep(),
    new CommitToGitHubStep(),
    new UpdateDbStatusStep(),
  ] as const;

  override bridge(
    fromStep: { name: string },
    toStep: { name: string },
    output: unknown,
    pipelineInput: z.infer<typeof InputSchema>,
    getStepOutput: <T = unknown>(name: string) => T | undefined,
  ): unknown {
    if (fromStep.name === "load-article" && toStep.name === "resolve-schema") {
      const out = output as { astroRepo: unknown };
      return { astroRepo: out.astroRepo };
    }
    if (fromStep.name === "resolve-schema" && toStep.name === "download-hero") {
      const load = getStepOutput<{ article: { heroImagePublicUrl: string; slug: string } }>("load-article")!;
      return {
        heroImagePublicUrl: load.article.heroImagePublicUrl,
        articleSlug: load.article.slug,
      };
    }
    if (fromStep.name === "download-hero" && toStep.name === "render-mdx") {
      const load = getStepOutput<{ article: unknown; cluster: unknown; astroRepo: { contentRoot: string } }>("load-article")!;
      const schema = getStepOutput<{ collectionInfo: unknown }>("resolve-schema")!;
      const hero = output as { astroAssetPath: string };
      return {
        article: load.article,
        cluster: load.cluster,
        collectionInfo: schema.collectionInfo,
        heroAstroAssetPath: hero.astroAssetPath,
        astroRepoRoot: load.astroRepo.contentRoot,
      };
    }
    if (fromStep.name === "render-mdx" && toStep.name === "commit-to-github") {
      const load = getStepOutput<{ article: { title: string; slug: string; cornerstoneKeyword: string }; astroRepo: unknown }>("load-article")!;
      const hero = getStepOutput<{ base64: string; astroAssetPath: string }>("download-hero")!;
      const render = output as { mdxPath: string; mdxContent: string };
      return {
        astroRepo: load.astroRepo,
        files: [
          { path: render.mdxPath, contentType: "text" as const, content: render.mdxContent },
          { path: hero.astroAssetPath, contentType: "base64" as const, content: hero.base64 },
        ],
        commitMessage:
          `feat(blog): publish "${load.article.title}"\n\n` +
          `Auto-generated from Marketing Automation Platform.\n` +
          `Cornerstone keyword: ${load.article.cornerstoneKeyword}\n` +
          `Article slug: ${load.article.slug}`,
      };
    }
    if (fromStep.name === "commit-to-github" && toStep.name === "update-db-status") {
      const load = getStepOutput<{ article: { id: string }; astroRepo: unknown }>("load-article")!;
      const render = getStepOutput<{ frontmatter: Record<string, unknown> }>("render-mdx")!;
      const hero = getStepOutput<{ astroAssetPath: string }>("download-hero")!;
      const commit = output as { commitSha: string; filesCommitted: string[]; bytesCommitted: number };
      return {
        articleId: load.article.id,
        projectId: pipelineInput.projectId,
        commitSha: commit.commitSha,
        filesCommitted: commit.filesCommitted,
        bytesCommitted: commit.bytesCommitted,
        frontmatter: render.frontmatter,
        heroAstroAssetPath: hero.astroAssetPath,
      };
    }
    return output;
  }
}
```

### Service Layer (Web-App-Ready Trigger)

`packages/adapters/astro-sync/src/trigger.ts`:

```typescript
import { eq } from "drizzle-orm";
import { db, articles, astroSyncRuns } from "@marketing-auto/db";
import { enqueuePipeline } from "@marketing-auto/pipelines/engine";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("astro-sync:trigger");

export async function enqueueArticleSync(input: {
  articleId: string;
  projectId: string;
}): Promise<{ syncRunId: string; jobId: string }> {
  const [article] = await db.select().from(articles).where(eq(articles.id, input.articleId)).limit(1);
  if (!article) throw new Error(`Article ${input.articleId} not found`);

  if (article.status !== "final_review" && article.status !== "ready_to_publish") {
    throw new Error(
      `Article status is "${article.status}", expected "final_review" or "ready_to_publish"`,
    );
  }

  // Create the pending sync_run row immediately so it's visible while pipeline runs
  const [syncRun] = await db.insert(astroSyncRuns).values({
    projectId: input.projectId,
    articleId: input.articleId,
    status: "pending",
  }).returning();

  const jobId = await enqueuePipeline({
    pipelineName: "article:astro-sync",
    projectId: input.projectId,
    input: { articleId: input.articleId, projectId: input.projectId },
    jobOptions: { jobName: `astro-sync-${input.articleId}` },
  });

  log.info({ articleId: input.articleId, syncRunId: syncRun!.id, jobId }, "Astro sync enqueued");

  return { syncRunId: syncRun!.id, jobId };
}
```

### CLI Script

`apps/api/src/scripts/article/sync.ts`:

```typescript
#!/usr/bin/env bun
import { eq, and } from "drizzle-orm";
import { db, articles, projects } from "@marketing-auto/db";
import { enqueueArticleSync } from "@marketing-auto/adapter-astro-sync";

const slug = process.argv[2];
if (!slug) {
  console.error("Usage: bun ... article:sync <article-slug>");
  process.exit(1);
}

// Find article by slug (regardless of project)
const all = await db.select({
  id: articles.id,
  projectId: articles.projectId,
  status: articles.status,
}).from(articles).where(eq(articles.slug, slug));

if (all.length === 0) {
  console.error(`No article found with slug "${slug}"`);
  process.exit(1);
}
if (all.length > 1) {
  console.error(`Multiple articles share slug "${slug}". Specify a project.`);
  process.exit(1);
}

const article = all[0]!;

if (article.status !== "final_review" && article.status !== "ready_to_publish") {
  console.error(
    `Article status is "${article.status}". Sync requires "final_review" or "ready_to_publish".`,
  );
  process.exit(1);
}

const result = await enqueueArticleSync({
  articleId: article.id,
  projectId: article.projectId,
});

console.log(`✅ Astro sync enqueued
   Article ID: ${article.id}
   Sync run ID: ${result.syncRunId}
   Job ID: ${result.jobId}

Pipeline will commit to Astro repo's main branch in ~10-30 seconds.
Check astroSyncRuns table or article.astro_commit_sha for completion.`);
process.exit(0);
```

Add to `apps/api/package.json`:
```json
"scripts": {
  ...
  "article:sync": "bun --env-file ../../.env src/scripts/article/sync.ts"
}
```

### HTTP Endpoint Stub

`apps/api/src/routes/articles.ts` (extend existing from Spec 20):

```typescript
articleRoutes.post("/articles/:articleId/sync", async (c) => {
  const articleId = c.req.param("articleId");
  const [a] = await db.select({ projectId: articles.projectId }).from(articles).where(eq(articles.id, articleId)).limit(1);
  if (!a) return c.json({ error: "Article not found" }, 404);

  try {
    const result = await enqueueArticleSync({ articleId, projectId: a.projectId });
    return c.json(result, 202);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
```

### Public API & Index

`packages/adapters/astro-sync/src/index.ts`:

```typescript
export { enqueueArticleSync } from "./trigger.ts";
export { ArticleSyncPipeline } from "./pipeline.ts";
export { AstroSyncError, type AstroRepoConfig, type SyncResult } from "./types.ts";

// For direct testing of utilities
export { parseBlogSchema } from "./steps/resolve-schema.ts";
```

### CLAUDE.md

`packages/adapters/astro-sync/CLAUDE.md`:

```markdown
# Astro Markdown Sync Adapter

Pushes a final_review article from the DB to its project's Astro repository as an `.mdx` file
plus a hero image asset. Commits directly to main via the GitHub App API.

## Hard Rules

- This adapter is the ONLY writer to Astro repos for blog content. Manual edits to generated
  `.mdx` files are silently overwritten on the next sync.
- Each sync is one atomic GitHub commit (.mdx + image + any future siblings).
- Always commits directly to main. PR-mode is reserved for Spec 21.5.
- Schema parsing is best-effort. If the Astro repo's content config is unparseable,
  the adapter emits permissive frontmatter (everything we know) and warns about unpopulated
  required fields. Marcel must either fix the regex parser or use astroFrontmatterDefaults.
- Hardcoded `collection: "blog"`. Other collections (Glossar, Case-Studies, Tools) need
  separate adapter pipelines.

## Required Environment

- `GITHUB_APP_ID` — App ID from GitHub App settings
- `GITHUB_APP_PRIVATE_KEY_PATH` — path to .pem file

See `SETUP-GITHUB-APP.md` in this package for one-time setup steps.

## Required Per-Project Configuration

Each project that wants to sync needs `projects.astro_repo`:
```json
{
  "owner": "marcel-bauer",
  "name": "ki-wissensraum-astro",
  "installationId": 12345678,
  "defaultBranch": "main",
  "contentRoot": "src/content",
  "assetsRoot": "src/assets"
}
```

The installation ID comes from running `bun --filter @marketing-auto/adapter-astro-sync list-installations`.

## Common Mistakes

- DO NOT commit when `articles.status !== "final_review"` — adapter throws
- DO NOT manually edit a generated `.mdx`. The auto-generated header is your warning sign
- DO NOT pass binary content as text. Always set `contentType: "base64"` for images
- DO NOT cache the Octokit instance across processes. Installation tokens expire after 1h
- DO NOT skip the auto-generated header in mdxContent — it's the only signal Marcel has
  that the file was machine-written
- DO NOT use the regex schema parser as if it were authoritative. It's a heuristic.
  Always check `unpopulatedRequired` field in step output

## Performance / Cost

Per article sync (KI-Wissensraum profile):
- ~3-5 GitHub API calls (1 ref read, 1-2 blobs, 1 tree, 1 commit, 1 ref update)
- ~500KB binary upload (hero image)
- Time: ~10-30 seconds per article
- Cost: €0 (GitHub API is free for public repos and our rate limit)
```

## Acceptance Criteria

### GitHub App
- [ ] `verify-app` script confirms App auth works
- [ ] `list-installations` script lists all repos the App is installed in
- [ ] App private key stays out of git (path in env, not the key itself)

### Schema migration
- [ ] `articles` has new fields: `collectionType`, `astroSyncedAt`, `astroCommitSha`, `astroAssetPaths`, `astroFrontmatter`
- [ ] `projects` has new field: `astroRepo` (jsonb nullable)
- [ ] `astro_sync_runs` table exists with all columns
- [ ] Migration runs cleanly

### Schema discovery
- [ ] `parseBlogSchema()` correctly identifies fields on a typical Astro `defineCollection({ schema: z.object({ ... }) })`
- [ ] Returns empty array gracefully on unparseable configs (no throw)
- [ ] Correctly identifies optional vs required fields
- [ ] Correctly identifies `image()` typed fields

### Pipeline (full sync)
- [ ] Article in `final_review` status: full sync produces commit on main
- [ ] Hero image is downloaded from R2 and uploaded as Astro asset
- [ ] `.mdx` file contains the auto-generated header
- [ ] `.mdx` frontmatter validates against the discovered schema (manual check via Astro build)
- [ ] DB after sync: `articles.status = "ready_to_publish"`, `articles.astro_commit_sha` set
- [ ] `astro_sync_runs` row written with `status = "succeeded"`
- [ ] Idempotent: running sync twice on same article produces two commits (overwriting `.mdx`)

### Errors
- [ ] Article without `astro_repo` configured: throws with clear message
- [ ] Article with wrong status: throws with clear message
- [ ] Network failure during commit: `astro_sync_runs.status = "failed"` with error stage
- [ ] Schema parse fails: warns + continues with permissive frontmatter

### CLI
- [ ] `article:sync <slug>` enqueues sync, prints IDs
- [ ] Exits non-zero on any error before enqueue

### HTTP
- [ ] `POST /api/articles/:id/sync` returns 202 on success
- [ ] Returns 400 on bad state, 404 on missing article

## Testing Strategy

**Unit tests** (always run):
- `parseBlogSchema()` against 3-5 real-world Astro config samples
- `computeRelative()` for path computation
- `RenderMdxStep`: takes a fixed input, asserts the YAML output matches expectations
- `LoadArticleStep`: DB-only, mock article, assert shape

**Integration test** (gated by `RUN_LIVE_ASTRO_SYNC=1` + a test repo):
1. Create a test article in DB with status `final_review`
2. Configure `projects.astro_repo` to point at a test repo (Marcel needs to create one)
3. Run pipeline
4. Verify commit appears in test repo
5. Verify DB state transitions
6. Cleanup: delete the test commit's branch (or use a throwaway test repo)

Cost: €0.

## Open Questions / Decisions Made

**Decision 1: Direct-to-main, no PRs.**
Solo dev, fast iteration. PR mode reserved for Spec 21.5 if collaboration becomes a thing.

**Decision 2: Single GitHub App, multiple installations.**
One App registration, installed separately on each Astro repo. Per-repo permissions, single auth flow to maintain. Cleaner than per-tenant GitHub Apps.

**Decision 3: Regex schema parser, not TypeScript AST.**
Astro content config is plain TypeScript, but compiling it would require Astro's runtime. Regex is good enough for typical Zod-based schemas. Falls back to permissive mode on parse failure.

**Decision 4: `originalCause` not `cause` on AstroSyncError.**
Per Spec 12/13/14/20 lessons.

**Decision 5: GitHub git-data API, not the simpler PUT contents API.**
PUT `/repos/{owner}/{repo}/contents/{path}` only supports one file per call. We need atomic multi-file commits (mdx + image). The git-data API (blobs → tree → commit → ref) handles this in one logical commit.

**Decision 6: Hero image content_type detection from HTTP header, not extension guessing.**
R2 stores the actual content-type. We trust that over the URL extension.

**Decision 7: Auto-generated header is HTML comment, not YAML key.**
HTML comments are valid in MDX and visible in the rendered `.mdx` source. YAML keys would be parsed by Astro and require schema support.

**Decision 8: `astroFrontmatter` snapshot in DB.**
We save the exact frontmatter that was committed. Lets us detect drift later (Spec 21.5: "did someone hand-edit the .mdx?" → compare git vs astroFrontmatter).

**Decision 9: Status transition `final_review → ready_to_publish` (not `published`).**
"Published" means the article is live on the deployed Astro site. Spec 21 doesn't deploy — it commits. Astro CI/CD is what publishes. A future Spec 22 (PageSpeed) or Spec 30 (Web App) can transition `ready_to_publish → published` after verification.

**Decision 10: `astroFrontmatterDefaults` field on projects deferred.**
The spec mentions it as a fallback for unpopulated required fields, but doesn't add it now. Reason: we don't know yet which fields a typical Astro schema has that we can't auto-populate. Add it after running against real KI-Wissensraum config and seeing what breaks. Until then, schema warnings go to logs.

**Decision 11: Pipeline runs in the existing `pipelines` worker.**
No new worker process. Same BullMQ queue infrastructure as Spec 20 article pipelines.

**Decision 12: No `cost-tracker` integration.**
GitHub API + R2 download are both free. We could log zero-cost rows for visibility (like SMTP in Spec 11.5), but this pipeline already writes detailed audit to `astro_sync_runs`, so cost-tracker rows would be redundant.

## Implementation Order

This spec is medium-large. **Recommend 4 sessions.**

**Session 1: GitHub App auth + admin scripts (~3-4h)**
1. Marcel sets up GitHub App per `SETUP-GITHUB-APP.md`
2. Schema migration: add `articles` columns, `projects.astroRepo`, `astro_sync_runs` table
3. Implement `github-auth.ts`
4. Implement `list-installations.ts` and `verify-app.ts` scripts
5. Marcel runs verify-app and list-installations, populates `projects.astro_repo` for KI-Wissensraum
6. Commit: `feat(astro-sync): github app auth + schema (spec 21)`

**Session 2: Schema parser + tests (~3-4h)**
1. Implement `parseBlogSchema()` and helpers in `resolve-schema.ts`
2. Implement `LoadArticleStep` and `ResolveSchemaStep`
3. Write unit tests for `parseBlogSchema()` against 3-5 real Astro configs (find samples in
   the Astro starter templates if needed)
4. Test: read KI-Wissensraum's actual content/config.ts via the live API, see what fields
   we identify
5. Commit: `feat(astro-sync): schema discovery (spec 21)`

**Session 3: Render + commit (~4-5h)**
1. Implement `DownloadHeroStep`
2. Implement `RenderMdxStep`
3. Implement `CommitToGitHubStep`
4. Implement `UpdateDbStatusStep`
5. Wire `ArticleSyncPipeline` with bridges
6. Implement `enqueueArticleSync` service function
7. Write the CLI `article:sync` script
8. Commit: `feat(astro-sync): pipeline + cli (spec 21)`

**Session 4: HTTP endpoint + integration test + manual verification (~3-4h)**
1. Wire HTTP endpoint
2. Run `bun --filter ... typecheck` cleanup
3. Manual end-to-end test against KI-Wissensraum:
   - Pick a final_review article (or set one's status manually for testing)
   - Run `article:sync <slug>`
   - Verify the commit on GitHub
   - Pull the Astro repo, run `astro build`, verify no errors
   - Verify `articles.astro_commit_sha` populated
4. If anything breaks: investigate, fix, re-test
5. Write the gated integration test (uses a separate test repo)
6. Commit: `feat(astro-sync): http endpoint + integration test (spec 21)`

**Total**: 13-17 hours of compute time. Live test cost: €0.

## Splitting Plan

See "Implementation Order" — four sessions with `/clear` between.

## Discovered During Implementation

**Session 1:**

1. **Octokit `GET /app` returns nullable data with a union owner type.** The `data` object from
   `app.octokit.request("GET /app")` is typed as possibly `null`, and `data.owner` is
   `User | Organization` — `Organization` has no `login` property. Scripts using this endpoint
   must null-coalesce and use `"login" in owner` narrowing (see `verify-app.ts`).

2. **Drizzle migrator skips manually-written migrations with `when` timestamps lower than the last applied migration.** The migrator compares `when` against `MAX(created_at)` in `__drizzle_migrations` and skips anything older. When writing a manual migration entry in `_journal.json`, always use a `when` value higher than all existing entries (not today's real Unix timestamp, which may be lower than the project's existing values).

3. **`onDelete: "cascade"` was missing from `astroSyncRuns.projectId` FK.** Drizzle defaults to
   `restrict` when `onDelete` is omitted. Caught during `/review-task` — always add
   `{ onDelete: "cascade" }` to every project-scoped FK.

**Session 2:**

4. **Non-greedy regex in schema body extraction cuts off at the first `})` inside nested fields.**
   The spec's regex `([\s\S]*?)\}\s*\)` stops at the first balanced `})` encountered, which
   can be inside a field like `schemaJsonLd: z.object({}).optional()` — truncating the body
   before `draft` and `tags`. Fixed by replacing the regex with a bracket-counting walk
   (`bracketBalanced()` in `resolve-schema.ts`). This approach handles arbitrarily nested
   objects without regex lookahead tricks.

5. **Classification order matters: `string_array` must be checked before `string`.** The
   pattern `z.array(z.string())` also satisfies the `z\.string\(\)` regex, so checking `string`
   first always wins. The fix is a simple reordering — more specific patterns first.

6. **`AstroRepoConfigSchema` has `.default()` fields, causing `_input` variance mismatch in
   `BaseStep`.** Fields `defaultBranch`, `contentRoot`, and `assetsRoot` have Zod defaults,
   making their `_input` type `string | undefined` while `_output` is `string`. TypeScript
   rejects this as `ZodType<TOutput>` in `BaseStep`'s generic. Fix: cast the step's
   `OutputSchema` with `as z.ZodType<OutputType>` — same pattern documented in
   `packages/pipelines/CLAUDE.md` under "Zod `.default()` in Step Schemas".

## Deviations

**Session 1:**

- **Spec listed `@octokit/app` + `@octokit/auth-app` as separate deps; implementation uses
  `octokit` only.** The unified `octokit` package re-exports the `App` class and all auth
  helpers. Adding the sub-packages separately is redundant and `octokit@^4` already pulls them
  as transitive deps. No functional difference.
