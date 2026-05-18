# Toolwiki Master Backlog

**Last updated:** 2026-05-18 (post Theme 58 + Backlog Reality Check + Article Generator Paths mini-discovery)

**Sources used:**
- `backlog-reality-check.md` (full discovery, 60-90 min runtime)
- `article-generator-paths.md` (mini-discovery, ~5 min runtime)
- Spec memories from Themes 54-58
- Marcel-confirmed Backlog priorities (Tier 3 → Tier 2 → Tier 1)

**Sortierung:** Active → Tier 1 → Tier 2 → Tier 3 → Smart-Deferred → Icebox → Discovered

---

## 🔥 Active Work

| Item | Status | Effort | Notes |
|------|--------|--------|-------|
| (none) | All Theme 58 specs implemented | — | Ready for Tier 3 |

---

## ✅ Verified Done (removed from prior backlog)

Items that the Reality Check or mini-discovery confirmed already implemented:

| Item | Where implemented | Verified by |
|------|-------------------|-------------|
| `articles.lastRefreshedAt` column | Spec 58.1, migration 0052 | Reality Check |
| Auto-refresh detection (LLM quality) | Spec 58.1, worker `article-quality-analysis` | Reality Check |
| Re-render UI flow for social posts | Spec 58.2 | Implementation reports |
| Cold-Start Backend (11 endpoints) | `apps/api/src/routes/cold-start.ts` (518 lines) | Reality Check 3.2 |
| Render duration metrics (timestamps) | Spec 57.2, columns + worker writes | Reality Check 3.3 |
| `/automate` for missing_spoke_type + cluster_too_small | Spec 49d | Reality Check 2.5 |
| `missing_hub` automation (via cornerstone spec workflow) | Different mechanism than chains | Reality Check 2.5 |
| `missing_translation` automation (via translation auto-trigger) | Different mechanism than chains | Reality Check 2.5 |
| Article Discovery post-draft timing | Correct by design (`DraftPipeline.afterComplete`) | Reality Check 2.6 |
| Per-source `min_signal_thresholds` config | `fetch-signals.ts` config-driven | Reality Check 4.4 |
| Activity Summary endpoint | Spec 56.5 Dim 5 | Reality Check 5.3 |
| Articles Count endpoint (backend) | Spec 56.5 Dim 5 (UI wiring open) | Reality Check 5.3 |
| RefreshQueuePage.vue | Spec 56.6 Section E | Conversation history |

---

## 🟢 Tier 3 — Pre-Theme-59 (Active sequence)

Order is recommended; Marcel can reorder.

### Cluster C — Signal Source Adapters (Quick Win)

**Reddit + GitHub Trending Adapters** — ~2 d
- **Status:** Schema slots reserved (`packages/db/src/schema/content.ts:682,890`), config block exists in `project-config.ts:80–85`, NO adapter implementation in `packages/adapters/`, NOT in signal collector enum
- **Scope:** Reddit adapter (PRAW or Pushshift), GitHub Trending adapter (gharchive or scraping)
- **Reality Check section:** 2.1

### Cluster D — Locale Completeness

**Bidirectional translation EN → DE** — ~3-4 d
- **Status:** Translation pipeline is entirely hardcoded DE → EN. Setup, body, decision steps all assume German source.
- **Scope:** Parameterize source/target locale throughout pipeline, add EN→DE prompt variants for decision step
- **Reality Check section:** 2.2

### Cluster B — Social Templates (deine Reihenfolge: news → concept-explainer → pro-con)

| Template | Effort | Notes |
|----------|--------|-------|
| **news-slide** | 3-5 d | Type slot reserved, commented out in bootstrap.ts line 18, no implementation files |
| **concept-explainer-deck** | 3-5 d | Same status; mentioned in `llmEnrichment.ts:19` for ki-wissen articles |
| **pro-con-verdict** | 3-5 d | Same status |

- **Status:** All three in `TemplateKey` union (`packages/social/src/templates/types.ts:23-26`), commented out in `bootstrap.ts`, no composition/eligibility/override files
- **Per template needs:** composition code, eligibility function, hook generator, override schema, Remotion component
- **Reality Check section:** 2.3

