# Backlog Reality-Check

**Date:** 2026-05-18
**Investigator:** Claude Code via discovery prompt

---

## Section 1: Verification

### 1.1 clusters.satellite_keywords

- **State:** ✅ In use (actively read AND written, but NOT as SSoT for new article generation — brief-sourced path is primary since Spec 54.3)
- **Evidence:**
  - Schema location: `packages/db/src/schema/identity.ts:115` — `satelliteKeywords: jsonb("satellite_keywords")` with comment "Stored in clusters.satelliteKeywords as an array (one entry per cornerstone in the cluster)."
  - **Writes:** `packages/pipelines/src/cold-start/03-cluster-plan/steps.ts:314` (Cold-Start Phase 3 writes it); `apps/api/src/routes/clusters.ts:127` (sets to `[]` on cluster create). There is NO write from the `/suggest` route since Spec 54.3 — that was explicitly removed (`apps/api/src/routes/projects.ts:186`: "no longer written to cluster.satelliteKeywords").
  - **Reads:** `apps/api/src/lib/gap-service.ts:108` reads it as fallback for Astro-imported clusters ("Path B"); `packages/pipelines/src/article/steps/topic-intake.ts:94` reads it as legacy fallback when no brief is linked; `packages/pipelines/src/cold-start/05-go-live-checklist/steps.ts:179` validates `satellite_keywords.length >= 5` for go-live gate.
  - `apps/api/test/routes/projects-suggest-idempotent.test.ts:142` explicitly tests that `/suggest` does NOT update `cluster.satelliteKeywords` — confirming the spec decision.
- **Recommendation:** Keep. This column is the ground truth for Cold-Start–generated clusters (the only source of satellite keywords for those clusters). The `/suggest` route dual-writes to `topicBriefs` only (Spec 54.3), but the column remains valid for legacy Astro-imported clusters that never got a brief. **Do not drop.**

---

### 1.2 content_gaps table

- **State:** ✅ Fully in use — heavily read and written across multiple routes, workers, and adapters
- **Evidence:**
  - Schema location: `packages/db/src/schema/content.ts:464` — `content_gaps` table with 5 indexes.
  - **Writes:** `packages/adapters/astro-sync/src/import/steps/detect-content-gaps.ts` (upserts gaps on Astro sync); `apps/api/src/workers/gap-auto-approver.ts` (updates status); `apps/api/src/routes/projects.ts:674–1148` (suggest, generate, automate, dismiss, resolve endpoints all update `contentGaps`); `apps/api/src/routes/projects/cron.ts` (reads count for cron status).
  - **Reads:** `apps/api/src/routes/projects.ts:615–836` (GET list endpoint with filter support); `apps/api/src/lib/gap-service.ts:82–186` (loads cluster satellite keywords, used by `/suggest`).
  - **API endpoints returning content_gaps rows:** `GET /:slug/content-gaps` at `apps/api/src/routes/projects.ts:595`, `GET /:slug/content-gaps/:id` at line ~820, plus the automate/generate/suggest endpoints operating on single gaps.
  - The `topic_briefs` table (Spec 54.3) is the SSoT for *content* (keywords, title), but `content_gaps` remains the SSoT for *gap lifecycle state* (open/approved/dismissed/resolved). Both tables are active — they are not substitutes for each other.
- **Recommendation:** Keep. Fully active, no migration needed.

---

## Section 2: Possibly Implemented

### 2.1 Reddit + GitHub Trending Adapters

- **State:** ❌ Not built as adapters — schema declares them as valid signal sources but no collector implementation exists
- **Evidence:**
  - `packages/pipelines/src/signal-sources/types.ts:25–26`: `"reddit"` and `"github"` appear in the `ExternalSignalSourceValue` Zod enum (alongside `producthunt`, `hackernews`, `vendor_rss`, `dataforseo_trends`).
  - `packages/db/src/schema/project-config.ts:80–85`: `reddit` config block exists in the project config schema (`enabled: false, subreddits: []`).
  - `packages/db/src/schema/content.ts:682,890`: `"reddit"` and `"github"` appear in DB enums for `external_signals.source`.
  - **BUT:** No `packages/adapters/reddit/` or `packages/adapters/github-trending/` directories exist. `ls packages/adapters/` returns only: `anthropic`, `astro-sync`, `dataforseo`, `email`, `hackernews`, `pagespeed`, `producthunt`, `replicate`, `storage`, `vendor-rss`, `voyage`.
  - **Signal collector wiring:** `apps/api/src/workers/signal-collector.ts:56` only handles `z.enum(["producthunt", "hackernews", "vendor_rss"])` — Reddit and GitHub are not in the `collect-adapter` job schema at all.
