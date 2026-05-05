# Spec 00: Foundation Setup

**Phase:** 1 (Foundation)
**Estimated Effort:** 1 day
**Dependencies:** None
**Status:** Ready for implementation

---

## Goal

Establish a clean, production-ready monorepo skeleton with Bun workspaces, Docker-based local infrastructure (PostgreSQL 16 + pgvector, Redis 7), TypeScript configuration, environment management, structured logging, and the foundational `CLAUDE.md` files. After this spec, the repo can be cloned, `bun install && docker compose up && bun dev` runs, and a basic health-check endpoint responds.

## Non-Goals

- No business logic yet (no Drizzle schemas, no routes, no UI)
- No external API integrations (Anthropic, Replicate etc.)
- No authentication
- No frontend setup (Quasar app comes in Spec 30)
- No marketing-skills git submodule integration (that already happened during repo init per the Bauanleitung; here we just verify it's there)

## User-Facing Behavior

After this spec is implemented, Marcel can:
- Clone the repo on a fresh machine
- Run `bun install` (installs all workspace deps)
- Run `docker compose up -d` (starts PG + Redis with persistent volumes)
- Run `bun run dev` from `apps/api/` (starts Hono server on port 3000)
- Hit `http://localhost:3000/health` and get `{"ok":true,"version":"0.1.0","uptime":42}`
- See structured JSON logs in stdout via pino
- Have type-safe ENV access via `@marketing-auto/shared/config`

## Repository Structure

After this spec, the repo looks like:

```
marketing-automation/
├── .claude/
│   ├── commands/              (already exists from init)
│   ├── agents/                (already exists from init)
│   └── settings.local.json    (will be auto-created by Claude Code)
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── server.ts          # Hono server entrypoint
│   │   │   ├── routes/
│   │   │   │   └── health.ts      # GET /health
│   │   │   └── lib/
│   │   │       └── logger.ts      # pino logger setup
│   │   ├── CLAUDE.md
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── web/                       # placeholder, populated in Spec 30
│       └── .gitkeep
├── packages/
│   ├── shared/
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── config.ts          # Zod-validated env config
│   │   │   ├── result.ts          # Result<T, E> type for error handling
│   │   │   └── logger.ts          # shared pino logger factory
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── db/
│   │   └── .gitkeep               # populated in Spec 01
│   ├── core/
│   │   └── .gitkeep               # populated as needed
│   ├── pipelines/
│   │   └── .gitkeep               # populated in Spec 05
│   ├── adapters/
│   │   └── .gitkeep               # populated in Phase 2
│   ├── cost-tracker/
│   │   └── .gitkeep               # populated in Spec 03
│   ├── prompts/
│   │   └── .gitkeep               # populated as needed
│   └── skills/                    # git submodule, already there
│       └── ...
├── docker/
│   └── postgres/
│       └── init.sql               # CREATE EXTENSION vector etc.
├── docker-compose.yml
├── .env.example
├── .gitignore
├── .editorconfig
├── tsconfig.base.json
├── package.json                   # workspace root
├── README.md
└── CLAUDE.md                      # root CLAUDE.md (already exists)
```

## Detailed Implementation Steps

### Step 1: Workspace Root Configuration

Create `package.json` at repo root:
```json
{
  "name": "marketing-automation",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev:api": "bun --filter @marketing-auto/api dev",
    "build": "bun --filter '*' build",
    "typecheck": "bun --filter '*' typecheck",
    "test": "bun --filter '*' test",
    "lint": "bunx @biomejs/biome check ."
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.4",
    "typescript": "^5.7.0",
    "@types/bun": "latest"
  }
}
```

Add `tsconfig.base.json` at repo root:
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "lib": ["ESNext"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": false,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true,
    "allowImportingTsExtensions": false,
    "types": ["bun-types"]
  }
}
```

### Step 2: `packages/shared/`

This is foundational – shared types, config, logger, Result type. Used by all other packages.

`packages/shared/package.json`:
```json
{
  "name": "@marketing-auto/shared",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./config": "./src/config.ts",
    "./result": "./src/result.ts",
    "./logger": "./src/logger.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.23.8",
    "pino": "^9.5.0",
    "pino-pretty": "^11.3.0"
  }
}
```

`packages/shared/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src/**/*"]
}
```

`packages/shared/src/config.ts` (Zod-validated env):
```typescript
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  
  // Database
  DATABASE_URL: z.string().url(),
  
  // Redis
  REDIS_URL: z.string().url(),
  
  // API server
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  API_HOST: z.string().default("0.0.0.0"),
  
  // Encryption (for credential vault later)
  ENCRYPTION_KEY: z.string().length(64).optional(),  // 32 bytes hex-encoded
  
  // Anthropic (for adapters later)
  ANTHROPIC_API_KEY: z.string().startsWith("sk-ant-").optional(),
  
  // Replicate
  REPLICATE_API_TOKEN: z.string().startsWith("r8_").optional(),
  
  // DataForSEO
  DATAFORSEO_LOGIN: z.string().optional(),
  DATAFORSEO_PASSWORD: z.string().optional(),
  
  // Resend (for magic link auth, Spec 04)
  RESEND_API_KEY: z.string().startsWith("re_").optional(),
  RESEND_FROM_EMAIL: z.string().email().optional(),
  
  // Web Push VAPID keys (for Spec 41)
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().email().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (cachedEnv) return cachedEnv;
  
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("❌ Invalid environment variables:");
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment configuration");
  }
  
  cachedEnv = parsed.data;
  return cachedEnv;
}

