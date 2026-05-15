## Post-54 Backlog (Reihenfolge der Priorität)

1. **54.4b — Reddit + GitHub Trending Adapters** (deferred from 54.4)
  - Adds: Reddit adapter (with subreddit configuration + rate-limit handling),
    GitHub Trending adapter (scraping-based, no official API)
  - Triggers needed when: toolwiki coverage of AI tools needs broader signal capture
    beyond PH + HN + Vendor RSS
  - Estimate: 1.5 days

2. **Tech Debt #3 — Automation chains only for 2/4 gap types**
  - Currently /automate only supports missing_spoke_type + cluster_too_small.
    missing_hub and missing_translation lack chain orchestration.
  - Partially addressed in 54.3 (policy decisions are clean), but the chain-
    enqueue path in /automate route still has the 2-type limit.

3. **Tech Debt #10 — Article Discovery is post-draft only**
  - Discovery pipeline currently runs after article generation, can't influence
    generation. Future spec to bring discovery earlier in the pipeline.

4. **clusters.satellite_keywords column cleanup**
  - After /suggest stopped writing in 54.3, column becomes fossil. Audit all
    readers, deprecate or migrate.

5. **dual-write deprecation: content_gaps → topic_briefs only**
  - Once 54.9 UI is on briefs, content_gaps table can be deprecated.

6. **Adjustable trend score weights via project config** (deferred from 54.5)
  - Currently `WEIGHTS = { buzz: 30, growth: 25, official: 15, serp: 20, coverage: 40 }` are
    constants in `packages/pipelines/src/topic-sources/trend-discovery/score.ts`.
  - When toolwiki's scoring behaviour is understood after smoke-testing, expose weights
    as `topic_scope.score_weights` (or a separate `trend_scoring` key) in `project_configurations`.
  - Score breakdown is already in `trend_metadata.score_breakdown` per brief — add a UI chart
    in 54.6 so Marcel can see which component drives each brief's score before tuning weights.
  - Estimate: 2 hours (schema + Zod default + score.ts refactor)

7. **Bulk DataForSEO Trends as signal source** (deferred from 54.5)
  - Currently `trendsExplore()` is used for **per-candidate scoring** only (score component).
  - A future `DataForSeoTrendsSignalSource` adapter could collect weekly top-growing queries
    from DataForSEO Trends and push them as `external_signals` — giving the synthesizer
    search-demand context even without community signals (HN/PH coverage).
  - Triggers when: toolwiki wants broader trend coverage or a new project has no
    PH/HN presence but needs DataForSEO-signal-driven brief generation.
  - Estimate: 1 day (new signal adapter + collect cron extension)

8. **`rejected_topic_candidates` 90-day storage cleanup** (deferred from 54.5)
  - The 30-day `expires_at` gate means old rejections stop blocking re-evaluation after 30 days.
    But rows stay in the DB forever. For long-running projects this table will grow without bound.
  - Add a periodic DELETE for rows where `expires_at < NOW() - INTERVAL '90 days'`.
  - Implement as a BullMQ janitor job or a DB cron (pg_cron). Could piggyback on the
    `trend-synthesizer` daily run (a second WHERE clause in the existing janitor query).
  - Estimate: 30 min

## Per-source configuration in signal_sources

**Priority:** Low — implement when 54.6 UI surfaces signal-source tuning needs
**Estimate:** 1-2 hours

Currently `maxAgeDays` and `minPoints` are hardcoded defaults in adapter implementations.
For multi-project flexibility, these should live in `project_configurations.signal_sources`:

```json
{
  "hackernews": { "enabled": true, "maxAgeDays": 30, "minPoints": 3, "queries": [...] },
  "vendor_rss": { "enabled": true, "maxAgeDays": 14, "feeds": [...] },
  "producthunt": { "enabled": true, "topic": "artificial-intelligence", "first": 20 }
}
```

Adapters read these from loaded config at fetch time. Schema migration + Zod updates + adapter refactor.
Triggered when toolwiki needs different thresholds than a future second project, or when 54.6 UI exposes signal tuning.


## Cross-Spec Learnings (Engineering Patterns from Theme 54)

### Strict TypeScript patterns
- **`exactOptionalPropertyTypes` + optional function parameters**: use conditional spread `...(value !== undefined && { value })` everywhere, never pass `T | undefined` directly to a parameter typed `value?: T`
- **Zod vs Drizzle insert types**: after Zod validation, strip undefined and cast to Drizzle's `$inferInsert`, not the Zod-inferred type:
```typescript
  const drizzleRow = Object.fromEntries(
    Object.entries(zodValidated).filter(([,v]) => v !== undefined)
  ) as typeof table.$inferInsert;
```
- **`metrics`/JSONB columns**: when schema uses `.$type<X>()`, no caller-side cast needed

### Codebase navigation
- **BullMQ workers live in `apps/api/src/workers/`**, NOT in any `apps/worker/` package — that doesn't exist
- **Adapter packages**: `packages/adapters/<name>/` with `src/{index,client,verify}.ts`. The `./verify` subpath is required convention
- **Env vars**: always via `packages/shared/src/config.ts` + `getEnv()`, never `process.env.X` direct
- **New packages need `paths` entries in**: `apps/api/tsconfig.json`, `packages/pipelines/tsconfig.json` (and any other consumer tsconfig)

### Schema evolution
- **`.default()` on new Zod fields**: backward-compat is preserved ONLY IF callers use `.parse()` and not manual object construction
- **When changing an adapter's input schema**: explicit acceptance criterion "all callers updated" — grep the workspace for `.fetch(`, `.emit(`, etc.

### Test fixtures
- Always use **mixed-source data** (multiple `source` values, multiple `approval_status` values) — single-source fixtures hide bugs
- **`onConflictDoUpdate.targetWhere`** for partial unique indexes must match the index `WHERE` predicate **byte-exactly**

### Custom Error classes
- Never use `kind` or `cause` as property names (ES2022 reserved) — use `<errorType>Kind` instead

### Foreign keys
- Declare FKs via **raw SQL migration**, not Drizzle `references()` — avoids circular imports