- **Recommendation:** Keep in backlog. Schema slots are reserved. The config structure for Reddit (`subreddits` array) is already in `project-config.ts`. Estimate: Reddit adapter ~1–2 days (PRAW or Pushshift API); GitHub Trending ~0.5 days (scraping or gharchive). Useful once the trend discovery pipeline is the main content source. Low urgency.

---

### 2.2 Bidirectional translation EN → DE

- **State:** ❌ Not built — translation pipeline is strictly DE→EN only
- **Evidence:**
  - `packages/pipelines/src/article/translation/setup-step.ts:75–122`: `TranslationSetupStep` loads "source article" by `sourceArticleId` and creates `enSlug = deArticle.slug + "-en"` stub. The naming convention assumes DE as source.
  - `packages/pipelines/src/article/translation/body-step.ts:157,275`: output variables are `enTitle`, `enMetaDescription` — hardcoded EN output.
  - `packages/pipelines/src/article/translation/pipeline.ts:175–205`: bridge logic explicitly builds EN article from DE: `enTitle`, `enMetaDescription`, `enSlug`, copies DE `heroImageKey`/`heroImageUrl`, derives `enExtras` from `deExtras`.
  - `packages/pipelines/src/article/translation/decision.ts:52`: `TranslationDecisionStep` prompt says `"adaptive": EN audience needs different angles. Examples: German-specific pricing (EUR only, no USD), DSGVO/BaFin/German regulatory emphasis...` — entirely DE→EN framing.
  - No `sourceLocale` / `targetLocale` fields in any translation step schema.
- **Recommendation:** Keep in backlog as a future requirement. The entire pipeline is hardcoded for DE source → EN target. Making it bidirectional would require: parameterising source/target locale throughout (setup-step, body-step, decision-step, pipeline bridges), adding EN→DE prompt variants for the decision step, and handling the different slug/URL patterns. Estimate: ~3–4 days.

---

### 2.3 Stub Templates (news-slide, concept-explainer-deck, pro-con-verdict)

- **State:** 🟡 Partially built — type declarations exist, but no implementations registered
- **Evidence:**
  - `packages/social/src/templates/types.ts:23–26`: All three are declared in the `TemplateKey` union type: `"news-slide"`, `"concept-explainer-deck"`, `"pro-con-verdict"`.
  - `packages/social/src/templates/bootstrap.ts:18–19`: Both `newsSlideTemplate` and `conceptExplainerDeckTemplate` are commented out (`// templateRegistry.register(newsSlideTemplate); // Spec 54g`).
  - `packages/social/src/templates/definitions/` only contains: `comparisonStunning.ts`, `comparisonStunning3.ts`, `singleToolSpotlight.ts`, `useCaseVerdictPerTool.ts`, and a `fixtures/` directory. No `newsSlide.ts`, `conceptExplainerDeck.ts`, or `proConVerdict.ts` files exist.
  - No override schemas for any of the three in `packages/social/src/templates/overrides/`.
- **Recommendation:** Keep in backlog. The type slot is reserved. These are non-trivial to build (each needs composition code, eligibility function, hook generator, override schema, Remotion component). None of the three are needed for current use-cases (toolwiki only uses `singleToolSpotlight` and comparison variants). Low urgency.

---

### 2.4 Bulk Operations (Trends/Gaps/Briefs)

- **State:** 🟡 Partially built — bulk approve/dismiss exists for **Briefs only**; not implemented for Trends or Gaps
- **Evidence:**
  - **Briefs (✅):** `apps/api/src/routes/projects/briefs.ts:136` — `POST /:slug/briefs/bulk-approve`; line 208 — `POST /:slug/briefs/bulk-dismiss`. Frontend: `apps/web/src/pages/briefs/BriefsPage.vue:158,180` calls both. `apps/web/src/components/briefs/BulkApproveModal.vue` exists.
  - **Gaps (❌):** `apps/api/src/routes/projects.ts` has a single-gap approve/dismiss/automate only. No `bulk-approve` or `bulk-dismiss` endpoint for content-gaps. No multi-select UI in gap-related Vue pages.
  - **Trends (❌):** `apps/api/src/routes/trends.ts` has single-brief endpoints (approve, dismiss, review) but no bulk equivalents. `apps/web/src/pages/trends/TrendsListPage.vue` has no `selectedIds` or `selectAll` pattern.
  - Multi-select UI exists only in `BriefsSection.vue` (via `selectedIds` prop) and `ArticleSocialTab.vue` (locale select-all for social generation — unrelated to bulk operations).
- **Recommendation:** Add bulk-approve/dismiss for Gaps and Trends to backlog as separate items. The briefs pattern is clean and reusable. Gaps bulk-approve would be high-value for large content gap lists. Estimate: ~0.5 day per entity type (backend + frontend following the briefs pattern).

---

### 2.5 Automation chains for missing_hub + missing_translation

