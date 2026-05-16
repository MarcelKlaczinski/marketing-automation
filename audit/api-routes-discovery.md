# API Routes Discovery for Spec 54.11 (UI Refactor)

**Date:** 2026-05-16
**Phase:** Pre-Spec-54.11
**Scope:** Marketing-Automation Platform repo
**Status:** Read-only inspection — no code changes, no DB writes
**Output:** `audit/api-routes-inventory.md`

---

## Goal

Catalog every HTTP API route in the marketing-automation-platform backend, with metadata sufficient to design the new UI (Spec 54.11) on top. The UI will be a multi-pane, dark-mode, glassmorphism-styled dashboard focused on pipeline orchestration — so routes need to be categorized by their UI role.

Additionally: identify **missing routes** that the new UI will require but don't yet exist. These need to be added during Spec 54.11 implementation alongside the UI work.

This is **NOT** a code review or refactoring task. The goal is **observation + categorization**.

---

## Section 1: Complete Route Inventory

Inspect:
- `apps/api/src/server.ts` (route registration)
- `apps/api/src/routes/` (all route files)
- `apps/api/src/routes/projects/` (nested project-scoped routes)
- `apps/api/src/lib/` for any inline route handlers

**For each route, document:**

| Field | Description |
|---|---|
| `path` | Full HTTP path (e.g. `/api/projects/:slug/articles/:id/refresh`) |
| `method` | GET / POST / PATCH / DELETE / PUT |
| `auth` | Required auth level (none / session / admin) |
| `inputSchema` | Brief description of request body or query params |
| `outputSchema` | Brief description of response shape |
| `projectScoped` | Yes/No — is project context required? |
| `fileLocation` | `apps/api/src/routes/<file>.ts:<line>` |
| `category` | One of: `auth`, `project`, `pipeline-trigger`, `pipeline-state`, `article`, `cluster`, `brief`, `cost`, `cold-start`, `admin`, `webhook`, `other` |
| `uiPresence` | "current-ui" / "no-ui" / "partial-ui" — is this route surfaced in the existing Vue UI? |

**Output format:** Markdown table, sortable by category.

**SQL/file inspection commands:**

```bash
cd <repo_root>

# Find all route registrations
grep -rn "app\.route\|router\.route\|\.get(\|\.post(\|\.patch(\|\.delete(" apps/api/src/server.ts | head -30

# Find all route files
ls -la apps/api/src/routes/
ls -la apps/api/src/routes/projects/ 2>/dev/null

# For each route file, find the actual endpoints
for f in apps/api/src/routes/*.ts apps/api/src/routes/projects/*.ts 2>/dev/null; do
  echo "=== $f ==="
  grep -n "^\s*\(app\|router\|\.get\|\.post\|\.patch\|\.delete\|\.put\)" "$f" | head -10
done
```

Also check for routes in:
- `apps/api/src/routes/cold-start.ts`
- `apps/api/src/routes/clusters.ts`
- `apps/api/src/routes/cornerstone-specs.ts`
- `apps/api/src/routes/cost.ts`
- `apps/api/src/routes/brand-tokens.ts`
- `apps/api/src/routes/articles.ts`
- `apps/api/src/routes/auth.ts`
- `apps/api/src/routes/trends.ts`
- `apps/api/src/routes/projects/clusters.ts`
- Other route files in the projects/ subdirectory

For routes that accept request bodies, peek at the Zod schema imported or inline-defined in the handler to capture the input shape.

---

## Section 2: Route → UI Need Mapping

For each route in Section 1, **classify which UI surface should expose it**:

| UI Surface | Description | Examples |
|---|---|---|
| `nav` | Top-level navigation entry | `/projects`, `/settings`, `/costs` |
| `project-selector` | Project switcher in nav | `GET /projects` |
| `dashboard` | Main pipeline orchestration view | Pipeline status, recent activity |
| `clusters-list` | List view of clusters per project | `GET /projects/:slug/clusters` |
| `cluster-detail` | Detail view of one cluster | Hub + spokes, generation status |
| `articles-list` | List of articles per project | `GET /projects/:slug/articles` |
| `article-detail` | One article view | body_md preview, status, costs |
| `briefs-list` | Trend/gap briefs list | Approvable briefs |
| `brief-detail` | One brief detail | Pre-cluster-creator view |
| `pipeline-runs-list` | All recent pipeline runs | Activity feed source |
| `pipeline-run-detail` | One pipeline run | Errors, retries, cost breakdown |
| `cost-dashboard` | Cost analytics | Already exists per audit |
| `settings` | Project + system settings | Brand tokens, target locales |
| `cold-start-flow` | Project onboarding wizard | Voice, competitors, clusters |
| `triggered-action` | Action-only route (button click) | Approve, retry, cancel |
| `internal-only` | Webhook or background process | No UI exposure |

