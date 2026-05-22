# Nano Banana Adapter (Google Gemini Image API)

Hero-image generation via Google Gemini's `gemini-3-flash-image-preview` model
(public name "Nano Banana 2"). Outputs are decoded from base64 inline data and
stored to R2 for stable URLs — the Gemini API itself returns inline base64,
not a downloadable URL.

## Credential Loading (Spec 32 + 64.6)

The client prefers credentials from the global vault (`getGlobal("nano-banana", "api_key")`),
falling back to `GOOGLE_GEMINI_API_KEY` env var. Set via installer for prod;
either path works for local dev.

Get a key at https://aistudio.google.com/apikey.

## Hard Rules

- ALL hero-image steps that need Nano Banana use this adapter — never call
  `generativelanguage.googleapis.com` directly
- EVERY call requires `projectId`, `operation`, `estimatedCostEur`, and `storagePrefix`
- The Gemini response is base64-encoded inline data — the adapter decodes and
  re-uploads to R2 so consumers get a stable URL
- The `storagePrefix` should encode tenant + content-type (e.g. `toolwiki/articles/hero`)
  so R2 stays browsable

## Model Routing

- `nano-banana-2` (default): editorial hero images, premium composition, ~$0.067/2K image.
- `nano-banana-pro`: premium tier (~$0.134/2K image) — reserved for future per-style routing.

## Cost Math

Cost is computed AFTER the call returns via `nanoBananaImageCostEur` in
`@marketing-auto/cost-tracker`. The `estimateCostEur("google-gemini", operation)`
pre-flight check uses the conservative €0.10/image upper bound from
`COST_ESTIMATES_EUR` so a sudden price hike doesn't bypass the limit guard.

## Retry Logic

3 attempts with exponential backoff (500ms → 1000ms) on 5xx responses or
network errors. 4xx responses fail fast (auth issues, invalid prompts, etc.) —
no point retrying those. The graceful skip in
`HeroImageStep.execute` is the outer backstop: if all 3 attempts fail the
article lands without a hero image rather than failing the whole pipeline.

## Common Mistakes

- DO NOT pass `storagePrefix` starting or ending with `/` (the adapter strips them, but cleanly)
- DO NOT call this for thumbnails or social variants — cost is ~22x flux-schnell;
  use the Replicate adapter's `flux-schnell` model for supporting images
- DO NOT bypass `assertCostBudget` — the cost-tracker check is the only thing
  protecting the project from runaway image-generation spend
- DO NOT trust the `seed` echoed in `GenerateImageResult.seed` when none was
  passed in — Gemini does not always return a deterministic seed for random
  generations; the field will be `null` in that case
