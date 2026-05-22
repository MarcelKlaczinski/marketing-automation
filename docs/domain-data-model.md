# Spec: Multi-Domain-Datenmodell-Evolution — Marketing-Tool

_Branch: `feature/multi-domain-datamodel`_
_Codebase: Marketing-Tool-Monorepo (Bun/Hono/Drizzle/Postgres/BullMQ)_
_Status: Draft._
_Aufwand: ~3-4 Wochen, 5 Sprints._
_Voraussetzung: Spec 64.14 (gelandet, Migration 0092 applied)._
_Parallel-Branch: `feature/schema-consolidation` (Toolwiki-Astro-Repo) — Sync-Punkte unten._

---

## 1. Problem

Marketing-Tool orchestriert heute toolwiki.ai. Geplante zweite Domain: balkon-kraft-werk.de (greenfield Astro). Heutige Code-Realität (aus Phase-2-Discovery-Audit `docs/discovery/marketing-tool-datenmodell-synthese.md`):

1. **Toolwiki-Bias hardcodiert in DB-Schema:** `articleCollectionTypeEnum` (5 Werte), `PlanningContentType` (5 Werte), `external_signals.source` CHECK, `topic_briefs.source`+`cluster_action` CHECKs, `cron_job_type` Enum (4/11 AI-spezifisch), `tool_*`-Spalten auf zentraler `articles`-Tabelle.
2. **8 LLM-Prompts hartcodiert mit "toolwiki.ai" + "AI tools":** `draft.ts:84`, `outline.ts:58-73`, `prompts/comparison.ts:68-73`, `prompts/ki-wissen.ts:95-102`, `social-image/steps.ts:737`+`:758-780`, `social-image/hookPrompt.ts` (6 Hook-Templates). Plus Spec 64.14 hat Counter-Examples + Positive-Examples in `trend-discovery/prompts.ts` hinzugefügt — alle Toolwiki-biased.
3. **`COLLECTION_ASTRO_NAME` in 4 Kopien** (Pattern-107-Realität, dokumentiert 3): `blog/persist.ts:18`, `steps/persist-article.ts:10`, `lib/canonical-url.ts:24`, `astro-sync/src/steps/render-mdx.ts:9-15`.
4. **Kein Boundary-Validator beim Astro-Write:** `RenderMdxStep` schreibt YAML ohne Zod-Validation. Bei Schema-Drift Tool↔Repo → Silent Build Drop → 404 zur Runtime.
5. **Lost-Update-Risiken beim Refresh:** `featured`, `tool_pricing`, manuelle Frontmatter-Edits werden überschrieben. Keine Field-Authority-Marker.
6. **Drei Category-Modelle in Toolwiki, null Tool-Side-Constraint:** `articles.category text` ohne FK/CHECK. BK braucht Categories-System, das beide Domains tragen kann.
7. **Kein geteiltes Zod-Package:** Schemas verstreut in `packages/shared`, `packages/pipelines/.../frontmatter/`, `packages/adapters/astro-sync`. Kein Single-Source zwischen Tool und Astro-Repo. Spec 50 (`ExtractCollectionSchemasStep`) ist Workaround-Code.

## 2. Ziel

Marketing-Tool von Toolwiki-spezifisch → Multi-Domain-Astro-Orchestrierung evolvieren. Konkrete Trigger-Domain: balkon-kraft-werk.de. Nach diesem Branch soll eine 3., 4. Domain onboardbar sein **ohne Tool-Code-Änderung** — nur via Project-Config + Domain-Extras-Schema im Workspace-Package.

**Constraint:** Toolwiki-Pipelines produzieren **funktional identische Outputs** zu vor diesem Branch. Snapshot-Tests sind Pflicht-Gates.

**In Scope:**

- DB-Schema-Evolution: `content_categories`-Tabelle, `articleCollectionTypeEnum` + `PlanningContentType` aufweichen, `tool_*`-Spalten semantisch taggen
- Workspace-Package `@marketing-auto/content-schema` erstellen + 4+ interne Konsumenten umstellen
- Boundary-Validator beim Astro-Repo-Write
- Refresh-Field-Whitelist (Lost-Update-Mitigation)
- LLM-Prompt-Tenant-Var-Swap (9 Hartcode-Stellen inkl. 64.14-Counter-Examples)
- `intentType` Hartcode → `project_configurations.intentTaxonomyDefault` lesen
- `deriveIntentFromCollection()` in Manual-Brief-Route (64.14-Erbe) domain-konfigurierbar
- Pattern-107-Konsolidierung
- Domain-Registry-Mechanismus