### Cluster A — Article Content Variants (MASSIVELY REDUCED)

**Original estimate:** 10-15 d (3-5 d each for 3 dedicated generators)
**Verified estimate:** **1-3 d total** (prompt-variant improvements)

Per mini-discovery: there are no separate pipelines. All three content types route through the **same blog pipeline** with intentType-conditional prompt sections in `DraftStep`.

**Single spec covers all three:** "DraftStep prompt enhancement for intent-type structure"
- ~1-2 d total
- Modifies `DraftStep` prompt with better intentType-aware structural guidance
- Optional: also enhance `OutlineStep` prompt
- No new step classes, no new pipeline files, no new queue registrations
- Reference: `author-picker/step.ts:53` notes future spec "54.9b" for proper comparison routing — could be addressed inline

**OR keep as 3 small sequential specs** if you want per-type clarity:
- Comparison prompt enhancement (~1 d)
- Use-case prompt enhancement (~1 d)
- ki-wissen prompt enhancement (~1 d)

Recommendation: **single combined spec** for efficiency. They share the same surface (DraftStep prompt).

### Cluster F — Polish / Quick Wins

**Phase 2 LOW-priority overrides** — 2 d
- Cosmetic section labels (`strengthsEyebrow`, `winnerLabel`, `overallResultLabel` etc.)
- Template Override Editor extension
- Low urgency; merge when next touching Settings UI

**Bulk Operations for Trends + Gaps** — 0.5 d each (1 d total)
- Briefs bulk already done (per Reality Check 2.4 — `briefs.ts:136,208`)
- Gaps need bulk-approve/dismiss
- Trends need bulk-approve/dismiss
- Reuse Briefs pattern (`BulkApproveModal.vue` reference)
- Reality Check section: 2.4

**Tier 3 Total: ~14-20 d** (DOWN from estimated ~30-40 d after Article Generators reduction)

---

## 🟢 Tier 2 — Theme 59 (Content Planner / Automation)

The big goal. Sub-specs unclear, requires Discovery prompt before specs.

| Item | Notes |
|------|-------|
| **Theme 59 Discovery prompt** | First step — what's the automation surface? What triggers? |
| **Trends Auto-Approval** | Sub-spec; auto-approve trends above threshold |
| **Auto-cluster-trigger** | Sub-spec; trigger TBD per Marcel (volume/cron/user — to be clarified in spec) |
| **Pre-generation discovery** | Tech Debt #10 — move discovery before draft so signals can influence generation |
| **Tech Debt #3 follow-up** | `missing_hub` + `missing_translation` automation is implemented via OTHER mechanisms (Reality Check 2.5) — verify they suffice for automated flows |
| **Cron coordination + state management** | Built on existing `cron_state` table (56.6 foundation) |

**Tier 2 estimated: ~15-25 d**

---

## 🟢 Tier 1 — Automation Foundation Hardening (post-Theme-59)

Resilience for unattended automation. **Reduced** based on Reality Check findings.

| Item | Effort | Status / Notes |
|------|--------|---------------|
| **Stalled render reconciliation** | 30 min | BullMQ stall detection set, but no app-level reset for `renderStatus='rendering'` after worker crash. Reality Check 3.3 + recommendation 1. |
| **`rejected_topic_candidates` physical prune** | 30 min | Expiry is 30 days (not 90); query filter works but no DELETE. Add to trend-synthesizer janitor. Reality Check 4.3. |
| **Worker process recycling** (`maxJobsPerWorker`) | 1 d | No implementation; low urgency since workers restartable via `worker:restart`. Reality Check 3.3. |
| **Pipeline completion push notifications** | ~1 d | **Infrastructure fully built** (`packages/core/src/notifications/`, `apps/api/src/routes/notifications.ts`, VAPID, push-subscriptions). Only wiring missing — connect `Worker.on('completed')` for `article:blog` + `social-render`. Reality Check 3.3 + recommendation 4. |
| **`maxAgeDays` per-source config** | 0.5 d | `min_signal_thresholds` is config-driven, but `maxAgeDays` is not. Add to `project_configurations.signal_sources`. Reality Check 4.4. |

