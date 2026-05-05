# DataForSEO Adapter

Typed SEO data adapter for SERP analysis, keyword research, and competitor intelligence.

## Hard Rules

- ALL pipeline steps that need SEO data use this adapter — never `dataforseo-client` directly
- EVERY call requires `projectId`, `operation`, `estimatedCostEur`
- Default location is Germany (2276), default language is "de" — override per call when targeting elsewhere
- Default mode for SERP is `live` — `standard` (queued, 5-min polling) is NOT implemented for MVP
- The cost-tracker uses the **actual cost reported by DataForSEO** (in the response `cost` field)
  when available, falling back to our list pricing. This handles DataForSEO's depth-based
  pricing variability (e.g., `+25%` for SERP info, `+50%` for clickstream data).

## Endpoint Selection

- `serp()`: when you need TODAY's SERP for a keyword (competitor analysis, content gap, SERP feature detection)
- `keywordOverview()`: when you need search volume, CPC, difficulty for a list of keywords (cluster planning)
- `relatedKeywords()`: when expanding a cluster (give me 100 related ideas to "claude prompts")
- `rankedKeywords()`: when analyzing a competitor's full keyword footprint ("what does horstmar.de rank for?")

## Cost Awareness

| Operation | Approx cost (live, standard params) | Use case scale |
|-----------|---------------------------------------|----------------|
| `serp` (depth=10) | €0.0018 | per article + per cluster cornerstone |
| `keywordOverview` (700 keywords) | €0.018 | once per cluster |
| `relatedKeywords` (limit=100) | €0.011 | once per cluster |
| `rankedKeywords` (limit=100) | €0.011 | once per competitor research run |

For KI-Wissensraum cold-start (50 keywords + 5 competitor analyses + 30 article SERPs):
expect total ~€0.15.

## Common Mistakes

- DO NOT pass more than 700 keywords to `keywordOverview()` — adapter throws
- DO NOT use `mode: "standard"` (not implemented) — use `live`
- DO NOT use `includeClickstreamData: true` for routine cluster planning — adds 50% cost
  for marginal accuracy improvement on common keywords. Reserve for niche/long-tail keywords.
- DO NOT call `rankedKeywords()` on every article generation — it's a periodic competitor
  research task, not a per-article need (run weekly or monthly via scheduled job)
- DO NOT expect `relatedKeywords()` to return keyword difficulty — `RelatedKeywordItem` has
  only `searchVolume`, `cpcUsd`, `competition`. Use `keywordOverview()` if you need difficulty
- DO NOT use keyword strings directly as DataForSEO `operation` identifiers — sanitize first
  (e.g. `.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "")`) to avoid special chars
- DO NOT forget that the `cost` field in DataForSEO responses is in USD — adapter converts
- DO NOT use `device: "mobile"` unless the project's audience is mobile-first;
  results differ significantly from desktop
- DO NOT run `bun run test` from inside this package — Bun resolves the same-name script before
  the built-in and recurses. Use `bun --filter @marketing-auto/adapter-dataforseo test` instead.
