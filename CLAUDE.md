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
- DO NOT skip Zod validation on tool boundaries
- DO NOT commit secrets — use .env, encrypted in db for tenant credentials
- DO NOT touch /packages/skills directly (it's a git submodule, fork it if you need changes)
- DO NOT add new pipeline steps without writing them to follow the BaseStep contract
- DO NOT bypass the cost-tracker — every external API call must log

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
- (more added as we progress)

## Key Project Context
- Marcel is solo dev + small team (1-3 people)
- Mobile-first because Marcel approves content on the go
- Quality > speed of generation (we approve before publish)
- Cost monitoring is mission-critical (hard limits, kill-switch)
- Marketing Skills repo is the prompt-foundation; we orchestrate, skills define WHAT