// Helper for tests
export function resetEnvCache(): void {
  cachedEnv = null;
}
```

`packages/shared/src/result.ts` (Result type):
```typescript
/**
 * Result type for explicit error handling without exceptions.
 * Inspired by Rust's Result<T, E>.
 */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/**
 * Wraps a promise to return a Result instead of throwing.
 */
export async function tryAsync<T, E = Error>(
  fn: () => Promise<T>,
  errorMapper?: (e: unknown) => E
): Promise<Result<T, E>> {
  try {
    const value = await fn();
    return ok(value);
  } catch (e) {
    const error = errorMapper ? errorMapper(e) : (e as E);
    return err(error);
  }
}

/**
 * Wraps a sync function to return a Result instead of throwing.
 */
export function trySync<T, E = Error>(
  fn: () => T,
  errorMapper?: (e: unknown) => E
): Result<T, E> {
  try {
    return ok(fn());
  } catch (e) {
    const error = errorMapper ? errorMapper(e) : (e as E);
    return err(error);
  }
}
```

`packages/shared/src/logger.ts`:
```typescript
import pino from "pino";
import { getEnv } from "./config.ts";

export function createLogger(name: string) {
  const env = getEnv();
  return pino({
    name,
    level: env.LOG_LEVEL,
    transport: env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
    // Production: structured JSON for log aggregators
    formatters: {
      level: (label) => ({ level: label }),
    },
  });
}

export type Logger = ReturnType<typeof createLogger>;
```

`packages/shared/src/index.ts`:
```typescript
export * from "./config.ts";
export * from "./result.ts";
export * from "./logger.ts";
```

### Step 3: `apps/api/`

`apps/api/package.json`:
```json
{
  "name": "@marketing-auto/api",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "bun --hot src/server.ts",
    "start": "bun src/server.ts",
    "build": "bun build src/server.ts --target=bun --outdir=./dist",
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  },
  "dependencies": {
    "@marketing-auto/shared": "workspace:*",
    "hono": "^4.6.0",
    "@hono/zod-validator": "^0.4.0",
    "zod": "^3.23.8"
  }
}
```

`apps/api/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "paths": {
      "@marketing-auto/shared": ["../../packages/shared/src/index.ts"],
      "@marketing-auto/shared/*": ["../../packages/shared/src/*.ts"]
    }
  },
  "include": ["src/**/*"]
}
```

`apps/api/src/server.ts`:
```typescript
import { Hono } from "hono";
import { logger as honoLogger } from "hono/logger";
import { getEnv, createLogger } from "@marketing-auto/shared";
import { healthRoutes } from "./routes/health.ts";

const env = getEnv();
const log = createLogger("api");

const app = new Hono();

// Middleware
app.use("*", honoLogger((message) => log.info(message)));

// Routes
app.route("/health", healthRoutes);

// 404 handler
app.notFound((c) => c.json({ ok: false, error: "Not Found" }, 404));

// Global error handler
app.onError((err, c) => {
  log.error({ err }, "Unhandled error");
  return c.json({ ok: false, error: "Internal Server Error" }, 500);
});

const startTime = Date.now();

log.info({ port: env.API_PORT, host: env.API_HOST }, "Starting API server");

export default {
  port: env.API_PORT,
  hostname: env.API_HOST,
  fetch: app.fetch,
};

// Make uptime available globally for health endpoint
declare global {
  var __startTime: number;
}
globalThis.__startTime = startTime;
```

`apps/api/src/routes/health.ts`:
```typescript
import { Hono } from "hono";

export const healthRoutes = new Hono();

const VERSION = "0.1.0";

healthRoutes.get("/", (c) => {
  const uptimeMs = Date.now() - (globalThis.__startTime ?? Date.now());
  return c.json({
    ok: true,
    version: VERSION,
    uptimeSec: Math.floor(uptimeMs / 1000),
    timestamp: new Date().toISOString(),
  });
});
```

`apps/api/CLAUDE.md`:
```markdown
# Backend API Conventions