- **State:** 🟡 Partially built — `/automate` endpoint exists but only routes `missing_spoke_type` / `cluster_too_small` to chains; `missing_hub` and `missing_translation` are explicitly excluded
- **Evidence:**
  - `apps/api/src/routes/projects.ts:1174` — `POST /:slug/content-gaps/:id/automate` exists and is fully functional.
  - `apps/api/src/routes/projects.ts:1236`: Explicit guard: `if (decision.kind === "create_cornerstone_spec") return c.json({ ok: false, error: "Hub gaps use cornerstone spec workflow — use /generate instead" }, 400)`.
  - `packages/pipelines/src/routing/` — `decideRoute()`: `missing_hub` → `create_cornerstone_spec` (routed to `/generate`, not `/automate`); `missing_translation` → `create_translation` (translation pipeline doesn't use chains — it's triggered directly by blog pipeline `afterComplete` or manually via `/generate`).
  - `apps/api/CLAUDE.md` under "Chain Advancement" confirms: only `missing_spoke_type` and `cluster_too_small` use chains.
- **Recommendation:** Clarify backlog entries. `missing_hub` automation is **done via `/generate`** (creates cornerstone spec — correct, not a chain). `missing_translation` automation is **done via translation pipeline auto-trigger** (chains are not the right mechanism). These aren't missing features — they're implemented differently than via chains. Remove these two from the "not implemented via chains" backlog item and add a note that the routing is correct as-is.

---

### 2.6 Article Discovery is post-draft only

- **State:** ✅ Confirmed — discovery is triggered after draft completes, not before
- **Evidence:**
  - `packages/pipelines/src/article/pipeline.ts:319–331`: `DraftPipeline.afterComplete` hook calls `_triggerDiscovery(pipelineInput.articleId, pipelineInput.projectId)` — triggered **after** the draft step completes.
  - Comment at line 28: `// Spec 54c: discovery callback wired in at worker startup (avoids api→pipelines circular dep)`.
  - No discovery call in any pre-draft step (outline, research, intake).
  - `apps/api/src/workers/index.ts:171`: `// Spec 54c: sync discovery so suggestions are available when the pipeline run shows "completed"`.
- **Recommendation:** Confirmed correct design. Discovery fires after the article has content (post-draft), which is the right time for link-opportunity detection. No backlog item needed.

---

## Section 3: Sweep — Not Built Confirm

### 3.1 Article Generators (Comparisons, ki-wissen, usecases)

- **Comparisons:** ❌ Not built — `ls packages/pipelines/src/article/` returns: `author-picker`, `blog`, `discovery`, `hero-generation`, `index.ts`, `localize`, `pipeline.ts`, `refresh`, `social-image`, `source-context`, `steps`, `tool-linker`, `translation`, `trigger.ts`, `types.ts`, `voice-reference`. No `comparison/` directory.
- **ki-wissen:** ❌ Not built — no `ki-wissen/` directory under `packages/pipelines/src/article/`.
- **usecases:** ❌ Not built — no `usecase/` or `usecases/` directory. The `useCaseVerdictPerTool` template exists in social (slides), but there is no dedicated article pipeline for use-case articles. Use-case articles are generated via the blog pipeline with `intentType: "use_case"`.

**Recommendation:** Keep all three in backlog. The `article:blog` pipeline is intentType-agnostic and handles use-case articles fine. Dedicated comparison and ki-wissen pipelines would add value but are low-priority given the blog pipeline covers most generation needs.

---

### 3.2 Cold-Start Backend (14 endpoints)

- **State:** ✅ Fully built — 12 endpoints found (spec may have counted differently)
- **Evidence:**
  - File: `apps/api/src/routes/cold-start.ts` (518 lines). Cold-start-related endpoints also live in `apps/api/src/routes/cold-start.ts` and some draft/project-wizard endpoints in `apps/api/src/routes/projects.ts`.
  - `cold_start_drafts` table: ❌ Does NOT exist in the DB schema. There is no `coldStartDrafts` table in `packages/db/src/`. The cold-start wizard state is stored in `pipeline_runs` (status tracking) + `projects`/`clusters`/`cornerstone_specs` tables (data persistence). The `useColdStartDraft` composable in the frontend uses TanStack Query against these existing tables.
  - Confirmed endpoints in `cold-start.ts`:
    1. `GET /:slug/cold-start/status`
    2. `POST /:slug/cold-start/voice-refinement/questions`
    3. `POST /:slug/cold-start/voice-refinement/synthesize` (line 233)
    4. `POST /:slug/cold-start/competitor-analysis/questions`
    5. `POST /:slug/cold-start/competitor-analysis/run` (line 292)
    6. `POST /:slug/cold-start/cluster-plan`
    7. `POST /:slug/cold-start/cluster-plan/confirm` (line 391)
    8. `POST /:slug/cold-start/cornerstone-list` (line 426)
    9. `PATCH /:slug/cold-start/clusters/:id` (line 452)
    10. `GET /:slug/cold-start/cornerstones`
    11. `POST /:slug/cold-start/go-live-checklist`

