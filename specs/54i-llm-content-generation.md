# Spec 54i — LLM-Generated Captions + Hashtags

## Goal

Replace static `buildCaption()` / `buildHashtags()` per-template functions with a single LLM call
that generates hook + caption + hashtags together. Translate all prompts to English for better
instruction-following quality.

## Background

Before 54i, captions were hardcoded template strings like "Schreib's in die Kommentare" — low
engagement, zero personalisation, identical for every article. Hashtag strategy was also static
with `#Toolwiki` self-promotional tags and no bilingual coverage.

## Key Design Decisions

**One LLM call for hook + caption + hashtags** — not three calls. The model builds a coherent
caption that references the hook's insight. Haiku-class model, `jsonMode: true`, max 512 tokens.

**Bilingual hashtag strategy for DE** — `#KITools` + `#AITools` always; `#KIVergleich` only
for comparison/use-case contentType (not single-tool spotlights). Total: 7 tags.

**English prompts** — all 5 pattern system prompts translated to English. Output language
is controlled via explicit instruction in the caption section ("German output, du-form").

**`domain` field in `ContentPromptContext`** — configurable, defaults to `"toolwiki.ai"`.
Allows future callers to pass `brandTokens.social.websiteUrl` for multi-tenant correctness.
Templates currently don't have brandTokens at `generateContent()` time, so they pass nothing
and get the default.

## Implementation

### `packages/core/src/social-hooks/hookPrompt.ts`

- All 5 `HOOK_SYSTEM_PROMPTS` rewritten in English
- New `buildContentPrompt()` — combines hook pattern + caption/hashtag instructions in one system prompt
- `ContentPromptContext` interface: `{ articleTitle, toolNames, primaryKeyword, locale, articleSlug, contentType, domain? }`
- Caption instructions: first line keyword-rich (Instagram search indexing), save CTA, no comment-baiting
- Hashtag rule: DE comparison → `#KIVergleich`; DE tool-spotlight → no `#KIVergleich`

### `packages/core/src/social-hooks/generateHook.ts`

- New `GeneratedContent` type: `{ hookOutput: HookOutput; caption: string; hashtags: string[] }`
- New `generateContentWithGate()` — validates hook part with retry, falls back to `buildFallbackCaption()`/`buildFallbackHashtags()` on total failure
- `generateHookWithGate()` kept for backward compat (used by `packages/pipelines`)
- Hashtag array from LLM is filtered (`typeof h === "string"`) rather than cast

### `packages/social/src/templates/types.ts`

- `generateHook` → `generateContent` on `TemplateDefinition` (returns `GeneratedContent`)
- `hookOutput?` → `generatedContent?` on `RenderContext`
- `GeneratedContent` interface exported

### All 4 templates

- `generateHook` → `generateContent`, calls `generateContentWithGate()`
- `render()` reads `context.generatedContent?.caption ?? fallbackCaption(...)` and `?.hashtags ?? fallbackHashtags(...)`
- `buildCaption` / `buildHashtags` → renamed `fallbackCaption` / `fallbackHashtags` (still present as safety net)
- Removed `#Toolwiki` from all fallback hashtag arrays
- Fallback captions use "Speicher" save-CTA (not comment-baiting)

### `apps/api/src/workers/discoveryWorker.ts`

- Calls `template.generateContent()` instead of `template.generateHook()`
- Passes `generatedContent` to `template.render()`

## Acceptance Criteria

- [x] `generateContentWithGate()` exported from `@marketing-auto/core`
- [x] All 5 hook prompts in English
- [x] `ContentPromptContext.domain` optional, defaults to `"toolwiki.ai"`
- [x] Hashtag arrays from LLM filtered to `string[]` (no unsafe cast)
- [x] All 4 templates implement `generateContent()` — TypeScript enforces
- [x] `render()` uses `context.generatedContent?.caption/hashtags` with fallback
- [x] `bun tsc --noEmit` on `apps/api` passes clean

## Discovered During Implementation

- **`exactOptionalPropertyTypes` rejects `field?: T` assigned `value | undefined`** — use `field: T | null` instead of `field?: T` in local intermediate types when building objects that conditionally set fields
- **`Array.isArray` narrows to `unknown[]` not `string[]`** — always filter with `typeof h === "string"` rather than casting directly
- **`ContentPromptContext` has no access to brandTokens** — `generateContent()` is called before `render()`, so templates don't have the project's `brandTokens` available. Pass `domain` explicitly when needed; the default covers the current single-tenant case