## Structure
- `src/server.ts`         Hono server entrypoint, middleware setup
- `src/routes/`           HTTP endpoints, thin glue layer
- `src/workers/`          BullMQ workers (added in Spec 05)
- `src/webhooks/`         Inbound webhooks (added later)
- `src/middleware/`       Custom Hono middleware (auth, cost-context)
- `src/lib/`              Local utilities (logger setup, helpers)

## Endpoint Patterns
- All endpoints use Zod-validated input via @hono/zod-validator
- All responses follow `{ ok: true, data }` | `{ ok: false, error }` shape
- Long-running operations: enqueue a BullMQ job, return job_id, client polls/subscribes via Web Push

## Worker Patterns
- One worker per queue, queue name = step name (e.g., "draft-generation")
- Steps must be idempotent (safe to re-run)
- Always wrap external calls in cost-tracker decorator
- Always log structured (pino, JSON output)

## Common Mistakes to Avoid
- DO NOT do business logic in route handlers — that goes in /packages/core
- DO NOT call adapters directly from routes — always via core services
- DO NOT use `process.env` directly — use typed `getEnv()` from @marketing-auto/shared
- DO NOT use console.log — use the pino logger
```

### Step 4: Docker Compose

`docker-compose.yml`:
```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    container_name: marketing_auto_pg
    restart: unless-stopped
    environment:
      POSTGRES_USER: marketing_auto
      POSTGRES_PASSWORD: dev_password_change_me
      POSTGRES_DB: marketing_auto
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./docker/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U marketing_auto"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: marketing_auto_redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
  redis_data:
```

`docker/postgres/init.sql`:
```sql
-- Enable pgvector for embeddings (used in Spec 01+)
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable pg_trgm for fuzzy text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Enable uuid-ossp for UUID generation (Drizzle uses gen_random_uuid by default but having both is fine)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

### Step 5: Environment Configuration

`.env.example` (commit this):
```bash
# Node
NODE_ENV=development
LOG_LEVEL=info

# Database
DATABASE_URL=postgresql://marketing_auto:dev_password_change_me@localhost:5432/marketing_auto

# Redis
REDIS_URL=redis://localhost:6379

# API
API_PORT=3000
API_HOST=0.0.0.0

# Encryption (Spec 02) - generate with: openssl rand -hex 32
ENCRYPTION_KEY=

# External APIs (Phase 2+)
ANTHROPIC_API_KEY=
REPLICATE_API_TOKEN=
DATAFORSEO_LOGIN=
DATAFORSEO_PASSWORD=

# Auth (Spec 04)
RESEND_API_KEY=
RESEND_FROM_EMAIL=

# Web Push (Spec 41) - generate with: bunx web-push generate-vapid-keys
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:marcel@example.com
```

`.gitignore`:
```
node_modules/
dist/
.env
.env.local
.env.*.local
*.log
.DS_Store
.idea/
.vscode/
!.vscode/settings.json
!.vscode/extensions.json

# Bun
bun.lockb

# Quasar (added in Spec 30)
.quasar/

# Local dev
*.sqlite
*.sqlite-journal
```

`.editorconfig`:
```ini
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false
```

### Step 6: README

`README.md`:
```markdown
# Marketing Automation Platform

Multi-tenant marketing automation built with Bun + Hono + Drizzle + Quasar PWA.

## Quick Start

```bash
# 1. Install dependencies
bun install

# 2. Set up environment
cp .env.example .env
# Edit .env (at minimum, generate ENCRYPTION_KEY)

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
docs/        Architecture decisions
```
```

### Step 7: Biome Configuration

`biome.json`:
```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "ignore": ["**/dist/**", "**/.quasar/**", "**/node_modules/**", "packages/skills/**"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "style": {
        "useImportType": "error",
        "useNodejsImportProtocol": "error"
      },
      "suspicious": {
        "noConsoleLog": "warn"
      }
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "trailingCommas": "es5",
      "semicolons": "always"
    }
  }
}
```

## Acceptance Criteria

After implementation:

- [ ] `bun install` succeeds with no errors
- [ ] `docker compose up -d` starts both services healthily (`docker compose ps` shows both as healthy)
- [ ] `psql $DATABASE_URL -c "SELECT extname FROM pg_extension"` lists `vector`, `pg_trgm`, `uuid-ossp`
- [ ] `bun run typecheck` passes for all packages
- [ ] `bun run dev:api` starts the server, logs structured JSON
- [ ] `curl http://localhost:3000/health` returns `{"ok":true,"version":"0.1.0",...}`
- [ ] Calling `/health` with invalid HTTP method returns 404 with `{"ok":false,"error":"Not Found"}`
- [ ] `bun run lint` passes with no errors
- [ ] All `CLAUDE.md` files exist (root + apps/api/)
- [ ] `.env.example` is committed, `.env` is in `.gitignore`
- [ ] No secrets committed to repo