**Out of Scope:**

- BK-Astro-Repo bootstrappen (separater Branch)
- BK-Domain-Extras-Schema schreiben (Post-Branch)
- Field-Authority-Marker (Phase-3-Feature)
- Spec-50 deprecaten (Post-BK-Aufräum-Aktion)
- `astro-sync` Adapter vollständig Multi-Domain (Pattern-107-Konsolidierung reicht)
- `pagespeed` Adapter Multi-Domain (BK nutzt erstmal Astro-Variant)
- `frontmatter_extras` → `domain_extras` Rename (optional, nicht kritisch)
- Signal-Adapter-Defaults pro Industry-Profile (BK-Onboarding-Scope, später)
- Theme 65 (Recurring Content System) Koordination

## 3. Architektur

### 3.1 Sprint 1 — Safety-Layer (Woche 1)

**S1.1 Refresh-Field-Whitelist** (2-3h)

Datei: `packages/pipelines/src/article/refresh/steps/persist-body.ts` (oder analog je nach Refresh-Pipeline-Layout)

```ts
const REFRESH_PRESERVED_FIELDS = [
  'featured',
  'tool_pricing',
  'tool_price_from',
  'tool_rating',
  'tool_votes',
  'tool_affiliate_slug',
  'pricingVerifiedAt',
] as const;
```

Pattern:
- Pre-Refresh: SELECT auf aktuellen `articles`-Row für Whitelist-Felder
- Post-Refresh: UPDATE-Set ohne Whitelist-Felder, alte Werte bleiben
- Falls die Felder im LLM-Output erscheinen, ignorieren (LLM darf vorschlagen, Whitelist gewinnt)

**S1.2 Boundary-Validator beim Astro-Write** (1 Tag)

Datei: `packages/adapters/astro-sync/src/steps/render-mdx.ts`

Heutiger Field-Filter `render-mdx.ts:226-232` ist heuristisch (Field-Set aus Spec-50-JSONB) und filtert silent. Verschärfen:

```ts
// Pre-Write-Hook
import { domainSchemaRegistry } from "@marketing-auto/content-schema";
// (Wenn Domain-Registry noch nicht da: Spec-50-JSONB als Übergang)

const validation = await validateFrontmatterAgainstSchema(
  buildFrontmatter(article),
  project.astroCollectionSchemas[article.collection],
);

if (!validation.success) {
  throw new AstroSyncValidationError({
    articleId: article.id,
    collection: article.collection,
    fieldPath: validation.error.path,
    expected: validation.error.expected,
    actual: validation.error.actual,
  });
}
```

Error-Class neu definieren in `packages/adapters/astro-sync/src/errors.ts`. Pattern-Referenz: D132 (Drizzle-Constraint-Widening braucht eigene Migration; hier Zod-at-Write statt CHECK).

**S1.3 Notification-Wiring für Boundary-Validation-Failures** (2-3h)

Pattern-Referenz: D64.11 (Worker-Lifecycle-Notifications).

```ts
// In ArticleSyncPipeline error handler
if (error instanceof AstroSyncValidationError) {
  await notifyOwners({
    projectId,
    severity: 'critical',
    title: `Astro-Sync blockiert: ${error.collection}/${article.slug}`,
    body: `Field "${error.fieldPath}" failed validation. Expected: ${error.expected}, Actual: ${error.actual}`,
    channel: 'sse_push',
  });
}
```

### 3.2 Sprint 2 — Workspace-Package extrahieren (Woche 1-2)

**Sync-Punkt:** Nach Sprint 2 kann Branch B Sprint 5 starten.

**S2.1 `packages/content-schema` Workspace anlegen** (4h)

Struktur:

