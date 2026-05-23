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

### Sprint 1 — Safety-Layer

**S1.1 Refresh-Field-Whitelist** (committed 2026-05-23, branch `feature/multi-domain-datamodel`)

- New module [`packages/pipelines/src/article/refresh/preserved-fields.ts`](../../../packages/pipelines/src/article/refresh/preserved-fields.ts):
  - `REFRESH_PRESERVED_COLUMNS` (5 `tool_*` promoted columns — defensive guard, currently not written by `PersistArticleStep`)
  - `REFRESH_PRESERVED_EXTRAS_KEYS` (`featured`, `pricingVerifiedAt` — JSONB keys, actual lost-update surface)
  - Pure `mergePreservedExtras(current, incoming)` helper
- [`PersistArticleStep`](../../../packages/pipelines/src/article/steps/persist-article.ts) now SELECTs `frontmatter_extras` alongside `bodyMd` inside its transaction and merges the whitelist before UPDATE
- 16 new tests (8 helper-unit + 8 static-source RefreshPipeline regression guard)
- Full pipelines suite 678/0/74, workspace typecheck 0 errors across 24 packages
- [packages/pipelines/CLAUDE.md](../../../packages/pipelines/CLAUDE.md) gets new subsection "Editorial-field preservation in PersistArticleStep"

**S1.2 Boundary-Validator beim Astro-Write** (committed 2026-05-23)

- New module [`packages/adapters/astro-sync/src/errors.ts`](../../../packages/adapters/astro-sync/src/errors.ts):
  - `AstroSyncValidationError` class carrying `articleId` + `collection` + structured `ValidationFailureDetail[]` (failure reasons: `missing_required` / `type_mismatch` / `enum_mismatch`)
- New module [`packages/adapters/astro-sync/src/lib/validate-frontmatter.ts`](../../../packages/adapters/astro-sync/src/lib/validate-frontmatter.ts):
  - Pure `validateFrontmatterAgainstSchema(fm, fields) → {success, failures[]}` against the Spec-50 JSONB snapshot
  - Permissive on empty schema (matches existing `buildFrontmatter` fallback)
  - Unknown extras pass through — the existing `RenderMdxStep` field-filter handles them; tighter validation deferred to Sprint 5 Domain-Registry
- [`RenderMdxStep`](../../../packages/adapters/astro-sync/src/steps/render-mdx.ts) wires the validator after `buildFrontmatter` + `transformImageFields`; on failure: structured `log.error` + throw. `article.id` added to InputSchema so the error payload carries it.
- Re-exported from package [`index.ts`](../../../packages/adapters/astro-sync/src/index.ts) so S1.3 + future callers can import the error class
- 23 new tests (18 validator-unit + 5 RenderMdxStep integration)
- Astro-sync suite: 66/0/1 (1 failure pre-existing in `sync-clusters.test.ts:205`, unrelated — verified via stash baseline)
- Workspace typecheck: 0 errors across 24 packages
- [packages/adapters/astro-sync/CLAUDE.md](../../../packages/adapters/astro-sync/CLAUDE.md) "Astro silent-exclusion trap" updated to point at the new validator

**S1.3 Notification wiring for validation failures** (committed 2026-05-23)

- [`ArticleSyncPipeline.afterError`](../../../packages/adapters/astro-sync/src/pipeline.ts) discriminates `AstroSyncValidationError` and fires a dedicated `type: "astro_sync_validation"` notification (severity `critical`, fans out to SSE + Web Push)
- Notification payload: title `"Astro-Sync blocked: <collection>/<articleId-short>"`, message = bullet-list of failures (truncated at 500 chars), `metadata.failures` preserves the FULL structured array (UI-renderable)
- Legacy `sync_failure` notification unchanged for non-validation errors (single discriminator branch, no behavior drift)
- 3 new tests (structured-payload, truncation w/ full metadata preserved, legacy fallthrough). Tests poll with 1500ms timeout because the pipeline uses `void createNotification(...)` (fire-and-forget — documented in inline comment)

