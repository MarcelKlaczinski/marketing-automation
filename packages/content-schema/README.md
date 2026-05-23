# @marketing-auto/content-schema

Shared Zod schemas for Astro content collections.

## Layers

- **Layer 1 — Core** (`./core`): universal frontmatter fields (Bucket A + B
  from the Phase-1 discovery audit at
  [docs/discovery/content-schema-synthesis.md](../../docs/discovery/content-schema-synthesis.md)).
- **Layer 2 — Domain extras** (`./domains/<domain>`): per-tenant extras
  (Bucket C). Toolwiki today; balkon-kraft-werk.de + future tenants ship
  their own module alongside.
- **Enums** (`./enums`): cross-package constants — `ARTICLE_COLLECTION_TYPES`
  (the canonical home, formerly in `@marketing-auto/shared`) and
  `COLLECTION_ASTRO_NAME` (Pattern-107 single source, replacing the 4 prior
  copies).
- **Registry** (`./registry`): `projectId → DomainContext` lookup so the
  boundary validator (S1.2) and LLM-output validators can resolve per-tenant
  schemas at runtime.
- **Validators** (`./validators`): pure functions that compose Core + Domain
  extras and enforce the schema at LLM-output time AND at Astro-write time.

## Status

Sprint 2 scaffold (multi-domain-evolution spec). Subtasks populate in order:

- ✅ **S2.1** package skeleton (this file)
- ⏳ S2.2 — `COLLECTION_ASTRO_NAME` migrates from 4 in-tree copies
- ⏳ S2.3 — `ARTICLE_COLLECTION_TYPES` migrates from `@marketing-auto/shared`
- ⏳ S2.4 — Toolwiki extras schemas migrate from `packages/pipelines/.../frontmatter/`
- ⏳ S2.5 — `baseFrontmatter()` Core factory
- ⏳ Sprint 5 S5.2 — Domain-Registry mechanism

## Conventions

- Pure Zod schemas — no I/O, no DB, no LLM. Composable + bundleable in any
  consumer (Marketing-Tool, Astro repos, edge functions).
- Per-domain modules under `./domains/<slug>` are self-contained. Adding a
  new tenant = new directory + register in `./registry`. **No Tool-side
  code edit needed** for a new tenant after Sprint 5.
- Subpath exports (`./core`, `./enums`, etc.) are stable contracts.
  Internal restructure must preserve public-API shape.

## Consumers (as of S2.1)

None yet. S2.2+ wires this package into:

- `packages/pipelines/src/article/blog/persist.ts` (Pattern-107)
- `packages/pipelines/src/article/steps/persist-article.ts` (Pattern-107)
- `packages/pipelines/src/article/lib/canonical-url.ts` (Pattern-107)
- `packages/adapters/astro-sync/src/steps/render-mdx.ts` (Pattern-107 +
  validator wiring)
- `packages/shared/src/types/article-collection.ts` (re-export for back-compat)