```
packages/content-schema/
├── package.json (name: "@marketing-auto/content-schema", type: "module")
├── tsconfig.json (strict, ESM, .d.ts emit)
├── src/
│   ├── index.ts                   # Public API
│   ├── core/
│   │   ├── seo.ts                 # seoCore zod
│   │   ├── i18n.ts                # i18nCore factory (locale-konfigurierbar)
│   │   ├── cluster.ts             # clusterCore
│   │   ├── monetization.ts        # monetizationCore factory
│   │   └── base.ts                # baseFrontmatter composition
│   ├── enums/
│   │   ├── collection.ts          # ARTICLE_COLLECTION_TYPES
│   │   ├── routing.ts             # COLLECTION_ASTRO_NAME (single source)
│   │   └── intent.ts              # IntentType-Sets (per-domain)
│   ├── domains/
│   │   └── toolwiki/
│   │       ├── index.ts
│   │       ├── extras-blog.ts
│   │       ├── extras-comparison.ts
│   │       ├── extras-ki-wissen.ts
│   │       ├── extras-tools.ts
│   │       └── extras-usecases.ts
│   ├── registry/
│   │   ├── types.ts
│   │   └── domain-registry.ts
│   └── validators/
│       ├── compose.ts             # buildArticleSchema(locales, extras)
│       ├── boundary.ts            # validateFrontmatterAtWrite
│       └── categories.ts          # validateCategoryReference (DB-injected)
└── README.md
```

`package.json`:

```json
{
  "name": "@marketing-auto/content-schema",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js",
    "./core": "./dist/core/index.js",
    "./domains/toolwiki": "./dist/domains/toolwiki/index.js",
    "./registry": "./dist/registry/index.js",
    "./validators": "./dist/validators/index.js"
  },
  "dependencies": {
    "zod": "^3.x"
  }
}
```

Root-`package.json` Workspaces-Array um `packages/content-schema` ergänzen.

**S2.2 `COLLECTION_ASTRO_NAME` Single-Source** (3-4h)

Quelle: `packages/content-schema/src/enums/routing.ts`. Re-Export aus Package.

4 existierende Kopien ersetzen:
- `packages/pipelines/src/article/blog/persist.ts:18`
- `packages/pipelines/src/article/steps/persist-article.ts:10`
- `packages/pipelines/src/article/lib/canonical-url.ts:24`
- `packages/adapters/astro-sync/src/steps/render-mdx.ts:9-15`

**CLAUDE.md-Update (Root):** Pattern-107 ablösen. Neuer Wortlaut sinngemäß: "Cross-package constants used by Tool and Astro repos live in `@marketing-auto/content-schema` as single source. Previous 'intentional duplication for module-independence' (Pattern-107) is deprecated."

**S2.3 `ARTICLE_COLLECTION_TYPES` umziehen** (1-2h)

Quelle: `packages/shared/src/types/article-collection.ts` → `@marketing-auto/content-schema/enums/collection`.

Re-Export aus `packages/shared` für Backward-Compat während Migration.

Drizzle-`$type<>()`-Cast in `packages/db/src/schema/_enums.ts:127` aktualisieren. Note: das pgEnum-Casting bleibt erstmal in DB (Aufweichung erst in Sprint 4).

**S2.4 Extras-Schemas umziehen** (4-6h)

Quellen:
- `packages/pipelines/src/article/frontmatter/comparison.ts` → `domains/toolwiki/extras-comparison.ts`
- `packages/pipelines/src/article/frontmatter/ki-wissen.ts` → `domains/toolwiki/extras-ki-wissen.ts`

Neu erstellen (aus Phase-1-Discovery-Inventar):
- `extras-blog.ts`: `intentType, bottomLinksVariant, primaryTool, showTopicLinks`
- `extras-tools.ts`: `features, pros, cons, useCases, integrations, pricing, priceFrom, rating, votes, affiliateSlug, website, relatedPillars`
- `extras-usecases.ts`: `relatedTags, industryFocus, featuredToolSlugs, highlights, contentType`

Validierungs-Pfade in Pipelines (LLM-Output-Check) auf neue Importpfade umstellen.

**S2.5 `baseFrontmatter()` Core-Factory** (1 Tag)

Datei: `packages/content-schema/src/core/base.ts`.

Locale-Liste konfigurierbar pro Domain. `publishedAt` + `updatedAt` als kanonisches Datums-Paar (löst Phase-1-E13).

Test: Toolwiki-Blog-Schema lässt sich als `baseFrontmatter(['de','en']).merge(ToolwikiBlogExtras)` komponieren ohne Type-Errors.

### 3.3 Sprint 3 — Categories-Refactor (Woche 2-3)

**Sync-Punkt:** Nach Sprint 3 kann Branch B Sprint 3 starten (Categories-Files mit identischen Slugs).

**S3.1 `content_categories` Tabelle** (4-6h)

Datei: `packages/db/src/schema/categories.ts`.