## Testing Strategy

For Spec 00, minimal tests are appropriate – this is bootstrap. Add ONE smoke test:

`apps/api/test/health.test.ts`:
```typescript
import { describe, it, expect } from "bun:test";
import app from "../src/server.ts";

describe("GET /health", () => {
  it("returns ok with version", async () => {
    const res = await app.fetch(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe("0.1.0");
    expect(typeof body.uptimeSec).toBe("number");
  });
});
```

Run: `bun test` from repo root.

## Open Questions / Decisions Made

**Decision 1: Biome over ESLint+Prettier.** Biome is a single tool, much faster, well-supported in 2026. If Marcel prefers ESLint, swap during implementation – but Biome is the default.

**Decision 2: pino over winston.** Pino is faster, structured-JSON-native, the standard for Node/Bun in 2026.

**Decision 3: postgres-js over node-postgres.** postgres-js is a pure-JS driver, faster, native promises, better for Bun. Drizzle supports both, we use postgres-js. (This becomes relevant in Spec 01.)

**Decision 4: No monorepo tool (Turborepo/Nx).** For a 2-3-person team and 8 packages, Bun workspaces are sufficient. We can add Turborepo later if build times become an issue.

**Decision 5: Docker for local infra, NOT for app runtime.** App runs natively via `bun` for fast iteration. Docker is only for PG + Redis. Production deployment will be addressed separately (likely Hetzner with systemd or Docker depending on Marcel's preference).

## Implementation Order

For the Claude Code session implementing this spec:

1. Root files: `package.json`, `tsconfig.base.json`, `.gitignore`, `.editorconfig`, `biome.json`
2. `packages/shared/` (config, result, logger, index)
3. `apps/api/` (server, routes/health, CLAUDE.md)
4. `docker/postgres/init.sql` and `docker-compose.yml`
5. `.env.example` and `README.md`
6. Smoke test
7. `bun install` and verify everything starts
8. `bun run typecheck` and fix any issues
9. Commit: `feat: foundation setup (spec 00)`

## Splitting Plan

This spec is small enough for one session. **No splitting needed.**

## Discovered During Implementation

- **Bun not pre-installed** — had to install via `curl -fsSL https://bun.sh/install | bash` before any `bun` commands worked. Add Bun installation to machine-setup docs when written.
- **`@types/bun` package name vs. tsconfig `types` key** — the npm package is `@types/bun`, but the tsconfig `types` entry must be `"bun"` (folder name under `@types/`). Specifying `"bun-types"` fails silently in some editors but errors in tsc.
- **Zod optional + format validators reject empty strings** — `z.string().startsWith("sk-ant-").optional()` still validates the value when the env var is set to `""` (or inherited from the shell with an unexpected format). Requires an `optionalStr()` helper using `z.preprocess` to coerce empty strings to `undefined`.
- **`console.error` in `getEnv()` is unavoidable** — `createLogger` calls `getEnv()`, so pino cannot be used to log env validation errors. `console.error` with a justification comment is the correct pattern here.

## Deviations

**D1: `tsconfig.base.json` — `types` removed from base, added per-package**
Spec specified `"types": ["bun-types"]` in base. The correct key is `"bun"` (not `"bun-types"`), and it must live in each package's tsconfig alongside a `"typeRoots": ["../../node_modules/@types"]` so tsc resolves it from the workspace root. The base tsconfig no longer sets `types` at all.

**D2: `config.ts` — `optionalStr()` preprocess helper**
Spec showed plain `.optional()` on constrained fields. In practice, env vars set to `""` (or leaking from the shell) bypass `.optional()` and trigger format validators. All optional fields with format constraints now use `optionalStr(schema)` which wraps in `z.preprocess`.

**D3: `logger.ts` — if/return instead of ternary for `transport`**
`exactOptionalPropertyTypes: true` rejects `transport: X | undefined` inline in an object literal passed to pino. The fix is two separate `pino()` call paths (one with transport, one without) rather than a ternary. Same runtime behavior.

**D4: `apps/api/tsconfig.json` — `rootDir` removed**
Spec included `rootDir: "./src"` but test files live in `test/`. Setting `rootDir` while including `test/**/*` causes TS6059. Removing `rootDir` from the api tsconfig resolves this without any functional impact (Bun handles compilation; tsc is typecheck-only here).
