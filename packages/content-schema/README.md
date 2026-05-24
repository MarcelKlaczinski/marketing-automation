# @marketing-auto/content-schema

Shared Zod schemas for Astro content collections — the single source of truth for cross-package taxonomy used by the marketing-tool monorepo AND by tenant Astro repos.

## Layers

- **Layer 1 — Core** (`./core`): universal frontmatter fields (Bucket A + B from the Phase-1 discovery audit at [docs/discovery/content-schema-synthesis.md](../../docs/discovery/content-schema-synthesis.md)). Composed via `baseFrontmatter(locales).merge(<extras>)`.
- **Layer 2 — Domain extras** (`./domains/<slug>`): per-tenant extras (Bucket C). Toolwiki ships today; new tenants register their own module alongside following the [onboarding checklist](../../docs/onboarding/new-domain-checklist.md).
- **Enums** (`./enums`): cross-package constants — `ARTICLE_COLLECTION_TYPES` (the canonical home, re-exported from `@marketing-auto/shared` for back-compat) and `COLLECTION_ASTRO_NAME` (Pattern-107 single source, replacing the 4 prior in-tree copies — see root CLAUDE.md DO-NOT rule).
- **Registry** (`./registry`): `projectId → DomainContext` lookup so the boundary validator (S1.2) + LLM-output validators + manual-brief route can resolve per-tenant schemas at runtime.
- **Validators** (`./validators`): pure DI-style functions — category-reference validator today; `compose.ts` + `boundary.ts` deferred to follow-ups.

## Public API entry points

| Subpath | What you get |
|---|---|
| `@marketing-auto/content-schema` | `ARTICLE_COLLECTION_TYPES`, `ArticleCollectionType`, `COLLECTION_ASTRO_NAME`, `astroFolderFor`, `collectionForAstroFolder` |
| `@marketing-auto/content-schema/core` | `baseFrontmatter`, `seoCore`, `i18nCore`, `clusterCore`, `monetizationCore`, `isoDate`, `imagePath`, `FaqItemSchema`, types |
| `@marketing-auto/content-schema/enums` | Re-export of routing + collection enums (same as root) |
| `@marketing-auto/content-schema/domains/toolwiki` | `BlogExtrasSchema`, `ComparisonExtrasSchema`, `KiWissenExtrasSchema`, `ToolsExtrasSchema`, `UsecasesExtrasSchema`, all their `validate*Extras` helpers, the `toolwikiDomain` DomainSpec, `TOOLWIKI_BLOG_INTENT_TYPES` |
| `@marketing-auto/content-schema/registry` | `DomainSchemaRegistry`, `DomainContext` (`getAllowedCollections`, `getIntentTaxonomy`, `getCollectionToIntentMap`), `CollectionContext` (with `validate` for full base+extras OR `validateExtras` for extras-only LLM output), `DomainSpec` (with optional `validateExtras?` callback for cross-field rules like Toolwiki's `winner=depends`, AND optional `collectionToIntentMap?` for per-tenant manual-brief auto-derive), `createDbBackedRegistry`, `forNicheStatic` |
| `@marketing-auto/content-schema/validators` | `CategoryLookup`, `CategoryValidator`, `createCategoryValidator`, `createInMemoryCategoryLookup` |

## Consumers (as of Sprint 5 ship)

- **`packages/pipelines`** — imports `COLLECTION_ASTRO_NAME` helpers (Pattern-107 single source) + Toolwiki extras schemas + `TOOLWIKI_BLOG_INTENT_TYPES`
- **`packages/adapters/astro-sync`** — imports `astroFolderFor` for the MDX write path
- **`packages/shared`** — re-exports `ARTICLE_COLLECTION_TYPES` from here (back-compat shim, droppable post-BK-launch)
- **`packages/db`** — imports `ARTICLE_COLLECTION_TYPES` via `@marketing-auto/shared` re-export for the Drizzle pgEnum literal list
- **`apps/api`** — imports `collectionForAstroFolder` for the standalone-article wizard

## Conventions

- **Pure Zod schemas** — no I/O, no DB, no LLM. Composable + bundleable in any consumer (Marketing-Tool, tenant Astro repos, edge functions).
- **Per-domain modules** under `./domains/<slug>` are self-contained. Adding a new tenant = new directory + register in the `DomainSpec` map. The registry's DI seams keep this package leaf — no Drizzle import inside `content-schema`.
- **Subpath exports** are stable contracts. Internal restructure must preserve public-API shape.
- **Cross-tenant isolation** — the registry rejects unknown niche/projectId pairs with `null` returns, never throws. Producers escalate.
- **Back-compat re-exports** in `@marketing-auto/shared` + `@marketing-auto/pipelines/article/frontmatter/{comparison,ki-wissen}.ts` are intentionally kept post-S2 — migrated callers can move at their own pace. Drop in a follow-up after BK launches.

## Migration guide

See [`docs/onboarding/new-domain-checklist.md`](../../docs/onboarding/new-domain-checklist.md) for the step-by-step adding-a-new-tenant flow.

For internal consumers migrating from the legacy in-tree shapes:
- `import { COLLECTION_ASTRO_NAME } from "<local-file>"` → `import { astroFolderFor } from "@marketing-auto/content-schema/enums"`
- `import { ARTICLE_COLLECTION_TYPES } from "@marketing-auto/shared"` → keeps working via re-export; new callers should prefer `from "@marketing-auto/content-schema/enums"`
- `import { ComparisonExtrasSchema } from "@marketing-auto/pipelines/article/frontmatter/comparison"` → keeps working via re-export; new callers should prefer `from "@marketing-auto/content-schema/domains/toolwiki"`

## Status

Sprint multi-domain-evolution complete (S2 + S5.2 + S5.3 + Domain-Registry consumer wiring follow-up). The production registry singleton lives at [`packages/pipelines/src/_lib/domain-registry-singleton.ts`](../pipelines/src/_lib/domain-registry-singleton.ts) and all 3 consumers route through it: RenderMdxStep (allowed-collections gate), DraftStep (`validateExtras` for comparison + ki-wissen), and `apps/api/src/routes/projects/briefs.ts` (gate + `GET /brief-options` dynamic taxonomy endpoint). New tenants extend `DOMAIN_SPECS` in the singleton; null-registry paths fall through to legacy validators for back-compat.

## Testing

```bash
bun --filter @marketing-auto/content-schema test     # 85 tests as of S5.2
bun --filter @marketing-auto/content-schema typecheck
```

The package has no production runtime side-effects — only Zod schemas + pure helpers. Tests use in-memory builders (no DB) so the suite is fast (< 100ms total).
