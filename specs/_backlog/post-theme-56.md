# Post-Theme-56 Backlog

Findings from the 56.5 cleanup audit that are deferred because they require significant new work beyond the audit's scope.

---

## Cold-Start Wizard — Missing Backend Endpoints (Phase E)

All 14 cold-start wizard endpoints referenced by `useColdStartDraft` composable and phase pages are not yet implemented. The wizard UI (Spec 56.4) is complete but blocked on these backend routes.

### Missing routes

All to be mounted at `/api/cold-start/*`:

| Method | Path | Description |
|--------|------|-------------|
| POST | `/cold-start/initialize` | Create a new cold-start draft, return `{ draftId }` |
| GET | `/cold-start/:draftId` | Fetch draft state (brand discovery status, form data) |
| PATCH | `/cold-start/:draftId` | Update draft form fields |
| POST | `/cold-start/:draftId/advance` | Move to next phase |
| POST | `/cold-start/:draftId/back` | Move to previous phase |
| POST | `/cold-start/:draftId/finalize` | Commit draft → create project, navigate to dashboard |
| POST | `/cold-start/:draftId/connect-astro` | Validate + store Astro repo connection (Phase 4) |
| GET | `/cold-start/:draftId/state` | Poll brand discovery status + phase completion flags |

### DB schema needed

- `cold_start_drafts` table with columns: `id`, `project_id` (nullable until finalize), `phase` (1–5), `form_data` (jsonb), `brand_discovery_status` (`idle` | `running` | `done`), `created_at`, `updated_at`

### Context

- Phase 2 (Brand) triggers brand discovery (async); UI polls `GET .../state` at 2 s interval while `brandDiscoveryStatus === "running"`
- Phase 4 (Astro) is optional — `POST .../connect-astro` only called if user provides a repo path
- Phase 5 (Confirm) calls `POST .../finalize` which must atomically create the project row and redirect

---

## Activity Summary — UI Consumer

`AppShell.vue` polls `GET /api/projects/:slug/activity-summary` every 60 s. This endpoint is now implemented (Spec 56.5 Dimension 5). The sidebar badge on the Dashboard nav item shows `runningCount`. `failedLast24h` is currently unused in the UI (reserved for a future Failures nav section).

---

## Missing Nav Sections (Future)

The following nav items were removed in Spec 56.5 (Dimension 1) because they had no matching routes. Add routes and pages when the features are built:

- **Activity** (`/projects/:slug/activity`) — global activity feed page
- **Failures** (`/projects/:slug/failures`) — failures-only filtered view with `failedLast24h` badge

---

## Articles Count Widget

`GET /api/projects/:slug/articles/count?window=week` is now implemented (Spec 56.5 Dimension 5). The Dashboard header `DashboardHeader.vue` does not yet call this endpoint — it shows a hardcoded `0` for the "Articles this week" metric. Wire it up when building a proper stats row on the dashboard.
