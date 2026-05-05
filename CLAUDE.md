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
- **Mobile-first**: All UI designed for mobile screens first, then desktop
- **Push Notifications**: Web Push via VAPID
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

## Workflow
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
