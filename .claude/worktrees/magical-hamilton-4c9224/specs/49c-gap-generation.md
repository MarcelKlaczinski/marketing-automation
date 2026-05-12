# Spec 49c — Gap-to-Article Generation

## Goal

Turn an approved content gap into an article (or cornerstone spec) with one
click. Adds three capabilities on top of Spec 49b:

1. **Title suggestion** — cheap LLM step (~€0.01/gap) that proposes a title,
   slug and meta description for a gap before the user commits to full generation.
2. **Generation trigger** — one-click pipeline launch that converts a gap into an
   article or cornerstone spec, then links the gap to the created record.
3. **Batch operations** — dismiss or suggest-titles for multiple gaps at once
   from the UI.

Missing-translation gaps get a **disabled** Generate button for now (translation
pipeline not yet built).

---

## Gap Type → Generation Action

| Gap type | Action | Creates |
|---|---|---|
| `missing_hub` | → Cornerstone Spec flow | `cornerstone_specs` row (status `proposed`) |
| `missing_spoke_type` | → Article Outline pipeline | `articles` row (status `proposed`) → triggers `article:outline` |
| `cluster_too_small` | → Article Outline pipeline | `articles` row (status `proposed`) → triggers `article:outline` |
| `missing_translation` | _(disabled)_ | nothing — button disabled, tooltip explains |

### Why cornerstone spec for `missing_hub`?

Hubs are pillar articles that define the cluster's topic. Marcel reviews and
optionally edits the proposed cornerstone spec before committing to a full
draft. This matches the existing Cornerstone Spec approval flow (Spec 45/48).

---

## New Columns (Migration 0022)

### `content_gaps` table additions

```sql
ALTER TABLE content_gaps
  ADD COLUMN filled_by_article_id     UUID REFERENCES articles(id) ON DELETE SET NULL,
  ADD COLUMN filled_by_spec_id        UUID REFERENCES cornerstone_specs(id) ON DELETE SET NULL,
  ADD COLUMN generation_triggered_at  TIMESTAMPTZ;
```

`filled_by_article_id` — set when a spoke/small-cluster article is created from
this gap.

`filled_by_spec_id` — set when a `cornerstone_spec` is created from a
`missing_hub` gap.

`generation_triggered_at` — timestamp when the Generate button was clicked;
allows the UI to show "generation in progress" state.

### `content_gaps.metadata` additions (no migration, JSONB)

```typescript
export type ContentGapMetadata = {
  // … existing fields …
  suggestedTitle?:           string;
  suggestedSlug?:            string;
  suggestedMetaDescription?: string;
};
```

---

## New Pipeline Step: `SuggestGapTitleStep`

Package: `packages/adapters/astro-sync/src/gap/steps/suggest-gap-title.ts`

**Input schema:**
```typescript
z.object({
  projectId: z.string().uuid(),
  gapId:     z.string().uuid(),
})
```

**What it does:**
1. Loads the gap row + cluster name + project marketing context
2. Calls LLM (Claude Haiku — cheap) with a prompt that:
   - Knows the gap type, cluster topic, and intent type (for spoke gaps)
   - Asks for: `title`, `slug`, `metaDescription`
3. Writes the three fields into `content_gaps.metadata`
4. Updates `content_gaps.updated_at`

**Cost:** ~€0.003–0.01 per gap (Haiku input + output ≈ 500 tokens each way)

**Skill:** `content-gap-suggestion` — new skill MD to write in `packages/skills/skills/`
(not a git submodule change — add to the skills package directly)