**Sprint 1 — Safety-Layer complete.**

### Sprint 2 — Workspace-Package extrahieren

**S2.1 Scaffold `@marketing-auto/content-schema` workspace** (committed 2026-05-23)

- New package `packages/content-schema/` with the 5 subpath exports defined in spec §3.2: `.`, `./core`, `./enums`, `./domains/toolwiki`, `./registry`, `./validators`
- Layout matches spec exactly; subtask placeholders in each barrel point at the upcoming sub-task that populates them
- Picked up by `packages/*` workspace glob (no root `package.json` edit needed)
- Workspace count went from 24 → 25 with 0 typecheck errors

**S2.2 `COLLECTION_ASTRO_NAME` single source** (committed 2026-05-23)

- New [`packages/content-schema/src/enums/routing.ts`](../../../packages/content-schema/src/enums/routing.ts) holds `COLLECTION_ASTRO_NAME` as a precise `as const` map + derived reverse map + defensive helpers `astroFolderFor()` / `collectionForAstroFolder()`
- Five in-tree copies (4 forward + 1 reverse in apps/api) replaced with imports from the new module
- Workspace dep added to `packages/pipelines`, `packages/adapters/astro-sync`, `apps/api`
- Root CLAUDE.md updated: existing line-159 rule references the new single source; new DO-NOT rule lands explicitly stating "no 5th copy" while preserving Pattern 107 validity for genuinely-independent constants
- 8 new tests covering forward/reverse symmetry + the `comparison`↔`comparisons` singular/plural rename + defensive fallback

**S2.3 `ARTICLE_COLLECTION_TYPES` migration** (committed 2026-05-23)

- Canonical home moved to [`packages/content-schema/src/enums/collection.ts`](../../../packages/content-schema/src/enums/collection.ts) (`ARTICLE_COLLECTION_TYPES` + `ArticleCollectionType` + `isArticleCollectionType`)
- `packages/shared/src/types/article-collection.ts` reduced to a back-compat re-export — droppable post-BK-launch
- Drizzle `articleCollectionTypeEnum` in [`packages/db/src/schema/_enums.ts`](../../../packages/db/src/schema/_enums.ts) now reads the literal list from `ARTICLE_COLLECTION_TYPES` so the pgEnum and the TypeScript const cannot drift
- Workspace dep added: `packages/shared → @marketing-auto/content-schema` (no cycle; verified `content-schema ← shared ← db ← pipelines ← api` stays acyclic)
- 6 new tests for the collection module

**S2.4 Toolwiki extras schemas migration** (committed 2026-05-23)

- Five collection-specific FRONTMATTER_EXTRAS schemas now under [`packages/content-schema/src/domains/toolwiki/`](../../../packages/content-schema/src/domains/toolwiki/):
  - `extras-comparison.ts` migrated verbatim from `packages/pipelines/src/article/frontmatter/comparison.ts`
  - `extras-ki-wissen.ts` migrated verbatim from `packages/pipelines/src/article/frontmatter/ki-wissen.ts`
  - **NEW** `extras-blog.ts` — `BlogIntentTypeSchema` (9 values from Spec 64.14) + `BlogBottomLinksVariantSchema` + `primaryTool` + `showTopicLinks` + `validateBlogExtras`
  - **NEW** `extras-tools.ts` — `features/pros/cons/useCases/integrations/pricing/priceFrom/rating/votes/affiliateSlug/website/relatedPillars`. `relatedPillars` loosened from the pre-spec hardcoded 12-Toolwiki-pillar enum to plain `z.string()` array (Phase-1 E1 fix; Sprint 5 Domain-Registry will add a per-tenant superRefine)
  - **NEW** `extras-usecases.ts` — `relatedTags/industryFocus/featuredToolSlugs/highlights` + `UsecaseContentTypeSchema` (stub/expanded/pillar/hub)
- Pipeline `frontmatter/{comparison,ki-wissen}.ts` files are now back-compat re-exports — all named exports + types preserved
- 22 new tests across the 5 modules

