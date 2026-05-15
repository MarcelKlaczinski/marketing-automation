# Backlog

Items that are intentionally NOT being worked on right now, but should not be forgotten. Each entry has:

- **Status**: `parked` (decision made: not now), `under-review` (uncertain), `archived` (decided against)
- **Last reviewed**: when it was last touched
- **Trigger**: what would re-activate this item

When an item moves to active development, write a Spec for it and remove it from this file.

---

## B-001: `projects.pipelineTemplate` field is unused

**Status**: parked
**Last reviewed**: 2026-05-07
**Origin**: Discussion in transcripts during Phase 4 Wave 4 work

**Summary**: The `pipeline_template` enum (educational / affiliate_review / local_business / programmatic_seo) is stored on every project and exposed in the project-create UI, but no code reads it. All projects run identical Cold-Start prompts, Outline templates, and Schema.org strategies regardless of template value.

**Why parked**: Removing the field means migration + UI removal for a value that's only descriptive. Implementing template-specific behavior is ~1-2 days of work without a concrete second-tenant use case to validate the variation points. Leaving it in is harmless metadata.

**Known bug** (deferred fix, not in scope): the Spec 34 project-update validator uses `z.enum(['educational', 'commercial', 'editorial'])` which doesn't match the actual DB enum. Updating `pipelineTemplate` via the UI would fail. Low impact (Marcel sets it once at project creation, never changes).

**Trigger to revisit**:
- A second tenant onboards with a fundamentally different strategy (e.g., music-school as `local_business` vs KI-Wissensraum as `educational`), AND
- The need to vary pipeline behavior between them is concrete (not "would be nice")

**When activated**:
- Fix the Spec 34 validator bug first
- Write a Spec defining which prompts / steps / schemas vary per template
- Don't try to make all four templates work simultaneously — start with the two tenants that actually exist

---

## B-002: Approvals workflow

**Status**: parked
**Last reviewed**: 2026-05-07
**Origin**: `approvals` table exists in schema (Spec 01) but is unused

**Summary**: The DB has an `approvals` table tracking `(article_id | social_post_id, action, comment, user_id)` for review workflows. No code writes to it, no UI reads it.

**Why parked**: Single-user system. Approvals only make sense when there's a separation between content-author and content-approver. Marcel currently is both.

**Trigger to revisit**:
- Marcel adds an editor / virtual assistant who drafts but doesn't publish, OR
- Marcel-as-author wants explicit approve-gates before pipelines proceed (e.g., "outline review must be approved before drafting")

**When activated**:
- Decide whether approvals are blocking (gate pipelines) or advisory (just log)
- UI: approval queue, approval history per article, approve/reject/comment actions
- Backend: extend trigger-helpers to optionally gate on approval-state

---

## B-003: Social posts (Instagram, TikTok, LinkedIn, Twitter)

**Status**: parked
**Last reviewed**: 2026-05-07
**Origin**: `social_posts` table + enums exist (Spec 01), repurpose-pipeline mentioned in early Phase 1 docs

**Summary**: Schema supports social-post management (carousel, reel, single_image, story formats × 4 platforms). Adapter for Instagram Graph exists. No UI, no pipeline currently generates social posts from articles.

**Why parked**: Marcel hasn't decided if social distribution is strategic for KI-Wissensraum. Building a feature that's never used is waste. Plus: each platform has its own approval/auto-post quirks (Instagram especially).

**Trigger to revisit**:
- Marcel publishes 10+ articles and wants to extend reach via social, OR
- A tenant onboards where social IS the primary channel

**When activated**:
- Spec the article → social post pipeline (one article → 1 LinkedIn carousel + 1 Instagram + 1 Twitter thread)
- Spec the social-posts kanban UI similar to articles
- Reactivate Instagram adapter (probably needs auth refresh)

---

## B-004: Briefing UI

**Status**: parked
**Last reviewed**: 2026-05-07
**Origin**: `briefings` table exists (Spec 03), daily briefing generation pipeline implemented but no UI surfaces it

**Summary**: Daily briefings (markdown summaries of project state) are generated and stored. Currently consumed only via email digest (Spec 11.5).