**Decision rule for `triggered-action` vs `dashboard`**:
- If route is called once on button click and returns success/failure → `triggered-action`
- If route returns data that's continuously displayed → `dashboard` or specific surface

**Output format**: Add a `uiSurface` column to the table from Section 1.

---

## Section 3: Missing Routes for New Dashboard Vision

The new UI (Spec 54.11) focuses on **pipeline orchestration**:
- Live activity feed of running/queued pipelines
- Pipeline-Kanban view (Queued/Running/Failed/Completed columns)
- Cluster-level generation status (after Spec 54.12)
- Failure inspection with retry capability
- Multi-pane layout (Linear-style)

**Question:** Which capabilities does the dashboard need that have NO existing route?

For each capability below, check if a corresponding route exists. If not, propose the route signature.

### 3.1 Live Activity Feed

UI needs: list of pipeline runs (running + recently completed), sorted by recency, with status, article title, project, cost, duration.

**Check:**
- Is there `GET /api/pipeline-runs?status=running` or similar?
- Is there cross-project pipeline_runs query for global view?
- Is there filtering by status, source, time window?

**Propose if missing:**
```
GET /api/pipeline-runs
  ?status=running|queued|failed|completed
  ?projectId=<uuid>
  ?source=blog|refresh|translation|cluster-plan
  ?since=ISO-timestamp
  ?limit=50
  →  Array<PipelineRunSummary>
```

### 3.2 Pipeline Run Detail (with steps + errors)

UI needs: drill into one pipeline run. See step-by-step progression, each step's cost, error message if failed, input/output for debugging.

**Check:**
- Is there `GET /api/pipeline-runs/:id` with full detail?
- Does it include `step_runs` JSONB expanded?
- Does it include linked `cost_logs` for this run?
- Does it include the `article_id` if linked?

**Propose if missing:**
```
GET /api/pipeline-runs/:id
  → {
      run: PipelineRun,
      steps: Array<StepRun>,
      costs: Array<CostLog>,
      article: Article | null,
      brief: TopicBrief | null,
    }
```

### 3.3 Retry Failed Pipeline Run

UI needs: button on failed run that re-enqueues with same input.

**Check:**
- Is there `POST /api/pipeline-runs/:id/retry`?
- Does it work for any pipeline type or only specific ones?

**Propose if missing:**
```
POST /api/pipeline-runs/:id/retry
  → { newRunId, status: "queued" }
```

### 3.4 Cancel Running Pipeline

UI needs: button to cancel in-progress pipeline (e.g. wrong brief, want to stop).

**Check:**
- Is there `DELETE /api/pipeline-runs/:id` or `POST /:id/cancel`?
- Does BullMQ allow safe cancellation mid-flight?

**Propose if missing:**
```
POST /api/pipeline-runs/:id/cancel
  → { status: "cancelled", refundedCostEur: number }
```

### 3.5 Cluster Generation Status (after Spec 54.12)

UI needs: cluster-level status (running/partial/completed/failed) with article-level drill-down. Comes from Spec 54.12 Section D.

**Check:**
- After 54.12 is implemented: `GET /api/projects/:slug/clusters/:id/generation-status`?
- Does it return aggregate (count of articles by status)?

**Propose if missing:**
```
GET /api/projects/:slug/clusters/:id/generation-status
  → {
      cluster: { id, name, generationStatus },
      articles: Array<{ id, role, status, locale, ... }>,
      pipelineRuns: Array<{ id, status, currentStep }>,
      costEur: number,
      progressPercent: number,
    }
```

### 3.6 Search Across Articles + Briefs

UI needs: search bar in nav. Type "ChatGPT" → see all articles + briefs containing this.

**Check:**
- Is there `GET /api/search?q=<query>&projectId=<id>`?
- Full-text search index on articles.body_md or title?

**Propose if missing:**
```
GET /api/projects/:slug/search?q=<query>&types=articles,briefs,clusters
  → {
      articles: Array<ArticleMatch>,
      briefs: Array<BriefMatch>,
      clusters: Array<ClusterMatch>,
    }
```

Implementation could use PostgreSQL `tsvector` or simple `ILIKE`. Decision in Spec 54.11.

### 3.7 Bulk Actions

UI needs: select multiple briefs/articles, apply action (approve all, reject all, retry all).

**Check:**
- Are there bulk endpoints for any entity?

