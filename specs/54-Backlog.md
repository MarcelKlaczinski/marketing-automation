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