**Why parked**: Email digest covers the use case. A separate UI for browsing historical briefings would be nice-to-have but not blocking.

**Trigger to revisit**:
- Marcel finds himself searching email archives for past briefings, OR
- A tenant prefers in-app reading over email

**When activated**:
- Simple list page `/briefings` with markdown rendering
- Filters: project, date range
- Maybe Inbox-page integration: "today's briefing" section

---

## B-005: Analytics integration (GA4 + Search Console)

**Status**: parked
**Last reviewed**: 2026-05-07
**Origin**: Out-of-scope mentions in early Phase 1 architecture

**Summary**: Search Console + GA4 credential adapters exist conceptually but no pull-pipeline integrates real-traffic data into the platform. The `articles.publishedAt` is set but actual page-view counts, click-through rates, ranking positions are not tracked.

**Why parked**: KI-Wissensraum is too new to have meaningful analytics data. Premature analytics infrastructure.

**Trigger to revisit**:
- KI-Wissensraum has 6+ months of published content with measurable traffic, OR
- Affiliate-review tenants onboard (where revenue-per-article tracking matters)

**When activated**:
- GA4 BigQuery export integration OR Data API direct queries
- Search Console URL Inspection API + Performance API
- Per-article dashboard: views, CTR, avg-position over time
- Cluster-level rollups
- Probably its own page `/analytics` with cross-filter to projects/clusters/articles

---

## B-006: Multi-user / editor role

**Status**: parked
**Last reviewed**: 2026-05-07
**Origin**: `userRoleEnum` has `owner | editor` (Spec 01)

**Summary**: Schema supports two roles but the system treats every user as owner. No editor-specific permission gates, no UI for adding/removing users from a project.

**Why parked**: Marcel is the sole user. Adding multi-user without a real second user is theater.

**Trigger to revisit**:
- Marcel hires an editor / VA, OR
- A tenant onboards where multi-user is required (agency-style usage)

**When activated**:
- Permission middleware on every endpoint (currently `requireAuth` is sufficient because every authed user is owner)
- User-management UI in Settings
- Project-membership join table (currently no FK between users and projects)
- Approvals (B-002) becomes much more relevant alongside this

---

## B-007: Cron infrastructure

**Status**: parked
**Last reviewed**: 2026-05-07
**Origin**: Multiple specs mention "run via cron" (Spec 03 briefings, Spec 40 notification pruning, Spec 22 PageSpeed re-checks)

**Summary**: Several pipelines should run on schedule but currently run only on manual trigger or HTTP admin endpoints. BullMQ supports scheduled jobs but no infrastructure registers them.

**Why parked**: Manual weekly cleanup works for current scale. Building cron infra without urgent need is overengineering.

**Trigger to revisit**:
- Marcel forgets to run pruning for 2+ weeks and notification table grows large, OR
- KI-Wissensraum live with daily briefings expected automatically, OR
- Multiple tenants each needing their own schedule

**When activated**:
- BullMQ `Queue.add(..., { repeat: { cron: '0 8 * * *' } })` for scheduled jobs
- Admin UI to view/edit schedules
- Per-project schedule overrides

---

## B-008: Performance pass for large projects

**Status**: parked
**Last reviewed**: 2026-05-07
**Origin**: Stabilization Report F-008 (articles list pagination), Spec 36 acknowledged

**Summary**: Several endpoints assume small data volumes:
- `/api/articles` returns ALL articles for a project (no pagination)
- `/api/clusters` joins all clusters + cornerstones (no pagination)
- Articles Kanban renders all cards in one pass (no virtualization)
- Cost-aggregation endpoint runs 7 sequential queries (could be 1)

**Why parked**: KI-Wissensraum currently has < 50 articles. Performance is fine.

**Trigger to revisit**:
- Any project crosses 100 articles OR 5+ active projects, OR
- Page load times exceed 1s on inbox/articles pages

**When activated**:
- Cursor-based pagination for articles + clusters list endpoints
- Virtual scrolling for Kanban (vue-virtual-scroller)
- Combined cost-aggregation query
- Indexes audit for hot paths

---

## B-009: Production deploy infrastructure

**Status**: parked
**Last reviewed**: 2026-05-07
**Origin**: Currently dev-only setup

