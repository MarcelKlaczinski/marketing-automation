# Marketing Automation Platform

## Project Overview
Multi-tenant marketing automation platform for content-driven projects.
First tenant: KI-Wissensraum (educational AI content blog).
Future tenants: Bellemann (automotive dealer), Balkonkraftwerk affiliate blog.
Designed to evolve into SaaS.

## Tech Stack (Hard Rules)
- **Runtime**: Bun (NOT Node.js)
- **Backend Framework**: Hono (NOT Express, NOT Fastify)
- **ORM**: Drizzle (NOT Prisma)
- **Database**: PostgreSQL 16 (with pgvector extension)
- **Cache + Queue**: Redis 7 + BullMQ
- **Validation**: Zod everywhere on boundaries
- **Frontend**: Quasar 2 + Vite + Vue 3 (Options API), PWA mode
- **Markdown editor**: `vue-codemirror` + CodeMirror v6 (`@codemirror/lang-markdown`, `@codemirror/theme-one-dark`, `@codemirror/view`, `@codemirror/state`, `@codemirror/commands`) + `marked` v18 for preview rendering
- **Charts**: `chart.js` v4 + `vue-chartjs` v5 (Options API wrapper for Chart.js; register elements explicitly before use)
- **Mobile-first**: All UI designed for mobile screens first, then desktop
- **Push Notifications**: Web Push via VAPID — `web-push` npm package in `packages/core`
- **Language**: TypeScript strict everywhere, English-only code/comments/JSDoc

## Architecture
- Hexagonal Architecture (ports & adapters), inspired by Marcel's Vanilla v3
- Multi-tenant via `project_id` foreign key (NO schema-per-tenant)
- Pipeline-Templates as classes with composable Steps
- Skills (in packages/skills) provide marketing domain knowledge
- Each pipeline step loads relevant skill MD + project context into LLM prompt
- **LLM calls**: always via `@marketing-auto/adapter-anthropic` (`anthropic.messages()`), never `@anthropic-ai/sdk` directly
- **Image generation**: always via `@marketing-auto/adapter-replicate` (`replicate.generateImage()`), never the `replicate` npm package directly
- **Object storage**: always via `@marketing-auto/adapter-storage` (`r2.put()` etc.), never `Bun.S3Client` directly
- **SEO data**: always via `@marketing-auto/adapter-dataforseo` (`dataforseo.serp()` etc.), never `dataforseo-client` directly
- **Transactional email**: always via `@marketing-auto/adapter-email` (`email.sendEmail()` / `email.sendMagicLinkEmail()`), never `nodemailer` directly

## Vue/Quasar Conventions (from Marcel's existing standards)
- Options API only (NOT Composition API, NOT script setup)
- `data: () => ({...})` arrow shorthand (NOT `data() { return {...} }`)
- Composables for shared logic (NOT mixins)
- Inputs: explicit autocomplete handling (`enableAutocomplete` prop pattern)
- All strings via i18n t() (NO hardcoded German/English strings)