**Render duration metrics** — **REMOVED** (already done per Reality Check 3.3).

**Tier 1 Total: ~3-4 d** (DOWN from estimated 5-8 d)

---

## 🟡 Smart-Deferred (Clear Trigger, Wait for Signal)

| Item | Effort | Trigger Condition | Status |
|------|--------|-------------------|--------|
| **Adjustable trend score weights via project config** | 2 h | Multi-project SaaS phase OR weights need tuning | Hardcoded constants in `score.ts:10–18` |
| **Bulk DataForSEO Trends as signal source** | 1 d | Daily signal collection cost exceeds budget OR 5+ projects | `trendsExplore` per-topic only; `dataforseo_trends` enum reserved but unused |
| **Per-article overrides** (3-tier template override merge) | 3-4 d | When per-project overrides too coarse | Spec 57.3 deferred this |

---

## 🔵 Icebox (Second Project Trigger)

| Item | Status |
|------|--------|
| **`projects.social_auto_render_locales` wire-up** | Column stored (migration 0048) but "currently unused" per migration comment. Wire into pipeline trigger when automated multi-locale rendering needed. Reality Check 5.1. |
| **LLM-driven brand-token seeding endpoint** | Migration script suffices for single-project; endpoint adds value for multi-project |

---

## ⚠️ Verification + Schema Decisions Confirmed

| Item | Decision |
|------|----------|
| **`clusters.satellite_keywords`** | ✅ **KEEP** — actively read for Astro-imported clusters and Cold-Start phase 3 + 5. NOT fossil. Reality Check 1.1. |
| **`content_gaps` table** | ✅ **KEEP** — heavily active, SSoT for gap lifecycle. NOT a duplicate of topic_briefs (which is SSoT for content). Reality Check 1.2. |

Both Backlog "deprecation candidate" items confirmed **active and needed**. Remove from any "schema cleanup" list.

---

## 🆕 Discovered During Reality Check (Add to Backlog)

| Item | Effort | Notes |
|------|--------|-------|
| **`projects/search.ts` document spec coverage** | 30 min docs | Cross-entity search endpoint exists with no spec reference. Likely from 56.x; verify or add to docs. Reality Check 5.3. |
| **`projects.social_auto_render_locales` wire-up** | 1-2 d | (Moved to Icebox above — multi-project trigger) |
| **Quality analysis results UI verification** | 30 min docs | RefreshQueuePage may show quality suggestions already; verify it does. Reality Check Summary. |

---

## 🚫 Streichen / Confirmed Obsolete

| Item | Reason |
|------|--------|
| **Pillars-as-a-view** | Marcel doesn't remember the pain; if it ever was a real need it would have re-emerged |
| **Manual hub-topic entry im Cluster Creator** | Automation antithesis; auto-cluster-trigger (Theme 59) makes this obsolete |
| **Author-picker pillar-level fallback** | Auto-pick in automation flow makes this obsolete |
| **Auto-approve banner in Cluster Detail** | Cosmetic; if auto-approve becomes default, banner becomes obsolete |
| **Stats row in Refresh Queue** | Cosmetic; nice-to-have, not blocker |
| **Render progress events + UI progress bar** | Polish; 10-30s + spinner sufficient per 57.2 Open Q4 decision |
| **Tech Debt #3 (as originally formulated)** | `missing_hub` + `missing_translation` ARE automated, just via different mechanisms than chains. Reality Check 2.5. |

---

## 📐 Updated Roadmap (Total Effort)

```
Tier 3 Active:    ~14-20 d  (DOWN from 30-40 d)
Tier 2 Theme 59:  ~15-25 d  (unchanged — needs Discovery first)
Tier 1 Hardening: ~3-4 d    (DOWN from 5-8 d)
──────────────────────────
Total Aktive Roadmap: ~32-49 d (6-10 Wochen, DOWN from ~50-73 d)
```