**S2.5 `baseFrontmatter()` Core factory** (committed 2026-05-23)

- Five new modules under [`packages/content-schema/src/core/`](../../../packages/content-schema/src/core/):
  - `seo.ts` — `seoCore` + `isoDate` + `imagePath` + `FaqItemSchema`
  - `i18n.ts` — `i18nCore(locales)` factory + `makeLocaleEnum` + `LocaleSet` type
  - `cluster.ts` — `clusterCore` + `ClusterRoleSchema`
  - `monetization.ts` — `monetizationCore(defaultSlots, defaultAffiliate)` factory
  - `base.ts` — `baseFrontmatter(locales)` composition that merges `seoCore + i18nCore + clusterCore` onto a universal frontmatter object with `publishedAt + updatedAt` as the canonical timestamp pair (resolves Phase-1 E13)
- 18 new tests including the Spec §3.2 acceptance criterion: `baseFrontmatter(['de','en']).merge(BlogExtrasSchema)` composes without type errors
- Core modules are NOT yet wired into the pipeline (Sprint 5 work) — they're available for any consumer to import

**Sprint 2 — Workspace-Package extrahieren: COMPLETE. Branch B sync-point released.**

### Sprint 3 — Categories-Refactor

**S3.1 `content_categories` table + migration 0094** (committed 2026-05-23)

- New table [`packages/db/src/schema/categories.ts`](../../../packages/db/src/schema/categories.ts) with `(id, project_id FK CASCADE, slug, scope, parent_slug, translations jsonb, icon, color, created_at, updated_at)`
- Composite unique on `(project_id, scope, slug)` — allows same slug across scopes legitimately
- `translations` jsonb shape `Record<locale, {label, urlSlug}>` matches Phase-1 §3.3 design + replaces in-tree URL_SLUG_MAP-style maps per tenant
- `parent_slug` plain text (no DB self-FK per Phase-1 R8 recursive-FK complexity)
- 5 new tests: locale-keyed translations roundtrip, same-slug-different-scope, unique constraint, parent_slug wiring, CASCADE on project delete

**S3.2 Seed Toolwiki categories + sync-point B** (committed 2026-05-23)

- Migration 0095 idempotent seed of 31 categories: 7 tool top-level + 13 tool subcategories + 6 blog + 5 ki-wissen
- Authoritative source: `URL_SLUG_MAP` from `/Users/marcelklaczinski/WebstormProjects/ki-wissensraum-neu/src/lib/url-slugs.ts`
- Tool DE/EN urlSlugs match URL_SLUG_MAP byte-for-byte
- Blog: slug = slugifyCategory(German label) (preserves current Astro routing). DE/EN urlSlugs identical today
- Ki-wissen: DE urlSlug = slugifyCategory(German), EN urlSlug = locale-neutral English (`fundamentals`/`technology`/etc.) — ready for Branch B's Phase-1-E3 fix
- Idempotency verified: second SQL run produces no duplicate rows
- **Branch B Sprint 3 released**: slug values fixed from this commit forward

**S3.3 CategoryValidator helper (DI pattern)** (committed 2026-05-23)

- New module [`packages/content-schema/src/validators/categories.ts`](../../../packages/content-schema/src/validators/categories.ts) — pure interface + factory, content-schema stays leaf
- `CategoryLookup` is the single DI seam consumers wire up (Drizzle backend in apps/api S3.4 wiring; in-memory backend for tests via `createInMemoryCategoryLookup`)
- `CategoryValidator.isValidReference(slug, scope, projectId)` returns tagged union — never throws
- Empty/blank slug → `ok: true` (category is optional on every collection)
- 9 new tests covering all scopes, cross-scope contamination, cross-tenant isolation, empty-slug ok, whitespace trim

**S3.4 Soft category coupling articles.category ↔ content_categories** (committed 2026-05-23)