**Propose if missing:**
```
POST /api/projects/:slug/briefs/bulk-approve
  Body: { briefIds: string[] }
  → { approved: number, failed: Array<{ id, reason }> }

POST /api/pipeline-runs/bulk-retry
  Body: { runIds: string[] }
  → { retried: number, failed: Array<{ id, reason }> }
```

### 3.8 Real-time Updates (WebSocket or SSE)

UI needs: live updates without polling. Pipeline status changes → UI animates immediately.

**Check:**
- Is there existing WebSocket setup in `apps/api/src/`?
- Any Server-Sent-Events endpoint?

**Propose if missing:**
```
GET /api/projects/:slug/events?since=ISO
  → SSE stream of events:
      { type: "pipeline.started", runId, articleId, ... }
      { type: "pipeline.step.completed", runId, step, costEur }
      { type: "pipeline.completed", runId, articleId }
      { type: "pipeline.failed", runId, error }
      { type: "cluster.status.changed", clusterId, newStatus }
```

Alternative: WebSocket on `/ws/projects/:slug`. Decision in Spec 54.11.

### 3.9 Cost Aggregations for Dashboard

UI needs: small widgets in dashboard showing "Cost today: €X, This week: €Y, This month: €Z".

**Check:**
- Existing `cost.ts` has dashboard endpoint?
- Does it support time-window queries?

**Propose if missing:**
```
GET /api/projects/:slug/cost-summary?window=today|week|month
  → {
      windowStart, windowEnd,
      totalEur, articleCount, pipelineRunCount,
      byOperation: Record<string, number>,
      byService: Record<string, number>,
      trend: Array<{ date, costEur }>,
    }
```

### 3.10 Project Switch / List

UI needs: project selector in nav. Dropdown of available projects.

**Check:**
- Existing `GET /api/projects`?
- Returns just IDs+names or full data?

**Propose if missing or insufficient:**
```
GET /api/projects/picker
  → Array<{
      id, slug, name, industry,
      generationStatus: { runningCount, queuedCount, failedCount },
      costThisMonth: number,
    }>
```

This is dashboard-aware project list — shows at-a-glance which projects have activity.

---

## Section 4: Categorization Summary

After Sections 1-3, produce a summary table:

```
ROUTE INVENTORY SUMMARY
=======================

Total routes: N
By category:
  auth: N
  project: N
  pipeline-trigger: N
  pipeline-state: N
  article: N
  cluster: N
  brief: N
  cost: N
  cold-start: N
  admin: N
  webhook: N
  other: N

By UI presence:
  current-ui: N (in existing Vue UI)
  no-ui: N (backend-only, no Vue surface)
  partial-ui: N (some aspects shown)

Missing routes for Spec 54.11:
  - <list from Section 3 with "PROPOSE" status>
  
Routes that might be obsolete (consider deprecation):
  - <routes flagged during inspection as unused or redundant>
```

---

## Section 5: Open Questions for Spec 54.11

Things observed during inspection that affect UI design decisions:

- Are routes consistently project-scoped via `/projects/:slug/...` or some via `?projectId=...` query? Consistency matters for routing.
- Are there auth-level inconsistencies? (some admin routes accidentally open, some user-routes admin-locked)
- Are pagination patterns consistent? (cursor-based vs offset-based)
- Are error responses consistent? (always JSON, always `{ error, message }` shape)
- Does the API expose `OpenAPI` / Swagger documentation that the UI could generate types from?

These don't block Spec 54.11 but inform whether 54.11 should include a "API Consistency" cleanup sub-section.

---

## Constraints

- **Read-only**: no code changes, no DB writes
- **Empirical**: cite file paths + line numbers where routes are defined
- **Comprehensive**: every route exposed via `app.route(...)` or `app.get/post/...` should be in the inventory
- **Categorize, don't optimize**: classify routes by purpose, don't propose refactorings
- **Propose, don't implement**: missing routes get **proposed signatures** with rationale, no code

## Output Location

Save inventory as `audit/api-routes-inventory.md` in the marketing-automation-platform repo. Format:

```markdown
# API Routes Inventory

[Generated 2026-05-16]

## Section 1: Complete Route Inventory

| Path | Method | Auth | Category | UI Surface | UI Presence | File |
|---|---|---|---|---|---|---|
| /api/auth/login | POST | none | auth | nav | current-ui | auth.ts:42 |
| ... | ... | ... | ... | ... | ... | ... |

## Section 2: Route → UI Need Mapping
[content]

## Section 3: Missing Routes
[content]

## Section 4: Summary
[content]

## Section 5: Open Questions
[content]
```
