# Marketing Automation Platform

Multi-tenant marketing automation built with Bun + Hono + Drizzle + Quasar PWA.

## Quick Start

```bash
# 1. Install dependencies
bun install

# 2. Set up environment
cp .env.example .env
# Edit .env (at minimum, generate ENCRYPTION_KEY: openssl rand -hex 32)

# 3. Start infrastructure
docker compose up -d

# 4. Start API server
bun run dev:api

# 5. Verify
curl http://localhost:3000/health
```

## Architecture

See `/CLAUDE.md` for project context.
See `/specs/` for feature specifications.

## Development

- `bun run dev:api` — Start API in hot-reload mode
- `bun run typecheck` — Type-check all packages
- `bun run test` — Run all tests
- `bun run lint` — Lint with Biome

## Stack

- **Runtime**: Bun
- **Backend**: Hono + Drizzle + PostgreSQL + Redis + BullMQ
- **Frontend**: Quasar 2 PWA (mobile-first)
- **AI**: Claude API (Sonnet/Opus), Replicate (Flux), DataForSEO

## Project Structure

```
apps/        Backend API + Quasar PWA
packages/    Shared libraries (db, core, pipelines, adapters, etc.)
specs/       Implementation specifications
```
