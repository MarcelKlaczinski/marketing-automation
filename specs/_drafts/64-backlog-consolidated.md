# Phase-E Backlog Reality Check — Consolidated (2026-05-23)

_Discovery-only output. INSPECT mode — no code changes._
_Reconciles 3 out-of-date snapshots against current code state post Theme 64._

## Source docs

| Tag | Doc | Status |
|---|---|---|
| doc1 | `phase-e-backlog-2026-05-21.md` (referenced inline in [64-backlog-discovery.md](specs/_drafts/64-backlog-discovery.md)) | Not a file in repo — items summarized via Marcel's spec |
| doc2 | [backlog-reality-check.md](specs/_drafts/backlog-reality-check.md) (2026-05-18, 434 lines) | Read fully |
| doc3 | [62e-Backlog.md](specs/_drafts/62e-Backlog.md) (2026-05-21, 263 lines, content duplicated mid-file) | Read fully |

**Live verify scope:** code (greps, file reads) + DB (Toolwiki `cron_state`, `project_configurations.signal_sources`, `articles GROUP BY collection`, `topic_briefs` counts, `image_batch_requests` counts).

---

## Section 1 — Items ERLEDIGT (verify confirmed)

| # | Item | Source | Status | Evidence |
|---|---|---|---|---|
| 5 | Hero-Image Quality | doc1 #5 | ✅ done | [outline.ts:95–111](packages/pipelines/src/article/steps/outline.ts) — English-only prompts, Rule 6 explicitly forbids text/labels/signage/captions/typography. Nano Banana 2 adapter at [packages/adapters/nano-banana/](packages/adapters/nano-banana/); provider toggle in [projects.image_generation_provider](packages/db/src/schema/projects.ts:107). WebP adapter ([packages/adapters/image-webp/](packages/adapters/image-webp/)) routes ALL image bytes through magic-byte sniff + sharp conversion; nano-banana + replicate both call it. Spec 64.6 + 64.6b + 64.6c + 64.6d. **Open caveat:** no Tesseract/OCR post-generation validation — not actually required by current quality bar. |
| — | 62.5.1 Batch-aware Cost Estimation | doc3 §62.5.1, doc2 references | ✅ done | Spec `62.5.1-batch-aware-cost-estimate.md` landed; `BATCH_DISCOUNT_FACTOR = 0.5` in `packages/cost-tracker/src/weekly-budget.ts`; 11 LLM-bound steps override `llmBound = true`; SnapshotInputsStep freezes `projects.llm_mode` into `inputSnapshot.config.llmMode`. doc3 line 113 even self-corrects ("✅ Implemented"); doc2 shows the older "deferred" stance. doc2 line < doc3 line — Marcel-Hypothese **bestätigt**. |
| 4 | HackerNews + ProductHunt Filter | doc1 #4, doc3 small notes | ✅ done | HN: Spec 63.9 single-word query rewrite ([packages/adapters/hackernews/src/signal-source.ts:DEFAULT_QUERIES](packages/adapters/hackernews/src/signal-source.ts)) — 4 OR-queries → 19 single-word queries; root CLAUDE.md DO-NOT entry "Algolia HN 4+ term OR-syntax silently degrades". PH: Spec 63.8 Item B votes-key snake_case in [packages/adapters/producthunt/src/signal-source.ts:48](packages/adapters/producthunt/src/signal-source.ts:48). |
| 7 | Push Cluster Build Link Error (FK race) | doc1 #7 | ✅ done | Commit `8836c5c fix(pipelines): guard runner against orphan projectId after project delete` (2026-05-22). Diagnose 2026-05-22 found 27 orphan link-rebuild jobs in Redis pointing at 24 deleted projectIds; runner now probes `projects` existence BEFORE pipeline_runs INSERT and returns `{ok: false, error: "project_deleted", runId: ""}` cleanly. Test: [packages/pipelines/test/engine/runner-orphan-project-guard.test.ts](packages/pipelines/test/engine/runner-orphan-project-guard.test.ts). Plus [test/fixtures/drain-project-jobs.ts](packages/pipelines/test/fixtures/drain-project-jobs.ts) helper. Notification spam terminated. |
| — | Reddit signal adapter (code-complete) | doc3 small notes | ✅ done in code, ❌ inactive in Toolwiki | [packages/adapters/reddit/src/](packages/adapters/reddit/src/) class-based `RedditSignalSource` + signal-collector wiring confirmed by Explore. **Toolwiki state (DB-verified):** `signal_sources.reddit.enabled=false`, `cron_state.signal_collector_reddit.is_active=f`. Subreddit array still empty per doc3. **Awaits OAuth credentials only** — no code work. |
| — | Bidirectional translation (DE↔EN) | doc2 §2.2 (marked ❌ at the time) | ✅ done — **OBSOLETE backlog item** | Setup-step parameterizes `sourceLocale` + `targetLocale: "de" \| "en"`; `DE_TO_EN_ADAPTIVE_MARKERS` + `EN_TO_DE_ADAPTIVE_MARKERS` defined in `decision.ts:29–47`; bridges use `findSibling()` bidirectional (Spec 59.2). Plus 64.3 locale-aware bridge (`buildCanonicalUrl`, `buildHeroAltText`, `bcp47Tag`), 64.4 FAQ-preservation validator, 64.5 word-drift cap. **doc2 §2.2 obsolete since Themes 59.2 / 64.3-64.5.** |
| — | Render duration metrics | doc2 §3.3, Summary | ✅ done | `renderStartedAt`/`renderCompletedAt` columns in `social_posts`, set by social-render.worker.ts on both success + failure paths. Already removed from doc2 backlog. |
| — | `/automate` endpoint for content-gaps | doc2 §2.5, Summary | ✅ done | `POST /:slug/content-gaps/:id/automate` exists for `missing_spoke_type`/`cluster_too_small`. `missing_hub` routes through `/generate` (cornerstone spec), `missing_translation` triggers via blog `afterComplete`. doc2 already disambiguates. |
| — | `min_signal_thresholds` per-source config | doc2 §4.4 | ✅ done | `loadActiveConfig().topicScope.min_signal_thresholds` consumed in `fetch-signals.ts`; per-source `minPoints`/`minVotes` overrides config-driven. |
| — | Cold-start backend | doc2 §3.2 | ✅ done | 11 endpoints in `apps/api/src/routes/cold-start.ts`. `cold_start_drafts` table never existed — state lives in `pipeline_runs` + `projects`/`clusters`/`cornerstone_specs`. Already removed from doc2 backlog. |
| — | Article discovery timing (post-draft) | doc2 §2.6 | ✅ done — **OBSOLETE backlog item** | `DraftPipeline.afterComplete` triggers discovery — correct design. Already confirmed in doc2. doc2 §2.6 is the answer; remove from open list. |
| — | `social_auto_render_locales` wiring | doc2 §5.7 "Items Discovered" | ✅ done | `SocialGenerationStep.shouldRun()` gates on the field; branches `"one"` vs `"all"`. Migration 0048 comment "currently unused" is stale. |
| 64.10 | R2 orphan-hero cleanup script | git status (in-flight today) | ✅ implemented, ⏳ `--apply` pending | [apps/api/src/scripts/cleanup-orphan-heroes.ts](apps/api/src/scripts/cleanup-orphan-heroes.ts) + smoke tests; spec 64.10 status line: _"Implemented (Fix A; Fix B no-op per §10 #2). `--apply` deletion pending Marcel-go."_ Adapter-storage `listObjects` + `deleteObject` local-fallback also landed. |