**Recommendation:** Cold-start backend is fully built. There is no `cold_start_drafts` table — the spec may have referenced a design that was later replaced by using `pipeline_runs` + project data tables. Remove the "cold_start_drafts table" backlog item.

---

### 3.3 Tier 1 Hardening items

- **Stalled job reconciliation (for social render):** 🟡 BullMQ-native stall detection configured, but no explicit application-level reconciliation on startup
  - Evidence: `apps/api/src/workers/social-render.worker.ts:203–204`: `stalledInterval: 10 * 60 * 1000` (check every 10 min) + `maxStalledCount: 1` (allow one retry on stall). This is BullMQ's built-in stall detection — it does NOT reset rows stuck in `renderStatus='rendering'` after a worker crash. There is no `reconcileStuckRenders()` function anywhere in the codebase. On a cold restart after a crash, posts with `renderStatus='rendering'` will stay stuck until a manual reset or re-render is triggered.
  - **Recommendation:** Add to backlog: "On worker startup, reset `renderStatus='rendering'` rows older than 15 min back to `'pending'`." This is a 30-minute fix.

- **Worker process recycling:** ❌ Not built
  - Evidence: No `maxJobsPerWorker` or process restart logic found in any worker file. The `apps/api/CLAUDE.md` describes the single-worker guarantee (PID file) but this is for preventing duplicates, not for memory-driven recycling. None of the BullMQ Worker instantiations include `maxJobsPerWorker` in their options.
  - **Recommendation:** Keep in backlog. Low urgency since workers are restartable manually via `worker:restart`.

- **Render duration metrics:** ✅ Fully built
  - Evidence: `packages/db/src/schema/content.ts:383–384`: `renderStartedAt` and `renderCompletedAt` columns exist. `apps/api/src/workers/social-render.worker.ts:118,154,179`: worker sets `renderStartedAt: new Date()` on job start and `renderCompletedAt: new Date()` on both success and failure. `apps/api/src/routes/social-posts.ts:116–117`: both timestamps are returned in the render-status polling endpoint.
  - **Recommendation:** Remove from backlog — done.

- **Push Notifications (email-first):** ❌ Not built for pipeline completion
  - Evidence: No `sendEmail` or push notification calls found in any pipeline worker completion hook (`apps/api/src/workers/index.ts`, `social-render.worker.ts`, `article-quality-analysis.worker.ts`). The push notification infrastructure exists (`packages/core/src/notifications/`, `apps/api/src/routes/notifications.ts`), but no pipeline worker sends a notification on completion.
  - **Recommendation:** Keep in backlog. The notification infrastructure is fully in place — adding a `sendPushNotification()` call to pipeline `afterComplete` or `Worker.on('completed')` is straightforward (~1 day including frontend subscription UX).

---

## Section 4: Smart-Deferred Triggers

### 4.1 Adjustable trend score weights via project config

- **Trigger fired:** No — weights are hardcoded constants
- **Evidence:** `packages/pipelines/src/topic-sources/trend-discovery/score.ts:10–18`: weights are defined as a module-level `const W = { buzz: 15, growth: 15, official: 25, serp: 20, diversity: 25, coverage: 40 } as const`. There is no call to `loadActiveConfig()` or any DB read of `project_configurations` in `score.ts`. The `min_trend_score` default is also a hardcoded constant (25).
- **Recommendation:** Keep deferred. Trigger condition: "multiple projects with significantly different content strategies" (e.g., a news-focused tenant vs. an evergreen-focused tenant). Current single-tenant usage doesn't need per-project weights. When the SaaS phase begins, add `trend_score_weights` to `project_configurations.topicScope` schema.

---

### 4.2 Bulk DataForSEO Trends as signal source

- **Trigger fired:** No — `trendsExplore` is called per-topic in score computation only, not as a bulk signal collector
- **Evidence:**
  - `packages/pipelines/src/topic-sources/trend-discovery/score.ts:158`: `dataforseo.trendsExplore({ keywords: [candidate.primary_keyword] })` — called 1 keyword at a time during scoring, not as a bulk ingestion step.
  - `apps/api/src/workers/signal-collector.ts:56`: `adapter: z.enum(["producthunt", "hackernews", "vendor_rss"])` — `dataforseo_trends` is NOT in the `collect-adapter` enum. The `ExternalSignalSourceValue` DB enum includes `"dataforseo_trends"` as a valid source type, but there is no `DataForSeoTrendsSignalSource` class and no worker branch handles it.
  - `packages/db/src/schema/content.ts:682`: `"dataforseo_trends"` is declared in the DB enum for `external_signals.source` — reserved but unused.