## Common Mistakes to Avoid
- DO NOT use Composition API or script setup
- DO NOT install Express, Fastify, or Prisma packages
- DO NOT use synchronous file IO in pipeline workers
- DO NOT make raw fetch() calls — always use typed adapter clients
- DO NOT skip Zod validation on tool boundaries — this includes HTTP request bodies, BullMQ job.data (arrives as unknown from Redis), and any external API response you trust
- DO NOT commit secrets — use .env, encrypted in db for tenant credentials
- DO NOT touch /packages/skills directly (it's a git submodule, fork it if you need changes)
- DO NOT add new pipeline steps without writing them to follow the BaseStep contract
- DO NOT bypass the cost-tracker — every external API call must log
- DO NOT use `z.string().startsWith(…).optional()` for env vars — shell leakage causes format validation to fire on empty strings; use `optionalStr()` from `packages/shared/src/config.ts` instead
- DO NOT pass `prop: value | undefined` to any function (internal or third-party) when `exactOptionalPropertyTypes` is on — build the object conditionally instead. Pattern: extract a base object, then spread optional fields only when defined (see `trackBase` in `packages/adapters/anthropic/src/client.ts`)
- DO NOT name a workspace script `test` whose body itself runs `bun test …` — Bun's CLI resolves the same-name script before the `test` built-in and recurses. If a package needs custom test setup (env loading, paths), invoke via `bun --filter <pkg> test` only; document the caveat in its CLAUDE.md so contributors don't run `bun run test` from the package cwd
- DO NOT omit `--env-file ../../.env` from package.json scripts in workspace packages — `bun --filter` runs scripts from the package directory, so the root `.env` is not auto-discovered. Add `--env-file ../../.env` to every script that triggers `getEnv()` at startup (dev, start, add-user, etc.)
- DO NOT add a new adapter under `packages/adapters/<name>/` without also adding `"packages/adapters/*"` to `workspaces` in root `package.json` — Bun's `packages/*` glob only resolves direct children, not nested packages
- DO NOT add `"types": ["bun"]` or `"typeRoots"` to adapter-level `tsconfig.json` files — it produces `Cannot find type definition file for 'bun'`. Bun types resolve correctly through the workspace root without explicit declaration (verified in adapters/anthropic, adapters/replicate, adapters/storage)
- DO NOT name a constructor parameter property `cause` when subclassing `Error` — `Error.cause` is a reserved built-in in ESNext lib and TypeScript requires `override`. Rename to `originalCause` or similar instead
- DO NOT use `RequestInfo` as a type in adapter code — it is not in scope under Bun's TypeScript config. Use `string | URL | Request` instead (the same union `RequestInfo` aliases in lib.dom.d.ts)
- DO NOT hardcode `0.92` as a USD→EUR conversion constant in adapters — import `EUR_PER_USD` from `@marketing-auto/cost-tracker` so all FX conversions stay in sync
- DO NOT reference a skill by name in `buildSystemPrompt()` without first verifying it exists in `packages/skills/skills/` — the loader silently falls back to an error log and empty string, so a typo produces a degraded prompt with no compile-time warning. Check the directory before writing step code
- DO NOT import a shared type from your local package when casting for a Drizzle `$type<T>` column — under `exactOptionalPropertyTypes`, Zod-inferred types with `field?: string | undefined` are structurally incompatible with DB-defined types that have `field?: string`. Always import the type from `@marketing-auto/db` for the cast (e.g. `SelfReviewIssue`, `ArticleOutline`)
- DO NOT add `as T` casts to jsonb columns that already use `.$type<T>()` — Drizzle types them correctly; the cast is dead weight that masks future type errors
- DO NOT pass an `as const` tuple to Drizzle's `inArray()` — it expects a mutable array. Use `Array<EnumValue>` with an explicit type annotation instead (e.g. `const statuses: Array<"a" | "b"> = ["a", "b"]`)
- DO NOT call `.on()` directly on the return value of `node:child_process` `spawn()` — Bun's type defs omit `.on()` from `ChildProcessWithoutNullStreams`. Define a local `SpawnResult` interface with the event overloads you need and cast with `as unknown as SpawnResult` (justified: runtime always has it). See `packages/adapters/pagespeed/src/steps/clone-or-update.ts` for the canonical pattern
- DO NOT pass a `ZodEnum` (or any non-`ZodString`) to `optionalStr()` — `optionalStr` only accepts `ZodString`. For optional enum env vars use `z.preprocess((v) => (v === "" ? undefined : v), z.enum([...]).optional())` directly (see `DEPLOYMENT_MODE` in `packages/shared/src/config.ts`)
- DO NOT add a subpath export (e.g. `"./verify"`) to an adapter `package.json` without also adding a matching `paths` entry in every consumer's `tsconfig.json` — `moduleResolution: "bundler"` honours the exports map at runtime but TypeScript still needs explicit `paths` for type resolution. Pattern: `"@marketing-auto/adapter-foo/verify": ["../../packages/adapters/foo/src/verify.ts"]`
- DO NOT call `r2.file()`, `r2.presign()`, or `r2.delete()` from `@marketing-auto/adapter-storage` without `await` — these are now async (since Spec 32 vault-first refactor). TypeScript strict mode catches the mistake at compile time, but the silent `Promise` return is easy to miss in non-strict contexts
- DO NOT make an adapter client factory synchronous if credential resolution must hit the DB (vault) — make the factory `async` and cache the resolved client in a module-level singleton. All callers inside the file must `await` the factory. The double-await pattern `(await getApi()).method()` is the correct idiom for immediate chained calls
- DO NOT assume `enqueuePipeline()` returns a `runId` — it only returns `{ jobId }`. When a UI needs a stable runId to poll immediately, use the **preRunId pattern**: INSERT a `pipeline_runs` row (`status='queued'`) before enqueuing, pass its ID as `preRunId` through job data; the runner UPDATEs it to `status='running'` instead of INSERTing. See `packages/pipelines/src/cold-start/triggers.ts` for the canonical implementation
- DO NOT derive Cold-Start phase completion from DB columns that don't exist (`projects.brandVoice`, `projects.coldStartCompletedAt`, `competitors` table) — Phase 1 = `projects.marketingContextMd` non-empty; Phase 2 = latest `cold-start:competitor-analysis` run `completed`; Phase 4 = `cornerstone_specs` row count > 0 (NOT the old `articles` table — Spec 48 migrated Phase 4 to `cornerstone_specs`); Phase 5 = latest `cold-start:go-live-checklist` run `completed`
- DO NOT destructure the first element of a Drizzle `select` result when you only need an aggregate — `const [{ count }] = await db.select(...)` causes TS2339 because the array can be empty. Use `const result = await db.select(...); const count = result[0]?.count ?? 0` instead
- DO NOT write a new pipeline-trigger HTTP endpoint without using `triggerWithPreRunId` or `checkTriggerAllowed` from `apps/api/src/routes/_lib/trigger-helpers.ts` — these enforce pause-check → cost-check → idempotency in the correct order. A route that skips them bypasses cost limits silently. See `apps/api/CLAUDE.md` for which variant to use
- DO NOT run `biome check --write` without first confirming `noNonNullAssertion` is set to `"off"` in `biome.json` — the `recommended: true` default sets it to `"error"`, and `--write` applies the safe-fix (`!` → `?.`) across the entire codebase, changing `string` to `string | undefined` silently and causing hundreds of downstream typecheck errors. Always verify `biome.json` has `"noNonNullAssertion": "off"` before running any `biome --write`
- DO NOT run `biome check --unsafe` on this codebase — the `noConsoleLog` unsafe fix removes the entire call body (arguments and all), leaving empty if/for blocks and corrupted script files. All intentional `console.log` calls in scripts are annotated with `// biome-ignore lint/suspicious/noConsoleLog: script output`
- DO NOT use `.rowCount` on Drizzle `update()` or `delete()` results — the property does not exist on `RowList<never[]>`. Use `.returning({ id: table.id })` and check `.length` instead: `const rows = await db.update(...).returning({ id: t.id }); return rows.length`
- DO NOT use `bun add <pkg> --filter @marketing-auto/foo` to install a package into a workspace — Bun interprets `--filter` as an npm package name to look up, not a workspace filter. Use `bun add <pkg> --cwd packages/foo` (or `--cwd apps/api`) instead
- DO NOT pass a bare column reference to Drizzle's index `.where()` — it expects an SQL expression. Use `isNull(col)` or `sql\`...\`` for partial index conditions: `.where(isNull(t.readAt))` not `.where(t.readAt)`
- DO NOT make discriminator columns (e.g. `collection`, `locale`) nullable when they appear in a unique index — PostgreSQL treats `NULL != NULL`, so two rows with `NULL` in that column never conflict, silently breaking the constraint. Use `NOT NULL` with a default value (e.g. `.default("blog")`) so the constraint works correctly
- DO NOT run `drizzle-kit generate` from within Claude Code or any non-TTY environment — it opens an interactive terminal prompt that stalls indefinitely. Write the migration SQL manually and add the corresponding entry to `packages/db/drizzle/meta/_journal.json` (increment idx, set `when` to a value strictly greater than the last entry, provide a descriptive tag)
- DO NOT rely on CASCADE alone to clean up test rows when the API/workers are running — background schedulers (e.g. `cluster:link-rebuild`) read approved rows and INSERT into `pipeline_runs` with the test `project_id`; if `afterEach` deletes the project first the FK fires. Always delete child rows explicitly in dependency order before deleting the project: `articles → clusters → contentPillars → projects`. Pattern used in `packages/adapters/astro-sync/test/sync-clusters.test.ts`
- DO NOT add a new Cold-Start step that reads project-level config (e.g. `targetLocales`) without loading it from `projects` via `db.select()` inside `execute()` — the step's `inputSchema` only receives what the previous step or bridge produces; project config must be queried directly. When the config is already in the pipeline input (e.g. `projectSlug`), add the field to the step's `inputSchema` — the pipeline runner passes the full pipeline input to the first step, and Zod silently strips unknown fields for subsequent steps. See `FetchCompetitorKeywordsStep` in `packages/pipelines/src/cold-start/02-competitor-analysis/steps.ts` for the canonical pattern

## Local DB Setup

Fresh machine? Run:
```bash
bun run db:setup    # provisions PostgreSQL role + database (idempotent)
bun run db:migrate  # applies all migrations
bun --env-file .env apps/api/src/scripts/apply-cost-defaults.ts  # applies cost limits to existing projects
```

Verify with `bun test` from any package — DB-touching tests should pass.

### Env-file gotcha

Drizzle-kit subcommands (check, migrate, push, studio, generate) need `--env-file ../../.env`
when run from `packages/db`. The scripts in `packages/db/package.json` have this baked in,
so always use `bun run check` / `bun run migrate` (not bare `bunx drizzle-kit …`).
The root scripts (`bun run db:migrate`, `bun run db:check`, etc.) also handle this automatically.

## SQL Date-Binding Convention

Drizzle's typed operators (`gte`/`lte`/`gt`/`lt`/`eq`/`ne`) auto-serialize Date objects to ISO strings. `sql` template literals bypass this — postgres.js receives the raw Date and crashes.

✅ CORRECT — Drizzle typed operators (Date objects fine):
```typescript
gte(table.createdAt, new Date())
lte(table.expiresAt, oneHourFromNow)
.values({ createdAt: new Date() })
.set({ updatedAt: new Date() })
```

❌ WRONG — sql template with raw Date (production crash):
```typescript
sql`${table.createdAt} >= ${new Date()}`
sql`expires_at < ${oneHourFromNow}`
```

✅ FIX — call .toISOString() before interpolating:
```typescript
sql`${table.createdAt} >= ${new Date().toISOString()}`
sql`expires_at < ${oneHourFromNow.toISOString()}`
```

Crash symptom: `TypeError: "string" argument must be of type string or instance of Buffer. Received an instance of Date` at `postgres.js/bytes.js` (bind step).

Regression test: `packages/core/test/sql-date-bind.test.ts`

## Workflow
**Pipeline-Code geändert?** Worker muss neugestartet werden — siehe
`apps/api/CLAUDE.md` → "Worker-Restart bei Pipeline-Code-Änderungen".

1. Check the spec file referenced in the prompt before coding
2. Read relevant CLAUDE.md files (root + nearest subdirectory)
3. Plan first if task is non-trivial — ask "should I enter plan mode?"
4. Implement the change
5. Run /review-task before declaring done
6. Run /update-docs if patterns changed

## Spec Files
All specs live in /specs/. Reference format: `/specs/<phase>-<feature>.md`
Implemented specs (do not re-implement):
- /specs/00-foundation.md
- /specs/01-database-schema.md
- /specs/03-cost-tracker.md
- /specs/05-base-pipeline-engine.md
- /specs/10-project-marketing-context-skill-integration.md
- /specs/11-anthropic-adapter.md
- /specs/12-replicate-adapter.md
- /specs/13-dataforseo-adapter.md
- /specs/11.5-email-adapter.md
- /specs/31-web-app-auth.md
- /specs/32-web-app-installer.md (all sessions done)
- /specs/35-coldstart-ui.md
- /specs/41-cost-enforcement-pipeline-hardening.md
- /specs/40-notifications.md
- /specs/44-astro-import.md

## Project Marketing Contexts

Each tenant project has a marketing context that defines its voice, audience,
pillars, and quality floors. Lives in `project-contexts/<slug>/marketing-context.md`.
After editing the file, run:

  bun --filter @marketing-auto/api sync-context <slug>

This syncs the markdown body and structured frontmatter fields to the DB,
where pipeline steps load it via `loadProjectContext()`.

To add a new project:
  bun --filter @marketing-auto/api add-project <slug> "Name" <industry> <pipelineTemplate>
  # then create project-contexts/<slug>/marketing-context.md
  # then run sync-context

## Key Project Context
- Marcel is solo dev + small team (1-3 people)
- Mobile-first because Marcel approves content on the go
- Quality > speed of generation (we approve before publish)
- Cost monitoring is mission-critical (hard limits, kill-switch)
- Marketing Skills repo is the prompt-foundation; we orchestrate, skills define WHAT
