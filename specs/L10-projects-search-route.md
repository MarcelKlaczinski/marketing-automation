# Spec L10 — projects/search.ts (Retrospective Doc-Coverage)

_Backfill-spec: existing code, documented after the fact._
_Status: Documented._
_Aufwand: 15 min._

---

## 1. Was tut die Komponente

Project-scoped global-search HTTP endpoint backing the Cmd+K Command Palette. Given a 2-to-100-char query string, fans out parallel `ilike` lookups across `articles`, `topic_briefs`, and `clusters` for the active project and returns up to N matches per type. Single-roundtrip backing for the palette's "what exists in this project" search drawer.

---

## 2. API / Props / State-Machine

### File location
- [apps/api/src/routes/projects/search.ts](apps/api/src/routes/projects/search.ts)
- Mount: `app.route("/api/projects", projectSearchRoutes)` at [apps/api/src/server.ts:111](apps/api/src/server.ts:111)
- Auth: `requireAuth` applied at the Hono router level ([search.ts:18](apps/api/src/routes/projects/search.ts:18))

### Public surface
- `GET /api/projects/:slug/search?q={query}&types={csv}&limit={n}`
- Query Zod schema ([search.ts:20](apps/api/src/routes/projects/search.ts:20)):
  - `q: string` min 2, max 100
  - `types?: string` — CSV (`articles,briefs,clusters`); defaults to all three when omitted
  - `limit?: number` — int min 1, max 50, default 20 (per-type, not global)
- Response: `{ ok: true, data: { articles: Row[], briefs: Row[], clusters: Row[] } }`
  - Per-type columns are projection-specific (only what the palette needs to render a row + deep-link)

### DB tables touched
- `projects` (1 SELECT — slug → id resolution)
- `articles` (ilike on `title`, `cornerstoneKeyword`, `slug`)
- `topic_briefs` (ilike on `topicTitle`, `primaryKeyword`)
- `clusters` (ilike on `name`, `primaryKeyword`)

### Error responses
- `400 validation_error` — Zod parse failure (e.g. `q` < 2 chars); body contains `details: zodError.flatten()`
- `404 project_not_found` — slug doesn't resolve

---

## 3. State-Machine / Flow

Stateless GET. Per request: (1) validate query → 400 if invalid; (2) resolve project by slug → 404 if missing; (3) split `types` CSV (default `["articles","briefs","clusters"]`); (4) `Promise.all` over three conditional queries — each one either runs the `ilike` OR-clause or returns `[]` based on the `types` filter; (5) return the three result groups. No mutation, no audit log, no cost tracking.

---

## 4. Design Decisions & Trade-offs

- **Flat per-type result groups, not a unified `{type, id, title, ...}` list** — the consumer (CommandPalette) renders three `CommandPaletteSection` blocks anyway, so a typed object beats a discriminated union that the frontend would need to re-narrow.
- **`ilike` over full-text search** — small tenant tables (single-digit thousands of rows at most). The trade-off accepts sequential-scan cost for zero index-maintenance and zero special tokenization. Re-evaluate if any tenant table crosses ~100k rows.
- **Per-type `limit` (not global)** — `limit=20` returns up to 60 rows total; balanced visibility beats one type dominating the palette dropdown. The 50-row max keeps payloads bounded.
- **No pagination, no cursor** — search is interactive; the user retypes to narrow rather than paging. Matches palette UX where additional results appear via keystroke, not click.
- **`Promise.all` parallel fan-out** — the three queries are independent; total latency = max of the three rather than sum. Trade-off: peak DB connection use is 3× per request.

---

## 5. Known Gotchas / Footguns

- **`types` is a CSV string** — `?types=articles,briefs`, NOT `?types=articles&types=briefs`. Backend splits on `,` and trims; repeated-param shape would be parsed as a single string `"articles,briefs"` (correct for the CSV form, but the schema is `z.string()`, not `z.array(z.string())`).
- **`q` minimum length 2** — a caller that fires before debounce settles will get a 400. The CommandPalette guards via `minChars` check before issuing the request.
- **Searched columns are a small allowlist per table** — `articles.metaDescription`, `topic_briefs.suggestedTitle`, `clusters.pillar` (denormalized pillar name) etc. are NOT searched. Intentional simplicity; widen the OR-clause only when a missing column has been demonstrated to hurt search precision.
- **No `LIMIT` budget across types** — `articles` always gets 20 even when 0 briefs/clusters match. Acceptable because the per-type cap is small.

---

## 6. Multi-Domain Refactor — Out of Scope

- **Project resolution by slug** — the `eq(projects.slug, slug)` lookup will likely shift in Sprint 3 (Categories) when projects gain a category dimension; the bare slug-to-id pattern may evolve.
- **Searched columns per content table** may shift if Sprint 2 introduces a unified `@marketing-auto/content-schema` that denormalizes differently or merges short-text columns into a single searchable column.
- **No tenant-credential search** today — if Sprint 5 adds per-tenant config that should be searchable, the endpoint will need a new result group.

---

## 7. References

- Frontend consumer: [apps/web/src/components/search/CommandPalette.vue:256](apps/web/src/components/search/CommandPalette.vue:256) (only known caller)
- DB tables: `projects`, `articles`, `topic_briefs`, `clusters`
- Related: web/CLAUDE.md TanStack-search anti-pattern (CommandPalette uses raw `apiGet` + watcher debounce, not `useQuery`, because the debounced input lives in `data()`)
- Cross-spec patterns: D1 (Vue Options API) on the consumer; backend follows the pagination-CLAUDE.md project-scoping idiom but skips the `paginated()` envelope because per-type lists are interactive snippets, not paginated tables