```ts
export const contentCategories = pgTable("content_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  scope: text("scope").notNull(), // 'tool' | 'blog' | 'knowledge' | 'usecase' | ...
  parentSlug: text("parent_slug"), // app-Layer-validated, kein DB-FK (Selbst-Referenz-Komplexität)
  translations: jsonb("translations").$type<Record<string, { label: string; urlSlug: string }>>().notNull(),
  icon: text("icon"),
  color: text("color"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("content_categories_project_scope_slug_idx").on(t.projectId, t.scope, t.slug),
]);
```

Migration: separate von Seed-Data (D124 — kein Seed in Type-Migration).

**S3.2 Seed-Migration für Toolwiki-Kategorien** (2-3h)

Separate Migration. Idempotent (`ON CONFLICT (project_id, scope, slug) DO NOTHING`).

Seedet aus Phase-1-Inventar:
- 7 Tool-Top-Level (Werte + DE/EN-Übersetzungen + urlSlugs aus heutiger `URL_SLUG_MAP`)
- 13 Tool-Subcategories
- 6 Blog-Categories: `'Guides & Tutorials'` → `guides-tutorials`, etc.
- 5 Knowledge-Categories: `'Grundlagen'` → `fundamentals`, etc.

**Wichtig für SEO:** `urlSlug`-Werte exakt identisch zur heutigen `URL_SLUG_MAP` in Toolwiki-Repo. Branch B Sprint 3.1 nutzt diesen Seed als Single-Source.

**S3.3 Validator-Helper** (3-4h)

Datei: `packages/content-schema/src/validators/categories.ts`.

```ts
export interface CategoryValidator {
  isValidReference(
    slug: string,
    scope: CategoryScope,
    projectId: string,
  ): Promise<boolean>;
}

export function createCategoryValidator(db: DrizzleDb): CategoryValidator {
  // DI-Pattern: Package kennt keine DB-Connection-Details
  // ...
}
```

Genutzt von:
- `RenderMdxStep` (Boundary-Validator-Extension)
- LLM-Output-Validation in `DraftStep`

**S3.4 `articles.category` weich an Categories-Tabelle koppeln** (2-3h)

**KEINE** Migration der bestehenden Werte (additive Phase).

Neuer Soft-Validator in `DraftStep`-Output: Kategorie sollte in `content_categories` für `(projectId, scope)` existieren. Bei Mismatch: Soft-Warning (Notification, severity=info), kein Throw.

Sammelt Daten für S3.5-Audit.

**S3.5 `articles.category`-Werte konsolidieren** (1 Tag)

Read-Only-Audit:
```sql
SELECT DISTINCT a.category, a.collection, COUNT(*)
FROM articles a
WHERE a.project_id = '<toolwiki>'
  AND a.category NOT IN (
    SELECT slug FROM content_categories
    WHERE project_id = a.project_id
  )
GROUP BY a.category, a.collection;
```

Migration-Script (Tool-CLI, kein Auto-Run):
- Backup: `ALTER TABLE articles ADD COLUMN category_legacy text; UPDATE articles SET category_legacy = category;`
- Map jeden ungemappten Wert → Categories-Slug (manuelle Review-Pflicht)
- Dry-Run-Mode pflicht (Pattern: "Verify-Gate als Spec-Source-of-Truth")
- Verify-SQL: `SELECT COUNT(*) FROM articles WHERE category NOT IN (SELECT slug FROM content_categories ...) = 0`

### 3.4 Sprint 4 — Toolwiki-Bias rauslösen (Woche 3-4)

**S4.1 `tool_*`-Spalten semantisch taggen** (2-3h)

Persist-2 Variant (a) aus Phase-2-Audit.

Keine Schema-Änderung. Code-Konvention via Header-Kommentar in `packages/db/src/schema/content.ts`:

```ts
/**
 * BUCKET-C TOOLWIKI-PROMOTION (Phase-1-Discovery)
 *
 * Columns prefixed `tool_*` are Toolwiki-domain-specific promotions.
 * Non-Toolwiki projects leave these NULL.
 *
 * Future per-domain promoted columns follow pattern `<domain>_*`
 * (e.g. `product_einspeisung_w` for balkon-kraft-werk.de if needed).
 */
tool_pricing: text("tool_pricing"),
// ...
```

`buildToolColumns()` in `astro-sync/src/import/steps/upsert-articles.ts` mit Domain-Guard:

```ts
async function buildToolColumns(frontmatter, projectId, db) {
  const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
  if (project.industry !== 'ai_education') return {}; // BK-Project lässt tool_* NULL
  // ... existing logic
}
```