---

## Section 2 — Items OBSOLET (no longer relevant)

| Item | Source | Why obsolete |
|---|---|---|
| Bidirectional EN→DE translation (3-4 days) | doc2 §2.2, Summary | Themes 59.2 + 64.3 + 64.4 + 64.5 covered DE↔EN with `sourceLocale`/`targetLocale` parameterization, locale-aware bridge, FAQ + word-drift validators, BCP-47 inLanguage tags. Verified above. |
| Cluster A "Article Content Variants" (intent-type prompt branching) | doc2 references, doc1 #? | **`intentType` is an output field, not a prompt-input selector.** Prompt branching in `selectDraftPrompt()` lives on `collectionType` (blog / comparison / ki-wissen). Marcel intentionally collection-typed the variants in Specs 61.2 + 61.3 — that's the design. Original backlog framing is outdated. Remove. |
| Article discovery is post-draft only | doc2 §2.6 | Confirmed correct design — discovery fires after the article has content. Not a backlog item, just a documented design choice. |
| Cold-start `cold_start_drafts` table | doc2 §3.2, Summary | Phantom — never existed. State persists in `pipeline_runs` + project data tables + frontend TanStack Query. |
| `missing_hub` / `missing_translation` automation chains | doc2 §2.5, Summary | Not missing — implemented via different mechanisms (cornerstone spec route + translation `afterComplete` auto-trigger). Not chains by design. |
| Per-source `min_signal_thresholds` config | doc2 §4.4 | Already config-driven via `fetch-signals.ts`. Only `maxAgeDays` portion of the original line item remains open (kept in §3). |
| Render duration metrics | doc2 §3.3 first sub-item | `renderStartedAt`/`renderCompletedAt` populated + returned. Confirmed in doc2 Summary. |
| Reddit-Auth aktivieren wenn Key ankommt | doc3 small notes | Reddit-Adapter is code-complete; only awaits OAuth credentials + 10-min DB flip. Not a code backlog — pure ops/credentials waiting. |
| GitHub `enabled:true` JSON ↔ cron_state inconsistency | doc3 small notes | Fixed by Spec 63.8 Item A — `SIGNAL_COLLECTOR_DEFAULT_PATTERNS` + project-create seeds 5 `cron_state` rows + PATCH default. Toolwiki was reconciled. |
| ProductHunt votes-key mismatch | doc3 small notes | Fixed by Spec 63.8 Item B — adapter now emits `votes_count`/`comments_count`. |
| HN-Cron-Bug fix (2026-05-21) | doc3 small notes | Fixed pre-63.9, then 63.9 fixed the OR-syntax degradation that was the actual root cause. Live verification: HN volume went 2 rows → 182 rows in one run after the query rewrite. |

