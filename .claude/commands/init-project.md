---
description: Bootstrap the marketing-automation monorepo from scratch
allowed-tools: Bash(bun:*), Bash(mkdir:*), Bash(git:*), Write, Edit
---

Bootstrap the marketing-automation monorepo following these exact steps:

1. Create the workspace structure:
   apps/
   api/         (Bun + Hono backend)
   web/         (Quasar 2 PWA)
   packages/
   db/          (Drizzle schemas + migrations)
   core/        (Domain logic)
   pipelines/   (Pipeline templates)
   adapters/    (External API clients)
   cost-tracker/
   prompts/
   shared/      (Types, utils)
   skills/      (already exists as git submodule)

2. Set up root package.json with Bun workspaces

3. Create docker-compose.yml with:
    - PostgreSQL 16 with pgvector extension
    - Redis 7
    - Both with persistent volumes

4. Initialize each app/package with minimal package.json

5. Set up TypeScript config:
    - Root tsconfig.base.json (strict, ESNext, bundler resolution)
    - Each package extends base

6. Add .gitignore (node_modules, .env, dist, .quasar)

7. Add .env.example with all required env vars listed

8. Create initial CLAUDE.md files in apps/api/, apps/web/, packages/pipelines/, packages/adapters/, packages/db/ — copy templates from /specs/00-foundation.md

After completion, run /review-task to verify everything is consistent.
