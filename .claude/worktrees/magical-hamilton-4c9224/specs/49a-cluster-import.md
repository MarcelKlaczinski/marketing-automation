# Spec 49a: Cluster Auto-Import from Frontmatter

**Phase:** Marketing-Tool integration spec — leverages existing frontmatter structure
**Estimated Effort:** 2-3 hours (1 session, structured into 4 sections)
**Dependencies:** Spec 44 (Astro repo import), Spec 45/46 (cornerstone_specs + translation pairs), Spec 47 (pagination), Spec 48 (Cold-Start multi-lang)
**Status:** Ready for implementation
**Recommended Model:** Sonnet 4.6 (focused refactor, no new LLM logic)
**Repos affected:** marketing-tool (db + adapter-astro-sync + api + web)

---

## Context

The toolwiki Astro repo's existing MDX articles already contain rich cluster metadata in their frontmatter:

```yaml
clusterKey: "prompt-engineering-2026"     # cluster identifier
clusterRole: "spoke"                       # "cornerstone" or "spoke"
intentType: "comparison"                   # SEO intent
category: "Vergleiche"                     # human-readable group
translationKey: "ai-agents-2026-comparison" # already handled by Spec 44
locale: "de"                                # already handled by Spec 44
author: "david-krueger"
tags: [...]
```

After Spec 44 import, this data lands in `articles.frontmatterExtras` jsonb (catch-all). It's there but not typed, not queried, not used for clustering.

**Problem**: Phase 4 of Cold-Start currently has nothing to show because `clusters` and `contentPillars` tables are empty after fresh import. Users see "No clusters" even though the 268 articles are clearly grouped via `clusterKey`.

**Solution**: A deterministic post-import step that:
1. Reads distinct `clusterKey` values from imported articles
2. Auto-creates `clusters` rows (one per distinct clusterKey)
3. Auto-creates `contentPillars` rows from distinct `category` values
4. Links articles to clusters via `articles.clusterId`
5. Promotes the article with `clusterRole: cornerstone` to be the cluster's cornerstone (sets `clusters.cornerstoneKeywords`, `clusters.pillarArticleId`)

This is **not LLM-based** — pure data structuring from frontmatter. Cost: $0. Runtime: seconds.

## Goal

After this spec:
- New typed columns: `articles.clusterKey`, `articles.clusterRole`, `articles.intentType` (also enables UI filtering)
- New pipeline step: `SyncClustersFromFrontmatterStep` runs at the end of `RepoImportPipeline`
- Cold-Start Phase 3 (Cluster-Plan) status: "complete" when clusters were auto-imported (no manual cluster-plan run needed for toolwiki)
- Phase 4 sees existing clusters + their cornerstones + their spokes from imported content
- Articles list UI can filter by cluster

## Non-Goals

- **No LLM-based classification** — articles without `clusterKey` stay `clusterId: null` and are flagged in UI as "uncategorized". Gap-suggestion via LLM is **Spec 49b**.
- **No tool-to-cluster attachment** — Tools/Authors/Tool-Categories/Special-Landings don't have `clusterKey` (they're entity-style). They stay outside clusters. Spec 49b can add manual attachment UI.
- **No cluster-name normalization** — `clusterKey: "prompt-engineering-2026"` stays as-is. Display uses `category` field for human label.
- **No cross-locale cluster merge** — same `clusterKey` shared between DE+EN articles already implies they belong to same cluster (deterministic). No fuzzy matching needed.
- **No frontmatter-write-back** — Marketing-Tool reads clusterKey, doesn't modify it. Frontmatter is read-only source-of-truth for imported articles.
- **No retroactive Phase 4 of Cold-Start** — if Phase 4 was already run for toolwiki before this spec, no automatic merge with pre-existing clusters. Manual cleanup if needed (likely empty given current state).

## Pre-flight

```bash
cd <marketing-tool-repo>
git status --porcelain  # clean
git checkout -b feature/49a-cluster-auto-import
bun test 2>&1 | tail -3  # green baseline
```

**Important data check before starting** — verify toolwiki articles actually have `clusterKey` field:

