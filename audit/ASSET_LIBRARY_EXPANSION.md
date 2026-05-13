# Spec 52a — Asset Library Expansion + Tool-Icon-Fix

Date: 2026-05-13

## Root Cause (discovered during implementation)

The bug was twofold:

1. **Broken lobe-icons path** in `packages/pipelines/src/_lib/resolve-tool-icon.ts`:
   The path used 4× `..` from the file, landing at `packages/apps/api/node_modules/…` (non-existent).
   Correct count from `_lib/` is 5× to reach repo root. This caused **every** lobe-icons lookup
   to silently fail (`Bun.file().exists() = false`).

2. **Emoji passthrough from LLM**: `ExtractToolsStep` prompt asked the LLM to return an `emoji`
   field per tool. `ResolveAssetsStep` spread the full extracted tool object (`...tool`), passing
   `emoji` through. `ToolIconImage.tsx` rendered `emoji` **before** the initials check — so even
   when the icon resolver returned an avatar, the emoji won.

## Coverage After Spec 52a

| Tool         | Before       | After (source)         |
|-------------|--------------|------------------------|
| Midjourney  | 🌈 emoji     | SVG (iconify)          |
| OpenAI/DALL-E | 🤖 emoji   | SVG (iconify)          |
| Claude/Anthropic | 🤖 emoji | SVG (simple-icons)    |
| Recraft     | 🎨 emoji     | SVG (lobe-icons)       |
| Ideogram    | ✍️ emoji     | SVG (lobe-icons)       |
| Flux Pro    | ⚡ emoji     | SVG (iconify via flux) |
| Figma       | avatar       | SVG (simple-icons)     |
| Notion      | avatar       | SVG (simple-icons)     |
| Perplexity  | avatar       | SVG (simple-icons)     |
| Unknown tool | avatar       | avatar (deterministic) |

## Per-Source Coverage

- **simple-icons**: Claude/Anthropic, Gemini, Figma, Notion, ElevenLabs, GitHub Copilot, Perplexity (~8 mapped tools)
- **iconify logos**: Midjourney, OpenAI family, Flux, Anthropic, Stability AI, Figma, Notion, Perplexity (~15 mapped tools)
- **lobe-icons**: Recraft, Ideogram, Hedra, Kling, Pika, Suno, Udio, Luma, Runway, Cursor, Windsurf, ElevenLabs, Perplexity, DeepL, and more (~25+ from existing DB seeds)
- **deterministic-avatar**: any unknown tool (never emoji)

## Technical Changes

- `packages/pipelines/src/_lib/icon-sources/` — new adapter layer (4 files)
- `packages/pipelines/src/_lib/resolve-tool-icon.ts` — full rewrite with chain + DB cache
- `packages/pipelines/package.json` — added simple-icons, @iconify/utils, @iconify-json/logos, @iconify-json/skill-icons
- `packages/pipelines/src/article/social-image/steps.ts` — stripped emoji from prompt + schema; `iconUrl→iconSvg`
- `packages/social/src/shared/ToolIconImage.tsx` — `iconSvg` prop, inline SVG rendering
- `packages/social/src/compositions/list-carousel/types.ts` — `iconSvg` field, removed emoji
- `packages/social/render-server.ts` — removed `resolveIconUrls()` file-to-base64 pre-processing
- `apps/api/src/lib/icon-resolver.ts` — new re-export for API routes

## Tests

- `packages/pipelines/test/icon-sources/simple-icons.test.ts` — 8 tests
- `packages/pipelines/test/icon-sources/iconify.test.ts` — 8 tests
- `packages/pipelines/test/icon-sources/icon-resolver.test.ts` — 10 integration tests (DB)

Total: 26 new tests, all passing. 0 regressions in existing social-image test suite (12 pass, 1 skip).

## Existing Posts

Intentionally NOT re-rendered (Marcel's decision). The `project_brand_assets` cache was cleared
(25 broken lobe-icons entries deleted) so new renders build fresh correct entries.
Spec 52b can add a Re-Render button if needed.

## Cost Impact

~$0.00 — no additional LLM calls. Icon resolution is CPU-only (file lookups + SVG string ops).
DB writes are amortized: each tool-slug is resolved once, then cached.