**Summary**: System runs locally on Marcel's machine. No production deployment exists.

**Why parked**: Premature for a system still under heavy iteration. Local-first development is faster.

**Trigger to revisit**:
- Marcel wants to access from multiple devices reliably, OR
- A second tenant onboards (means actual customer-facing uptime expectations), OR
- Cost of NOT having backups becomes too high

**When activated**:
- HTTPS termination (Caddy or Cloudflare in front of API)
- Postgres backup strategy (pg_dump cron + offsite)
- Redis persistence config
- Process supervisor (systemd or pm2)
- VAPID keys regenerated (per Spec 40 deploy checklist)
- DELETE FROM push_subscriptions WHERE endpoint LIKE '%localhost%'
- Logs aggregation (Loki, or just rsyslog)
- Monitoring (uptime + cost-limit-pause alerts)

---

## B-010: pgvector for internal linking

**Status**: under-review
**Last reviewed**: 2026-05-07
**Origin**: Spec 24 (internal linking) uses pgvector, Spec 42 setup script enables extension

**Summary**: pgvector is enabled and the `articles.embedding` column exists. Whether the internal-linking pipeline actually uses it correctly to find semantic-similar articles needs verification.

**Why under-review**: Last touched in Spec 24 implementation. With Spec 42 stabilization complete, worth a quick check whether the linking actually produces good results in practice on KI-Wissensraum.

**Trigger to validate**:
- After 10+ articles published, check if internal-link suggestions are sensible
- Use the cluster link-rebuild trigger (Spec 24) on a real cluster, inspect the results

**When activated** (if quality is poor):
- Tune the cosine-similarity threshold
- Consider re-embedding with a different model
- Add manual override mechanism for "always link to X from Y"

---

# Backlog Spec: Evergreen Topic Discovery & Refresh Scheduling

**Status:** Backlog — proposed after Phase B completion
**Priority:** Medium-High (significant traffic/SEO impact, complements Trend Discovery)
**Estimated Effort:** 4-5 days (~28-32 focused hours across 6-7 sessions)
**Dependencies:** Spec 54.5 (TopicBrief synthesis pattern), Spec 54.7 (Cluster Creator — for `create_new` evergreen topics), Spec 54.8 (Generator Modes — for refresh-mode generation)
**Recommended Model:** Opus 4.7 (multi-source synthesis + heuristic design)

---

## The Problem

The current Trend Discovery system (Specs 54.4-54.6) detects **explosive trends** — new tool launches, breaking news, vendor announcements. This catches "what's hot right now" beautifully (RAG-Tools, Codex enterprise, GPT-5.5 leaks).

But it systematically **misses evergreen high-traffic topics** that drive sustained organic traffic:

- "Top 5 Claude Skills 2026" — searched year-round, peaks in May (mid-year roundup season)
- "Beste KI Mai 2026" — monthly "best of" content with predictable search demand
- "ChatGPT vs Claude vs Gemini Vergleich" — comparison content with stable demand
- "Wie generiert man bessere Bilder mit ChatGPT" — how-to evergreen
- "Beste KI-Tools für Marketing 2026" — annual category roundups

These topics have:
- **High search volume** (1k-50k searches/month for top variants)
- **Low day-to-day signal** (no HN explosion, no PH launch, no vendor announcement)
- **Predictable cadence** (monthly/quarterly/annual refresh windows)
- **High conversion potential** (commercial intent for "best X" and "X vs Y" queries)
- **Time-decay characteristics** ("2026" in the title goes stale on Dec 31)

Trend Discovery cannot find them because:
1. No signals in `external_signals` correspond to "evergreen demand"
2. Score model rewards `community_buzz` + `official_announcement` + `serp_volatility` — all near-zero for stable evergreens
3. Even with `min_trend_score = 25`, an evergreen with `search_volume = 50000/mo` scores ~5-10 (no buzz, no volatility, no announcement)

This is a **structural blind spot**, not a tuning problem.

## The Solution Vision

Add a parallel `EvergreenDiscoveryTopicSource` (mirrors the `TrendDiscoveryTopicSource` pattern from 54.5) that proactively identifies and schedules evergreen topics through three discovery modes:

