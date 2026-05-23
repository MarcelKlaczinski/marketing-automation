# Spec L9 — RefreshQueuePage (Retrospective Doc-Coverage)

_Backfill-spec: existing code, documented after the fact._
_Status: Documented._
_Aufwand: 15 min._

---

## 1. Was tut die Komponente

Project-scoped page that surfaces two refresh signals side-by-side — **Quality Suggestions** (LLM-detected staleness from `refresh_suggestions`) and **Time-based Candidates** (date-driven staleness from a live join). Lets Marcel manually run detection, bulk-analyze all articles, trigger a refresh per item, dismiss, or mark already-refreshed. Cron status indicator in the header shows whether the daily detection job is on plus the last fire time.

---

## 2. API / Props / State-Machine

### File location
- [apps/web/src/pages/refresh/RefreshQueuePage.vue](apps/web/src/pages/refresh/RefreshQueuePage.vue)
- Route: `/projects/:slug/refresh-queue` (name `refresh-queue`), registered at [apps/web/src/router/index.ts:184](apps/web/src/router/index.ts:184)

### Public surface
- Vue Options API page component — no Props / Emits / Slots
- Two composable spreads in `setup()`:
  - [useRefreshCandidates.ts](apps/web/src/composables/useRefreshCandidates.ts) → `candidates`, `hasMore`, `isLoading`, `isFetchingMore`, `loadMore`, `triggerRefresh`, `dismissCandidate` (TanStack `useInfiniteQuery`, paginated by cursor, page size 20)
  - [useRefreshSuggestions.ts](apps/web/src/composables/useRefreshSuggestions.ts) → `suggestions`, `isLoading`, `dismissSuggestion`, `markRefreshed` (TanStack `useQuery`, single page)

### Internal state (data())
- `detecting`, `analyzing` — button-loading flags for header CTAs
- `cronActive`, `cronLastRunAt`, `manualLastDetectedAt` — cron status header
- `refreshingArticleIds[]`, `analyzingArticleIds[]` — per-row loading flags for suggestion cards
- `findingsModal: { open, articleTitle, findings }` — modal state for Quality Findings drill-down

### API calls (page-level + composable-level)
- `GET /projects/:slug/refresh-detection/status` — cron header (lines 209–220)
- `POST /projects/:slug/refresh-detection/run` — manual trigger
- `POST /projects/:slug/articles/quality-analysis` — bulk (empty body = all articles) or per-article (`{ articleIds: [id] }`); response `{ enqueued, estimatedCostEur, jobIds }`
- Composables hit: `/refresh-candidates` (list + cursor), `/refresh-candidates/:id/{trigger,dismiss}`, `/refresh-suggestions` (list), `/refresh-suggestions/:id` DELETE, `/articles/:id/mark-refreshed`

### DB tables touched (via API → backend)
- `refresh_suggestions`, `refresh_dismissed` (see [packages/db/src/schema/refresh.ts](packages/db/src/schema/refresh.ts))
- `articles` (read for staleness join + write for `lastRefreshedAt`)
- `pipeline_runs` (`article:refresh` trigger inserts via `triggerWithPreRunId`)

---

## 3. State-Machine / Flow

`mounted` → `loadCronStatus()` (non-critical; failures swallowed). User actions are all fire-and-toast: each method sets a row/button loading flag, awaits the composable mutation (which invalidates the relevant TanStack query), then surfaces `positive` / `negative` Quasar notifications. The infinite-query `loadMore` button only renders when the latest page's `hasMore === true`. Findings modal opens via `onViewFindings(suggestion)` and only when `suggestion.qualityFindings !== null`.

---

## 4. Design Decisions & Trade-offs

- **Two composables spread into `setup()`** — both expose `isLoading`; the collision is intentionally disambiguated via a `suggestionsLoading` computed at [RefreshQueuePage.vue:199](apps/web/src/pages/refresh/RefreshQueuePage.vue:199) (see web/CLAUDE.md spread-collision footgun from Spec 58.1). Renaming would touch two composables for one page — accepted as a local fix.
- **Per-row loading via `refreshingArticleIds[]` / `analyzingArticleIds[]`** — plain arrays with `push` + `filter`, not `Set`, because Vue 3 reactivity on arrays via index/length is reliable while `Set.add()` requires the replace-and-assign dance (web/CLAUDE.md Set/Map gotcha). Per-card boolean would also work but would force a prop on every card.
- **Cron status is mount-time only** — no polling. Marcel toggles cron in Settings (separate page) so stale header in this tab is acceptable; full refresh on re-navigation.
- **Quality section first, time-based second** — quality findings are higher-signal (LLM-graded) and the section header carries an explicit description; time-based is the broader sweep.

---

## 5. Known Gotchas / Footguns

- **`AnalyzeAllResponse` payload partially discarded** — `estimatedCostEur` and `jobIds` are captured into the type but never surfaced in the notification (only `enqueued` is shown). Matches the apps/web/CLAUDE.md guidance to capture multi-result responses, but the cost number is silently dropped.
- **`onMarkRefreshed` invalidates BOTH `refresh-suggestions` AND `refresh-candidates`** (see [useRefreshSuggestions.ts:60](apps/web/src/composables/useRefreshSuggestions.ts:60)) — a freshly refreshed article must disappear from both lists.
- **Cron label fallback chain** — `manualLastDetectedAt ?? cronLastRunAt ?? "never"` (line 193). Manual trigger takes precedence so the user sees their own last action first.
- **The `suggestionsLoading` cast** at line 200 (`this as unknown as ReturnType<typeof useRefreshSuggestions>`) is intentional — the spread-merge loses TypeScript discrimination between the two `isLoading` refs.

---

## 6. Multi-Domain Refactor — Out of Scope

- **Project-scoping via `useProjectStore().currentSlug` + URL templates** likely shifts during Sprint 3 (Categories). The `/projects/:slug/...` API shape is not documented in detail here.
- **i18n keys under `refresh.*`** may consolidate into a workspace package during Sprint 2 — namespace structure not enumerated here.
- **Quality-Findings JSON shape** (currently typed in `packages/db/src/schema/refresh.ts` AND mirrored in `useRefreshSuggestions.ts`) is a candidate for migration into `@marketing-auto/content-schema` in Sprint 2.

---

## 7. References

- DB tables: `refresh_suggestions`, `refresh_dismissed`, `refresh_suggestion_source` enum
- Backend route file: [apps/api/src/routes/projects/refresh.ts](apps/api/src/routes/projects/refresh.ts) (9 endpoints; mounted at `/api/projects` via `app.route("/api/projects", projectRefreshRoutes)`)
- Backend worker: [apps/api/src/workers/refresh-detector.ts](apps/api/src/workers/refresh-detector.ts) (writes `refresh_suggestions` on cron + manual run)
- Related specs: 58.1 (spread-collision footgun), 56.6 (refresh-queue route registration comment), E.1a (`refresh_suggestions` schema)
- Cross-spec patterns: TanStack `invalidateQueries` after mutations; D1 Vue Options API exclusivity
