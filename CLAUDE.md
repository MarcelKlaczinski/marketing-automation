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
- DO NOT pass `prop: value | undefined` to third-party libs when `exactOptionalPropertyTypes` is on — build the object conditionally (if/return) instead of using a ternary that produces `undefined`
- DO NOT name a workspace script `test` whose body itself runs `bun test …` — Bun's CLI resolves the same-name script before the `test` built-in and recurses. If a package needs custom test setup (env loading, paths), invoke via `bun --filter <pkg> test` only; document the caveat in its CLAUDE.md so contributors don't run `bun run test` from the package cwd
- DO NOT omit `--env-file ../../.env` from package.json scripts in workspace packages — `bun --filter` runs scripts from the package directory, so the root `.env` is not auto-discovered. Add `--env-file ../../.env` to every script that triggers `getEnv()` at startup (dev, start, add-user, etc.)

## Workflow
1. Check the spec file referenced in the prompt before coding
2. Read relevant CLAUDE.md files (root + nearest subdirectory)
3. Plan first if task is non-trivial — ask "should I enter plan mode?"
4. Implement the change
5. Run /review-task before declaring done
6. Run /update-docs if patterns changed

## Spec Files
All specs live in /specs/. Reference format: `/specs/<phase>-<feature>.md`
Current active specs:
- /specs/00-foundation.md
- /specs/01-cold-start-pipeline.md
- /specs/03-cost-tracker.md
- /specs/04-magic-link-auth.md

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
