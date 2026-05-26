# Anthropic Adapter

The single, typed entry point for all Claude API calls in the platform.

## Credential Loading (Spec 32)

The client prefers credentials from the global vault (`getGlobal("anthropic", "api_key")`),
falling back to `ANTHROPIC_API_KEY` env var. Set credentials via the installer (`/installer`)
or env var for local dev. Changing vault credentials requires an API server restart for the
cached client singleton to pick them up.

## Hard Rules

- ALL pipeline steps that need an LLM call use this adapter — never `@anthropic-ai/sdk` directly
- EVERY call must include `projectId`, `operation`, and `estimatedCostEur`
- The `systemPrefix` is what gets cached (1h TTL by default). Put stable content there:
  skill content, project marketing context, format examples
- The `systemSuffix` is NOT cached. Put per-call instructions there
- `jsonMode: true` is the standard way to request structured output — **except for `claude-sonnet-4-6`**, which rejects assistant prefill (see JSON Mode Resilience). For Sonnet: omit `jsonMode`, prompt explicitly, extract JSON from `response.raw` manually

## Model Routing Guidance

- Haiku 4.5: classification, summarization of short text, prompt compression, briefing assembly from raw data
- Sonnet 4.6: research synthesis, outlines, brand-voice-light tasks, fact-check, social repurposing
- Opus 4.7: final article draft, opinion pieces, brand-voice-critical content

If unsure, default to Sonnet. Only escalate to Opus when an A/B test shows it.

## Cache Effectiveness

Inspect `cost_logs.metadata` for `cacheReadTokens` vs `cacheCreationTokens` to verify
caching is working. Expected pattern after warmup:
- First call: high `cacheCreationTokens`, low `cacheReadTokens` (writes the cache)
- Subsequent calls within 1h: high `cacheReadTokens`, low/zero `cacheCreationTokens` (hits)
- Hit rate < 60% after warmup = something is wrong (prefix changes between calls)

Common cache breakers:
- Different `systemPrefix` per call (slightly varying skill order, different project context, etc.)
- Marketing context updated mid-run (briefly invalidates cache)
- Cross-organization or cross-workspace requests (caches isolated)

## Dev-Mode Response Cache (Spec 22.6)

Fixture-based replay cache controlled by `ANTHROPIC_CACHE_MODE` env-var:

- `off` (default, production): always live API, no fixture I/O
- `auto`: replay if fixture exists, else call live + record
- `record`: always call live, always write fixture
- `replay`: only replay; cache miss = error (for CI / reproducible tests)

Fixtures live at `packages/adapters/anthropic/fixtures/<sha256-16>.json` — committed to git.

### Workflow

1. First run (new prompts): set `ANTHROPIC_CACHE_MODE=auto`, run the pipeline. Real API calls
   happen; fixtures are recorded automatically.
2. Subsequent dev work: `ANTHROPIC_CACHE_MODE=auto` (or `replay` for strict). All cached calls
   return instantly at $0 cost.
3. When a prompt changes, its cache key changes → next run does a live call and records a new
   fixture. Old fixture becomes orphan; run `fixtures prune` occasionally.
4. Force re-record one call: pass `forceRefresh: true` in `MessagesInput`.

### Hard Rules

- NEVER set `record` or `auto` in production — always `ANTHROPIC_CACHE_MODE=off` (the default).
- Web-search calls (`webSearch.enabled=true`) are NEVER cached — results go stale.
- `replay` mode in CI requires committed fixtures for every prompt the test path touches.
- Inspect fixtures before committing: `bun --filter @marketing-auto/adapter-anthropic fixtures show <key>`.

### CLI

```bash
bun --filter @marketing-auto/adapter-anthropic fixtures list
bun --filter @marketing-auto/adapter-anthropic fixtures show <key>
bun --filter @marketing-auto/adapter-anthropic fixtures delete <key>
bun --filter @marketing-auto/adapter-anthropic fixtures prune 60
```

### Cache Key

sha256 of: `model` + `systemPrefix` + `systemSuffix` + `userMessage` + sampling params + `jsonMode`.
Excluded (run-correlation only, don't affect LLM output): `projectId`, `pipelineRunId`, `articleId`, `operation`, `estimatedCostEur`.

## JSON Mode Resilience

When `jsonMode: true`, the adapter uses two hardening techniques:

1. **Assistant prefill**: sends `{role: "assistant", content: "{"}` so the model continues from `{` — it cannot insert a code fence before a character it has already emitted, preventing ` ```json ` wrapping.
2. **Retry loop**: if JSON parsing still fails (max 2 retries, 1 s / 2 s delay), each retry is a full cost-tracked API call. The adapter throws `JsonParseError` only after all retries are exhausted.

The `raw` field in `MessagesResult` always has `{` prepended when `jsonMode: true`.

**`jsonMode: true` requires assistant prefill support.** `claude-sonnet-4-6` returns HTTP 400 `"This model does not support assistant message prefill"` when `jsonMode: true` is passed. For steps using this model that need JSON output, omit `jsonMode` and extract JSON manually from `response.raw` (use `raw.indexOf("{")` / `raw.lastIndexOf("}")`). Instruct the model via `systemSuffix: "Respond with only a valid JSON object. No markdown, no explanation."` and include an inline JSON skeleton in the user message.

## Vision-blocks (Spec 65.8)

The adapter accepts optional `userImages: UserImageAttachment[]` for vision-capable models. When present, the user message becomes multi-part content: image blocks BEFORE the text block (Anthropic's recommended order — images give context the text then asks about).

Two source types:
- `{ type: "url", url: "https://..." }` — provider CDN URL; media-type inferred server-side
- `{ type: "base64", mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: "..." }` — inline base64

**Cache is disabled** when `userImages` is set (`isCacheable` returns false). Vision picks are non-deterministic and provider URLs rotate — replay would mislead. WebSearch calls have the same exclusion for the same staleness reason.

**Use Sonnet 4.6 + manual JSON extraction**, NOT `jsonMode: true`. Sonnet rejects assistant prefill. Pattern: `systemSuffix: "Respond with only a valid JSON object. No markdown fences, no prose preamble."` + extract from `result.raw` via `indexOf("{")` / `lastIndexOf("}")`. Canonical example: `packages/pipelines/src/article/social-image/photographic/pick-image-llm.ts`.

## Common Mistakes

- DO NOT pass system as a string — must be the array of TextBlockParam (the adapter handles this; if you ever shortcut around the adapter, remember this)
- DO NOT skip cost-tracker — even "small" calls add up
- DO NOT exceed model `max_tokens` (adapter clamps automatically; don't fight it)
- DO NOT request `temperature: 1.5` or wild values — Anthropic has a 0-1 range
- DO NOT use `jsonMode: true` with `claude-sonnet-4-6` — the model rejects assistant prefill with HTTP 400. Extract JSON manually from `response.raw` instead (see JSON Mode Resilience note above)
- DO NOT enable `ANTHROPIC_CACHE_MODE=record` or `=auto` in production — default is `off`