**S4.2 `articleCollectionTypeEnum` + `PlanningContentType` aufweichen** (1 Tag)

Migration: pgEnum-Casts entfernen.

```sql
-- articleCollectionTypeEnum
ALTER TABLE articles
  ALTER COLUMN collection TYPE text;
-- pgEnum bleibt vorerst in DB, wird nach Migration in Drizzle nicht mehr referenziert
```

Validierung wandert in `@marketing-auto/content-schema/registry`:

```ts
export interface DomainCollectionRegistry {
  getAllowedCollections(projectId: string): Promise<string[]>;
  isAllowed(projectId: string, collection: string): Promise<boolean>;
}
```

Default-Werte für Toolwiki: aus `ARTICLE_COLLECTION_TYPES`. Per-Project-Override via `projects.allowed_collections` JSONB (neue Spalte, nullable, NULL = use defaults).

`PlanningContentType` analog:
- `packages/shared/src/types/project-config.ts:SIGNAL_SOURCE_CONTENT_TYPE_MAP_SCHEMA` (von 64.14) listet heute `["cluster", "cluster_spoke", "comparison", "social_post", "ki_wissen"]` hardcoded
- Refactoring: Liste aus Domain-Registry ziehen, nicht hardcoded
- 64.14-`signal_source_content_type_map` Validation bleibt funktional gleich, nur Werte-Set wird per-Project

**S4.3 `intentType` Per-Project-Config** (1 Tag)

`project_configurations.intentTaxonomyDefault` existiert bereits (Spec 54.2).

`DraftStep`-Prompt + `OutlineStep`-Prompt: hartcodiertes 9-Werte-Enum durch Config-Lookup ersetzen.

Pattern-Referenz: 64.14 nutzt `project_planner_config.signal_source_content_type_map` als JSONB-Override. **Diese Architektur-Referenz übernehmen**, keine neue erfinden.

Default-Werte für Toolwiki: bestehender 9-Werte-Set bleibt unverändert in `project_configurations` für Toolwiki-Project.

`deriveIntentFromCollection()` in `apps/api/src/routes/projects/briefs.ts` (Manual-Brief-Route aus 64.14 Phase C) ebenfalls auf Config-Lookup umstellen:

```ts
async function deriveIntentFromCollection(
  collection: string,
  projectId: string,
): Promise<IntentType> {
  const config = await loadProjectConfiguration(projectId);
  const mapping = config.collectionToIntentMap ?? DEFAULT_COLLECTION_TO_INTENT_MAP;
  return mapping[collection] ?? 'use_case';
}
```

**S4.4 LLM-Prompt-Tenant-Var-Swap** (1-2 Tage)

9 Hartcode-Stellen aus Phase-2-Audit + 64.14:

1. `steps/draft.ts:84` + `:86-88` — "You are writing the FULL DRAFT of an article for toolwiki.ai..."
2. `steps/outline.ts:58-61` + `:63-73` — "You are producing the OUTLINE for an article on toolwiki.ai..."
3. `prompts/comparison.ts:68-73` — Komplette Scope-Check-Block
4. `prompts/ki-wissen.ts:95-102` — "FULL DRAFT of a KNOWLEDGE PILLAR article for the ki-wissen collection on toolwiki.ai..."
5. `social-image/steps.ts:737` — "You are an editor for toolwiki.ai..."
6. `social-image/steps.ts:758-780` — Hartcodierte URLs `toolwiki.ai/${slug}`
7. `social-image/hookPrompt.ts` — Alle 6 Hook-Templates "German AI tools niche"
8. `social-image/hookEngine.ts:8,10` — Fallback-Keyword "KI-Tools"
9. **NEU aus 64.14:** `topic-sources/trend-discovery/prompts.ts` — `KNOWLEDGE_COUNTER_EXAMPLES` + `KNOWLEDGE_POSITIVE_EXAMPLES` (12 Toolwiki-biased Examples)

Variablen-Source:
- `projects.domain` — z.B. "toolwiki.ai" oder "balkon-kraft-werk.de"
- `projects.marketingContextMd` — Niche-Statement aus Cold-Start Phase 1
- Neue Spalte: `projects.classifier_examples` JSONB — Strukturierte Examples für Synthesizer

```ts
// projects.classifier_examples JSONB shape:
{
  knowledge: {
    counterExamples: [
      { title: string; reasonExcluded: string; correctIntent: string }
    ],
    positiveExamples: [
      { title: string; reasonIncluded: string }
    ]
  },
  // weitere Klassifikations-Kategorien...
}
```