- New module [`packages/pipelines/src/article/category-validation/validate-and-notify.ts`](../../../packages/pipelines/src/article/category-validation/validate-and-notify.ts)
- `collectionTypeToScope()` mapping: tools→tool, blog→blog, ki-wissen→knowledge, usecases→usecase, comparison→null
- `getProductionLookup()` module-level singleton wrapping Drizzle SELECT against `content_categories`
- `validateCategoryAndNotify(args)` fire-and-forget called after DraftStep's FRONTMATTER_EXTRAS parse
- On mismatch: severity=info notification fan-out to all owners + structured warn log
- DraftStep wraps the call in its own try/catch (additive phase: must never fail the pipeline)
- 13 new tests covering all mapping cases, known/unknown/empty/null/non-string categories, lookup exceptions, whitespace trim

**S3.5 Consolidation CLI** (committed 2026-05-23)

- New script [`apps/api/src/scripts/consolidate-article-categories.ts`](../../../apps/api/src/scripts/consolidate-article-categories.ts)
- CLI flags: `--project=<slug>` (required), `--apply` (default dry-run), `--no-backup`
- Pure `slugifyCategory(value)` mirrors the canonical Toolwiki Astro helper byte-for-byte (& → und, NFKD-fold, ß → ss, lowercase, hyphen-collapse)
- Defense-in-depth: dry-run default + verify-gate after apply re-runs the unmapped audit query
- Live Toolwiki dry-run: 10/11 unmapped pairs mappable, 82 article rows would update, 1 expected skip (`comparisons/Vergleiche` — no taxonomy for comparison collection by design)
- 9 new tests for `slugifyCategory` parity with Astro
- `--apply` run on Toolwiki is a Marcel-decision (verify-gate convention) — awaiting his go-ahead

**Sprint 3 — Categories-Refactor: COMPLETE. Branch B sync-point B released.**

### Sprint 4 — Toolwiki-Bias rauslösen (3 of 5 done)

**S4.1 `tool_*` column semantic tagging** (committed 2026-05-23)

- Header comment in [`packages/db/src/schema/content.ts`](../../../packages/db/src/schema/content.ts) documents the 6 `tool_*` columns as BUCKET-C TOOLWIKI-PROMOTION
- Domain-guard in [`packages/adapters/astro-sync/src/import/steps/upsert-articles.ts`](../../../packages/adapters/astro-sync/src/import/steps/upsert-articles.ts) — `isToolwikiDomain = project.industry === "ai_education"` gates `buildToolColumns()`
- Per-row loop optimization: project industry loaded ONCE before the loop (no N+1 on 250-row imports)
- Zero DB migration; non-Toolwiki tenants leave the columns NULL even if they have a `tools` Astro collection

**S4.2 `articleCollectionTypeEnum` aufweichen → text** (committed 2026-05-23)

- Migration 0096 drops the pgEnum constraint on `articles.collection_type`, converts to text (DROP DEFAULT → SET DATA TYPE text USING …::text → SET DEFAULT 'blog')
- Drizzle schema uses `text("collection_type").$type<ArticleCollectionType>()` — TS narrowing preserved at write sites for Toolwiki today
- pgEnum type `article_collection_type` intentionally NOT dropped — other code may reference `articleCollectionTypeEnum.enumValues`
- Live verify: `pg_typeof(collection_type) = 'text'`; 252+ existing Toolwiki values unchanged; INSERTs default to 'blog' as before
- `PlanningContentType` aufweichen scope (spec §3.4) NOT included — `planned_items.content_type` is already plain text since 62.2 (Memory D12), no pgEnum to drop; consumer-side validation can widen per-project via Domain-Registry (Sprint 5) without DDL

**S4.3 DraftStep intentType enum extracted to TOOLWIKI_BLOG_INTENT_TYPES** (committed 2026-05-23)