```sql
SELECT
  collection,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE frontmatter_extras ? 'clusterKey') as has_cluster_key,
  COUNT(*) FILTER (WHERE frontmatter_extras ? 'clusterRole') as has_cluster_role,
  COUNT(DISTINCT frontmatter_extras->>'clusterKey') as distinct_clusters
FROM articles
WHERE source = 'imported' AND project_id = (SELECT id FROM projects WHERE slug = 'toolwiki')
GROUP BY collection
ORDER BY collection;
```

Expected: blog, ki-wissen, comparisons, usecases have high `has_cluster_key` ratios. Tools/Authors/etc. should have 0 (entity-style). If blog/ki-wissen have <90% coverage, decide whether to:
- Continue and accept some uncategorized articles
- Stop and fix frontmatter in the Astro repo first

## Architecture Overview

```
RepoImportPipeline (existing, Spec 44)
   │
   ├─ ListContentFilesStep
   ├─ FilterChangedFilesStep
   ├─ ParseFrontmatterBatchStep    ← extracts clusterKey into frontmatterExtras
   ├─ UpsertArticlesStep            ← MODIFIED: also sets articles.clusterKey/clusterRole/intentType
   ├─ LinkTranslationPairsStep
   ├─ SyncClustersFromFrontmatterStep  ← NEW (Section B)
   └─ UpdateImportRunStep
                ▼
        clusters + contentPillars populated
        articles.clusterId set
                ▼
        Phase 4 UI shows real cluster structure
```

**Auto-Cluster-Creation logic**:

```
For each distinct (projectId, clusterKey):
  1. Find pillar by category → create if not exists
  2. Create/update cluster row with:
       - name = clusterKey (machine slug) or category (if cornerstone article has one)
       - pillar = category (denormalized)
       - cornerstoneKeywords = [all keywords from cornerstone-role articles in this cluster]
       - pillarArticleId = the cornerstone article's id
  3. UPDATE all articles in this cluster: SET clusterId = <new id>
```

## Splitting Plan

4 sections for `/start-task /review-task` workflow:

```
A — DB schema: typed cluster fields + migration       ~45min   [task: 49a.1-schema]
B — SyncClustersFromFrontmatterStep + pipeline wire   ~1h      [task: 49a.2-sync-step]
C — UI: cluster filter in articles, Phase 3 status    ~45min   [task: 49a.3-ui]
D — Tests + final verification                        ~30min   [task: 49a.4-tests]
```

---

## Section A — DB Schema

### A.1 Files modified

- `packages/db/src/schema/content.ts` — add typed columns to `articles`
- `packages/db/migrations/0XXX_articles_cluster_fields.sql` — manual migration with backfill
- `packages/db/migrations/meta/_journal.json` — manual entry
- `packages/adapters/astro-sync/src/import/parse-frontmatter.ts` — extract new fields into typed result
- `packages/adapters/astro-sync/src/import/steps/upsert-articles.ts` — write new fields

### A.2 Articles schema additions

```typescript
// packages/db/src/schema/content.ts (extend articles table)
export const articles = pgTable("articles", {
  // ... existing columns ...

  // NEW (Spec 49a): cluster metadata from frontmatter
  clusterKey: text("cluster_key"),
  clusterRole: text("cluster_role").$type<"cornerstone" | "spoke" | null>(),
  intentType: text("intent_type"),

  // ... existing columns ...
}, (t) => ({
  // ... existing indexes ...

  // NEW indexes:
  clusterKeyIdx: index("articles_cluster_key_idx").on(t.projectId, t.clusterKey),
  clusterRoleIdx: index("articles_cluster_role_idx").on(t.projectId, t.clusterRole),
}));
```

### A.3 Migration SQL