Migration: `ALTER TABLE projects ADD COLUMN classifier_examples jsonb;`

Seed für Toolwiki: die 12 Examples aus 64.14 (`I've joined Anthropic`, `Was ist RAG?`, etc.).

**Test:** Snapshot-Test pro Prompt-Template — Toolwiki-Run produziert identische Prompts wie vor Refactor (Byte-Diff). Mock-BK-Project (Test-Fixture) produziert BK-Variante mit anderen Counter-Examples.

**S4.5 Test-Suite für Synthesizer-Prompt anpassen** (3-4h)

Datei: `packages/pipelines/test/topic-sources/trend-discovery/prompts.test.ts` (von 64.14).

Heute: 5 Regression-Guards für hardcoded Toolwiki-Examples.

Refactor: Per-Project-Fixtures. Tests laden Test-Project mit `classifier_examples` JSONB + verifizieren, dass die Prompt-Output die Project-spezifischen Examples enthält.

Toolwiki-Test-Fixture nutzt weiterhin die 12 64.14-Examples (Regression-Guard für Toolwiki bleibt erhalten). Zusätzlich BK-Test-Fixture mit Solar-Examples als Multi-Domain-Beweis.

### 3.5 Sprint 5 — Polish (Woche 4)

**S5.1 `frontmatter_extras` → `domain_extras` Rename** (optional, 4-6h)

Skippbar wenn Sprint 1-4 schon viel berührt hat. Rein semantischer Win, signalisiert Layer-2-Status.

Rename in:
- Drizzle-Spalte
- ~15 Code-Stellen
- Pipeline-Output-Builders

**S5.2 Domain-Registry-Mechanismus** (1-2 Tage)

Datei: `packages/content-schema/src/registry/domain-registry.ts`.

```ts
export interface DomainSchemaRegistry {
  forProject(projectId: string): DomainContext;
}

export interface DomainContext {
  forCollection(name: string): CollectionContext;
  getAllowedCollections(): string[];
  getIntentTaxonomy(): string[];
  getCategorySlugs(scope: CategoryScope): Promise<string[]>;
}

export interface CollectionContext {
  validate(frontmatter: unknown): SafeParseResult;
  getCoreSchema(): ZodSchema;
  getExtrasSchema(): ZodSchema;
}
```

Bootstrapping beim Worker-Start: Registry lädt alle `projects.domain` + zugehörige Domain-Module aus `@marketing-auto/content-schema/domains/*`.

Toolwiki-Domain → `domains/toolwiki/*`. BK-Domain wird in Post-Branch-Phase angelegt.

Genutzt von:
- Boundary-Validator (S1.2) statt direktem Spec-50-JSONB-Lookup
- Manual-Brief-Route (64.14) für `getAllowedCollections()`
- LLM-Output-Validators in Pipelines

**S5.3 Dokumentation** (1 Tag)

- Update `CLAUDE.md` Root: Pattern-107-Update, neue Multi-Domain-Architecture-Section
- Neue Datei: `docs/onboarding/new-domain-checklist.md` — Step-by-Step für 3., 4. Domain
- Update `packages/content-schema/README.md`: Konsumenten-Liste, Versionierung, Migration-Guide
- Update Memory-Patterns wenn nötig

## 4. Tests

**Pro Sprint:**
- Unit-Tests in `__tests__/`-Ordnern (D-Convention)
- Bun-Test-Runner
- Keine Smoke-Tests

**Cross-Sprint:**

- **Snapshot-Test Toolwiki-Pipelines:** Vor Sprint 1 Snapshot-Baseline aller LLM-Prompts (Toolwiki-Project). Nach jedem Sprint Snapshot-Diff. Toolwiki-Output muss byte-identisch bleiben (außer für intentionale Strukturänderungen wie Datums-Felder).
- **Boundary-Validator-Tests:** Künstlich invalides Frontmatter (`category: 123` statt String, fehlendes Required-Field) → muss Throw, nicht Silent-Drop.
- **Refresh-Whitelist-Test:** Article mit `featured: true` → Refresh-Lauf → `featured` bleibt `true`.
- **Categories-Validator-Test:** Unbekannter Category-Slug → Soft-Warning (S3.4), Validator-Reject (S3.5+).
- **Multi-Domain-Fixture:** Mock-BK-Project (Test-only, in DB nicht persistiert) mit eigenen `classifier_examples`, `intentTaxonomyDefault`, `allowed_collections`. Pipeline-Test-Run erzeugt BK-Variante ohne Toolwiki-Strings.

