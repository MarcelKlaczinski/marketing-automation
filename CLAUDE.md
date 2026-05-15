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
- **SEO data**: always via `@marketing-auto/adapter-dataforseo` (`dataforseo.serp()`, `dataforseo.trendsExplore()` etc.), never `dataforseo-client` directly
- **Embeddings**: always via `@marketing-auto/adapter-voyage` (`voyage.embed()` / `voyage.embedBatch()`), never the Voyage AI REST API directly. Use the `voyage` object export (not named `embed` export) so the function is patchable in tests
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
- DO NOT write a partial `targetWhere` in Drizzle's `onConflictDoUpdate` — PostgreSQL requires `targetWhere` to reproduce ALL conditions of the partial unique index's WHERE clause exactly. If the index is `WHERE gap_id IS NOT NULL AND approval_status IN (...)`, a `targetWhere` of only `approval_status IN (...)` produces "there is no unique or exclusion constraint matching the ON CONFLICT specification" at runtime (no compile-time error). Copy the full predicate verbatim.
- DO NOT make discriminator columns (e.g. `collection`, `locale`) nullable when they appear in a unique index — PostgreSQL treats `NULL != NULL`, so two rows with `NULL` in that column never conflict, silently breaking the constraint. Use `NOT NULL` with a default value (e.g. `.default("blog")`) so the constraint works correctly
- DO NOT run `drizzle-kit generate` from within Claude Code or any non-TTY environment — it opens an interactive terminal prompt that stalls indefinitely. Write the migration SQL manually and add the corresponding entry to `packages/db/drizzle/meta/_journal.json` (increment idx, set `when` to a value strictly greater than the last entry, provide a descriptive tag)
- DO NOT rely on CASCADE alone to clean up test rows when the API/workers are running — background schedulers (e.g. `cluster:link-rebuild`) read approved rows and INSERT into `pipeline_runs` with the test `project_id`; if `afterEach` deletes the project first the FK fires. Always delete child rows explicitly in dependency order before deleting the project: `articles → clusters → contentPillars → projects`. Pattern used in `packages/adapters/astro-sync/test/sync-clusters.test.ts`
- DO NOT add a new Cold-Start step that reads project-level config (e.g. `targetLocales`) without loading it from `projects` via `db.select()` inside `execute()` — the step's `inputSchema` only receives what the previous step or bridge produces; project config must be queried directly. When the config is already in the pipeline input (e.g. `projectSlug`), add the field to the step's `inputSchema` — the pipeline runner passes the full pipeline input to the first step, and Zod silently strips unknown fields for subsequent steps. See `FetchCompetitorKeywordsStep` in `packages/pipelines/src/cold-start/02-competitor-analysis/steps.ts` for the canonical pattern
- DO NOT set `article.cornerstoneKeyword` to `slugify(title)` when creating an article programmatically — `TopicIntakeStep` matches `article.cornerstoneKeyword` against entries in `cluster.satelliteKeywords[].cornerstoneKeyword` to find satellite keywords for SERP research. A slugified title never matches, producing `satelliteKeywords = []` and degraded outline quality. Always derive `cornerstoneKeyword` from the cluster's actual keyword data (e.g. via `gap.metadata.suggestedCornerstoneKeyword` populated by `gap-service.ts`) or from `cornerstoneSpecs.cornerstoneKeyword` for spec-to-article generation
- DO NOT assume an Astro content entry will be reachable at its URL after syncing — Astro silently excludes entries from `getStaticPaths()` when the collection's Zod schema validation fails (e.g. missing required fields like `date`, `category`, `excerpt`). The result is a 404 with no server-side error. Always verify `buildFrontmatter()` satisfies all required collection fields. Use `ExtractCollectionSchemasStep` (Spec 50) to keep the schema stored in DB and inject it into the generation prompt
- DO NOT pass `frontmatterSchema` to `buildSystemPrompt()` as a raw `z.unknown()` array without casting — the function expects `FrontmatterFieldDescriptor[]` (from `@marketing-auto/db`). Import the type at the top of the step file and cast: `frontmatterSchema as FrontmatterFieldDescriptor[]`
- DO NOT use `sql\`${col} != ${value}\`` for inequality comparisons in Drizzle — the `!=` operator is not handled by parameter binding and silently produces incorrect queries. Use `ne(col, value)` from `drizzle-orm` instead. The `ne()` operator is listed alongside `eq`, `gt`, `lt` etc. in the SQL Date-Binding Convention above and auto-serializes values correctly
- DO NOT query by `translationKey` alone — it is project-scoped by convention but not by a DB unique constraint. Always pair it with `eq(articles.projectId, projectId)` to prevent cross-tenant sibling matches in any pipeline or route that joins on translation siblings
- DO NOT pass `pipelineRunId: null` to `anthropic.messages()` — the adapter field accepts `string` only, not `null`. Omit the field entirely when there is no pipeline run context (e.g. ad-hoc hook generation in `discoveryWorker.ts`). TypeScript surfaces this as "Type 'null' is not assignable to type 'string'" at the call site
- DO NOT use `field?: T` in local intermediate types when building objects conditionally under `exactOptionalPropertyTypes` — TypeScript rejects assigning `value | undefined` to an optional field. Use `field: T | null` instead and check for `null` rather than `undefined`
- DO NOT cast `Array.isArray(x) ? (x as string[])` — `Array.isArray` narrows to `unknown[]`, not `string[]`. Filter with `.filter((h): h is string => typeof h === "string")` for safe narrowing
- DO NOT write LLM prompts in German — all system prompts must be in English for better instruction-following quality. Specify output language inline: "German output, du-form" or "Output locale: de". See `packages/core/src/social-hooks/hookPrompt.ts` for the canonical pattern. Exception: few-shot examples that demonstrate target-language output format (e.g. showing the LLM what a German hook looks like) may stay in German — they are output data, not instructions. The rule applies to instruction text, format descriptions, constraints, and role definitions only
- DO NOT expect pipeline-generated tool articles to have `pros`, `cons`, `features`, `useCases`, `pricingTier` in `frontmatterExtras` unless the article's `intentType` is `overview`, `features`, `review`, `pricing`, or `use-cases` AND a `primaryTool` is set — the DraftStep TOOL SPOTLIGHT FIELDS block is conditional on these two checks. Articles with `intentType: "general"` or `intentType: "tutorial"` will not have these fields and will fail `single-tool-spotlight` eligibility. This is intentional: tutorials/guides about a tool are not the same as tool review/spotlight articles.
- DO NOT use `claude-opus-4-7` as the default model in pipeline steps without explicit justification — Opus is ~5× more expensive than Sonnet and only warranted for tasks requiring deep multi-step reasoning (e.g. open-ended research synthesis, complex refactoring). Structured JSON generation (outline, schema detection, JSON translation) uses Sonnet 4.6 or Haiku 4.5. Model hierarchy: Haiku for classification/extraction tasks, Sonnet for creative/free-text generation, Opus only when Sonnet demonstrably fails on the task. See `audit/COST_AUDIT_2026-05-12.md` for cost data.
- DO NOT forget that `pricing.ts` uses hardcoded rates for `claude-opus-4-7` ($5/$25 per 1M input/output) which may be lower than Anthropic's actual billing rate — the 2026-05-12 audit found a $0.26 discrepancy between the DB total and Anthropic dashboard for a single Opus call. Verify `packages/cost-tracker/src/pricing.ts` rates against the Anthropic console whenever Opus is used at scale, and update `EUR_PER_USD` if FX shifts >5%
- DO NOT add transparency to oklch colors by appending hex-alpha digits (e.g. `oklch(64% 0.16 248)33`) — CSS hex-alpha syntax only works on 6-digit hex values; appending to oklch is invalid and Chromium silently drops the entire `background` property. Use `color-mix(in oklch, <color> <percent>%, transparent)` instead: `color-mix(in oklch, ${theme.brand} 15%, transparent)`
- DO NOT implement custom ZIP builders — use `fflate` (`zipSync` for synchronous in-memory ZIP, `level: 0` for stored/uncompressed). The hand-rolled PKZIP implementation in `social-posts.ts` produced corrupted ZIPs that macOS and Windows refused to open; it was replaced in Spec 52a with `fflate` which is battle-tested and handles CRC, offsets, and end-of-central-directory records correctly
- DO NOT import `drizzle-orm` operators (`and`, `eq`, `inArray`, `ne`, `gte`, `lte`, `gt`, `lt`, `isNull`, `isNotNull`, `sql`) directly from `drizzle-orm` in workspace packages other than `packages/db` — each package may have its own installed version of drizzle-orm, causing TypeScript type incompatibilities (`Type 'Column<...>' is not assignable to parameter`). Always import these operators from `@marketing-auto/db` instead: `import { and, eq, inArray } from "@marketing-auto/db"`. The re-export in `packages/db/src/index.ts` is the canonical source for the workspace-wide drizzle-orm version
- DO NOT import from `packages/pipelines/src/_lib/` using relative paths in `apps/api` — cross-workspace imports must go through the `@marketing-auto/pipelines` workspace alias. If the symbol you need isn't exported from `packages/pipelines/src/index.ts`, add it there first, then add `"@marketing-auto/pipelines": ["../../packages/pipelines/src/index.ts"]` to `apps/api/tsconfig.json` paths if missing. Relative cross-workspace paths like `../../../packages/...` produce `TS2307 Cannot find module` errors that TypeScript reports but Bun silently ignores at runtime
- DO NOT pass `toolCategory: "AI tool"` or a similarly generic string to `generateContentWithGate()` when `primaryCategory` is not set — the LLM echoes the generic value and produces nonsensical hooks like "Welche KI macht die besten KI-Tools?". Omit `toolCategory` entirely when unknown (use the `...(toolCategory !== undefined && { toolCategory })` spread pattern), which makes `buildContentPrompt` send the sentinel `"(infer from tool names)"` that tells the LLM to derive the specific domain from the tool names (Cursor + Windsurf + Codeium → "KI-Code-Editor"). See `packages/core/src/social-hooks/hookPrompt.ts` INFERENCE RULE for the full mapping

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
- /specs/49b-content-gap-detection.md
- /specs/49c-gap-generation.md
- /specs/50-astro-schema-awareness.md
- /specs/54c-discovery-pipeline-integration.md (discovery-gate UI, sync gap-fix discovery, project-scoped social tab)
- /specs/54d-template-preview-gallery.md (admin template gallery with mock fixtures, side-by-side theme previews, download)
- /specs/54e-project-scoped-template-gallery.md (gallery moved into project detail tab with brand tokens + eligible articles scoped to project)
- /specs/54f-single-tool-spotlight.md
- /specs/54g-schema-formalization.md (outputFormat, compatibleChannels, generationClass, plannerMeta on TemplateDefinition; QW-1 slide count fix; QW-2 brandTokens consistency)
- /specs/54h-mandatory-hook-contract.md (generateHook() required on all templates; hook engine migrated to packages/core; wired in discoveryWorker.ts)
- /specs/54i-llm-content-generation.md (generateContent() replaces static captions; English prompts; bilingual DE hashtags; one LLM call for hook+caption+hashtags)
- /specs/54k-social-posts-planner-columns.md (templateKey + locale columns on social_posts; migration 0031)
- /specs/54l-draftStep-tool-frontmatter.md (DraftStep now emits pros/cons/features/useCases/pricingTier/priceFrom/rating for tool articles; closes single-tool-spotlight eligibility gap for pipeline-generated articles)
- /specs/54-0-content-planner-adr.md (ADR: Content Planner architecture — TopicBrief contract, 3-layer model, 9-spec decomposition for Theme 54; no code changes)
- /specs/54.3-topic-routing.md (TopicRoutingPolicy: decideRoute + executeDecision pure functions; /suggest idempotency; /generate + /automate use brief as SSoT; TopicIntakeStep brief-sourced; source='imported' filter removed; Phase A complete)
- /specs/54.5-trend-scoring-topic-synthesis.md (Sessions 1–4 done: adapter-voyage, dataforseo.trendsExplore, score.ts, coverage.ts, cluster-match.ts, prompts.ts, synthesize.ts, emit-brief.ts, source.ts, fetch-signals.ts, trend-synthesizer worker + cron + admin CLI; smoke test pending VOYAGE_API_KEY in .env)
- /specs/54.5b-post-smoke-test-cleanup.md (loadActiveConfig JSONB parse through Zod schemas; ?? workarounds removed; score rebalanced buzz=15 growth=15 official=25 serp=20 diversity=25 coverage=40; source_diversity component added; MAJOR_VENDOR_DOMAINS expanded; COST_OPS registered for trend ops)

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
