# Spec 49b — Content Gap Detection

## Goal

Zero-LLM pipeline that analyses the current cluster/article state and writes a
prioritised list of content gaps into a `content_gaps` DB table. No generation
is triggered automatically — Marcel reviews the list in the UI and approves
individual gaps before any costly pipeline runs.

Detection runs:
1. **Automatically** — as the last step of every `astro:repo-import` pipeline
   (after `SyncClustersFromFrontmatterStep`).
2. **On-demand** — via a dedicated API endpoint (button in the UI).

Cost: **€0** — no LLM calls, no external API calls.

---

## Gap Types

| type | Priority | Description |
|---|---|---|
| `missing_hub` | 1 (critical) if cluster ≥ 5 articles, else 2 | Cluster has spoke articles but `pillar_article_id IS NULL` |
| `missing_translation` | 1 if hub article, else 2 | Article exists in one locale (DE or EN) but no partner with same `translation_key` exists |
| `missing_spoke_type` | 2 | Cluster has a hub but is missing one of the expected spoke intent types |
| `cluster_too_small` | 2 if 0–1 articles, else 3 | Cluster has fewer than 3 total articles |

### Expected spoke intent types (for `missing_spoke_type`)

Derived from `articles.intent_type`. A cluster is considered to have a spoke type
covered when at least one article with that `intent_type` exists.

| intent_type value | Label |
|---|---|
| `comparison` | Tool A vs. Tool B |
| `pricing` | Pricing / Kosten Reality Check |
| `alternatives` | Tool X Alternativen |
| `use_case` | Use-Case / Rolle Guide |

A `missing_spoke_type` gap is created for each missing intent type in a cluster
that already has a hub. Clusters without a hub skip this check (covered by
`missing_hub` first).

---

## DB Schema

### New table: `content_gaps`

```sql
CREATE TABLE content_gaps (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  cluster_id        UUID REFERENCES clusters(id) ON DELETE CASCADE,

  -- Gap classification
  gap_type          TEXT NOT NULL,  -- 'missing_hub' | 'missing_translation' | 'missing_spoke_type' | 'cluster_too_small'
  locale            TEXT,           -- for missing_translation: the locale that IS missing (e.g. 'en')
  intent_type       TEXT,           -- for missing_spoke_type: which intent is absent
  translation_key   TEXT,           -- for missing_translation: the translation_key of the existing article

  -- Prioritisation
  priority          INTEGER NOT NULL DEFAULT 2,  -- 1 = critical, 2 = high, 3 = medium

  -- Lifecycle
  status            TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'in_progress' | 'resolved' | 'dismissed'
  resolved_at       TIMESTAMPTZ,
  dismissed_at      TIMESTAMPTZ,

  -- Context for generation (populated at detection time, used by UI + generation pipeline)
  metadata          JSONB NOT NULL DEFAULT '{}',
  -- metadata shape:
  -- {
  --   clusterName: string,
  --   clusterMemberCount: number,
  --   existingLocale?: 'de' | 'en',          -- missing_translation
  --   existingArticleSlug?: string,           -- missing_translation
  --   spokesPresent?: string[],               -- missing_spoke_type
  --   suggestedTitle?: string,                -- optional hint for generation
  -- }

  detected_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX content_gaps_project_idx     ON content_gaps(project_id);
CREATE INDEX content_gaps_cluster_idx     ON content_gaps(cluster_id);
CREATE INDEX content_gaps_status_idx      ON content_gaps(project_id, status);
CREATE INDEX content_gaps_type_idx        ON content_gaps(project_id, gap_type);

-- Natural key: one open gap per (project, cluster, type, locale, intent_type)
-- Prevents duplicates on re-run without needing to delete-all first
CREATE UNIQUE INDEX content_gaps_dedup_idx ON content_gaps (
  project_id,
  COALESCE(cluster_id::text, ''),
  gap_type,
  COALESCE(locale, ''),
  COALESCE(intent_type, ''),
  COALESCE(translation_key, '')
) WHERE status IN ('open', 'in_progress');
```

### Column addition: `projects.gaps_last_detected_at`

```sql
ALTER TABLE projects
  ADD COLUMN gaps_last_detected_at TIMESTAMPTZ;
```

### Migration

- idx: 21, when: 1779900000000, tag: `0021_content_gaps`
- File: `packages/db/drizzle/0021_content_gaps.sql`
- Write SQL manually (no `drizzle-kit generate` — non-TTY environment).
- Add Drizzle `$type<>` annotations in `packages/db/src/schema/content.ts`.

---

## Drizzle Schema

### `packages/db/src/schema/content.ts` additions