- **Recommendation:** Keep deferred. Trigger condition: "daily signal collection costs exceed budget" (current per-topic score calls happen lazily only for trending candidates, which is efficient). A pre-built bulk DataForSEO signal source would only be needed if proactive pre-caching of trend data is required. Not needed until 5+ projects are active.

---

### 4.3 `rejected_topic_candidates` 90-day cleanup

- **Trigger fired:** No — there is no janitor job; records expire in 30 days (not 90) via query-time filter only
- **Evidence:**
  - `packages/pipelines/src/topic-sources/trend-discovery/source.ts:215`: `expiresAt: thirtyDaysFromNow` — records are inserted with a 30-day expiry (not 90 days as the backlog item says).
  - `packages/pipelines/src/topic-sources/trend-discovery/source.ts:196`: filter `gt(rejectedTopicCandidates.expiresAt, new Date())` — expired rows are excluded at query time.
  - **No DELETE or cleanup**: grep found zero `DELETE.*rejected` statements in non-test code. There is no cron job, BullMQ job, or scheduled function that prunes expired rows from `rejected_topic_candidates`. The `trend-synthesizer.ts` worker janitor only stamps unprocessed `external_signals`, not `rejected_topic_candidates`.
  - The `refresh_detector.ts` worker also has no cleanup for this table.
- **Recommendation:** Add to backlog: "Prune expired rejected_topic_candidates rows older than expiresAt." The `rejectedTopicCandidates_project_active_idx` index on `(project_id, expires_at)` already exists, making a DELETE cheap. Estimated effort: 30 minutes — add one `DELETE WHERE expires_at < NOW()` call to the trend-synthesizer janitor phase. Note: rename the backlog item from "90-day" to "30-day" since that's the actual expiry.

---

### 4.4 Per-source configuration in signal_sources

- **Trigger fired:** Partially — `min_signal_thresholds` is read from project config; maxAgeDays is not
- **Evidence:**
  - `packages/pipelines/src/topic-sources/trend-discovery/fetch-signals.ts:14`: `const thresholds = scope.min_signal_thresholds` — reads from `loadActiveConfig().topicScope.min_signal_thresholds` (project config, stored in DB).
  - Line 34: `const minPoints = thresholds.hackernews ?? 3` — per-source point threshold is config-driven with fallback.
  - Line 38: `const minVotes = thresholds.producthunt ?? 0` — same pattern.
  - `packages/db/src/schema/project-config.ts:49`: `min_signal_thresholds` is in the `TopicScopeSchema`.
  - **maxAgeDays:** No `maxAgeDays` usage found in `fetch-signals.ts`. Signal freshness is controlled by the `signal_collector.ts` 14-day janitor (stamps old unprocessed signals), not a per-source config.
- **Recommendation:** The per-source threshold configuration is partially done (min points/votes per source are config-driven). `maxAgeDays` per source is not implemented. Update backlog: mark thresholds as done, keep `maxAgeDays` per source as deferred. Trigger condition: "an RSS feed starts producing stale content" (currently not a problem with weekly cron).

---

## Section 5: Sweep — Items We Might Have Forgotten

### 5.1 Recent Migrations (0045 onwards)

| Migration | Description |
|-----------|-------------|
| `0045_full_cluster_schema.sql` | Spec 54.12: Full Cluster Generation Schema — adds `generation_status`, `generation_plan`, `spoke_plan`, `expected_article_count`, `generated_article_count` to clusters; `cluster_generation_plans` table; `cluster_plan_status` enum |
| `0046_discovery_config.sql` | Spec 56.6: Discovery automation config — `trends_cron_enabled`, `refresh_cron_enabled`, `auto_approve_gaps`, `refresh_staleness_days` on projects; `cron_state` table; `refresh_dismissed` table |
| `0047_social_posts_locale_not_null.sql` | Spec 57.1 Part B: `social_posts.locale` made NOT NULL with default `de-DE`; backfill + new index on `(article_id, locale, status)` |
| `0048_social_auto_render_locales.sql` | Spec 57.1 Part B: `projects.social_auto_render_locales` JSONB column (stored, currently unused in automation) |
| `0049_toolwiki_brand_tokens_seed.sql` | Spec 57.1 A.5: Seeds toolwiki brand tokens (`surfaceSecondary`, `eyebrowColor`, pricing colors, typography sizing) from hardcoded template values |
| `0050_project_template_overrides.sql` | Spec 57.3: `project_template_overrides` table — one row per (project, templateKey) for per-template overrides |
| `0051_social_posts_render_status.sql` | Spec 57.2: `social_render_status` enum + 5 render lifecycle columns on `social_posts` (`renderStatus`, `renderStartedAt`, `renderCompletedAt`, `totalSlides`, `renderJobId`) |
| `0052_articles_last_refreshed_at.sql` | `articles.last_refreshed_at` timestamp column; backfilled from `published_at` for existing published articles |
| `0053_refresh_suggestions.sql` | `refresh_suggestion_source` enum (`time`, `quality`); `refresh_suggestions` table with `source`, `score`, `reason`, `dismissedAt`, `approvedAt` |
| `0054_cron_job_type_quality_analysis.sql` | Spec E.1a: Adds `quality_analysis` to `cron_job_type` enum |
| `0055_projects_quality_analysis_cron.sql` | `projects.quality_analysis_cron_enabled` boolean column |