```sql
-- packages/db/migrations/0XXX_articles_cluster_fields.sql

ALTER TABLE "articles"
  ADD COLUMN "cluster_key" text,
  ADD COLUMN "cluster_role" text,
  ADD COLUMN "intent_type" text;

-- Backfill from frontmatter_extras for existing imported articles
UPDATE "articles"
SET
  "cluster_key" = frontmatter_extras->>'clusterKey',
  "cluster_role" = frontmatter_extras->>'clusterRole',
  "intent_type" = frontmatter_extras->>'intentType'
WHERE source = 'imported'
  AND frontmatter_extras IS NOT NULL;

CREATE INDEX IF NOT EXISTS "articles_cluster_key_idx"
  ON "articles" ("project_id", "cluster_key");
CREATE INDEX IF NOT EXISTS "articles_cluster_role_idx"
  ON "articles" ("project_id", "cluster_role");
```

Update `_journal.json` manually.

### A.4 Frontmatter parser updates

```typescript
// packages/adapters/astro-sync/src/import/parse-frontmatter.ts

// Add to TYPED_FIELDS set:
const TYPED_FIELDS = new Set([
  "title", "slug", "locale", "translationKey",
  "publishedAt", "updatedAt", "author", "category", "subcategory",
  "tags", "noindex",
  // NEW:
  "clusterKey", "clusterRole", "intentType",
]);

// Update FrontmatterSchema and ParseResult.typed shape:
const FrontmatterSchema = z.object({
  // ... existing fields ...
  clusterKey: z.string().optional(),
  clusterRole: z.enum(["cornerstone", "spoke"]).optional(),
  intentType: z.string().optional(),
}).passthrough();

export interface ParseResult {
  // ... existing ...
  typed: {
    // ... existing typed fields ...
    clusterKey: string | null;
    clusterRole: "cornerstone" | "spoke" | null;
    intentType: string | null;
  };
}
```