```typescript
export type ContentGapMetadata = {
  clusterName: string;
  clusterMemberCount: number;
  existingLocale?: "de" | "en";
  existingArticleSlug?: string;
  spokesPresent?: string[];
  suggestedTitle?: string;
};

export const contentGaps = pgTable(
  "content_gaps",
  {
    id:             uuid("id").primaryKey().defaultRandom(),
    projectId:      uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    clusterId:      uuid("cluster_id").references(() => clusters.id, { onDelete: "cascade" }),
    gapType:        text("gap_type").$type<"missing_hub" | "missing_translation" | "missing_spoke_type" | "cluster_too_small">().notNull(),
    locale:         text("locale"),
    intentType:     text("intent_type"),
    translationKey: text("translation_key"),
    priority:       integer("priority").notNull().default(2),
    status:         text("status").$type<"open" | "in_progress" | "resolved" | "dismissed">().notNull().default("open"),
    resolvedAt:     timestamp("resolved_at",  { withTimezone: true }),
    dismissedAt:    timestamp("dismissed_at", { withTimezone: true }),
    metadata:       jsonb("metadata").$type<ContentGapMetadata>().notNull().default({}),
    detectedAt:     timestamp("detected_at",  { withTimezone: true }).notNull().defaultNow(),
    createdAt:      timestamp("created_at",   { withTimezone: true }).notNull().defaultNow(),
    updatedAt:      timestamp("updated_at",   { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectIdx:  index("content_gaps_project_idx").on(t.projectId),
    clusterIdx:  index("content_gaps_cluster_idx").on(t.clusterId),
    statusIdx:   index("content_gaps_status_idx").on(t.projectId, t.status),
    typeIdx:     index("content_gaps_type_idx").on(t.projectId, t.gapType),
  })
);
```

### `packages/db/src/schema/projects.ts` addition

```typescript
gapsLastDetectedAt: timestamp("gaps_last_detected_at", { withTimezone: true }),
```

Export `contentGaps` from `packages/db/src/schema/index.ts`.

---

## Pipeline Step: `DetectContentGapsStep`

**File:** `packages/adapters/astro-sync/src/import/steps/detect-content-gaps.ts`

```
Input:  { projectId: string }
Output: { gapsCreated: number, gapsResolved: number, gapsDismissed: number, totalOpen: number }
```

### Algorithm

```
1. Load all clusters for project (with pillarArticleId, member count)
2. Load all imported articles for project (id, clusterId, clusterRole,
   intentType, locale, translationKey, slug)

3. For each cluster:
   a. missing_hub
      → cluster has ≥ 1 spoke AND pillarArticleId IS NULL
      → priority = cluster.memberCount >= 5 ? 1 : 2

   b. cluster_too_small
      → cluster.memberCount < 3
      → priority = cluster.memberCount <= 1 ? 2 : 3

   c. missing_spoke_type  (only if cluster has a hub)
      → for each EXPECTED_INTENT_TYPE:
           if no article in cluster with that intentType → create gap
      → priority = 2

4. For missing_translation:
   → group articles by translationKey
   → for each group: if de present but en absent → gap(locale='en')
   → for each group: if en present but de absent → gap(locale='de')
   → priority = article.clusterRole === 'hub' ? 1 : 2

5. Upsert gaps:
   → INSERT ... ON CONFLICT (dedup index) DO UPDATE SET detected_at = NOW()
   → This re-stamps existing open gaps without creating duplicates

6. Resolve gaps that no longer apply:
   → UPDATE content_gaps SET status='resolved', resolved_at=NOW()
      WHERE status='open' AND project_id=$1
      AND NOT EXISTS (matching current gap from steps 3-4)

7. UPDATE projects SET gaps_last_detected_at = NOW()
   WHERE id = project_id
```

**Cost override:** `estimatedCostEur() → 0`

---

## Integration: Astro Import Pipeline

`packages/adapters/astro-sync/src/import/pipeline.ts` — add as final step:

```typescript
import { DetectContentGapsStep } from "./steps/detect-content-gaps.ts";

// In steps array (after SyncClustersFromFrontmatterStep):
new DetectContentGapsStep(),
```

Bridge from `sync-clusters-from-frontmatter` → `detect-content-gaps`:
```typescript
// Input passthrough — both steps only need { projectId }
if (from.name === "sync-clusters-from-frontmatter" && to.name === "detect-content-gaps") {
  return { projectId: pipelineInput.projectId };
}
```

---

## API Endpoints

### `POST /api/projects/:slug/detect-gaps` — On-demand trigger

```typescript
// apps/api/src/routes/projects.ts
projectRoutes.post("/:slug/detect-gaps", requireAuth, async (c) => {
  const [project] = await db.select({ id: projects.id })
    .from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!project) return c.json({ ok: false, error: "Not found" }, 404);

  const step = new DetectContentGapsStep();
  const result = await step.execute({ projectId: project.id }, stubCtx);

  return c.json({ ok: true, data: result });
});
```