---

### 5.2 Recent CLAUDE.md updates (Spec 57.x+)

New patterns added (root CLAUDE.md) since the last session — key ones not tracked in existing spec files:

- **`jsonMode: true` banned for `claude-sonnet-4-6`** — use `systemSuffix` + `raw.indexOf("{")` extraction instead. Canonical example: `GenerateCaptionStep`.
- **Re-enqueue with timestamp-based jobId** — `rerender-${id}-${Date.now()}` pattern for re-trigger flows to avoid BullMQ dedup silence.
- **`renderInput` snapshot in JSONB** — persist full Remotion inputs at INSERT time; re-render reads snapshot + fresh brand tokens.
- **`jsonb_set` for partial JSONB column update** — use `jsonb_set(content, '{slides}', '[]'::jsonb)` instead of overwriting the whole column.
- **BullMQ queue in `packages/pipelines/src/engine/`** — canonical example: `social-render-queue.ts` for cross-workspace queue access without direction violations.
- **Single `JobData` union type + separate `PerJobData`** — pattern for queues with cron-batch + per-item shapes. Canonical: `article-quality-analysis-queue.ts`.
- **`apiPut` added to `apps/web/src/lib/api.ts`** — must import alongside `apiGet`, `apiPost`, `apiPatch`, `apiDelete`.
- **`locale: z.enum(["de", "en"]).default("de")` required in Remotion composition inputSchema** — was missing from `listCarouselInputSchema` before Spec 57.3.

---

### 5.3 Recent route additions

Full route inventory (from `apps/api/src/routes/`):

```
_lib/trigger-helpers.ts     — shared pipeline trigger guards (pause + cost + idempotency)
admin.ts                    — admin endpoints (prune notifications, etc.)
articles.ts                 — article CRUD + pipeline triggers + across-projects list
auth.ts                     — magic link auth
brand-assets.ts             — tool icon + logo upload/delete/reset
brand-tokens.ts             — project brand token CRUD
clusters.ts                 — cluster CRUD
cold-start.ts               — 11 cold-start wizard endpoints
cornerstone-specs.ts        — cornerstone spec CRUD
cost.ts                     — cost log endpoints
health.ts                   — health check
notifications.ts            — push subscription management
pillars.ts                  — content pillars CRUD
pipeline-runs.ts            — pipeline run list/detail/retry
projects.ts                 — main project + content-gaps endpoints (largest file)
projects/articles-standalone.ts  — import + pairs endpoints
projects/articles.ts        — project-scoped article list
projects/briefs.ts          — brief CRUD + bulk-approve/dismiss
projects/cluster-full-plan.ts — full cluster plan review + approve
projects/clusters.ts        — project-scoped cluster list
projects/cost-summary.ts    — cost summary by service
projects/cron.ts            — cron status + manual trigger
projects/pillars.ts         — project-scoped pillar list
projects/pipeline-events.ts — SSE for pipeline events
projects/pipeline-runs.ts   — project-scoped run list
projects/refresh.ts         — refresh suggestions + queue
projects/search.ts          — cross-entity search
projects/template-overrides.ts — per-template override CRUD (GET/PUT/DELETE)
push-subscriptions.ts       — VAPID push subscriptions
social-posts.ts             — social post list + download ZIP + re-render
system.ts                   — system credentials + adapter verify
trends.ts                   — trend brief list + approve/dismiss
```

**Surprises:** `projects/refresh.ts` and `projects/search.ts` were not explicitly tracked in any backlog item reviewed. Both appear fully implemented.

---

### 5.4 Recent frontend pages

Full page inventory (from `apps/web/src/pages/`):

