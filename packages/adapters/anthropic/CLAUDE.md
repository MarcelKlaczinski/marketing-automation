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
- `jsonMode: true` is the standard way to request structured output. Don't ask for JSON
  in the user message and parse manually — use the flag

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

## Common Mistakes

- DO NOT pass system as a string — must be the array of TextBlockParam (the adapter handles this; if you ever shortcut around the adapter, remember this)
- DO NOT skip cost-tracker — even "small" calls add up
- DO NOT exceed model `max_tokens` (adapter clamps automatically; don't fight it)
- DO NOT request `temperature: 1.5` or wild values — Anthropic has a 0-1 range
- DO NOT instruct the user message "respond with JSON" — use `jsonMode: true`
