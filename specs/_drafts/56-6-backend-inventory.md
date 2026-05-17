# 56.6 Backend Inventory (for Content Discovery UI)

**Date:** 2026-05-17
**Investigator:** Claude Code via discovery prompt

---

## Area A: Trends Discovery

### A.1 Pipeline existence

**Found:** Trends discovery is fully implemented as a `TopicSource` (not a full Pipeline).

- **Pipeline class:** `TrendDiscoveryTopicSource` in `/packages/pipelines/src/topic-sources/trend-discovery/source.ts`
- **Worker coordination:** `src/workers/trend-synthesizer.ts` enqueues synthesis jobs via BullMQ; worker calls `TrendDiscoveryTopicSource.emit()`
- **Three-tier job system:**
  - `schedule-daily` — daily cron entry point (triggered by scheduler)
  - `synthesize-all` — fans out to one `synthesize-project` per project
  - `synthesize-project` — calls `TrendDiscoveryTopicSource.emit()` + inserts `topic_briefs` rows

### A.2 Data model

**`TrendMetadataSchema`** (JSONB column on `topic_briefs.trend_metadata`):
```typescript
{
  trendScore: number;
  signals: Array<{
    id: string (uuid);
    source: "producthunt" | "hackernews" | "reddit" | "github" | "vendor_rss" | "dataforseo_trends";
    externalId: string;
    url?: string;
    capturedAt: string;
  }>;
  freshnessWindow: "breaking" | "rising" | "stable";
  relatedEvent?: string;
  scoreBreakdown?: {
    communityBuzz: number;
    searchVolumeGrowth: number;
    officialAnnouncement: number;
    serpVolatility: number;
    sourceDiversity: number;
    existingCoveragePenalty: number;
  };
}
```

**`ExternalSignalSource` enum (DB column `external_signals.source`):**
- `producthunt`, `hackernews`, `reddit`, `github`, `vendor_rss`, `dataforseo_trends`

**Related tables:**
- `external_signals` — raw signals fetched daily via adapters (dedup key: `source + external_id`)
- `rejected_topic_candidates` — topics rejected during synthesis; 30-day expiry for re-emergence

### A.3 Sources / data inputs

**Signal sources (adapters):**
- `packages/adapters/hackernews/` — fetches HN posts (free API)
- `packages/adapters/dataforseo/` — DataForSEO Trends + keyword growth (paid adapter, cost-tracked)
- `packages/adapters/vendor-rss/` — RSS feeds for vendor announcements (free)
- `packages/adapters/` — Reddit adapter exists (implied by enum value)

**Signal collection trigger:**
- Daily cron: `signal-collector.ts` fires at `SIGNAL_COLLECTOR_CRON` (default: `"30 0 * * *"` — 00:30 UTC)
- Manual trigger: `bun --filter @marketing-auto/api signals:collect <slug>`

**Configuration:**
- Sources are **project-scoped** (collected per project)
- Default cron: 00:30 UTC, 14-day retention before expiry
- Janitor in `synthesize-project` stamps unprocessed signals older than 14 days with `processedAt`

### A.4 Scoring logic

**Scoring function:** `computeTrendScore()` in `/packages/pipelines/src/topic-sources/trend-discovery/score.ts`

**Six-component weighted score (Spec 54.5b):**
```typescript
const score =
  (W.buzz * buzz) / 100 +
  (W.growth * growth) / 100 +
  (W.official * official) / 100 +
  (W.serp * serpVol) / 100 +
  (W.diversity * diversity) / 100 -
  (W.coverage * coveragePenalty) / 100;
const total = Math.round(clamp(raw, 0, 100));
```

**Weights (positive sum to 100):**
- `buzz: 15` — community engagement (HackerNews points + votes + Reddit comments via log10 normalization)
- `growth: 15` — DataForSEO Trends `growth_ratio` normalized (0-2 range → 0-100)
- `official: 25` — vendor_rss announcements from major labs (binary: 0 or 100)
- `serp: 20` — SERP volatility (SERP features variety + competition heuristic)
- `diversity: 25` — cross-source confirmation (0, 50, or 100 based on unique signal sources)
- `coverage: 40` — **penalty** for existing coverage (article similarity 0-100, subtracted from total)