- `TOOLWIKI_BLOG_INTENT_TYPES` exported as `as const` tuple from [`packages/content-schema/src/domains/toolwiki/extras-blog.ts`](../../../packages/content-schema/src/domains/toolwiki/extras-blog.ts)
- DraftStep imports + interpolates: `${TOOLWIKI_BLOG_INTENT_TYPES.map((v) => `"${v}"`).join(" | ")}`
- Runtime byte-equivalence verified — interpolated line is identical to the legacy hardcoded `"overview" | "pricing" | …`
- Scope reductions from spec (documented in §12 deviations):
  - OutlineStep doesn't have the 9-value enum (its `intent` field is freeform descriptor per H2)
  - `deriveIntentFromCollection` in `briefs.ts` uses a SEPARATE 10-value `INTENT_TYPES` (brief-CREATION classification — distinct concept from article-OUTPUT intent); not touched
  - `project_configurations.intentTaxonomyDefault` is YET ANOTHER intent set (cluster-gap-detection, 4 values); not touched — its value set is incompatible with the 9-value draft enum

**S4.4 LLM-prompt tenant-var swap** (NOT STARTED — deferred)

The remaining 8 hardcoded sites (draft.ts site 1 done via S4.3 partial; outline.ts, prompts/comparison.ts, prompts/ki-wissen.ts, social-image/steps.ts ×2, social-image/hookPrompt.ts, social-image/hookEngine.ts, trend-discovery/prompts.ts) + the new `projects.classifier_examples` JSONB column + seed migration are deferred to a dedicated session.

Reason: each touched prompt is captured in `__tests__/snapshots/baseline-toolwiki-prompts.json` with a `mustContainSubstrings` array. Byte-equivalence verification per-site requires running each builder with the live Toolwiki project context and diffing the produced bytes. The blast radius (9 LLM prompts touching Toolwiki output quality + cost) warrants focused attention rather than tacking it onto a multi-sprint session.

**S4.5 Synthesizer-prompt test-suite per-project fixtures** (deferred with S4.4)

Depends on S4.4 — once the synthesizer prompt reads `projects.classifier_examples`, the test suite migrates from hardcoded Toolwiki-only fixtures to per-project fixtures.

**Sprint 4 status: 3 of 5 sub-tasks done. S4.4 + S4.5 deferred to a focused session.**

### Pre-Sprint-1 verification

- ✅ Migration 0092 (`signal_source_content_type_map` on `project_planner_config`) verified applied via `information_schema` lookup
- ✅ Baseline snapshot [`__tests__/snapshots/baseline-toolwiki-prompts.json`](../../../__tests__/snapshots/baseline-toolwiki-prompts.json) captures SHA-1 + size + must-contain-substrings for all 9 Toolwiki-biased prompt sites

## 12. Discovered & Deviations

### S1.1 — file path and write-site mismatch

**Spec said**: "Datei: `packages/pipelines/src/article/refresh/steps/persist-body.ts`"

**Reality**:
1. The file `packages/pipelines/src/article/refresh/steps/persist-body.ts` does not exist. Refresh uses the shared `packages/pipelines/src/article/steps/persist-body.ts` which is a body-checkpoint only — it writes `bodyMd`/`wordCount`/`updatedAt`, nothing else.
2. `RefreshPipeline` does NOT touch any field in the spec's preserved list today. Its 8 steps write `outline`/`bodyMd`/`selfReviewScore`/`selfReviewIssues`/`updatedAt`/`lastRefreshedAt` only.
3. The actual lost-update surface is `PersistArticleStep` (called by `BlogPipeline`, not `RefreshPipeline`) when re-generating an existing imported article. Its line-120 `frontmatterExtras` overwrite is where `featured` / `pricingVerifiedAt` get clobbered.

**Marcel-decision 2026-05-23** (scope A+B): implement the merge at the real write site (`PersistArticleStep`) AND keep the documentary whitelist + RefreshPipeline static-source regression guard so a future refactor that adds writes to refresh fails the test immediately.