No BullMQ — step is synchronous and cheap (< 1s for typical project size).

### `GET /api/projects/:slug/content-gaps` — List gaps

Query params: `status` (default: `open`), `type`, `priority`, `limit`, `offset`

Response:
```json
{
  "ok": true,
  "data": {
    "items": [...],
    "total": 42,
    "limit": 50,
    "offset": 0,
    "lastDetectedAt": "2026-05-11T13:22:48Z"
  }
}
```

### `PATCH /api/projects/:slug/content-gaps/:id` — Update status

Accepts `{ status: "dismissed" | "in_progress" }` (resolved is set automatically
by re-detection).

---

## UI

**Location:** New tab or section in `ProjectDetailPage` → `GapsPanel.vue`

Alternatively surfaced in `ClustersManagementPage` per-cluster.

### GapsPanel layout

```
[ Zuletzt erkannt: 11. Mai 2026, 13:22 Uhr ]  [ Gaps erkennen ]

Filter: [Alle] [missing_hub] [missing_translation] [missing_spoke_type] [cluster_too_small]

┌─────────────────────────────────────────────────────────────┐
│ 🔴 missing_hub · Priorität 1                                │
│ Cluster: video-ki-2026 (8 Artikel, kein Hub)               │
│                                         [Ignorieren] [→ Generieren freigeben] │
├─────────────────────────────────────────────────────────────┤
│ 🟠 missing_translation · Priorität 1                        │
│ suno (DE) hat kein EN-Pendant                               │
│                                         [Ignorieren] [→ Generieren freigeben] │
└─────────────────────────────────────────────────────────────┘
```

"Generieren freigeben" → setzt `status = 'in_progress'` und triggert später
die Outline-Pipeline (nicht Teil dieser Spec — Spec 50).

---

## Prioritätslogik (Zusammenfassung)

| Condition | Priority |
|---|---|
| `missing_hub` + cluster ≥ 5 articles | 1 — critical |
| `missing_hub` + cluster < 5 articles | 2 — high |
| `missing_translation` + hub article | 1 — critical |
| `missing_translation` + spoke article | 2 — high |
| `missing_spoke_type` | 2 — high |
| `cluster_too_small` + 0–1 articles | 2 — high |
| `cluster_too_small` + 2 articles | 3 — medium |

---

## Verification

```sql
-- After first detection run:
SELECT gap_type, priority, COUNT(*) as count
FROM content_gaps
WHERE project_id = (SELECT id FROM projects WHERE slug = 'toolwiki')
  AND status = 'open'
GROUP BY gap_type, priority
ORDER BY priority, gap_type;

-- Expected for toolwiki current state:
-- missing_hub        | 1 | ~5  (large clusters without hub)
-- missing_hub        | 2 | ~5  (small clusters without hub)
-- missing_translation| 1 | ~4  (hub articles with only one locale)
-- missing_translation| 2 | ~X  (spoke pairs incomplete)
-- missing_spoke_type | 2 | ~X  (depends on intentType coverage)
-- cluster_too_small  | 3 | ~8  (2-article clusters)

-- Timestamp updated:
SELECT slug, gaps_last_detected_at FROM projects WHERE slug = 'toolwiki';
```

---

## Files to Create / Modify

| Action | Path |
|---|---|
| CREATE | `specs/49b-content-gap-detection.md` (this file) |
| CREATE | `packages/db/drizzle/0021_content_gaps.sql` |
| MODIFY | `packages/db/drizzle/meta/_journal.json` (add entry idx 21) |
| MODIFY | `packages/db/src/schema/content.ts` (add `contentGaps` table + `ContentGapMetadata` type) |
| MODIFY | `packages/db/src/schema/projects.ts` (add `gapsLastDetectedAt` column) |
| MODIFY | `packages/db/src/schema/index.ts` (export `contentGaps`) |
| CREATE | `packages/adapters/astro-sync/src/import/steps/detect-content-gaps.ts` |
| MODIFY | `packages/adapters/astro-sync/src/import/pipeline.ts` (add step + bridge) |
| MODIFY | `apps/api/src/routes/projects.ts` (add 2 endpoints) |
| CREATE | `apps/web/src/components/projects/GapsPanel.vue` |
| MODIFY | `apps/web/src/pages/ProjectDetailPage.vue` (add Gaps tab) |

---

## Out of Scope (→ Spec 50)

- Automatic generation trigger from an approved gap
- Suggested title / outline generation for a gap (LLM, costs money)
- Gap-to-article tracking (linking a resolved gap to the article that filled it)
- Batch approval ("approve all missing_hub gaps")