**Thresholds:**
- Min score for acceptance: `config.topicScope.min_trend_score` (default: **25** per Spec 54.5b)
- Coverage similarity ranges:
  - `> 0.85` → reject (covered)
  - `0.60-0.85` → Haiku tiebreaker LLM call
  - `< 0.60` → accept (new)

**Helper functions:**
- `computeCommunityBuzz(signals)` — log10 normalization of engagement metrics
- `computeOfficialAnnouncementBonus(signals)` — checks `MAJOR_VENDOR_DOMAINS` set
- `normalizeGrowthRatio(ratio)` — clamps growth_ratio to [0,2]
- `computeSerpVolatilityFromResults(serpFeatures, organicResultCount)` — feature variety + competition score
- `computeSourceDiversity(signals)` — returns 0/50/100 based on unique source count
- `computeCoveragePenalty(maxSimilarity)` — linear interpolation between 0.50 and 0.85 thresholds

### A.5 Triggering

**Cron registration:**
- File: `/apps/api/src/workers/trend-synthesizer.ts`
- Registration function: `registerTrendSynthesizerCron()` (lines 193-206)
- **Status: DISABLED** — commented out at line 174 in `/apps/api/src/workers/index.ts`
  ```typescript
  // await registerTrendSynthesizerCron(); // temporarily disabled
  ```

**Cron configuration:**
- Default pattern: `TREND_SYNTHESIZER_CRON` env var, fallback `"30 1 * * *"` (01:30 UTC)
- Job name: `"schedule-daily"` with `repeat: { pattern: cron }`
- Registered with BullMQ via `queue.add(name, payload, opts)`

**Manual trigger:**
```bash
bun --filter @marketing-auto/api trends:synthesize <slug>
```
Enqueues a `synthesize-project` job with stable jobId.

**Status: Cron disabled** — must call manual trigger or re-enable via code change.

### A.6 Brief creation from trends

**Flow:**
1. `TrendDiscoveryTopicSource.emit()` returns array of `TopicBriefInsert` (does NOT persist)
2. Worker owns the transaction: `await tx.insert(topicBriefs).values(rows)`
3. After insert, worker stamps signals: `processedAt = now(), processedInto = brief.id`