**Pre-Sprint-1-Acceptance:**
- 64.14-Migration 0092 verifiziert applied (`SELECT * FROM project_planner_config LIMIT 1` enthält `signal_source_content_type_map`-Spalte)
- Snapshot-Baseline der Toolwiki-Prompts erstellt + commited als `__tests__/snapshots/baseline-toolwiki-prompts.json`

## 5. Acceptance

1. Toolwiki-Pipelines produzieren funktional identische Outputs (Snapshot-Test pass)
2. Boundary-Validator schließt L5-Lost-Update-Risiko (artifizielles Bad-Frontmatter throw't, kein Silent-Drop)
3. Refresh-Field-Whitelist erhält `featured` + `tool_*` Werte bei Refresh-Lauf
4. `content_categories`-Tabelle existiert, 31+ Toolwiki-Slugs geseedet (identisch zu Branch-B Sprint 3.1)
5. `@marketing-auto/content-schema` Workspace-Package ist von 4+ internen Konsumenten importiert
6. `COLLECTION_ASTRO_NAME` existiert nur noch in 1 Datei (`@marketing-auto/content-schema/enums/routing`)
7. LLM-Prompts in 9 Hartcode-Stellen lesen aus `projects.domain` / `projects.marketingContextMd` / `projects.classifier_examples`
8. `articleCollectionTypeEnum` + `PlanningContentType` sind nicht mehr pgEnum, sondern text + Domain-Registry-validated
9. `intentType` + `deriveIntentFromCollection()` lesen aus `project_configurations.intentTaxonomyDefault` / `collectionToIntentMap`
10. Mock-BK-Project erzeugt domain-spezifische Outputs ohne Code-Change (Test-Fixture-Beweis)
11. Workspace-typecheck: alle Packages, 0 errors
12. Test-Suites grün: pipelines, api, db, planner — keine Regressions
13. CLAUDE.md aktualisiert (Pattern-107-Update, Multi-Domain-Section)
14. `docs/onboarding/new-domain-checklist.md` existiert

## 6. Cross-Cutting-Regeln

- **Multi-Tenant-Invariante (CLAUDE.md):** Alle neuen Tabellen + Spalten haben `project_id` FK. `content_categories` ja. `projects.allowed_collections` JSONB ja. `projects.classifier_examples` JSONB ja.
- **Migrations-Patterns (D124, D132):** Type-Migration und Seed-Migration getrennt. Constraint-Widening via separate Migration. Keine `cron_state`-Seeds in Type-Migrations.
- **Drizzle-Conventions (D132):** Numeric columns als `$type<string>()`. JSONB-Spalten als `$type<DomainType>()` typed.
- **Pattern-107 wird abgelöst:** Single source via `@marketing-auto/content-schema`. CLAUDE.md-Update Sprint 2.2.
- **64.14-Architektur-Referenz:** Per-Project-Config-Pattern via JSONB-Override mit NULL-default = use system-default. Mirror dieses Pattern in S4.2, S4.3, S4.4.
- **Commit-Pattern:** Granulare Commits pro Sprint-Sub-Task. Sprint-Boundaries als Merge-Commits in Feature-Branch.
- **Spec-Format:** Sprint-Ende „Implemented" + „Discovered & Deviations" Sections in `docs/specs/multi-domain-evolution/S<N>.md`.
- **Test-Coverage:** Mindestens 1 Test pro Sub-Task. Bei DB-Schema-Änderungen Migrations-Apply-Verifikation.

## 7. Decisions (vorab geklärt mit Marcel)

| # | Decision | Empfehlung | Begründung |
|---|---|---|---|
| D1 | Persistenz-Option | Persist-2-Sharpened Variant (a) — `tool_*`-Tagging, keine Migration zurück ins JSONB | Behält Spec 54.8 Field-Promotion-Performance für Toolwiki; BK lässt Spalten NULL |
| D2 | Zod-Package extrahieren | JETZT, vor BK-Aufschlag | Sonst Schema-Drift zwischen Tool und neuem BK-Astro-Repo unkontrolliert |
| D3 | Categories-Refactor | JETZT, parallel zu Astro-Repo-Refactor | 3 Modelle bleiben in Toolwiki, BK braucht 4. Modell → Anti-Pattern |
| D4 | `tool_*`-Spalten | Tag-only (Variant a) | Pragmatic, 0 Migration. Later-Refactor optional. |
| D5 | `relatedPillars` Tool-Seite | Akzeptieren (JSONB), Repo-seitig in Branch B refactoren | Tool-Seite ist nicht das Problem |
| D6 | Domain-Plugin-Pattern | Repo (BK-spezifische Logik), Tool wissensfrei | Tool bleibt rein Content-Generator |
| D7 | Boundary-Validator | Sprint 1, nicht Sprint 5 | Heute Live-Bug-Risiko |
| D8 | Field-Authority-Marker | Phase-2 später, nicht in diesem Refactor | Whitelist reicht für jetzt |
| D9 | `frontmatter_extras` Rename | Optional in Sprint 5 | Skippbar wenn Sprint 1-4 schon viel berührt |
| D10 | Onboarding-Workflow | `docs/onboarding/new-domain-checklist.md` als Output | 3., 4. Domain trivialisieren |

## 8. Sync-Punkte mit Branch B (Toolwiki-Astro)

| Branch-A-Sprint | Branch-B-Sprint | Sync-Bedingung |
|---|---|---|
| Sprint 2 (Workspace-Package) | Sprint 5 (Schema-Package-Integration) | A.2 muss komplett sein bevor B.5 starten kann |
| Sprint 3 (Categories Tool-seitig) | Sprint 3 (Categories-Files Astro) | A.3.2 Seed-Daten definieren die Slug-Werte für B.3.1 — A.3.2 muss zuerst sein |
| keine direkte Abhängigkeit | Sprint 1+2+4 | können parallel zu A laufen |

**Empfohlene Bearbeitungs-Reihenfolge:**

1. A-Sprint 1 (Safety-Layer)
2. A-Sprint 2 (Workspace-Package)
3. B-Sprint 1+2 parallel zu A-Sprint 3
4. A-Sprint 3 (Categories Tool)
5. B-Sprint 3 (Categories Astro)
6. A-Sprint 4 + B-Sprint 4 parallel
7. B-Sprint 5 (Schema-Package-Integration)
8. A-Sprint 5 (Polish)

## 9. Risiken & Mitigation

| # | Risiko | Mitigation |
|---|---|---|
| R1 | 64.14-Migration 0092 nicht überall angewendet → S4.2 Caller bricht | Pre-Sprint-1-Verify-Step |
| R2 | Categories-Migration bricht 268 imported Articles | S3.4 additiv, alte Werte parallel via `category_legacy` |
| R3 | Snapshot-Test-Drift durch Toolwiki-Background-Aktivität (LLM-Output Re-Run) | Snapshot-Test gilt für Prompt-Strings, nicht LLM-Output |
| R4 | Workspace-Package-Setup bricht TypeScript-Build | TS-Project-References pflegen, Build-Test in S2.1 |
| R5 | Domain-Registry-Performance bei Worker-Start | Lazy-Load + Cache; analog zu `_toolIndex`-Pattern |
| R6 | `tool_*`-Domain-Guard verhindert versehentlich Toolwiki-Imports | Industry-Check `'ai_education'`-Default + Test-Fixture für Toolwiki |
| R7 | Pattern-107-Konsolidierung bricht ein vergessenes Modul | grep -r "COLLECTION_ASTRO_NAME" vor S2.2 vollständig auflisten |
| R8 | Sync-Punkt A.3 → B.3 verzögert sich | Sub-Sprint A.3.2 priorisieren, B.3 wartet darauf |

## 10. Offene Fragen für Marcel

1. **Wann ist BK-Launch geplant?** Konservativ 6 Wochen ab Branch-Start angenommen. Wenn früher: Sprint 5 (Polish) komprimieren.
2. **Spec-50 (`ExtractCollectionSchemasStep`) deprecaten?** Default: nein, bleibt als Fallback. Deprecation ist Post-BK-Aufräum-Aktion.
3. **Werden bestehende Toolwiki-Pipelines während des Refactors live laufen?** Default: ja, Tool ist Production. Daher additive Migrationen, keine Drop-Spalten ohne Übergangsphase.
4. **`frontmatter_extras` → `domain_extras` Rename: Sprint 5 oder Post-BK?** Default: Sprint 5 wenn Zeit, sonst Post-BK.

## 11. Implemented

_(wird beim Spec-Abschluss gefüllt)_

## 12. Discovered & Deviations

_(wird beim Spec-Abschluss gefüllt)_
_(wird beim Spec-Abschluss gefüllt)_