```
AuthVerifyPage.vue
DashboardPage.vue
LoginPage.vue
NotFoundPage.vue
article-tools/ArticleToolsPage.vue
articles/ArticleDetailPage.vue
articles/ArticlesListPage.vue
articles/tabs/ArticleBodyTab.vue
articles/tabs/ArticleCostTab.vue
articles/tabs/ArticleFrontmatterTab.vue
articles/tabs/ArticleRunsTab.vue
articles/tabs/ArticleSocialTab.vue        ← Spec 57.2 + 58.2 render status + re-render
articles/tabs/ArticleVersionsTab.vue
briefs/BriefDetailPage.vue
briefs/BriefsPage.vue                     ← bulk approve/dismiss
briefs/BriefsSection.vue
clusters/ClusterDetailPage.vue
clusters/ClustersListPage.vue
cold-start/ColdStartLayout.vue
cold-start/ColdStartNewPage.vue
cold-start/ColdStartPhase1Basics.vue
cold-start/ColdStartPhase2Brand.vue
cold-start/ColdStartPhase3Seed.vue
cold-start/ColdStartPhase4Astro.vue
cold-start/ColdStartPhase5Confirm.vue
components/DashboardClusters.vue
components/DashboardHeader.vue
components/DashboardLanes.vue
components/DashboardStats.vue
costs/CostsPage.vue
refresh/RefreshQueuePage.vue              ← fully implemented (not tracked in CLAUDE.md spec list)
settings/SettingsBrandAssetsPage.vue
settings/SettingsBrandTokensPage.vue
settings/SettingsCredentialsPage.vue
settings/SettingsPage.vue
settings/SettingsProjectPage.vue          ← includes TemplateOverridesSection (Spec 57.3)
trends/TrendDetailPage.vue
trends/TrendsListPage.vue
```

**Surprises:**
- `refresh/RefreshQueuePage.vue` exists and is functional — not explicitly listed in CLAUDE.md spec history. This corresponds to `apps/api/src/routes/projects/refresh.ts`.
- No `TemplateGalleryPage.vue` — the i18n keys for `templateGallery` exist in `social.ts` but there is no dedicated gallery page. The template gallery is embedded in `ArticleSocialTab.vue`.
- No `QualityAnalysisPage.vue` — the `quality_analysis_cron_enabled` toggle is in `SettingsProjectPage.vue` (via `useDiscoverySettings` composable). No standalone page for quality analysis results.

---

### 5.5 Recent queues / workers

| Queue (from `new Queue(...)`) | Location |
|-------------------------------|----------|
| `scheduler` (SCHEDULER_QUEUE) | `packages/pipelines/src/engine/scheduler.ts` |
| `article-quality-analysis` | `packages/pipelines/src/engine/article-quality-analysis-queue.ts` |
| `social-render` | `packages/pipelines/src/engine/social-render-queue.ts` |
| `marketing-pipelines` (QUEUE_NAME) | `packages/pipelines/src/engine/queue.ts` |
| `gap-auto-approver` | `apps/api/src/workers/gap-auto-approver.ts` |
| `cron-orchestrator` | `apps/api/src/workers/cron-orchestrator.ts` |
| `refresh-detector` | `apps/api/src/workers/refresh-detector.ts` |
| `signal-collector` | `apps/api/src/workers/signal-collector.ts` |
| `discovery` (DISCOVERY_QUEUE_NAME) | `apps/api/src/workers/discoveryWorker.ts` |
| `trend-synthesizer` | `apps/api/src/workers/trend-synthesizer.ts` |

**Workers created (from `new Worker(...)`):**
- `scheduler` (in queue.ts runner)
- `article-quality-analysis.worker.ts`
- `social-render.worker.ts`
- `marketing-pipelines` (in queue.ts)
- `gap-auto-approver`
- `cron-orchestrator`
- `refresh-detector`
- `signal-collector`
- `discoveryWorker`
- `trend-synthesizer`

All queues match known specs. No orphaned queues without a matching spec. The `social-render` and `article-quality-analysis` queues are in `packages/pipelines/src/engine/` (canonical pattern per the DO NOT rule about cross-workspace queue access).

---

### 5.6 Tests inventory

- **Total test files:** 190 (via `find . -name "*.test.ts" -not -path "*/node_modules/*" | wc -l`)
- **Notable test categories:**
  - Pipeline integration tests: `packages/pipelines/test/article/` (7 files including topic-intake, assembly, persist-outline, article-pipeline.integration.test.ts)
  - Routing tests: `packages/pipelines/test/routing/execute-decision.test.ts`
  - Internal linking: `packages/pipelines/test/internal-linking/integration.test.ts`
  - Schema extension: `packages/pipelines/test/schema-extension/`
  - Signal sources / trend scoring: `packages/pipelines/test/topic-sources/trend-discovery/score.test.ts`
  - Adapter tests: `packages/adapters/astro-sync/test/` (6 files), `packages/adapters/anthropic/test/`, `packages/adapters/dataforseo/test/`
  - API route tests: `apps/api/test/routes/` (projects-suggest-idempotent, projects-generate, trends, etc.)
  - Cost tracker: `packages/cost-tracker/test/cost-tracker.test.ts`
  - Core utils: `packages/core/test/sql-date-bind.test.ts`, `packages/core/test/hashtag-instructions.test.ts`

---

### 5.7 Build / CI inventory