**That's ~18-24 fewer days** than the previous backlog estimate, primarily because:
- Cold-Start Backend (7-10 d) — already done
- Article Generators (10-15 d → 1-3 d) — prompt variants, not separate pipelines
- Render duration metrics (2 d) — already done
- Push Notification scope reduced (4-5 d → 1 d) — infrastructure exists

---

## 📌 Recommended Next Move

Based on Reality Check Recommendation 1: **the highest-confidence quick win** is stalled-render startup reconciliation (30 min). Combine with `rejected_topic_candidates` prune (30 min) and Trends + Gaps bulk operations (1 d) for a **~1-day micro-spec** of "Backlog cleanup quick wins" before starting Cluster C (Adapters, 2 d).

**Alternative**: Skip the micro-spec, go directly to **Cluster C (54.4b Reddit + GitHub Adapters)** as planned. The 30-min items can piggyback on later touchpoints.

---

## 🛠️ Cross-Spec Engineering Patterns

Reference from 54-Backlog (kept for grep-ability):

### Strict TypeScript
- `exactOptionalPropertyTypes` + optional params: conditional spread `...(v !== undefined && { value: v })`
- Zod → Drizzle insert: strip undefined, cast to `$inferInsert`
- `metrics`/JSONB columns with `.$type<X>()` — no caller-side cast needed

### Codebase navigation
- BullMQ workers: `apps/api/src/workers/`
- BullMQ queues: `packages/pipelines/src/engine/` (cross-workspace pattern)
- Adapter packages: `packages/adapters/<name>/` with `src/{index,client,verify}.ts`
- Env vars: via `packages/shared/src/config.ts` + `getEnv()`
- DB helpers: `packages/db/src/helpers/<entity>-{read,write}.ts` split (NOT `repos/`)

### Schema evolution
- `.default()` on new Zod fields: backward-compat only if callers use `.parse()`
- Adapter input schema changes: grep all callers (`.fetch(`, `.emit(`)
- Tenant-scoped tables: `project_id` direct, even on child tables with FK to articles
- FK constraints: raw SQL migration, not Drizzle `references()`

### Patterns from Theme 57/58
- `jsonMode: true` banned for `claude-sonnet-4-6` — use `systemSuffix` + `raw.indexOf("{")` extraction
- Re-enqueue: timestamp-based jobId (`rerender-${id}-${Date.now()}`) bypasses BullMQ dedup
- `renderInput` snapshot in JSONB at INSERT time; re-render reads snapshot + fresh tokens
- `jsonb_set(content, '{slides}', '[]'::jsonb)` for partial JSONB updates
- BullMQ dual-shape queues: Zod discriminated union + `safeParse()` discrimination
- Single `JobData` union + separate `PerJobData` for cross-shape queues
- Inline `.set()` for `lastRefreshedAt` when call-site builds update (atomic)
- Helper functions for standalone updates only

### Custom Errors
- Never `kind` or `cause` as property names (ES2022 reserved) — use `<errorType>Kind`

### Tests
- Mixed-source fixtures always (multiple `source`, `approval_status` values)
- `onConflictDoUpdate.targetWhere` must match partial unique index `WHERE` byte-exactly

---

## 📝 Maintenance Notes

- **When a spec lands:** Move from Active → Verified Done (delete from active sections)
- **When trigger conditions are met:** Promote from Smart-Deferred → Active
- **Verification items:** Run grep, document findings, then decide
- **Total effort estimates:** Indicative only; actual implementation will reveal deviations (per established pattern)

---

## Summary Stats

- **Active**: 0 specs (Theme 58 complete, awaiting next spec)
- **Tier 3 Active sequence**: 5 clusters, ~14-20 d
- **Tier 2 (Theme 59)**: ~15-25 d, needs Discovery
- **Tier 1 Hardening**: 5 items, ~3-4 d
- **Smart-Deferred**: 3 items
- **Icebox**: 2 items
- **Confirmed Obsolete**: 7 items (streichen!)
- **Total realistic roadmap**: ~32-49 d (was ~50-73 d before Reality Check)
