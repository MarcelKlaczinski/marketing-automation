# packages/shared Conventions

Foundational utilities imported by every package. Keep this lean — no business logic.

## Exports
- `getEnv()` / `resetEnvCache()` — Zod-validated env, cached after first call
- `createLogger(name)` — pino factory; pretty in dev, JSON in prod
- `ok()` / `err()` / `tryAsync()` / `trySync()` — Result<T,E> helpers

## Patterns

**Adding new env vars:** always use `optionalStr(schema)` for optional fields that have format constraints (startsWith, email, length). Plain `.optional()` will fail when the var is set to `""` in the shell.

**Extending env schema:** add to `envSchema` in `src/config.ts`, then add the var to `.env.example` with an empty value or comment.

**tsconfig:** each package that extends `tsconfig.base.json` must set its own `"types": ["bun"]`, `"typeRoots": ["../../node_modules/@types"]`, `"allowImportingTsExtensions": true`, and `"noEmit": true`. The base intentionally leaves these unset; without `allowImportingTsExtensions`, every `.ts` import path errors as TS5097.