---

## Section 3 — Items NOCH OFFEN (priorisiert)

### High Priority

| # | Item | Effort (re-estimated) | Trigger |
|---|---|---|---|
| 1 | **Social-Article Decoupling** — 3 layers: (a) fallback-LLM for missing tool frontmatter (today `?? 70` hardcoded default in `GenerateComparisonGrid4Step`), (b) `existingArticleId` input variant (current schema requires `articleId` only), (c) standalone social-pipeline entry (no article, e.g. news-recap from `external_signals`, single-tool highlight). | **3–5 days** (revised up from doc1's 1-2d estimate after Agent C verify — three independent code paths + 2 HTTP routes + new pipeline entry shape needed) | News-recap content desire OR tool-highlight needs OR comparisons-grid-4 silently using `?? 70` defaults becomes a quality issue |
| 2 | **Deterministic Cluster-Routing for ComparisonDiscovery** — `comparison-discovery.ts` writes briefs with `clusterId=NULL`. Toolwiki state: 24 `comparisons`-collection articles ALL clustered (legacy editorial); 4 new `comparison_discovery` briefs in pipeline (pending, clusterless). Inconsistency real but not blocking — Astro cross-linking uses `toolSlugs` independent of cluster ([RelatedComparisons.astro:25](apps/web/src/.../RelatedComparisons.astro:25) per doc3). | **1–2 days** | Cluster hub-page builds for comparisons OR scaling comparison_discovery briefs into actual published articles |
| 3 | **GitHub Tool-Inventory** (separate `content_source_inventory` table) — established-tools filter (`minStars: 100, lastActiveWithinDays: 90, hasTopicTag`). Distinct from signal-system (trending). Feeds `ki_wissen` + `cluster` items for planner. | **2–3 days** | Toolwiki content stream needs recurring "Top-10 X tools 2026" / "How to install Y" angles beyond what trending feeds give |
| 4 | **Distribution-Layer** V1 static + V2 engagement-driven | V1: **1–2 days** / V2: **3–5 days** | V1 unblocked AFTER planner produces stable weekly content stream (Theme 62/63 are deployed; 64.7 batch hero-images close the last quality gate). V2 needs ≥2 months of engagement data first. |

### Mid Priority

| # | Item | Effort | Trigger |
|---|---|---|---|
| 6 | **Longitudinal Plan-Diversity** (cross-week) — 63.5's `pickWithDiversity` is within a single plan only. KW21 already covered "RAG" → KW22 should down-rank "RAG". | **0.5 day** | Plan generation reaches 6–8 consecutive weeks where Marcel observes topic-staleness in the calendar UI |
| 8 | **Precomputed `topic_briefs.embedding` column** — 63.5 currently computes Voyage embeddings on-the-fly per plan run. `topic_briefs` schema has no `embedding` column today. | **0.5 day** schema + migration + emit-brief wiring | ≥ 5 plan runs/week OR Voyage cost on cost-summary becomes meaningful OR plan generation latency >30s |
| 9 | **DataForSEO_trends as Signal-Source** — enum slot exists in 3 places (RawSignalSchema, `external_signals.source`, `signal-top-n.ts` dead case-branch); zero adapter, zero collector dispatch. Cost ~$0.06/call × 20 daily ≈ $36/month. | **1–2 days** after strategy decision | Toolwiki signal mix gains "search-intent" dimension worth $36/mo budget impact |
| — | Bulk approve/dismiss for Gaps | **0.5 day** | Gap list grows past ~20 open items |
| — | Bulk approve/dismiss for Trends | **0.5 day** | Trend brief list grows past ~20 open items |
| — | Stalled-render startup reconciliation (rows stuck in `renderStatus='rendering'`) | **30 min** | Worker crash leaves a post stuck once (visible via render-status polling) |
| — | `rejected_topic_candidates` physical prune (30-day expiry filter exists, no DELETE) | **30 min** | Table grows past ~10k rows (currently 1 active row Toolwiki — no urgency) |
| — | Pipeline completion push notifications via `Worker.on('completed')` | **1 day** | Marcel wants closure notifications on long blog generations (5–10 min runs) |

### Low Priority / Smart-Deferred

| Item | Trigger to fire |
|---|---|
| `news-slide` template (declared in TemplateKey union, commented out in bootstrap) | News-recap social posts become a desired output |
| `concept-explainer-deck` template (same status) | Education-focused social posts needed |
| `price-comparison` template (same status) | Pricing-comparison social posts needed (different angle from `comparison-grid-3/4`) |
| Adjustable trend score weights via project config (currently hardcoded `W = {buzz:15, growth:15, ...}`) | Multi-tenant: news vs evergreen tenants need different weights |
| Bulk DataForSEO_trends as signal source (per-topic only today) | Daily signal-collection costs exceed budget OR >5 active projects |
| Worker process recycling (`maxJobsPerWorker`) | Long-running workers show heap growth in monitoring |
| `maxAgeDays` per-source config (only `min_signal_thresholds` is config-driven today) | RSS feed starts producing stale content visible in trend output |
| Adjustable HN `minPoints` / `maxAgeDays` (HN config in Toolwiki: `minPoints: 5`, worker hardcoded `maxAgeDays: 30`) | 63.9 fix produced 182 rows / 22/day → don't tune unless volume drops |

---

## Section 4 — DO-NOT-FIX Items (Confirmed Parked)

| Item | Memory-Ref / Source | Trigger to revisit |
|---|---|---|
| Knowledge-Hub-Spoke in Tools-Cluster (`intent_type='knowledge'` brief can append to ANY cluster including `tools`/`comparisons`) | Root [CLAUDE.md:154](CLAUDE.md:154) DO-NOT rule + [packages/pipelines/CLAUDE.md:983-985](packages/pipelines/CLAUDE.md:985) | Production semantic pollution: off-topic tool injection by `tool-linker/pre-generation.ts:38` becomes visible in published articles. Marcel's mitigation today: editorial review via Spec 63.6 `plan_pending` workflow. |
| OCR-Check on hero images via Tesseract | Spec 64.6 / 64.6d explicit decision | Hero images regress (text-label leakage) AFTER Nano Banana 2 + Rule-6 outline prompt are confirmed in production for ≥ 30 days. |
| Add `cost_logs.metadata.augmented` typed field | Spec 64.6d skipped explicitly | Spec 64.8 (image-prompt-audit) actually consumes the metadata in production. Verified: 64.8 IS in `specs/` ([64.8-image-prompt-audit.md](specs/64.8-image-prompt-audit.md)) — Marcel says "wartet auf samples", so 64.8 needs to LAND fully before this field becomes useful. |

---

## Section 5 — NEU entdeckt durch Theme 64

| Item | Source-Spec | Effort | Priority |
|---|---|---|---|
| `originalR2Key` in batch path | [Spec 64.7 §11 #7](specs/64.7-image-batch-mode.md) | ~30 LOC — pipe batch result through `convertImageToWebp` instead of direct R2 store | Low — known limitation; batch articles intentionally lack forensic original today |
| `cost_logs.metadata.augmented` field | Spec 64.6d → 64.8 | 1 line JSONB-additive | Lands with 64.8 (also see Section 4) |
| `RefreshQueuePage.vue` + `projects/refresh.ts` lack spec coverage | doc2 §5.7 "Items Discovered" | ~15 min documentation pass | Document when context fades; not a code task |
| `projects/search.ts` cross-entity search lacks spec coverage | doc2 §5.7 "Items Discovered" | ~15 min documentation pass | Same as above |
| `pgvector hnsw` index on `clusters.embedding` exists but NOT on `topic_briefs` (since `topic_briefs.embedding` doesn't exist yet) | Inferred from §3 #8 | Pairs with #8 above when triggered | — |

---

## Section 6 — Recommended Next 3 Specs

Selection criteria: **Toolwiki content-stream impact** (does Marcel publish more / better content?) × **effort fit** (small enough to land in one focused session) × **dependency-free** (doesn't block on external credentials or upstream Spec landings).

### 1. **Stalled-Render Reconciliation + Pipeline-Completion Notifications (combined bundle)** — ~1.5 days

Why: Both items hit Marcel's daily UX directly. Stalled-render is the silent-loss case (a render crashes during the 5-10 min Remotion job and the post is stuck forever; user has no way to retry without finding it manually). Push-notifications close the long-running-blog feedback loop (Marcel walks away during a 7-min `article:blog` run and currently has no completion signal).

Both share the same `social-render.worker.ts` + worker `index.ts` surface — bundling them keeps the worker-restart cost amortized.

Bundle shape:
- Worker startup: `UPDATE social_posts SET render_status='pending' WHERE render_status='rendering' AND render_started_at < NOW() - INTERVAL '15 minutes'` (30 min)
- `Worker.on('completed')` listener that calls `createNotification()` from `packages/core/src/notifications/` for at minimum `article:blog` + `social-render` + `cluster:full-plan` (1 day)

Trigger fit: ✅ infra is fully ready (notification surface, push-subscription routes, SSE); no spec dependencies; small enough for one session.

### 2. **`originalR2Key` in batch path** — ~0.5 day

Why: Spec 64.7 explicitly flagged this as a known limitation. Implementing it now means future Marcel never has the "I want to re-encode this batch-generated hero, but the original is gone" situation. ~30 LOC routing the batch result through the existing `convertImageToWebp` adapter. No new schema work (column already exists per Spec 64.6c migration 0091). Pure pipe-through.

Trigger fit: ✅ Spec 64.7 is fresh in Marcel's head; cost ~0 to land while the surrounding code is warm. Postponing it means re-loading the batch-path mental model in 2 months.

### 3. **Comparison-Discovery Cluster-Routing (Spec from doc1 #2)** — ~1.5 days

Why: 4 `comparison_discovery` briefs in Toolwiki sit clusterless (verified live). They route fine to `article:blog` (Spec 64.9 already loosened the immediate-dispatch gate for plan-dispatch), but the resulting articles land with `cluster_id=NULL` — diverging from the 24 editorial comparisons which are all clustered to `{topic}-comparisons-2026`. Each new `comparison_discovery` brief that Marcel approves into a plan creates a hub-page inconsistency that compounds over time.

Heuristic from doc3: derive `clusterKey` deterministically from `comparisonMetadata.{toolASlug, toolBSlug}` subcategory match. Same-subcategory → existing `{subcategory}-comparisons-2026` cluster. Cross-subcategory → leave as-is (no forced cluster).

Trigger fit: ✅ Marcel will eventually want comparison hub pages. Solving this BEFORE many comparison_discovery briefs land prevents backfill pain. Small spec.

---

### Honorable mentions (skipped from top-3):

- **Spec 64.8** Image-Prompt-Audit — Marcel says "wartet auf samples". Don't push from outside; it lands when Marcel has the audit corpus.
- **Social-Article Decoupling** (doc1 #1) — Highest-impact open item but 3-5 days. Better as standalone deep-dive after Marcel-decision on what FORM the standalone social pipeline should take (news-recap vs tool-highlight vs both).
- **GitHub Tool-Inventory** (doc1 #3) — 2-3 days; needs its OWN discovery-spec to nail down `content_source_inventory` shape vs. signal-system separation. Worth doing but not next.
- **DataForSEO_trends bulk** — Strategy decision needed before code (which keywords, what cost limit). Defer to budget review.
- **Distribution-Layer V1** — Unblocked but Marcel's note in doc3: "Theme 62 produktiv eine Woche gelaufen". Wait one more cycle.
- **Bulk operations for Gaps/Trends** — Low-friction, but Toolwiki's current gap/trend volume doesn't justify yet (verify ≥20 open items first).

---

## Section 7 — Consolidated Backlog (single source of truth)

Sortiert nach status, dann priority within status.

| ID | Item | Status | Priority | Effort | Trigger | Last Updated |
|---|---|---|---|---|---|---|
| **ERLEDIGT** | | | | | | |
| E1 | Hero-Image Quality bundle (64.6/6b/6c/6d) | ✅ done | — | — | — | 2026-05-23 |
| E2 | Bidirectional translation (DE↔EN) | ✅ done | — | — | — | 2026-05-23 |
| E3 | 62.5.1 Batch-aware Cost Estimation | ✅ done | — | — | — | 2026-05-23 |
| E4 | HN Algolia query rewrite (63.9) | ✅ done | — | — | — | 2026-05-23 |
| E5 | ProductHunt votes-key snake_case (63.8 Item B) | ✅ done | — | — | — | 2026-05-23 |
| E6 | Push Cluster Build Link FK race guard | ✅ done | — | — | — | 2026-05-23 (commit 8836c5c) |
| E7 | Reddit signal adapter (code-complete) | ✅ done in code | — | — | Awaits OAuth credentials | 2026-05-23 |
| E8 | `signal_collector_*` JSON ↔ cron_state alignment (63.8 Item A) | ✅ done | — | — | — | 2026-05-23 |
| E9 | Render duration metrics | ✅ done | — | — | — | 2026-05-23 |
| E10 | `/automate` content-gaps endpoint | ✅ done | — | — | — | 2026-05-23 |
| E11 | `min_signal_thresholds` per-source config | ✅ done | — | — | — | 2026-05-23 |
| E12 | Cold-start backend (11 endpoints) | ✅ done | — | — | — | 2026-05-23 |
| E13 | Article discovery post-draft timing | ✅ done — design choice | — | — | — | 2026-05-23 |
| E14 | `social_auto_render_locales` wiring | ✅ done | — | — | — | 2026-05-23 |
| E15 | R2 orphan-hero cleanup (64.10) | ✅ implemented | — | — | `--apply` pending Marcel | 2026-05-23 |
| **OFFEN — HIGH** | | | | | | |
| H1 | Social-Article Decoupling (3 layers) | ❌ open | High | 3–5 days | News-recap / tool-highlight needs surface | 2026-05-23 |
| H2 | Deterministic Cluster-Routing for ComparisonDiscovery | ❌ open | High | 1–2 days | Comparison hub pages OR Toolwiki has ≥10 comparison_discovery published articles | 2026-05-23 |
| H3 | GitHub Tool-Inventory (`content_source_inventory` table) | ❌ open | High | 2–3 days | Recurring inventory-based content angles needed | 2026-05-23 |
| H4 | Distribution-Layer V1 (static schedule) | ❌ open | High | 1–2 days | Planner stable 1 week + Marcel-decision on channels | 2026-05-23 |
| **OFFEN — MID** | | | | | | |
| M1 | Longitudinal Plan-Diversity (cross-week) | ❌ open | Mid | 0.5 day | 6–8 consecutive weeks show topic staleness | 2026-05-23 |
| M2 | Precomputed `topic_briefs.embedding` column | ❌ open | Mid | 0.5 day | ≥5 plan runs/week OR Voyage cost meaningful | 2026-05-23 |
| M3 | DataForSEO_trends bulk signal source | ❌ open | Mid | 1–2 days | Strategy + budget decision first | 2026-05-23 |
| M4 | Bulk approve/dismiss for Gaps | ❌ open | Mid | 0.5 day | Gap list >20 items | 2026-05-23 |
| M5 | Bulk approve/dismiss for Trends | ❌ open | Mid | 0.5 day | Trend list >20 items | 2026-05-23 |
| M6 | Stalled-render startup reconciliation | 🟡 partial | Mid | 30 min | Worker crash leaves a stuck render | 2026-05-23 |
| M7 | `rejected_topic_candidates` 30-day physical prune | ❌ open | Mid | 30 min | Table grows past ~10k rows (Toolwiki: 1 row today) | 2026-05-23 |
| M8 | Pipeline completion push notifications | 🟡 infra ready, no wire | Mid | 1 day | Marcel wants completion signal on long runs | 2026-05-23 |
| M9 | Distribution-Layer V2 (engagement-driven) | ❌ open | Mid | 3–5 days | V1 deployed + ≥2 months engagement data | 2026-05-23 |
| **OFFEN — LOW / SMART-DEFERRED** | | | | | | |
| L1 | `news-slide` social template | 🟡 stub | Low | 1 day | News social posts needed | 2026-05-23 |
| L2 | `concept-explainer-deck` social template | 🟡 stub | Low | 1 day | Education social posts needed | 2026-05-23 |
| L3 | `price-comparison` social template | 🟡 stub | Low | 1 day | Pricing-comparison social posts needed | 2026-05-23 |
| L4 | Adjustable trend score weights per project | ❌ open | Low | 0.5 day | Multi-tenant divergence | 2026-05-23 |
| L5 | Worker process recycling (`maxJobsPerWorker`) | ❌ open | Low | 1 day | Worker heap growth visible | 2026-05-23 |
| L6 | `maxAgeDays` per-source config | ❌ open | Low | 0.5 day | RSS feed produces stale content | 2026-05-23 |
| L7 | `originalR2Key` in batch path (64.7 follow-up) | ❌ open | Low | 30 LOC | Want forensic original on batch heroes | 2026-05-23 |
| L8 | `cost_logs.metadata.augmented` field | ❌ open | Low | 1 line | Spec 64.8 actually consumes it | 2026-05-23 |
| L9 | Document `RefreshQueuePage.vue` + `projects/refresh.ts` spec coverage | ❌ open (doc-task) | Low | 15 min | Context still warm | 2026-05-23 |
| L10 | Document `projects/search.ts` spec coverage | ❌ open (doc-task) | Low | 15 min | Context still warm | 2026-05-23 |
| **DO-NOT-FIX** | | | | | | |
| X1 | Knowledge-Hub-Spoke in Tools-Cluster | DO-NOT-FIX | — | — | Production off-topic tool mentions become visible | 2026-05-23 |
| X2 | OCR validation via Tesseract on hero images | DO-NOT-FIX | — | — | Hero text-label regressions after 30+ days in production | 2026-05-23 |

---

## Toolwiki Live State (DB-verified 2026-05-23)

### Articles by collection × clustering

| Collection | Total | Clustered | Unclustered |
|---|---|---|---|
| authors | 10 | 0 | 10 (by design — authors are not in a cluster) |
| blog | 58 | 58 | 0 |
| **comparisons** | **24** | **24** | **0** |
| ki-wissen | 24 | 24 | 0 |
| special-landings | 10 | 0 | 10 (by design) |
| tool-categories | 14 | 0 | 14 (by design) |
| tools | 108 | 108 | 0 |
| usecases | 24 | 24 | 0 |

**Reading:** 22 editorial comparison articles (doc3's #) ≈ 24 today (2 added since). All clustered — consistent with doc3's "22 redaktionelle Bestands-Comparisons sind alle clustered nach `{topic}-comparisons-2026` Pattern".

### Toolwiki signal sources state

| Source | JSON `enabled` | `cron_state.is_active` | Aligned? |
|---|---|---|---|
| hackernews | true | t | ✅ |
| producthunt | true | t | ✅ |
| vendor_rss | true | t | ✅ |
| reddit | false | f | ✅ (consistent — awaits credentials) |
| github | false | f | ✅ |
| dataforseo_trends | false (boolean stub, no object) | n/a (no cron) | ✅ — adapter doesn't exist anyway |

**63.8 Item A alignment fix held** — no more JSON-vs-cron drift visible.

### Topic briefs by source

| Source | Count |
|---|---|
| gap_analysis | 168 |
| trend_discovery | 22 |
| comparison_discovery | **4** ← these are the clusterless ones (H2 motivates fix here) |
| refresh_detection | 1 |

### Brief approval status

| Status | Count |
|---|---|
| pending | 176 |
| plan_pending | **11** ← Spec 63.6 plan_pending workflow active |
| superseded | 4 |
| rejected | 2 |
| approved | 1 |
| routed | 1 |

**plan_pending 11 rows confirm Spec 63.6 + 64.9 workflows are live.**

### image_batch_requests

0 rows — Spec 64.7 batch mode infrastructure deployed but not yet exercised against Toolwiki (Marcel runs sync today, batch would activate when `projects.llm_mode='batch'`).

### Rejected topic candidates

1 active row only. **M7 physical-prune is not urgent.**

---

## Cleanup of source docs

Suggested cleanup after Marcel reads this:
- Delete or archive [specs/_drafts/backlog-reality-check.md](specs/_drafts/backlog-reality-check.md) (doc2) — superseded by this file.
- Delete or archive [specs/_drafts/62e-Backlog.md](specs/_drafts/62e-Backlog.md) (doc3) — superseded by this file. (Content is also duplicated inside the file itself — see lines 1-126 vs 128-263.)
- Delete [specs/_drafts/64-backlog-discovery.md](specs/_drafts/64-backlog-discovery.md) — discovery-spec, work done.
- Keep [specs/_drafts/diagnose-push-cluster-link.md](specs/_drafts/diagnose-push-cluster-link.md) for history (already resolved by commit 8836c5c).

---

## Verification log (what I actually checked)

1. ✅ Read doc2 + doc3 fully (lines 1-end).
2. ✅ Dispatched 4 parallel Explore agents covering: Hero-Image + Translation + Intent-aware draft, Signal adapters + brief embeddings + cost-logs, Social-Decoupling + Comparison-routing + Templates, Distribution + Push-notif + Worker hardening + Plan-diversity.
3. ✅ Live DB queries (read-only, Marcel-approved): articles GROUP BY collection × cluster_id, cron_state by project=toolwiki, signal_sources JSON state, topic_briefs by source + approval_status, image_batch_requests, rejected_topic_candidates active/expired.
4. ✅ Git log inspection: 30 commits scanned; commit `8836c5c` confirmed as the FK race fix for Push Cluster Link Error.
5. ✅ Spec directory enumeration: 64.1–64.10 + 64.6b/c/d + 64.0b confirmed present; 64.8 + 64.10 modified in current git status.
6. ✅ CLAUDE.md DO-NOT rules cross-checked for Knowledge-Hub-Spoke (root:154 + pipelines:983-985).

**Total verify time:** ~90 minutes including parallel agent fan-out + DB queries + synthesis.