**Whitelist split** (deviation from spec's flat list): split into two arrays — `REFRESH_PRESERVED_COLUMNS` (the 5 `tool_*` promoted columns; currently defensive, not written) and `REFRESH_PRESERVED_EXTRAS_KEYS` (the 2 JSONB-resident keys; the actual fix surface). The split is structural: columns and JSONB keys are merged differently (columns are skipped in the UPDATE `.set()`, JSONB keys are merged inside the `frontmatter_extras` blob).

**Cross-pipeline side-effect** (positive): the merge fires for ALL `PersistArticleStep` calls including `TranslationPipeline`'s EN-sibling persist. On `refresh_propagation` / `manual_resync` re-translation, this correctly preserves Marcel's per-locale `featured: true` curation on the EN article. Not a regression.

### S1.2 — boundary scope kept narrow

**Spec said**: import the future Domain-Registry from `@marketing-auto/content-schema` (with Spec-50 JSONB as transitional fallback).

**Reality**: implemented against the Spec-50 JSONB snapshot directly (the workspace package doesn't exist yet — that's Sprint 2). The validator's signature `validateFrontmatterAgainstSchema(fm, fields: FrontmatterField[])` will become the contract the Domain-Registry implements in Sprint 5; only the call-site in `RenderMdxStep` needs to swap `input.collectionInfo.fields` for the registry lookup at that point.

**Deviation — unknown-extras passthrough**: the spec sketch implied that any field Astro Zod rejects should throw. In practice, the existing field-filter in `buildFrontmatter()` (line 226-232) drops unknown keys before they reach Astro, so unknown extras are not a write-time failure today. The validator catches the real failure modes that DID propagate: missing required fields (was warn-only) and type/enum mismatches on KNOWN fields. Tightening unknown-extras to a throw is deferred to Sprint 5 when Domain-Registry replaces the JSONB snapshot.

**Pre-existing test failure not regressed**: `packages/adapters/astro-sync/test/sync-clusters.test.ts:205` "counts uncategorized articles" fails with `expected 2, received 1` on both master and this branch (verified via `git stash` baseline). Unrelated to S1.2 — filed as branch-level test debt; will not be fixed in this PR.

### S2.x — Sprint 2 deviations

**S2.2 fifth copy**: the spec said "4 in-tree copies" of `COLLECTION_ASTRO_NAME`. Actual count was 5 — there's a reverse-direction map at [`apps/api/src/routes/projects/articles-standalone.ts`](../../../apps/api/src/routes/projects/articles-standalone.ts) (`ASTRO_FOLDER_TO_COLLECTION_TYPE`). The new module provides BOTH directions via `astroFolderFor()` + `collectionForAstroFolder()` so the reverse site folded in cleanly.

**S2.3 Drizzle wiring**: spec said "Drizzle-`$type<>()`-Cast in `packages/db/src/schema/_enums.ts:127` aktualisieren". Line 127 is the `pgEnum` definition itself, not a `$type<>()` cast. Updated the literal list to read from `ARTICLE_COLLECTION_TYPES` instead — needed `as unknown as [string, ...string[]]` workaround for drizzle's mutable-tuple signature, justified inline.

**S2.4 `relatedPillars` loosening**: pre-S2.4 the field was a hardcoded `z.enum([...])` of 12 Toolwiki pillar slugs (Phase-1 E1 "härteste Toolwiki-Bindung im Schema"). Spec §3.2 told us to migrate the schemas; the Phase-1 E1 fix and the per-domain registry concern naturally landed at the same point. Loosened to `z.array(z.string())` so other tenants can use their own pillar set; Sprint 5 Domain-Registry will add the per-tenant superRefine that re-narrows for Toolwiki.

**S2.4 extras schemas not yet wired into RenderMdxStep boundary validator**: the validator from S1.2 currently uses the Spec-50 JSONB snapshot. Sprint 5 (Domain-Registry) is the natural integration point — schemas exist now but the integration is one sprint away to avoid double-touching the boundary validator.

**S2.5 Core modules are leaf-only today**: the schemas under `./core/` and `./domains/` exist + are tested, but no pipeline step or RenderMdxStep call site imports them yet. Wiring them in (replacing the Spec-50 JSONB path) is Sprint 5 S5.2 Domain-Registry work. The factory shape was validated by the acceptance-criterion test composing `baseFrontmatter(['de','en']).merge(BlogExtrasSchema)`.

### S3.x — Sprint 3 deviations

**S3.2 blog slugs deviate from spec example**: spec §3.3 wrote "'Guides & Tutorials' → guides-tutorials" but the canonical Toolwiki Astro `slugifyCategory()` rule is `& → und`, producing `guides-und-tutorials`. The seed migration follows the Astro helper byte-for-byte to preserve SEO-stable URL routing (spec §5 acceptance #4: identical to Branch B Sprint 3.1).

**S3.2 ki-wissen EN urlSlugs are forward-compat-only**: today's Toolwiki Astro stores German labels in EN frontmatter (Phase-1 E3 wart). The seed introduces EN urlSlugs (`fundamentals`/`technology`/`ethics-law`/`practice`/`future`) that Branch B Sprint 3 can adopt to fix the wart. Until Branch B does the URL renderer migration, the EN urlSlugs are unused.

**S3.4 fire-and-forget vs blocking validator** (intentional): spec §3.3 said "Soft-Warning (Notification, severity=info), kein Throw". Implementation goes further: DraftStep wraps `validateCategoryAndNotify` in its OWN try/catch so even an exception inside the helper (e.g. DB connection lost) can't fail the pipeline. The helper itself does NOT swallow its lookup errors — the test "lookup throws → notification still skipped, no escalation (catch-all)" asserts the helper's contract: it propagates unexpected failures upward, the call site owns escalation.

**S3.5 `category_legacy` column is a one-time migration artifact**: NOT added to the Drizzle schema. The script ALTER-adds it idempotently on `--apply`. Future tenants don't get the column unless they run the script. Document only — no follow-up cleanup planned because the column is null-safe.

**S3.5 1 mappable skip in dry-run**: the 2 comparison articles with `category="Vergleiche"` are intentionally out-of-scope (comparison collection has no category taxonomy by design — Phase-1 §1 finding). The script logs them as `skip_no_scope` and leaves the value untouched. A future cleanup could NULL the field, but that's a separate decision outside this spec.

### S1.3 — notification fan-out reuses the existing surface

**Spec sketch said**: `notifyOwners({projectId, severity, title, body, channel})`.

**Reality**: there is no `notifyOwners` helper. The codebase ships `createNotification` from `@marketing-auto/core/notifications` invoked per-owner in a loop (existing `sync_failure` pattern). S1.3 reuses that surface, adding a discriminator branch inside `ArticleSyncPipeline.afterError`:

- **AstroSyncValidationError → `type: "astro_sync_validation"`** with `metadata.failures` preserving the full structured array even when `message` is truncated at 500 chars
- **Generic Error → `type: "sync_failure"`** (legacy path) unchanged

No new helper, no new module — the spec's `channel: 'sse_push'` field is implicit (severity=`critical` already fans out to BOTH SSE and Web Push via `createNotification`'s built-in dispatch).

**Test-side gotcha discovered**: the existing pipeline uses `void createNotification(...)` (fire-and-forget) which races the test's SELECT. The new test polls with a 1500ms timeout. Documented inline so future test authors copy the pattern.

### Pre-Sprint-1 — branch + spec creation

The branch `feature/multi-domain-datamodel` and the spec file `docs/specs/multi-domain-evolution/spec.md` did not exist when the task started; both were created at the beginning of session 2026-05-23 from Marcel's inline-pasted spec.

### Pre-Sprint-1 — §10 open questions resolved

- **Q1 BK-Launch**: 8+ weeks. Sprint 5 stays at full width; no compression of S5.1/S5.2/S5.3.
- **Q2 Spec-50 deprecation**: NO — stays as fallback. Deprecation is a post-BK aufräum-Aktion.
- **Q3 Toolwiki pipelines live during refactor**: assumed YES (default per spec).
- **Q4 `frontmatter_extras → domain_extras` rename**: INCLUDE in Sprint 5 (S5.1).