- **Root scripts:** `dev`, `build`, `typecheck`, `test`, `lint` (biome), `db:setup`, `db:migrate`, `db:check`, `db:studio` — standard local dev scripts only.
- **CI workflows:** No `.github/workflows/` in the main repo. Only `packages/skills/.github/workflows/` has CI (`validate-skill.yml`, `sync-skills.yml`) — these are for the git submodule, not the main platform.
- **Env files:** `.env.example` exists at root and `apps/web/.env.example`. No wrangler.toml (no Cloudflare Workers deployment configured).
- **No deploy/release/smoke scripts** in `package.json`. The platform appears to be deployed manually or via a process not tracked in this repo.

---

## Summary

### Items confirmed done → remove from backlog
- **Render duration metrics** (`renderStartedAt`/`renderCompletedAt`) — fully implemented in Spec 57.2, stored and returned in API.
- **`/automate` endpoint for content gaps** — fully implemented for `missing_spoke_type` + `cluster_too_small` chains (Spec 49d).
- **Cold-start backend endpoints** — 11 endpoints implemented in `cold-start.ts`. The `cold_start_drafts` table item was never built (state uses `pipeline_runs` instead) — remove this phantom table from any backlog.
- **Article discovery timing (post-draft)** — confirmed working as designed.
- **`missing_hub` and `missing_translation` automation** — implemented via different mechanisms (cornerstone spec + translation auto-trigger) than chains. Not missing.
- **Per-source `min_signal_thresholds` config** — implemented and config-driven in `fetch-signals.ts`.

### Items confirmed not built → keep in backlog
- **Reddit signal source adapter** — enum slot reserved, no implementation. Low urgency.
- **GitHub Trending signal source adapter** — enum slot reserved, no implementation. Low urgency.
- **Bidirectional EN→DE translation** — entire pipeline is hardcoded DE→EN. Non-trivial (~3–4 days).
- **`news-slide`, `concept-explainer-deck`, `pro-con-verdict` templates** — type slots reserved, commented out in bootstrap. Low urgency for current tenant.
- **Bulk approve/dismiss for Gaps** — only Briefs have bulk operations. ~0.5 day.
- **Bulk approve/dismiss for Trends** — only Briefs have bulk operations. ~0.5 day.
- **Worker process recycling (maxJobsPerWorker)** — no implementation anywhere.
- **Pipeline completion push notifications (email-first)** — infrastructure ready, no pipeline worker wires it.
- **`maxAgeDays` per-source config for signal freshness** — min thresholds are config-driven but max age is hardcoded.

### Items partially built → adjust scope
- **Stalled render job reconciliation** — BullMQ-native `stalledInterval` + `maxStalledCount: 1` is set, but there is no startup reconciliation for rows stuck in `renderStatus='rendering'` after a crash. Add: "On worker startup, reset `renderStatus='rendering'` rows older than 15 min back to `'pending'`." (~30 min fix).
- **`rejected_topic_candidates` cleanup** — expiry is 30 days (not 90), query-time filter is in place, but no DELETE job prunes the physical rows. Add a 30-minute janitor to the trend-synthesizer worker. Rename backlog item from "90-day cleanup" to "30-day physical prune."

### Items discovered (not on backlog) → add to backlog
- **`refresh/RefreshQueuePage.vue` + `projects/refresh.ts`** — appears fully implemented but not in the CLAUDE.md spec list. Verify it's complete and add the spec reference.
- **`projects/search.ts`** — cross-entity search endpoint exists with no spec reference. Verify coverage.
- **`projects.social_auto_render_locales` column (migration 0048)** — stored but "currently unused" per migration comment. Add to backlog as "wire social auto-render locales into pipeline trigger."
- **Quality analysis results UI** — `quality_analysis_cron_enabled` toggle exists in settings, worker runs, `refresh_suggestions` table populated with `source='quality'`, but no dedicated page to review quality analysis output. `RefreshQueuePage.vue` may show quality suggestions — needs verification.

### Highest-confidence recommendations for next moves
1. **Add stalled-render startup reconciliation** (~30 min): In `social-render.worker.ts` startup, run `UPDATE social_posts SET render_status='pending' WHERE render_status='rendering' AND render_started_at < NOW() - INTERVAL '15 minutes'`. Prevents permanent stuck posts after worker crashes.
2. **Add 30-day physical prune for `rejected_topic_candidates`** (~30 min): One DELETE in the trend-synthesizer janitor phase. Prevents unbounded table growth.
3. **Implement bulk approve/dismiss for Trends** (~0.5 day): The Briefs pattern is clean and directly reusable. High UX value when the trend list grows beyond 20 items.
4. **Wire pipeline completion push notifications** (~1 day): Push notification infra is fully built. Connect to `Worker.on('completed')` in the pipeline worker for at minimum the `article:blog` and `social-render` queues.
5. **Verify `RefreshQueuePage.vue` spec coverage**: This page exists and appears functional but has no corresponding spec entry in CLAUDE.md. Document it (and the `refresh_suggestions` + `refresh-detector` worker) before the context fades.