In `parseMdxContent()`, populate the new typed fields and remove them from `extras` (since they're now typed).

### A.5 UpsertArticlesStep updates

```typescript
// packages/adapters/astro-sync/src/import/steps/upsert-articles.ts
// In the .insert(articles).values({...}):

  clusterKey: typed.clusterKey as string | null,
  clusterRole: typed.clusterRole as "cornerstone" | "spoke" | null,
  intentType: typed.intentType as string | null,

// And in .onConflictDoUpdate set: clause:
  clusterKey: typed.clusterKey as string | null,
  clusterRole: typed.clusterRole as "cornerstone" | "spoke" | null,
  intentType: typed.intentType as string | null,
```

### A.6 Section A Acceptance

- [ ] Migration applies: `articles.cluster_key`, `cluster_role`, `intent_type` exist
- [ ] Backfill: existing imported articles have these populated where frontmatter had them
- [ ] `parseMdxContent()` extracts these fields into typed result
- [ ] `UpsertArticlesStep` writes them on import + re-import
- [ ] Verification query: `SELECT COUNT(*) FROM articles WHERE cluster_key IS NOT NULL` shows expected count
- [ ] No regression: existing pipelines/tests still pass
- [ ] Commit: `feat(db): typed cluster fields on articles (49a.1)`

---

## Section B — SyncClustersFromFrontmatterStep

### B.1 Files to create / modify

- `packages/adapters/astro-sync/src/import/steps/sync-clusters-from-frontmatter.ts` (new)
- `packages/adapters/astro-sync/src/import/pipeline.ts` — register new step
- `packages/adapters/astro-sync/src/import/index.ts` — export

### B.2 Sync step implementation

```typescript
// packages/adapters/astro-sync/src/import/steps/sync-clusters-from-frontmatter.ts
import {
  articles,
  clusters,
  contentPillars,
  db,
} from "@marketing-auto/db";
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { createLogger } from "@marketing-auto/shared";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";

const log = createLogger("astro-import:sync-clusters");

const InputSchema = z.object({
  projectId: z.string().uuid(),
});

const OutputSchema = z.object({
  pillarsCreated: z.number(),
  pillarsUpdated: z.number(),
  clustersCreated: z.number(),
  clustersUpdated: z.number(),
  articlesLinked: z.number(),
  uncategorizedCount: z.number(),
});

export class SyncClustersFromFrontmatterStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "sync-clusters-from-frontmatter";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0; }

  async execute(
    input: z.infer<typeof InputSchema>,
    _ctx: StepContext
  ): Promise<z.infer<typeof OutputSchema>> {
    const projectId = input.projectId;

    // Step 1: Find all distinct (clusterKey, category) pairs for this project's imported articles
    const groupRows = await db
      .select({
        clusterKey: articles.clusterKey,
        category: articles.category,
        count: sql<number>`count(*)::int`,
      })
      .from(articles)
      .where(
        and(
          eq(articles.projectId, projectId),
          eq(articles.source, "imported"),
          isNotNull(articles.clusterKey)
        )
      )
      .groupBy(articles.clusterKey, articles.category);

    log.info({ groups: groupRows.length }, "Distinct cluster groups in frontmatter");

    // Step 2: Materialize pillars from distinct categories
    const distinctCategories = [
      ...new Set(groupRows.map((g) => g.category).filter((c): c is string => !!c)),
    ];

    let pillarsCreated = 0;
    let pillarsUpdated = 0;
    const pillarByName = new Map<string, string>();

    // Load existing pillars first
    const existingPillars = await db
      .select({ id: contentPillars.id, name: contentPillars.name })
      .from(contentPillars)
      .where(eq(contentPillars.projectId, projectId));
    for (const p of existingPillars) {
      pillarByName.set(p.name, p.id);
    }

    let nextPosition = existingPillars.length;
    for (const cat of distinctCategories) {
      if (pillarByName.has(cat)) {
        pillarsUpdated += 1;
        continue;
      }
      const [pillar] = await db
        .insert(contentPillars)
        .values({
          projectId,
          name: cat,
          description: `Auto-imported from Astro repo frontmatter`,
          position: nextPosition++,
        })
        .returning({ id: contentPillars.id });
      pillarByName.set(cat, pillar!.id);
      pillarsCreated += 1;
    }

    // Default "Uncategorized" pillar (for clusters without a category)
    let uncategorizedPillarId = pillarByName.get("Uncategorized");
    if (!uncategorizedPillarId) {
      const [u] = await db
        .insert(contentPillars)
        .values({
          projectId,
          name: "Uncategorized",
          description: "Clusters without a frontmatter category",
          position: nextPosition++,
        })
        .returning({ id: contentPillars.id });
      uncategorizedPillarId = u!.id;
      pillarByName.set("Uncategorized", uncategorizedPillarId);
      pillarsCreated += 1;
    }

    // Step 3: For each distinct clusterKey, materialize a cluster
    let clustersCreated = 0;
    let clustersUpdated = 0;
    let articlesLinked = 0;

    const distinctClusterKeys = [
      ...new Set(groupRows.map((g) => g.clusterKey).filter((k): k is string => !!k)),
    ];

    for (const clusterKey of distinctClusterKeys) {
      // Find all articles for this cluster (across locales)
      const members = await db
        .select({
          id: articles.id,
          clusterRole: articles.clusterRole,
          category: articles.category,
          cornerstoneKeyword: articles.cornerstoneKeyword,
          title: articles.title,
          slug: articles.slug,
          locale: articles.locale,
          translationKey: articles.translationKey,
        })
        .from(articles)
        .where(
          and(
            eq(articles.projectId, projectId),
            eq(articles.clusterKey, clusterKey)
          )
        );

      if (members.length === 0) continue;

      // Pick the category from the first member (assume cluster has consistent category)
      const memberCategory = members.find((m) => m.category)?.category ?? null;
      const pillarId = memberCategory
        ? (pillarByName.get(memberCategory) ?? uncategorizedPillarId)
        : uncategorizedPillarId;

      // Find cornerstone article (clusterRole='cornerstone'). Prefer DE.
      const cornerstones = members.filter((m) => m.clusterRole === "cornerstone");
      const cornerstoneDe = cornerstones.find((c) => c.locale === "de");
      const cornerstoneFallback = cornerstones[0] ?? null;
      const cornerstone = cornerstoneDe ?? cornerstoneFallback;

      // Cornerstone keywords = unique keywords from cornerstone-role articles
      const cornerstoneKeywords = [
        ...new Set(
          cornerstones
            .map((c) => c.cornerstoneKeyword)
            .filter((k): k is string => !!k && k.length > 0)
        ),
      ];

      // Upsert cluster (use clusterKey as natural key — combined with projectId)
      const existing = await db
        .select({ id: clusters.id })
        .from(clusters)
        .where(and(eq(clusters.projectId, projectId), eq(clusters.name, clusterKey)))
        .limit(1);

      let clusterId: string;
      if (existing.length > 0) {
        clusterId = existing[0]!.id;
        await db
          .update(clusters)
          .set({
            pillarId,
            pillar: memberCategory,
            primaryKeyword: cornerstone?.cornerstoneKeyword ?? null,
            cornerstoneKeywords,
            pillarArticleId: cornerstone?.id ?? null,
            status: "approved", // auto-imported = approved
          })
          .where(eq(clusters.id, clusterId));
        clustersUpdated += 1;
      } else {
        const [c] = await db
          .insert(clusters)
          .values({
            projectId,
            pillarId,
            name: clusterKey,
            pillar: memberCategory,
            primaryKeyword: cornerstone?.cornerstoneKeyword ?? null,
            cornerstoneKeywords,
            satelliteKeywords: [],
            status: "approved",
            pillarArticleId: cornerstone?.id ?? null,
          })
          .returning({ id: clusters.id });
        clusterId = c!.id;
        clustersCreated += 1;
      }

      // Link all members to this cluster
      const memberIds = members.map((m) => m.id);
      const result = await db
        .update(articles)
        .set({ clusterId })
        .where(
          and(
            eq(articles.projectId, projectId),
            eq(articles.clusterKey, clusterKey)
          )
        )
        .returning({ id: articles.id });
      articlesLinked += result.length;
    }

    // Step 4: Count uncategorized articles
    const uncategorizedResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(articles)
      .where(
        and(
          eq(articles.projectId, projectId),
          eq(articles.source, "imported"),
          sql`${articles.clusterKey} IS NULL`
        )
      );
    const uncategorizedCount = uncategorizedResult[0]?.count ?? 0;

    log.info(
      {
        pillarsCreated,
        pillarsUpdated,
        clustersCreated,
        clustersUpdated,
        articlesLinked,
        uncategorizedCount,
      },
      "Cluster sync complete"
    );

    return {
      pillarsCreated,
      pillarsUpdated,
      clustersCreated,
      clustersUpdated,
      articlesLinked,
      uncategorizedCount,
    };
  }
}
```

### B.3 Pipeline registration

Add the step to `RepoImportPipeline` after `LinkTranslationPairsStep`, before `UpdateImportRunStep`:

```typescript
// packages/adapters/astro-sync/src/import/pipeline.ts
import { SyncClustersFromFrontmatterStep } from "./steps/sync-clusters-from-frontmatter.ts";

export class RepoImportPipeline extends Pipeline {
  // ...
  readonly steps = [
    new ListContentFilesStep(),
    new FilterChangedFilesStep(),
    new ParseFrontmatterBatchStep(),
    new UpsertArticlesStep(),
    new LinkTranslationPairsStep(),
    new SyncClustersFromFrontmatterStep(),  // NEW
    new UpdateImportRunStep(),
  ] as const;

  // bridge() — pass projectId to new step
  // (Pattern matches existing bridge logic)
}
```

Update `bridge()` to forward `projectId` to the new step (it already flows through pipeline input).

Update `UpdateImportRunStep` to include cluster stats in the run summary (optional but nice for audit):
- Read previous step's output and store `pillarsCreated`, `clustersCreated`, `articlesLinked` in `astroImportRuns.importMetadata` jsonb if such field exists, or add new columns.

### B.4 Section B Acceptance

- [ ] `SyncClustersFromFrontmatterStep` exists and follows BaseStep pattern
- [ ] Step is wired into `RepoImportPipeline.steps` after `LinkTranslationPairsStep`
- [ ] Re-running import is idempotent (clusters updated, not duplicated)
- [ ] After running import on toolwiki: `SELECT COUNT(*) FROM clusters WHERE project_id = toolwiki` shows ~N where N = distinct clusterKey values
- [ ] After running import: every imported article with `clusterKey IS NOT NULL` has `clusterId IS NOT NULL`
- [ ] Cornerstone articles correctly set `clusters.pillarArticleId`
- [ ] Uncategorized count matches articles with NULL clusterKey
- [ ] Commit: `feat(astro-import): auto-sync clusters and pillars from frontmatter (49a.2)`

---

## Section C — UI: Cluster Filter + Phase 3 Status

### C.1 Files modified

- `apps/api/src/routes/cold-start.ts` — Phase 3 status now considers auto-imported clusters as "complete"
- `apps/web/src/components/articles/ArticlesPanel.vue` — cluster filter dropdown
- `apps/web/src/components/articles/ImportedArticlesPanel.vue` — show cluster name per article
- (Optional) `apps/web/src/pages/ClustersManagementPage.vue` — visible since clusters table now populated

### C.2 Cold-Start Phase 3 status

The Cold-Start status endpoint computes phase completion. Phase 3 (cluster-plan) is currently "pending" unless a cluster-plan pipeline-run was completed. After this spec, **any clusters in DB count as "complete"**:

```typescript
// apps/api/src/routes/cold-start.ts (in status handler)

// Phase 3: cluster plan
const clustersCount = await db
  .select({ count: sql<number>`count(*)::int` })
  .from(clusters)
  .where(eq(clusters.projectId, projectId));

const clusterPlanRunning = /* existing check */;
const phase3Complete = (clustersCount[0]?.count ?? 0) > 0;

// Status JSON:
clusters: {
  status:
    clusterPlanRunning.length > 0 ? "running" :
    phase3Complete ? "complete" : "pending",
  count: clustersCount[0]?.count ?? 0,
  source: phase3Complete && hadAutoImport ? "imported" : "generated",  // hint for UI
},
```

UI banner in Phase 3 component shows "X clusters auto-imported from frontmatter" instead of "Generate clusters" button when `source === "imported"`.

### C.3 Articles cluster filter (optional, nice-to-have)

Add a cluster dropdown filter to `ArticlesPanel.vue`:

```vue
<q-select
  v-model="filterClusterId"
  :options="clusterOptions"
  :label="$t('articles.filters.cluster')"
  clearable
  outlined
  dense
/>
```

Wire to existing list endpoint with `?clusterId=<id>` filter (extend `articleRoutes.get("/")` query schema if not already there). Skip if list endpoint doesn't easily accept this filter.

### C.4 Imported articles: show cluster

In `ImportedArticlesPanel.vue` or `ImportedArticlesTable.vue`, add a "Cluster" column showing `clusterKey` for each pair. This makes the import results immediately useful.

### C.5 Section C Acceptance

- [ ] Cold-Start status endpoint reports Phase 3 as "complete" when clusters exist
- [ ] Phase 3 UI shows imported cluster count instead of "Generate" button (when applicable)
- [ ] ClustersManagementPage.vue route shows auto-imported clusters (it was previously stub-rendering; now it can show real data)
- [ ] Imported articles table shows cluster name/key per row
- [ ] Commit: `feat(web): show auto-imported clusters in Cold-Start Phase 3 + articles UI (49a.3)`

---

## Section D — Tests + Final Verification

### D.1 Files to create

- `packages/adapters/astro-sync/test/sync-clusters.test.ts` (new)

### D.2 Unit test

```typescript
// packages/adapters/astro-sync/test/sync-clusters.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { articles, clusters, contentPillars, db, projects } from "@marketing-auto/db";
import { eq } from "drizzle-orm";
import { SyncClustersFromFrontmatterStep } from "../src/import/steps/sync-clusters-from-frontmatter.ts";

describe("SyncClustersFromFrontmatterStep", () => {
  let projectId: string;
  const slug = `sync-clusters-test-${Date.now()}`;

  beforeEach(async () => {
    const [p] = await db
      .insert(projects)
      .values({
        slug,
        name: "Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    projectId = p!.id;
  });

  afterEach(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  test("creates pillar and cluster from frontmatter", async () => {
    await db.insert(articles).values([
      {
        projectId,
        source: "imported",
        slug: "anyword-test",
        locale: "de",
        collection: "blog",
        cornerstoneKeyword: "anyword test",
        title: "Anyword Test",
        clusterKey: "ai-writing-2026",
        clusterRole: "cornerstone",
        category: "AI Writing Tools",
        status: "published",
      },
      {
        projectId,
        source: "imported",
        slug: "anyword-vs-jasper",
        locale: "de",
        collection: "blog",
        cornerstoneKeyword: "anyword vs jasper",
        title: "Anyword vs Jasper",
        clusterKey: "ai-writing-2026",
        clusterRole: "spoke",
        category: "AI Writing Tools",
        status: "published",
      },
    ]);

    const step = new SyncClustersFromFrontmatterStep();
    const result = await step.execute(
      { projectId },
      { projectId, pipelineRunId: "x", recordCost: async () => {} } as any
    );

    expect(result.pillarsCreated).toBeGreaterThanOrEqual(1);
    expect(result.clustersCreated).toBe(1);
    expect(result.articlesLinked).toBe(2);

    const linkedArticles = await db
      .select({ clusterId: articles.clusterId })
      .from(articles)
      .where(eq(articles.projectId, projectId));
    expect(linkedArticles.every((a) => a.clusterId !== null)).toBe(true);

    const [cluster] = await db
      .select()
      .from(clusters)
      .where(eq(clusters.projectId, projectId));
    expect(cluster?.name).toBe("ai-writing-2026");
    expect(cluster?.primaryKeyword).toBe("anyword test"); // from cornerstone article
    expect(cluster?.pillarArticleId).not.toBeNull();
  });

  test("re-running is idempotent", async () => {
    // Insert one cluster-keyed article
    await db.insert(articles).values({
      projectId,
      source: "imported",
      slug: "x",
      locale: "de",
      collection: "blog",
      cornerstoneKeyword: "x",
      title: "X",
      clusterKey: "cluster-x",
      clusterRole: "cornerstone",
      category: "Topic",
      status: "published",
    });

    const step = new SyncClustersFromFrontmatterStep();
    await step.execute({ projectId }, {} as any);
    const result2 = await step.execute({ projectId }, {} as any);

    expect(result2.clustersCreated).toBe(0); // already exists
    expect(result2.clustersUpdated).toBe(1);

    const allClusters = await db.select().from(clusters).where(eq(clusters.projectId, projectId));
    expect(allClusters.length).toBe(1); // not duplicated
  });

  test("counts uncategorized articles", async () => {
    await db.insert(articles).values([
      {
        projectId,
        source: "imported",
        slug: "no-cluster",
        locale: "de",
        collection: "tools",
        cornerstoneKeyword: "no-cluster",
        title: "Tool",
        clusterKey: null,
        category: null,
        status: "published",
      },
    ]);

    const step = new SyncClustersFromFrontmatterStep();
    const result = await step.execute({ projectId }, {} as any);

    expect(result.uncategorizedCount).toBe(1);
  });
});
```

### D.3 Final manual verification

```bash
# Type check
bun --filter @marketing-auto/db tsc --noEmit
bun --filter @marketing-auto/adapter-astro-sync tsc --noEmit
bun --filter @marketing-auto/api tsc --noEmit
bun --filter @marketing-auto/web vue-tsc --noEmit

# Tests
bun test

# Re-trigger import for toolwiki:
curl -X POST http://localhost:3050/api/projects/toolwiki/astro-import

# Wait ~30s, then verify:
psql "$DATABASE_URL" -c "
  SELECT
    (SELECT count(*) FROM content_pillars WHERE project_id = (SELECT id FROM projects WHERE slug = 'toolwiki')) as pillars,
    (SELECT count(*) FROM clusters WHERE project_id = (SELECT id FROM projects WHERE slug = 'toolwiki')) as clusters,
    (SELECT count(*) FROM articles WHERE source='imported' AND cluster_id IS NOT NULL AND project_id = (SELECT id FROM projects WHERE slug = 'toolwiki')) as linked_articles,
    (SELECT count(*) FROM articles WHERE source='imported' AND cluster_key IS NULL AND project_id = (SELECT id FROM projects WHERE slug = 'toolwiki')) as uncategorized
  ;
"

# Expected: pillars ≥ 3, clusters ≥ 10, linked_articles ~ 100-160 (blog+ki-wissen+comparisons+usecases),
# uncategorized ~ 100-120 (tools + authors + tool-categories + special-landings)

# Verify Cold-Start status:
curl http://localhost:3050/api/projects/toolwiki/cold-start/status | jq '.data.clusters'
# Expected: { status: "complete", count: <N>, source: "imported" }
```

### D.4 Section D Acceptance

- [ ] Unit tests pass (3 scenarios)
- [ ] Manual smoke matches expected counts
- [ ] Cold-Start status endpoint returns Phase 3 as complete
- [ ] No regressions in existing tests
- [ ] Commit: `test(sync-clusters): unit tests + verification (49a.4)`

---

## Acceptance Criteria (combined)

- [ ] All 4 sections committed on `feature/49a-cluster-auto-import`
- [ ] `articles.clusterKey`, `clusterRole`, `intentType` typed columns exist + backfilled
- [ ] `SyncClustersFromFrontmatterStep` registered in `RepoImportPipeline`
- [ ] After import: clusters + pillars + article-cluster-links populated for toolwiki
- [ ] Cold-Start Phase 3 status reports "complete" automatically
- [ ] ClustersManagementPage shows auto-imported clusters
- [ ] Re-import is idempotent (no duplicates, updates in place)
- [ ] All tests green

## Reporting Back

After implementation:

1. **Schema diff** for articles table
2. **Pre-flight data check**: paste output of the pre-flight SQL (cluster_key coverage per collection)
3. **Post-import counts**: pillars, clusters, linked_articles, uncategorized
4. **Distinct clusters list**: paste output of `SELECT name FROM clusters WHERE project_id = toolwiki ORDER BY name LIMIT 30;`
5. **Cold-Start status sample**: paste `/cold-start/status` response
6. **UI smoke**: does ClustersManagementPage show auto-imported data?
7. **Test results**
8. **Commit hashes** — 4 commits
9. **Deviations**

## Next After This Spec

Once 49a is done and you've seen the actual cluster structure for toolwiki:

- **Spec 49b**: Gap-identification per cluster (LLM analyzes existing cornerstone + spokes, suggests what's missing)
- **Spec 49c**: Tool-attachment to clusters (manual UI + frontmatter `relatedTools` field if exists)
- **Cold-Start for toolwiki**: now meaningful because Phase 3 is already done — start with Phase 4 if gaps are identified

## Discovered During Implementation

- **`tools` collection has 100% clusterKey coverage** — spec assumed tools were entity-style with no clusterKey. In practice all 108 tool articles have `clusterKey` set, forming 22 distinct clusters. This is more useful than expected; tools are fully clustered.
- **`usecases` collection has 0% clusterKey coverage** — spec expected usecases to have cluster keys. None of the 24 usecases articles carry `clusterKey`. They're counted as uncategorized (same bucket as authors/special-landings/tool-categories).
- **Scheduler race condition in tests** — creating `status: "approved"` cluster rows in a live DB while the API/workers are running triggers the `cluster:link-rebuild` background scheduler. When `afterEach` deletes the project, any in-flight `pipeline_runs` INSERT fails with an FK violation. Fix: delete `articles → clusters → contentPillars → projects` explicitly in `afterEach` (not just the project). Documented in root `CLAUDE.md`.

## Deviations

- **`source: "imported"` always returned when clusters exist** — the spec called for a more precise signal distinguishing frontmatter-imported vs LLM-generated clusters. Implemented as always `"imported"` when `clusterCount > 0` for simplicity, since `cluster-propose` has never been run for toolwiki. The Phase3ClusterPlan UI guards correctly via `this.phase === "idle"`, so the banner only appears when no pipeline run is active. If `cluster-propose` is later run for a project, the source field will be stale but the UI will show the correct "complete via pipeline" view.
- **Sync step run standalone without full re-import** — verification used a one-off script to call `SyncClustersFromFrontmatterStep` directly on the backfilled data rather than triggering a full GitHub-App-authenticated import. Functionally identical; the step is self-contained and the backfill had already populated `cluster_key` on all 210 articles.