**(A) Search-Volume-First Discovery**
- DataForSEO keyword-overview crawl for project-relevant seed keywords
- Find high-volume, low-difficulty keywords matching project's themes
- Emit briefs for those not yet covered (existing-coverage check from 54.5 reused)

**(B) Calendar-Driven Refresh Scheduling**
- Detect existing articles with year and or month-in-title (`* April 2025`, `* April2024`) approaching staleness
- Detect "best X" / "top X" / "guide" articles older than 90 days for refresh
- Detect cluster gaps for upcoming calendar moments (monthly "Beste KI", quarterly "Year in AI")
- Emit refresh briefs (`source='evergreen_refresh'`)

**(C) Programmatic SEO Patterns**
- Template-based discovery: "Beste {category} für {use_case}" combinations
- Lookup gaps in keyword × intent matrix (using project's intent taxonomy from 54.2)
- Emit briefs for unfilled cells (`source='evergreen_programmatic'`)

All three modes emit `TopicBrief` rows with `source` starting with `evergreen_*`, surfaced in the same UI tabs from 54.6 (or a new tab "Evergreen Opportunities").

## Architecture Sketch

### Three TopicSources, one orchestrator

```
EvergreenDiscoveryWorker (BullMQ, weekly cron — not daily)
  ├── SearchVolumeFirstSource.emit(input, ctx)
  │     Uses: DataForSEO keyword-overview, ranked-keywords
  │     Output: high-volume topics not yet covered
  │
  ├── CalendarRefreshSource.emit(input, ctx)
  │     Uses: articles + cluster scan, current date, project calendar config
  │     Output: refresh briefs for staling content + upcoming calendar moments
  │
  └── ProgrammaticPatternSource.emit(input, ctx)
        Uses: intent taxonomy × keyword templates × cluster coverage
        Output: programmatic SEO gap briefs
```

Why weekly (not daily): evergreen topics don't change at hourly speed. DataForSEO keyword data is expensive (~€0.02-0.05 per keyword overview). Weekly cadence keeps cost manageable while staying current enough for SEO opportunities.

### New TopicBrief sources

Extend the `topic_briefs.source` enum:

```sql
ALTER TABLE topic_briefs
  DROP CONSTRAINT topic_briefs_source_check;

ALTER TABLE topic_briefs
  ADD CONSTRAINT topic_briefs_source_check
  CHECK (source IN (
    'gap_analysis',
    'trend_discovery',
    'evergreen_volume',        -- NEW
    'evergreen_refresh',       -- NEW
    'evergreen_programmatic',  -- NEW
    'manual'
  ));
```

### TopicBrief metadata structure

Mirrors `trend_metadata` from 54.1:

```typescript
// For evergreen_volume
type EvergreenVolumeMetadata = {
  search_volume_monthly: number;
  keyword_difficulty: number;
  cpc_eur: number;
  related_keywords: string[];
  serp_features: string[];  // featured snippet, people-also-ask, etc.
  competitor_articles: { url: string; title: string; domain: string }[];
  evergreen_score: number;  // composite, see scoring section
};

// For evergreen_refresh
type EvergreenRefreshMetadata = {
  existing_article_id: string;
  current_title: string;
  staleness_reason: 'year_in_title_aging' | 'older_than_threshold' | 'calendar_moment';
  current_age_days: number;
  current_traffic_estimate?: number;  // if Search Console data available
  calendar_moment?: string;  // e.g., "Q4 2026 review", "Mai 2026 best-of"
  suggested_changes: string[];
};

// For evergreen_programmatic
type EvergreenProgrammaticMetadata = {
  pattern_template: string;  // e.g., "Beste {category} für {use_case}"
  pattern_variables: Record<string, string>;
  similar_existing_articles: string[];  // IDs of pattern-siblings
  intent_taxonomy_cell: { intent_type: string; cluster_id: string | null };
};
```

### Evergreen scoring model (different from trend score)

Trend score weights virality. Evergreen score weights **sustained value**:

| Component | Weight | Rationale |
|---|---|---|
| `search_volume` | 35 | Monthly search volume (log-normalized) — primary driver |
| `competition_gap` | 25 | Project's domain authority vs. SERP top-10 (lower competition = higher) |
| `commercial_intent` | 15 | CPC × search volume = expected click value |
| `topical_authority_fit` | 15 | Embedding similarity to project's strongest clusters |
| `freshness_opportunity` | 10 | For refresh: how stale; for new: serp churn over 6 months |
| `existing_coverage_penalty` | 30 | Same as trend, but threshold higher (0.92 instead of 0.85 — evergreens compete with each other more) |

The threshold for emission is `evergreen_score >= 50` (higher than trend's 25). Evergreens should be high-conviction; sloppy ones eat article budget.

### Calendar configuration per project

Project config gets a new `evergreen_calendar` section:

```typescript
// in TopicScopeSchema or new EvergreenConfigSchema
EvergreenCalendarSchema = z.object({
  enabled: z.boolean().default(true),
  refresh_age_threshold_days: z.number().int().default(180),  // half-year refresh
  year_in_title_grace_period_days: z.number().int().default(60),  // refresh "X 2025" articles 60 days before year-end
  recurring_moments: z.array(z.object({
    name: z.string(),                  // e.g., "Beste KI Monatsupdate"
    cadence: z.enum(["weekly", "monthly", "quarterly", "annually"]),
    first_occurrence: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),  // ISO date
    lead_time_days: z.number().int().default(14),  // emit brief 14 days before
    cluster_hint: z.string().optional(),  // suggest which cluster to attach to
  })).default([]),
  programmatic_patterns: z.array(z.object({
    template: z.string(),               // e.g., "Beste {category} für {use_case}"
    variables: z.record(z.string(), z.array(z.string())),  // {category: ["KI-Tools",...], use_case: ["Marketing",...]}
    target_cluster_id: z.string().uuid().optional(),
    max_combinations_per_run: z.number().int().default(5),  // throttle
  })).default([]),
});
```

This is project-configurable — toolwiki's calendar differs from a SaaS-tools site. Defaults are minimal; Marcel populates per-project.

### Integration with existing pipeline

Evergreen briefs flow through the **same** routing policy as trend briefs:
- `cluster_action='append_to_existing'` → routes through `/automate` (Phase A pipeline)
- `cluster_action='create_new'` → blocked until Cluster Creator (54.7) — same as trend `create_new`
- `cluster_action='refresh'` → uses refresh-mode article pipeline (depends on 54.8 Generator Modes)

Critical sequencing:
1. **54.7 Cluster Creator** is a hard prerequisite — without it, all `create_new` evergreen briefs are blocked (and the volume of `create_new` from evergreens is much higher than from trends because evergreens reach into uncovered SEO territory)
2. **54.8 Generator Modes** is needed for `evergreen_refresh` to actually generate refresh-mode articles (not full new articles)

So this spec lands **after** 54.7 and 54.8.

### UI extensions

Spec 54.6 built three tabs (Pending / Rejected / Signals). Evergreen Discovery adds either:

(a) **A fourth tab "Evergreen Opportunities"** with sub-tabs Volume / Refresh / Programmatic
(b) **Source filter on existing Pending tab** — show all pending briefs, filter by source

Both are valid. Recommendation: **(b)** for the immediate UI, **(a)** for 54.9's full UI redesign. Source filter is one chip in the existing list; new tabs require more component scaffolding.

Score breakdown component (`ScoreBreakdownChart.vue` from 54.6) needs a variant for evergreen scoring — different components, different weights. Either a polymorphic component or a parallel `EvergreenScoreBreakdownChart.vue`.

### Cost considerations

This is the spendiest of the three discovery types. Per-project per weekly run estimates:

| Operation | Cost | Volume per run |
|---|---|---|
| DataForSEO keyword-overview (search volume + difficulty) | €0.02 each | 20-50 keywords |
| DataForSEO ranked-keywords (find what we don't rank for) | €0.02 each | 5-10 calls |
| DataForSEO SERP (top-10 competitor scan) | €0.002 each | 10-20 calls |
| LLM evergreen synthesis (Opus, structured output) | ~€0.50 | 1 |
| LLM refresh detection (analyzing existing articles) | ~€0.30 | 1 |
| Voyage embeddings (similarity to existing) | ~€0.01 | 50-100 texts |
| **Total per project per weekly run** | **~€1.50-2.50** | |

For toolwiki: ~€6-10/month. Roughly 4-7× the trend discovery cost. Justified if it surfaces 2-4 high-value briefs/month.

### DataForSEO endpoints to use

Beyond the existing `serp()` and `trendsExplore()`, we need:

- `keywordOverview(keyword)` — search volume, difficulty, CPC, intent
- `keywordSuggestions(seedKeyword)` — discover related keywords
- `rankedKeywords(domain)` — what does the project's domain rank for?
- `competitorKeywords(competitorDomain)` — what do competitors rank for that we don't?

Each is its own DataForSEO API endpoint with its own pricing. Spec the wrapper functions in the same `@marketing-auto/adapter-dataforseo` package.

## Why This Matters (Business Case)

**Traffic potential**: The top evergreen AI queries in German get 5k-50k monthly searches each. A successful evergreen ranks for years, accumulating traffic. A single well-positioned "Beste KI-Tools 2026" article could outperform 20 trend-driven articles in lifetime traffic.

**Cost ratio**: At €1.50-2.50/run weekly, evergreen discovery costs ~€100/year per project. If it surfaces even one article/month that ranks (10% likely with proper scoring + content quality), that's ~€8/article for discovery. Cheaper than ahrefs subscription, more targeted.

**Defensive moat**: While Trend Discovery is reactive (everyone could chase the same trends), Evergreen Discovery is proactive — the project that systematically covers the keyword universe wins.

**Reduces drought periods**: Some weeks the signal pool from 54.4 is dry (no big launches, slow news week). Evergreen briefs fill the publishing pipeline during those weeks.

## What This Is NOT

- Not a replacement for Trend Discovery — both run in parallel
- Not a backlinks tool — purely organic SEO opportunity finder
- Not a SERP rank tracker (that's a separate future spec)
- Not auto-approving any briefs — same human-in-the-loop discipline as 54.5
- Not handling search-volume-data refresh — DataForSEO data has its own freshness; we re-query weekly
- Not multi-language search-volume aggregation in v1 — start with `topic_scope.languages` primary language only (German for toolwiki); EN coverage is a future expansion
- Not handling article-cannibalization detection — if a refresh brief is approved but the new article ends up competing with the old one for the same query, that's a 2nd-order issue (separate future spec)

## Decisions to Make Before Spec Finalization

When this is pulled from backlog to active development, these need user input:

1. **Per-project enablement**: Default on or off for new projects? (My instinct: off — needs explicit calendar/pattern config to be useful)
2. **Refresh trigger threshold**: 180 days, 90 days, configurable? (My instinct: 180 default, configurable)
3. **Year-in-title grace period**: 60 days before year-end, 90 days, configurable? (My instinct: 60 default)
4. **Max evergreen briefs per weekly run**: cap to avoid flooding? (My instinct: 5 per source × 3 sources = 15 max/week)
5. **Score weight tunability**: same as trend weights (POST-54-BACKLOG) — fixed for v1, config later?
6. **Skill usage**: which Claude Skills (programmatic-seo, ai-seo, content-strategy, marketing-ideas, copywriting) loaded for evergreen synthesis? (My instinct: programmatic-seo + site-architecture for `evergreen_programmatic`; content-strategy + marketing-ideas for the other two)
7. **Refresh vs new article distinction**: when a refresh brief is approved, should it create a new article that replaces the old, or modify the old article in place? (Depends on 54.8 Generator Modes design)

## Phase Sequencing

```
✅ Phase A (54.0-54.3) — Foundation
✅ Phase B (54.4-54.6) — Trend Discovery
⏳ Phase C (54.7-54.8) — Cluster Creator + Generator Modes
⏭️ Phase D (54.9)      — UI Refactor
─────────────────────────────────────
⏭️ Phase E (this spec) — Evergreen Topic Discovery
```

This is its own phase. Likely numbered 54.10 or 55.0 depending on whether Theme 54 is closed after 54.9 or extended.

## Implementation Order (when pulled from backlog)

**Session 1: DataForSEO adapter extensions + DB migration (~3h)**
- Extend `@marketing-auto/adapter-dataforseo` with keywordOverview, keywordSuggestions, rankedKeywords, competitorKeywords
- ALTER topic_briefs.source CHECK to include 3 new values
- Drizzle schema + types updated

**Session 2: EvergreenConfigSchema + project_configurations extension (~2h)**
- Extend project_configurations schema with `evergreen_calendar` JSONB
- Backward-compat via Zod defaults (no migration needed thanks to 54.5b's `loadActiveConfig.parse()` fix)
- Settings UI for calendar moments + programmatic patterns (or SQL-only in v1)

**Session 3: SearchVolumeFirstSource (~4h)**
- Implement TopicSource interface
- Seed-keyword expansion via DataForSEO
- Existing-coverage check (reuse from 54.5)
- Score computation
- Unit + integration tests

**Session 4: CalendarRefreshSource (~5h)**
- Year-in-title detection (regex on existing article titles)
- Age-based staleness detection
- Calendar-moment cron logic (lead-time + cadence handling)
- Refresh-specific brief metadata
- Tests

**Session 5: ProgrammaticPatternSource (~5h)**
- Template-variable combination engine
- Intent × cluster matrix gap detection
- Throttling logic (max_combinations_per_run)
- Tests

**Session 6: Evergreen scoring + orchestrator worker (~4h)**
- Score formula in score.ts (or new evergreen-score.ts)
- Weekly cron registration
- Three-source fan-out pattern (mirror 54.4's signal-collector)
- Cost-budget integration

**Session 7: UI integration + manual smoke test (~3h)**
- Source filter chip in TrendBriefList (or new Evergreen tab)
- EvergreenScoreBreakdownChart variant
- Smoke test on toolwiki with real data
- Polish

Total: ~26-28 hours, fits the 4-5 day estimate.

## Related Backlog Items (consolidate if pulled together)

This spec may consolidate or be informed by:
- "Per-source configuration in signal_sources" (already in POST-54-BACKLOG) — same project config pattern
- "Bulk DataForSEO Trends as signal source" — different use case, separate spec
- "Major-Lab Detection via Project Config" — similar config-driven pattern
- Programmatic SEO via Astro skill — overlap with `evergreen_programmatic` source; clarify boundary

## Sketch of First Real Use Case (toolwiki)

After implementation, a typical weekly run for toolwiki might produce:

```
Pending Evergreen Briefs (week of June 1, 2026):

1. [evergreen_volume] "Beste KI-Tools für Content-Marketing 2026"
   evergreen_score: 78
   search_volume_monthly: 8,100
   competition_gap: high (no existing strong competitor article)
   commercial_intent: 0.92 (CPC €4.20)
   cluster_action: append_to_existing → cluster: "AI Marketing Tools"

2. [evergreen_refresh] "Beste KI April 2025 → 2026"
   evergreen_score: 71
   existing_article_id: article-abc
   staleness_reason: year_in_title_aging (185 days old, year-end in 213 days)
   current_traffic_estimate: 1,200/mo
   cluster_action: refresh

3. [evergreen_programmatic] "Beste KI für Newsletter-Erstellung"
   evergreen_score: 64
   pattern_template: "Beste KI für {use_case}"
   pattern_variables: { use_case: "Newsletter-Erstellung" }
   similar_existing_articles: [article-def, article-ghi]
   cluster_action: append_to_existing → cluster: "Use-Case Roundups"
```

This is the kind of structured opportunity surfacing that makes the project compoundable over time.

---

**End of backlog spec. Move to active development after 54.7 and 54.8 land.**

## How to use this file

- **Adding an item**: number it B-NNN sequentially. Don't reuse numbers.
- **Updating an item**: bump `Last reviewed`. Add notes inline if state changed.
- **Activating an item**: write a Spec, link the spec from the backlog item, then remove the item from this file. The spec history captures the reasoning.
- **Archiving an item**: change status to `archived`, add 1-line reason. Keep in this file for context (don't delete).
- **Quarterly review**: scan the file, ensure each `parked` item still makes sense. Update `Last reviewed`.
