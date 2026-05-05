---
description: Review changes against project standards
allowed-tools: Bash(git diff:*), Bash(git status:*), Read, Grep
---

Review all uncommitted changes (git diff + new files) against project standards:

**Universal Checks:**
- [ ] All TypeScript is strict (no `any`, no `as` casts without justification comment)
- [ ] No hardcoded strings that should be config (use /packages/shared/config)
- [ ] All comments and JSDoc are in English
- [ ] No console.log left behind (use pino logger)
- [ ] No commented-out code blocks
- [ ] All external API calls go through cost-tracker
- [ ] All boundary inputs (HTTP, queue jobs) validated with Zod

**Backend-specific (if apps/api/ touched):**
- [ ] Routes are thin glue, business logic in /packages/core
- [ ] Workers are idempotent
- [ ] Adapters are not called from routes directly
- [ ] No process.env direct usage outside /packages/shared/config

**Frontend-specific (if apps/web/ touched):**
- [ ] Vue Options API used (NO script setup, NO Composition API)
- [ ] data: () => ({...}) shorthand
- [ ] Mobile tested at 375px first
- [ ] Quasar v2 components only
- [ ] No localStorage for auth
- [ ] All user-facing strings via $t()

**Pipeline-specific (if packages/pipelines/ touched):**
- [ ] Steps follow BaseStep contract
- [ ] Steps are idempotent (re-running gives same result)
- [ ] Skills loaded from /packages/skills/, not redefined
- [ ] Project context loaded into prompt

**Database-specific (if packages/db/ touched):**
- [ ] All tables have project_id FK (multi-tenant)
- [ ] Migrations are reversible
- [ ] Indexes on FK columns and frequent query columns
- [ ] No CASCADE deletes without justification

Report violations with file + line number. Fix automatically where unambiguous; ask Marcel where decision needed.