**Brief properties for trends:**
- `source: "trend_discovery"`
- `approvalStatus: "pending"` (requires Marcel's review before routing)
- `approvalRequired: true`
- `clusterAction: "append_to_existing"` or `"create_new"` (determined by `findMatchingCluster()`)
- `trendMetadata: { trendScore, signals, scoreBreakdown, freshnessWindow, relatedEvent }`
- `locale: "de" | "en"` (resolved from `projects.targetLocales[0]`)
- `clusterId: uuid | null` (if cluster match found, else null + `clusterAction: "create_new"`)

**Automatic article generation?**
No — briefs require Marcel's approval via `/api/projects/:slug/trends/<briefId>/approve` before routing to a pipeline.

**Approval endpoint:**
- `POST /api/projects/:slug/trends/pending-briefs/<briefId>/approve` — calls `decideRoute()` + `executeDecision()`, enqueues `article:blog` pipeline (since all trend briefs have locale + clusterId)

### A.7 Listing trends in the API

**Endpoint:** `GET /api/projects/:slug/trends/pending-briefs`

**Response shape:**
```json
{
  "ok": true,
  "data": {
    "briefs": [
      {
        "id": "uuid",
        "source": "trend_discovery",
        "topicTitle": "...",
        "trendMetadata": { "trendScore": 75, ... },
        "approvalStatus": "pending",
        ...
      }
    ]
  }
}
```

**Query support:**
- Sorts by `trendScore DESC` (via raw SQL: `(${topicBriefs.trendMetadata}->>'trendScore')::int`)
- Filters: `approvalStatus = "pending"` (hard-coded in route)
- No pagination or additional filters currently

**Related endpoints:**
- `GET /api/projects/:slug/trends/rejected-topics` — list rejected candidates with reasons + expiry
- `POST /api/projects/:slug/trends/<briefId>/approve` — approve and route to pipeline
- `DELETE /api/projects/:slug/trends/<briefId>` — dismiss brief

### A.8 Trends UI today

**UI status: NONE**

No Vue pages or components for trends UI. Only i18n strings exist:
- `/apps/web/src/i18n/de/trends.ts`
- `/apps/web/src/i18n/en/trends.ts`

**Briefs page** (`apps/web/src/pages/briefs/BriefsPage.vue`) is generic and currently lists all briefs (gap + manual sources) without filtering by source. No trends-specific UI implemented.

---

## Area B: Content-Gap Analysis

### B.1 Pipeline / analysis logic

**Gap detection:** Not a pipeline — zero-cost pure SQL + async import process.

**Trigger points:**
1. **Cold-Start Phase 2/3** — gaps auto-generated from cluster analysis (sync with LLM cluster generation)
2. **Post-import** — Astro repo import pipeline auto-detects gaps via `detect-content-gaps.ts` adapter step
3. **Manual detection** — route `POST /api/projects/:slug/cold-start/detect-gaps` (Phase 4.5)

**Detection logic:**
- Scans existing clusters + articles
- Identifies missing hub, missing spoke types, missing translations, cluster-too-small
- Writes to `content_gaps` table with `status: "open"`
- **Zero LLM cost** (detection is SQL-based; suggestion is separate Haiku call)

### B.2 Data model

**`ContentGapMetadata` type:**
```typescript
{
  clusterName?: string;
  clusterMemberCount?: number;
  existingLocale?: "de" | "en";          // missing_translation: locale that EXISTS
  existingArticleSlug?: string;          // missing_translation: slug of existing article
  spokesPresent?: string[];              // missing_spoke_type: intent types already covered
  suggestedTitle?: string;               // Spec 49c: LLM suggestion (Haiku)
  suggestedSlug?: string;
  suggestedCornerstoneKeyword?: string;  // real search keyword anchored to cluster.satelliteKeywords
  suggestedMetaDescription?: string;
  suggestedHeroImagePrompt?: string;     // image generation prompt
  discoveredKeywords?: string[];         // keywords from DataForSEO relatedKeywords (Path B)
}
```

**`content_gaps` table:**
```sql
id: uuid (PK)
project_id: uuid (FK → projects, cascade)
cluster_id: uuid (FK → clusters, cascade, nullable)
gap_type: TEXT "missing_hub" | "missing_spoke_type" | "missing_translation" | "cluster_too_small"
locale: TEXT (nullable) — for missing_translation
intent_type: TEXT (nullable) — for missing_spoke_type
translation_key: TEXT (nullable) — for missing_translation
priority: INTEGER (1-3, default 2)
status: TEXT "open" | "in_progress" | "resolved" | "dismissed" (default "open")
resolved_at: TIMESTAMP (nullable)
dismissed_at: TIMESTAMP (nullable)
metadata: JSONB (ContentGapMetadata)
filled_by_article_id: UUID (nullable, no FK) — article that resolved the gap
filled_by_spec_id: UUID (nullable, FK → cornerstone_specs)
generation_triggered_at: TIMESTAMP (nullable)
detected_at: TIMESTAMP (default now())
created_at: TIMESTAMP (default now())
updated_at: TIMESTAMP (default now())
```

**Indexes:**
- `project_id`
- `cluster_id`
- `(project_id, status)`
- `(project_id, gap_type)`

### B.3 API endpoints

**List gaps:**
- `GET /api/projects/:slug/content-gaps?status=open&gapType=missing_hub&priority=1`
- Filters: `status`, `gapType`, `priority`, `activeOnly` (boolean)
- Returns paginated list with count

**Update gap status:**
- `PATCH /api/projects/:slug/content-gaps/:id`
- Body: `{ status: "open" | "in_progress" | "resolved" | "dismissed" }`
- Sets `dismissed_at` or `resolved_at` timestamp

**Batch status update:**
- `POST /api/projects/:slug/content-gaps/batch`
- Body: `{ gapIds?: string[], filters?: { status, gapType, priority }, action: "dismiss" | "mark_in_progress" | "resolve" }`
- Updates multiple gaps atomically

**Suggest gap title (Haiku):**
- `POST /api/projects/:slug/content-gaps/:id/suggest`
- Response: `{ suggestedTitle, suggestedSlug, suggestedMeta, primaryKeyword, secondaryKeywords, briefId, clusterUpdated: false, cached: false }`
- Idempotent: returns cached result if fields already populated
- Cost: `COST_OPS.GAP_TITLE_SUGGEST` (€0.01)

**Generate from gap (route to brief):**
- `POST /api/projects/:slug/content-gaps/:id/generate`
- Calls `decideRoute(brief)` + `executeDecision()` in transaction
- Enqueues appropriate pipeline (`article:blog`, `article:outline`, `cornerstone:spec`)
- Returns `{ briefId, articleId?, specId? }`

### B.4 LLM prompt for gap identification

**Not found directly** — gap detection is SQL-based, not LLM-driven. Suggestions are separate.

**Suggestion prompt** (Haiku, in `src/lib/gap-service.ts`):
```
User provides:
- Cluster name + topic
- Gap type + intent type (if missing_spoke_type)
- Existing articles in cluster

Claude's task:
- Suggest 1-3 search keywords for the gap (primary + secondary)
- Suggest a title, slug, meta description, hero image prompt
- Format: <SUGGESTED_TITLE>...</SUGGESTED_TITLE>, etc.
```

**Keyword enrichment path (Path B):**
- If cluster has no Cold-Start data, calls `relatedKeywords()` via DataForSEO adapter
- Cost: `COST_OPS.GAP_RELATED_KEYWORDS` (€0.015)

### B.5 Triggering

**Auto-triggers:**
1. **Cold-Start Phase 4** — gap detection happens post-cluster-approval (part of Phase 4 setup)
2. **Astro repo import** — `detect-content-gaps.ts` runs as a step in import pipeline

**Manual triggers:**
- Route exists but no public endpoint (internal only): `POST /api/projects/:slug/cold-start/detect-gaps`

**Per-project config:**
- Gaps are detected per project automatically; no opt-in flag (always enabled)

### B.6 Gap acceptance flow

**Step 1: Suggest (optional)**
- Call `/api/projects/:slug/content-gaps/:id/suggest` to populate metadata
- Marcel reviews suggestions, may edit metadata manually

**Step 2: Generate**
- Call `/api/projects/:slug/content-gaps/:id/generate`
- Backend calls `decideRoute(brief)` based on gap type:
  - `missing_hub` → cornerstone spec creation (spec 54.3)
  - `missing_spoke_type` → article creation
  - `missing_translation` → translation creation
  - `cluster_too_small` → article creation
- Creates `TopicBrief` row with `source: "gap_analysis"`, `gapId: <gap.id>`
- Enqueues pipeline (blog, outline, or spec)
- Updates `contentGaps.generation_triggered_at` + `status: "in_progress"`

**Step 3: Resolution**
- When article/spec is created, manually set `status: "resolved"` + `filled_by_article_id` or `filled_by_spec_id`
- Or auto-resolve via chain completion (Spec 49d)

**Auto-creation?**
No — gaps require Marcel's approval at the suggest or generate step. No auto-brief generation.

### B.7 Existing UI

**Files found:**
- `/apps/web/src/i18n/de/gaps.ts`
- `/apps/web/src/i18n/en/gaps.ts`

**Pages/components:** NONE — only i18n strings. No Vue UI implemented.

### B.8 Backend status

**Gap detection:** FULLY IMPLEMENTED
- SQL-based gap detection via Cold-Start and import pipelines
- `content_gaps` table with full schema

**Gap suggestion:** FULLY IMPLEMENTED
- Haiku suggestion endpoint (`/suggest`)
- DataForSEO keyword enrichment (Path B fallback)
- Idempotent + caching

**Gap routing:** FULLY IMPLEMENTED
- `decideRoute()` + `executeDecision()` integration (Spec 54.3)
- Brief creation and pipeline enqueue
- Supports all four gap types

**Gap UI:** NOT IMPLEMENTED
- No page/component yet
- i18n strings ready but no bindings

---

## Area C: Refresh Detection

### C.1 Detection pipeline

**Refresh detection:** NOT a detection pipeline — refresh is **manual trigger only**.

**Manual endpoint:**
- `POST /api/articles/:id/refresh`
- Body: `{ reason: "user-provided reason" }` (optional, default: "manual refresh")

**What it does:**
1. Creates a `TopicBrief` with `source: "refresh_detection"` + `refreshMetadata`
2. Enqueues `article:refresh` pipeline (Spec 54.10)
3. Pipeline re-generates article outline + body in place

**"Refresh detection" naming:** Refers to the brief source type, not an automated detection mechanism.

**Automatic detection?**
**Not found** — no scheduled/cron process detects stale articles and creates briefs automatically. Refresh is 100% manual today.

### C.2 Data model

**`RefreshMetadataSchema` (JSONB on `topic_briefs.refresh_metadata`):**
```typescript
{
  targetArticleId: string (uuid);          // article being refreshed
  reason?: string;                          // user-provided reason
  staleness: {
    daysSinceLastUpdate: number;
    rankingChange: number | null;           // ranking delta from prev. (not auto-computed)
    competitorRefreshed: boolean;           // manual flag (not auto-detected)
  };
}
```

**Brief properties for refresh:**
- `source: "refresh_detection"`
- `clusterAction: "refresh"`
- `generationMode: "refresh"`
- `approvalRequired: true` (requires Marcel's review before pipeline enqueue)
- `approvalStatus: "pending"`
- `refreshMetadata: { targetArticleId, reason, staleness }`

**No `staleness_score` column exists** on `articles` table — staleness is metadata-only, not computed at write time.

### C.3 API endpoints

**Manual refresh trigger:**
- `POST /api/articles/:id/refresh`
- Body: `{ reason?: string }` (default: "manual refresh")
- Response: `{ ok: true, data: { runId, jobId, deduped } }`
- Returns pre-generated `pipeline_runs` row for polling

**Approval:**
- Implicitly approved when route is called (no separate approval gate)
- Enqueues `article:refresh` pipeline immediately

### C.4 Triggering

**Manual only:**
- User clicks "Refresh" on article detail page
- Route handler creates brief + enqueues pipeline

**Cron or auto-detection?**
**Not implemented** — no scheduled job discovers stale articles.

**Per-project config?**
**Not found** — no flag to opt in/out of manual refresh.

### C.5 Brief creation

**Yes** — refresh always creates a `TopicBrief` with `source: "refresh_detection"`.

Brief properties are hardcoded in route:
```typescript
const brief: TopicBriefInsert = {
  projectId: article.projectId,
  source: "refresh_detection",
  topicTitle: `Refresh: "${article.slug}"`,
  clusterId: article.clusterId,
  clusterAction: "refresh",
  generationMode: "refresh",
  approvalRequired: true,
  approvalStatus: "pending",
  refreshMetadata: {
    targetArticleId: articleId,
    reason: body.reason,
    staleness: {
      daysSinceLastUpdate: daysSinceUpdate,
      rankingChange: null,
      competitorRefreshed: false,
    },
  },
};
```

### C.6 Detection vs execution

**Execution:** `article:refresh` pipeline is fully implemented (Spec 54.10):
- 8 steps: intake → tool-relevance → outline → persist → draft → persist → tool-linker → self-review
- Re-generates outline + body in place
- Preserves original in `article_versions`

**Detection:** NOT IMPLEMENTED
- No automated process identifies candidates for refresh
- No cron or scheduled job
- No UI for browsing staleness candidates

---

## Area D: Cross-cutting

### D.1 Cron infrastructure

**File:** `/apps/api/src/workers/index.ts`

**Pattern:**
```typescript
// For repeating jobs via BullMQ
const queue = getQueue("signal-collector");
queue.add(
  "schedule-daily",
  { type: "schedule-daily" },
  {
    repeat: { pattern: cron },
    removeOnComplete: true,
  }
);

// Via startScheduler() (generic cron registry)
await startScheduler(); // from @marketing-auto/pipelines
```

**Registered repeating jobs:**
1. **Signal Collector** (`signal-collector.ts:232`)
   - Pattern: `SIGNAL_COLLECTOR_CRON` (default `"30 0 * * *"` — 00:30 UTC)
   - Job: `"schedule-daily"` → `collect-project` per project
   - Status: **ENABLED** (registered at worker startup)

2. **Trend Synthesizer** (`trend-synthesizer.ts:206`)
   - Pattern: `TREND_SYNTHESIZER_CRON` (default `"30 1 * * *"` — 01:30 UTC)
   - Job: `"schedule-daily"` → `synthesize-project` per project
   - Status: **DISABLED** (commented out at line 174)

3. **Auth Cleanup** (lines 129-136)
   - Pattern: `"0 3 * * *"` (03:00 daily)
   - Status: **DISABLED** (commented out)

4. **Article Scheduler** (lines 138-150)
   - Pattern: `"0 3 * * *"` (03:00 daily)
   - Gated by `ARTICLE_SCHEDULER_ENABLED` env var
   - Status: **DISABLED** (no env var set by default)

5. **startScheduler()** (from pipelines)
   - Generic cron scheduler for one-off and repeating tasks
   - Powers Cold-Start phase schedulers (Phase 1, 4, 5)
   - Auto-registered at worker startup

**Enabling/disabling:**
- Code change + worker restart (no runtime toggle)
- Alternatively, manually enqueue jobs via CLI:
  ```bash
  bun --filter @marketing-auto/api signals:collect <slug>
  bun --filter @marketing-auto/api trends:synthesize <slug>
  ```

**Enable trend synthesizer:**
1. Uncomment line 174 in `src/workers/index.ts`
2. Run `bun --filter @marketing-auto/api run worker:restart`

### D.2 Per-project config

**Project-level toggle flags** (`packages/db/src/schema/projects.ts`):

```sql
auto_publish: BOOLEAN (default false)
  — Spec 49d: if true, automation chain triggers Astro-Transfer automatically after Schema-EN
  — Example: toolwiki has this set to true

translation_auto_trigger: BOOLEAN (default true)
  — Spec 54.10: if true, Blog Pipeline auto-triggers EN translation after DE article completes
  — Set false per project to opt out of auto-translation

gaps_last_detected_at: TIMESTAMP (nullable)
  — Spec 49b: timestamp of last content-gap detection run
  — Zero-cost step, used to rate-limit detection

target_locales: JSONB array[string] (default ["de-DE"])
  — Spec 54.1+: BCP-47 locales targeted by Cold-Start (Phase 2/3 use this)
  — Examples: ["de-DE"], ["de-DE", "en-US"], ["en-US"]

target_niche: TEXT (nullable)
  — Spec 54.2: niche tag for Cold-Start competitor discovery
  — Examples: "ai-tool-wiki", "automotive-dealer", "solar-energy"
```

**Signal collection config:**
- Sources are hardcoded per adapter (all projects collect same sources)
- No per-project opt-in/opt-out for signal sources

**No per-gap-type flags** — all gap types detected automatically (no disable option).

### D.3 Notification on discovery

**When briefs are created:**
- `TrendDiscoveryTopicSource.emit()` inserts briefs (no notification)
- `GapAnalysisTopicSource.emit()` inserts briefs (no notification)
- Manual refresh route inserts brief (no notification)

**Current behavior:**
- Briefs appear in API response when queried
- UI polling or SSE subscription picks them up
- **No proactive push notifications** exist for trend/gap discovery

**Planned?**
Not found in current codebase. Notifications are available for pipeline events (Spec 55.1) but not for discovery events.

### D.4 Cost tracking

**Operation values for discovery:**

```typescript
COST_OPS.TREND_SYNTHESIS: "trend-synthesis"
  // Opus 4.7 daily LLM synthesis of signals into TopicBriefs (~€0.40)

COST_OPS.TREND_COVERAGE_TIEBREAKER: "trend-coverage-tiebreaker"
  // Haiku Cosine similarity 0.60-0.85 disambiguation (~€0.005)

COST_OPS.DATAFORSEO_TRENDS_EXPLORE: "dataforseo-trends-explore"
  // DataForSEO Trends growth_ratio lookup (~€0.010)

COST_OPS.VOYAGE_EMBED_TEXT: "voyage-embed-text"
  // Voyage AI embedding for article/cluster matching (shared cost)

COST_OPS.GAP_TITLE_SUGGEST: "gap-title-suggest"
  // Haiku gap title suggestion (~€0.01)

COST_OPS.GAP_KEYWORD_OVERVIEW: "gap-keyword-overview"
  // DataForSEO Cold-Start keyword overview (Spec 49c, ~€0.01)

COST_OPS.GAP_RELATED_KEYWORDS: "gap-related-keywords"
  // DataForSEO relatedKeywords fallback for Astro imports (~€0.015)
```

**Tracking:**
- Trend synthesis run creates a `pipeline_runs` row (operation: `"trend-synthesis"`)
- Cost logged to `cost_logs` table per project per operation
- Cost enforcement: `assertCostBudget()` called before DataForSEO + Voyage calls inside steps

### D.5 Approval workflow

**Two separate flows:**

**Trend briefs:**
- Created with `approvalStatus: "pending"` + `source: "trend_discovery"`
- Manual approval route: `POST /api/projects/:slug/trends/<briefId>/approve`
- Calls `decideRoute()` + `executeDecision()` → enqueues blog pipeline
- **Always routes to `article:blog`** (trend briefs have `locale + clusterId`)

**Gap briefs:**
- Created with `approvalStatus: "pending"` + `source: "gap_analysis"` + `gapId`
- Manual approval route: `POST /api/projects/:slug/content-gaps/:id/generate`
- Calls `decideRoute()` based on gap type → routes to article/spec/translation pipeline
- **Blog detection:** `isBlogBrief()` checks `locale !== null && clusterId !== null`

**Refresh briefs:**
- Created with `approvalStatus: "pending"` + `source: "refresh_detection"`
- **No approval gate** — enqueued immediately to `article:refresh`

**No separate approval enums** — all briefs use same `approvalStatus` enum:
```typescript
"pending" | "approved" | "rejected" | "auto_approved" | "superseded" | "routed"
```

**Approval semantics:**
- `pending` — awaiting Marcel's review
- `approved` → `routed` — after `executeDecision()` succeeds
- `rejected` — dismissed without routing
- `superseded` — replaced by another brief
- `auto_approved` — not currently used

---

## Summary

### What's implemented

**Trends discovery:**
- ✅ Full signal collection pipeline (6 sources)
- ✅ LLM synthesis into candidates (daily cron, currently disabled)
- ✅ Six-component scoring with coverage dedup
- ✅ Cluster matching + brief emission
- ✅ Manual trigger + approval flow
- ✅ API endpoints for listing, dismissing, approving
- ❌ **Cron currently disabled** (requires code change to enable)
- ❌ UI not implemented

**Content-gap analysis:**
- ✅ SQL-based gap detection (Cold-Start + import pipeline)
- ✅ Four gap types: missing_hub, missing_spoke, missing_translation, cluster_too_small
- ✅ Haiku suggestion endpoint (title, keywords, metadata)
- ✅ DataForSEO keyword enrichment fallback
- ✅ Routing to article/spec/translation via `decideRoute()` + `executeDecision()`
- ✅ Full API: list, update status, batch operations, suggest, generate
- ❌ UI not implemented

**Refresh detection:**
- ✅ Manual refresh trigger endpoint (`POST /api/articles/:id/refresh`)
- ✅ Brief creation with staleness metadata
- ✅ Full `article:refresh` pipeline (8 steps, re-generates in place)
- ❌ **No automated detection** (zero cron jobs, zero detection logic)
- ❌ UI not implemented

**Cross-cutting:**
- ✅ Cron infrastructure (BullMQ + generic scheduler)
- ✅ Per-project config flags (`auto_publish`, `translationAutoTrigger`, `targetLocales`, `targetNiche`)
- ✅ Cost tracking (operations defined, estimates set)
- ✅ Approval workflow (consistent across sources)
- ❌ No push notifications on discovery events

### What's stubbed / partial

- **Signal collection cron:** Implemented but disabled at startup (requires uncomment)
- **Trend synthesis cron:** Implemented but disabled at startup (requires uncomment)
- **Refresh detection UI:** Brief creation works, but no UI to browse candidates or trigger refresh

### What's missing entirely

- **Trends UI page:** No page to list/filter/approve trends
- **Gaps UI page:** No page to list/filter/suggest/generate gaps
- **Refresh detection automation:** No cron job discovers stale articles
- **Refresh UI:** No page to browse candidates, no auto-detection threshold config
- **Discovery notifications:** No push/email alerts when briefs are created
- **Bulk approval UI:** No multi-select approve/dismiss for briefs

---

## Recommendation for 56.6 Spec

### Trends UI requires backend work

**Currently needed:**
- ✅ Cron un-disable (code change)
- ✅ API endpoints exist and work
- ✅ Brief data model is complete

**What's missing:**
- Vue page (`TrendsPage.vue`) to list pending briefs
- Brief detail + approval flow
- Dismiss/reject UI
- Signal breakdown visualization (score breakdown)
- Source-level drill-down (which signals contributed to score)

### Gaps UI requires backend work

**Currently needed:**
- ✅ API endpoints exist and work
- ✅ Gap detection + suggestion work
- ✅ Routing works

**What's missing:**
- Vue page (`GapsPage.vue`) to list gaps by status/type/priority
- Gap detail + suggestion + approval flow
- Batch operations UI
- Keyword suggestion visualization
- Cluster context display

### Refresh UI requires backend work

**Currently needed:**
- ✅ Manual trigger endpoint works
- ✅ Pipeline is fully functional

**What's missing:**
- **Automated refresh detection** (MUST implement if spec calls for it):
  - Cron job scanning articles by `updatedAt`
  - Heuristic for staleness (days since update, ranking changes, competitor activity)
  - Auto-creation of `TopicBrief` rows with `source: "refresh_detection"`
  - Daily or weekly frequency (per-project config)
- Vue page to browse refresh candidates
- Detail view + manual reason entry

### New endpoints needed (if not already present)

- `GET /api/projects/:slug/trends/pending-briefs` — **EXISTS**
- `POST /api/projects/:slug/trends/<briefId>/approve` — **EXISTS (implied by routing)**
- `GET /api/projects/:slug/content-gaps?status=open` — **EXISTS**
- `POST /api/projects/:slug/content-gaps/:id/suggest` — **EXISTS**
- `POST /api/projects/:slug/content-gaps/:id/generate` — **EXISTS (via routing)**
- `POST /api/articles/:id/refresh` — **EXISTS**
- `GET /api/projects/:slug/refresh-candidates` — **NOT FOUND** (needed if auto-detection added)

### Existing endpoints sufficient

- ✅ Trend discovery: full CRUD via trends route
- ✅ Gap analysis: full CRUD + suggestion via projects route
- ✅ Refresh: manual trigger works, auto-detection is optional enhancement

### Per-project config schema changes needed

- ❌ None required immediately
- ⚠️ If refresh auto-detection added: add `refreshAutoTrigger: boolean` and `refreshStalenessThresholdDays: integer` to project config

### Optional enhancements (post-56.6)

1. Refresh auto-detection + cron (Spec 56.7?)
2. Push notifications for new briefs (Spec 56.8?)
3. Bulk approval UI with pre-filtering
4. Signal + keyword visualization dashboard
5. Refresh staleness score column on articles table

