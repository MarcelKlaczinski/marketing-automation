# packages/shared Conventions

Foundational utilities imported by every package. Keep this lean — no business logic.

## Exports
- `getEnv()` / `resetEnvCache()` — Zod-validated env, cached after first call
- `createLogger(name)` — pino factory; pretty in dev, JSON in prod
- `ok()` / `err()` / `tryAsync()` / `trySync()` — Result<T,E> helpers

## brand-tokens (Spec 60.0)

`@marketing-auto/shared/brand-tokens` is the **single source of truth** for the `BrandTokens` type and `brandTokensSchema` Zod schema.

```typescript
import { brandTokensSchema, type BrandTokens, DEFAULT_BRAND_TOKENS } from "@marketing-auto/shared/brand-tokens";
```

- `brandTokensSchema` — canonical Zod schema with `.strip()` and `.default({})` on all sub-objects
- `BrandTokens` — TypeScript type inferred from the schema (no manual maintenance)
- `DEFAULT_BRAND_TOKENS` — `brandTokensSchema.parse({})`, all defaults applied

Key fields added in 60.0:
- `colors.brandHue` (0-360) — replaces `primaryHue`; hue of the brand color scale
- `colors.accentHue` (0-360) — hue of the accent color scale
- `colors.surfaceRaised/Dark`, `surfaceSunken/Dark`, `border/Dark` — optional DS override stops
- `typography.fontFamilyMono` — monospace font stack
- `voice.addressForm` is now `z.enum(["du", "Sie"])` (was `z.string()`)

Deprecated fields (kept for back-compat, remove in Spec 61+):
`colors.surfaceSecondary`, `colors.eyebrowColor`, `colors.primaryHue`, `colors.wikiCream`

Removed fields (DB-only, were never consumed by renderer):
`typography.fontFamilyOptions`, `eyebrowWeight`, `captionWeight`, `headingLetterSpacing`,
`bodyLetterSpacing`, `headingSize`, `subheadSize`, `bodySize`, `eyebrowSize`,
`headingLineHeight`, `bodyLineHeight`

**Data migration:** `packages/db/migrations/scripts/0042-brand-tokens-schema-sync.ts`
**Verification:** `bun run --cwd packages/db verify:brand-tokens-schema`

## Patterns

**Adding new env vars:** always use `optionalStr(schema)` for optional fields that have format constraints (startsWith, email, length). Plain `.optional()` will fail when the var is set to `""` in the shell.

**Extending env schema:** add to `envSchema` in `src/config.ts`, then add the var to `.env.example` with an empty value or comment.

**tsconfig:** each package that extends `tsconfig.base.json` must set its own `"types": ["bun"]`, `"typeRoots": ["../../node_modules/@types"]`, `"allowImportingTsExtensions": true`, and `"noEmit": true`. The base intentionally leaves these unset; without `allowImportingTsExtensions`, every `.ts` import path errors as TS5097.