Wait — skills is a git submodule. Use inline system prompt in the step instead
(same pattern as steps that can't rely on submodule skills).

---

## API Changes

### 1. `POST /api/projects/:slug/content-gaps/:id/suggest`

Triggers `SuggestGapTitleStep` synchronously (fast, cheap).

**Response:**
```json
{
  "ok": true,
  "data": {
    "suggestedTitle": "…",
    "suggestedSlug": "…",
    "suggestedMetaDescription": "…"
  }
}
```

### 2. `POST /api/projects/:slug/content-gaps/:id/generate`

Triggers full generation based on gap type.

**Request body** (optional override):
```typescript
z.object({
  title:           z.string().optional(), // override suggested title
  locale:          z.string().optional(), // override locale (default: 'de')
}).optional()
```

**Logic per gap type:**

**`missing_hub`:**
```
1. Load cluster + project
2. Determine locale (default 'de', or gap locale)
3. INSERT cornerstone_specs row:
   - status: 'proposed'
   - cornerstoneKeyword: derived from cluster.name (slugified)
   - proposedTitle: body.title ?? gap.metadata.suggestedTitle ?? cluster.name + " — Übersicht"
   - proposedSlug: gap.metadata.suggestedSlug ?? slugify(proposedTitle)
   - metaDescription: gap.metadata.suggestedMetaDescription ?? ""
   - locale, clusterId, projectId, translationKey: new uuid
4. UPDATE content_gaps SET
     filled_by_spec_id = <new spec id>,
     generation_triggered_at = NOW(),
     status = 'in_progress'
5. Return { cornerstoneSpecId, clusterId }
```

**`missing_spoke_type` / `cluster_too_small`:**
```
1. Load cluster + project
2. INSERT articles row:
   - projectId, clusterId
   - source: 'generated'
   - status: 'proposed'
   - locale: body.locale ?? 'de'
   - clusterRole: 'spoke'
   - intentType: gap.intentType (for missing_spoke_type) or null
   - cornerstoneKeyword: slugify(proposedTitle)
   - title: body.title ?? gap.metadata.suggestedTitle ?? null
   - collection: 'blog'
   - slug: gap.metadata.suggestedSlug ?? temp slug (to be refined in outline step)
   - approvalMode: project.pipelineConfig.approvalMode ?? 'manual'
3. Enqueue article:outline pipeline for the new article
4. UPDATE content_gaps SET
     filled_by_article_id = <new article id>,
     generation_triggered_at = NOW(),
     status = 'in_progress'
5. Return { articleId, runId }
```

**`missing_translation`:**
```
Return 400 { ok: false, error: "Translation generation not yet implemented" }
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "type": "cornerstone_spec" | "article",
    "cornerstoneSpecId": "…",   // missing_hub only
    "articleId": "…",            // spoke/small only
    "runId": "…",                // article outline run id (spoke/small only)
    "gapStatus": "in_progress"
  }
}
```

### 3. `POST /api/projects/:slug/content-gaps/batch`

**Request body:**
```typescript
z.object({
  action:  z.enum(["dismiss", "suggest-all"]),
  filters: z.object({
    gapType:  z.enum(["missing_hub", "missing_translation", "missing_spoke_type", "cluster_too_small"]).optional(),
    priority: z.coerce.number().int().min(1).max(3).optional(),
  }).optional(),
  gapIds:  z.array(z.string().uuid()).optional(), // explicit list overrides filters
})
```

**`dismiss`:** bulk UPDATE status = 'dismissed' for matching open gaps.

**`suggest-all`:** enqueue `SuggestGapTitleStep` for each matching open gap
(runs sequentially in-process — max 20 gaps per batch to avoid timeouts).

**Response:**
```json
{ "ok": true, "data": { "affected": 12 } }
```

---

## UI Changes (`GapsPanel.vue`)

### Per-gap card additions

- **"Suggest" button** (`lightbulb_outline` icon) — calls `/suggest`, then shows
  the suggested title inline below the gap type badge.
  - While loading: spinner replaces icon
  - After load: shows `suggestedTitle` in italic + slug in code font
  - Button turns into checkmark if suggestion already exists in metadata

- **"Generate" button** (`play_arrow` icon) — calls `/generate`
  - `missing_translation` gaps: button is disabled, tooltip explains why
  - After click: gap card shows `in_progress` badge + link to created article/spec
  - For `missing_hub`: routes to cornerstone spec approval page
  - For spoke/small: routes to article detail page

- **Status chip** on card — shows current status (`open`, `in_progress`,
  `resolved`, `dismissed`) with colour

### Batch action toolbar

Above the gap list, a row of batch buttons (only shown when gaps exist):

```
[Dismiss all cluster_too_small]  [Suggest titles for all]
```

Filter-context-aware: the batch buttons act on the current filter selection.

---

## Files to Touch

### New
- `packages/adapters/astro-sync/src/gap/steps/suggest-gap-title.ts`
- `packages/db/drizzle/0022_gap_generation.sql`

### Modified
- `packages/db/src/schema/content.ts` — add 3 new columns + update `ContentGapMetadata` type
- `packages/db/drizzle/meta/_journal.json` — add 0022 entry
- `apps/api/src/routes/projects.ts` — add 3 new endpoints
- `apps/web/src/components/projects/GapsPanel.vue` — suggest/generate buttons, batch toolbar
- `apps/web/src/i18n/de/gaps.ts` + `en/gaps.ts` — new keys

---

## Cost Estimate

| Action | Model | Estimated cost |
|---|---|---|
| Suggest title (1 gap) | Claude Haiku | ~€0.005 |
| Suggest-all (20 gaps) | Claude Haiku | ~€0.10 |
| Full article outline | Claude Sonnet | ~€0.15 (existing pipeline) |
| Cornerstone spec creation | No LLM in spec creation itself | €0.00 |

---

## Decisions

- **No automatic suggest on generation** — Marcel must explicitly click "Suggest"
  before "Generate". This avoids surprise LLM costs.
- **`cornerstone_specs` not `articles` for hubs** — keeps hub creation in the
  existing approval flow; Marcel can edit the spec before committing to a draft.
- **Batch suggest capped at 20** — prevents accidental large LLM bills from
  one click. Future: configurable cap.
- **Translation disabled** — revisit when a translation pipeline exists.
- **Slug temp value** — for spoke articles, slug is set to a temporary value
  (`gap-<gapId[0..8]>`) and gets replaced by the outline step's `UpdateArticleStep`.

---

## Deviations from Original Spec

### 1. Service function, not BaseStep
The spec described `SuggestGapTitleStep` as a `BaseStep` in `packages/adapters/astro-sync/`.
**Implemented as** `suggestGapTitle()` in `apps/api/src/lib/gap-service.ts`, called
synchronously from route handlers. Rationale: the operation is a one-off HTTP call, not
a pipeline step — it has no need for idempotency keys, step_runs rows, or BullMQ queuing.
The service-file pattern (`src/lib/<domain>-service.ts`) satisfies the "no adapter calls
in routes" rule without unnecessary pipeline overhead.

### 2. Suggestion output extended
Original spec: `title`, `slug`, `metaDescription` only.
**Implemented:** also returns `heroImagePrompt` (image generation prompt, always required
for articles) and `cornerstoneKeyword` (the primary search keyword anchored to real cluster
data).

### 3. DataForSEO keyword enrichment added
Not in original spec. Before calling Claude Haiku, `gap-service.ts` calls
`dataforseo.keywordOverview()` on the cluster's existing keyword list (from Cold-Start
Phase 3). This provides volume + difficulty data so Haiku picks a rankable keyword instead
of guessing from the cluster name. Cost: +~€0.002 per suggestion. DataForSEO errors fall
back gracefully.

### 4. `cornerstoneKeyword` on article insert uses LLM-suggested keyword
Spec said `cornerstoneKeyword: slugify(proposedTitle)`.
**Implemented:** `cornerstoneKeyword = meta.suggestedCornerstoneKeyword ?? slugify(proposedTitle)`.
`TopicIntakeStep` matches `article.cornerstoneKeyword` against `cluster.satelliteKeywords`
entries to retrieve satellite keywords for the SERP research step. Using `slugify(title)`
never matches → `satelliteKeywords = []` → degraded outline quality. The LLM-suggested
keyword is chosen from the cluster's actual keyword data, ensuring the match succeeds.
