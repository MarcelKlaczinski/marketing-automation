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

Plus: aktiviere "Restrict to Gemini API" in AI Studio damit der Key bei einem Leak
nicht für andere Google-APIs missbraucht werden kann. Plus: regelmäßig nutzen
damit Dormant-Block (May 2026 policy change) nicht greift.

## Hard Rules

- ALL hero-image steps that need Nano Banana use this adapter — never call
  `generativelanguage.googleapis.com` directly
- EVERY call requires `projectId`, `operation`, `estimatedCostEur`, and `storagePrefix`
- The Gemini response is base64-encoded inline data — the adapter decodes and
  re-uploads to R2 so consumers get a stable URL
- The `storagePrefix` should encode tenant + content-type (e.g. `toolwiki/articles/hero`)
  so R2 stays browsable

## Model Routing

- `nano-banana-2` (default): editorial hero images, premium composition. Supports
  all four resolutions (`0.5k / 1k / 2k / 4k`).
- `nano-banana-pro`: premium tier — reserved for future per-style routing.
  Supports `1k / 2k / 4k` only; `0.5k` is silently upgraded to `1k` inside
  [model-inputs.ts](src/model-inputs.ts) to avoid an HTTP 400.

## Resolution Toggle (Spec 64.6b)

`projects.image_generation_resolution` controls output resolution per tenant.
The adapter accepts `'0.5k' | '1k' | '2k' | '4k'` (lowercase, matches the DB
column) and maps to Gemini's `imageSize` string per the API docs:

| DB value | Gemini `imageSize` | Pixel target | Notes |
|---|---|---|---|
| `'0.5k'` | `"512"` | 512px | Flash only; no "K" suffix per API docs |
| `'1k'` | `"1K"` | 1024px | Toolwiki default |
| `'2k'` | `"2K"` | 2048px | Premium quality |
| `'4k'` | `"4K"` | 4096px | Print quality |

**Uppercase `K` is required by the Gemini API** — lowercase is rejected. The
adapter's `GEMINI_RESOLUTION_MAP` is the single translation point.

### Resolution Pricing Reference

USD/EUR prices verified 2026-05-23 via Google Cloud Generative AI pricing page.
EUR uses the workspace-wide `EUR_PER_USD = 0.92` constant from `@marketing-auto/cost-tracker`.

| Resolution | nano-banana-2 USD/EUR | nano-banana-pro USD/EUR | Use-Case |
|---|---|---|---|
| 0.5k | $0.045 / €0.041 | (upgraded to 1k) | Thumbnails, social preview |
| **1k** | **$0.067 / €0.062** | $0.134 / €0.123 | **Editorial hero (Toolwiki default)** |
| 2k | $0.101 / €0.093 | $0.134 / €0.123 | Premium-quality, retina displays |
| 4k | $0.151 / €0.139 | $0.240 / €0.221 | Print quality (overkill for blog) |

Pricing maps live in `packages/cost-tracker/src/pricing.ts`
(`NANO_BANANA_2_PRICING_USD` + `NANO_BANANA_PRO_PRICING_USD`). The Planner's
cost estimate uses `estimateHeroImageCost(provider, resolution)` from
`@marketing-auto/core/cost` so plans approved with the 2K toggle don't drift
from the budget Marcel saw at approval time.

## Cost Math

Cost is computed AFTER the call returns via `nanoBananaImageCostEur({model, resolution, count, mode?})`
in `@marketing-auto/cost-tracker`. The `mode` arg defaults to `"sync"` for back-compat;
pass `"batch"` to apply the documented 50% Gemini Batch API discount (Spec 64.7).
Precomputed batch maps (`NANO_BANANA_2_BATCH_PRICING_USD` + `NANO_BANANA_PRO_BATCH_PRICING_USD`)
live alongside the sync maps in `pricing.ts`. The `estimateCostEur("google-gemini", operation)`
pre-flight check uses the conservative **€0.25/image** upper bound from
`COST_ESTIMATES_EUR` — covers the 4K Pro worst case so a sudden price hike
or accidental Pro routing doesn't bypass the limit guard. The same €0.25 caps both
`HERO_IMAGE` (sync) and the batch ops (`HERO_IMAGE_BATCH_SUBMIT` / `HERO_IMAGE_BATCH_RESULT`).

## Retry Logic

Three branches with distinct backoff profiles:

| Failure | Retry? | Backoff | Final error |
|---|---|---|---|
| **429** (rate limited) | yes | **1s → 2s → 4s** (max 7s) | `"Rate limited after 3 attempts"` |
| **5xx** (transient) | yes | 500ms → 1s → 2s (max 3.5s) | `"Gemini call failed after 3 attempts"` |
| **4xx non-429** (auth / blocked / invalid prompt) | no | fail-fast | original status + body excerpt |

The 429 backoff is intentionally aggressive — quota recovery needs a longer
window than a transient 5xx blip; hammering at 500ms during a 429 burst only
burns more quota. 4xx (non-429) fail-fast because retrying an invalid prompt
or revoked API key just wastes budget.

The graceful skip in `HeroImageStep.execute` is the outer backstop: if all
three attempts fail the article lands in `final_review` without a hero image
rather than failing the whole pipeline. Marcel can re-render later from the UI.

## Rate Limits & Quota Management

**Quotas apply per Google Cloud Project**, NOT per API key
([docs](https://ai.google.dev/gemini-api/docs/rate-limits)).
Live tier limits (RPM / TPM / RPD / Images-per-Min) are visible at
<https://aistudio.google.com/rate-limit> and depend on usage tier. Google's
docs intentionally don't publish fixed numbers — they vary by region, model
version, and account history. Treat the dashboard as the source of truth.

**Tier 1 qualification**: link a billing account and stay under the $250
cumulative cap. Tier 2 unlocks after $250 cumulative spend + 3 days.

### Toolwiki Usage Profile (May 2026)

- ~3.4 hero images/day average
- ~14 images/day during plan-approve spikes (KW21 burst)
- Well within Tier 1 budget for current article cadence

### Scale Thresholds

Rough article-to-image expansion at the current ~5 hero images / article (DE +
EN siblings × HTTP/og:image variants are deduped):

| Articles / month | Daily hero generations | Headroom vs typical 250 RPD ceiling |
|---|---|---|
| 50 (current) | ~3.4 | ~73× |
| 200 | ~13 | ~19× |
| 500 | ~33 | ~7.5× |
| 1000 | ~66 | ~3.8× |
| **2500** | **~165** | **~1.5× — re-check the dashboard** |

**Decision point:** at >1000 articles/month, verify the live Tier 2 RPD on the
dashboard. The 250-figure used historically is illustrative — actual limits
may differ by region.

## Batch Mode (Spec 64.7)

The adapter exposes three batch surfaces alongside the sync `generateImage`:

- `createImageBatch({ model, displayName, requests })` — submits ONE Gemini
  batch (all requests share the model encoded in the endpoint path).
- `retrieveBatch(batchName)` — maps Gemini's `JOB_STATE_*` enum to a 3-state
  `"processing" | "succeeded" | "failed"` representation.
- `fetchBatchResults(batchName)` — when state is `succeeded`, walks the
  inlined response and uploads each image to R2; returns per-customId result
  list.

**Wire format vs Spec sketch (verified 2026-05-23):** the Gemini Batch API
contract differs substantially from Spec 64.7's pre-implementation sketch
— actual endpoint is `models/{slug}:batchGenerateContent` (model in path,
not flat `/batches:create`), correlation key is `metadata.key` (not the
guessed `custom_id`), and state enum is `JOB_STATE_*` (not `BATCH_STATE_*`).
The deeply-nested request shape `batch.input_config.requests.requests[]`
is intentional — Gemini supports either inline OR file-input modes through
the same `input_config` envelope. The adapter uses inline mode only — fits
≤50 hero images per batch comfortably and avoids a separate JSONL upload.

**Pricing:** all four resolutions × both models are documented at 50% of the
sync rate. The pre-computed maps `NANO_BANANA_2_BATCH_PRICING_USD` and
`NANO_BANANA_PRO_BATCH_PRICING_USD` in `packages/cost-tracker/src/pricing.ts`
mirror the sync maps. Pass `mode: "batch"` to `nanoBananaImageCostEur({...})`
to apply the discount; defaults to `"sync"` for back-compat.

**Per-batch model constraint:** the `batchGenerateContent` endpoint takes one
model in the path. The Plan-Coordinator (`apps/api/src/lib/plan-image-batch-coordinator.ts`)
groups pending rows by model before calling `createImageBatch`. Mixed-model
plans currently raise an error rather than silently splitting — single-
provider projects (Toolwiki's current setup) never hit this path.

**Single-image re-roll stays sync:** the batch surface is for plan-approved
bulk generation only. UI re-roll buttons and standalone test generations
use the sync `generateImage` path so the user gets immediate feedback. The
trigger boundary enforces this via `overrideLlmMode: "sync"` on the standalone
endpoint (see [articles-standalone.ts](../../../apps/api/src/routes/projects/articles-standalone.ts)).

## Common Mistakes

- DO NOT pass `storagePrefix` starting or ending with `/` (the adapter strips them, but cleanly)
- DO NOT call this for thumbnails or social variants — cost is ~22x flux-schnell;
  use the Replicate adapter's `flux-schnell` model for supporting images
- DO NOT bypass `assertCostBudget` — the cost-tracker check is the only thing
  protecting the project from runaway image-generation spend
- DO NOT trust the `seed` echoed in `GenerateImageResult.seed` when none was
  passed in — Gemini does not always return a deterministic seed for random
  generations; the field will be `null` in that case
- DO NOT send the `imageSize` value in lowercase (`"1k"` etc.) — the Gemini API
  rejects it. The adapter's `GEMINI_RESOLUTION_MAP` is the single translation
  point; new callers should pass the DB-style lowercase token and let the
  adapter handle the conversion.
- DO NOT use `nano-banana-pro` with `resolution: "0.5k"` and expect 512px output —
  Pro doesn't support 512, the adapter silently upgrades to 1K. Pricing accounts
  for this in `NANO_BANANA_PRO_PRICING_USD['0.5k'] = $0.134` (mirrors 1K rate).
- DO NOT mix `nano-banana-2` and `nano-banana-pro` requests in one
  `createImageBatch()` call (Spec 64.7) — the model is encoded in the endpoint
  path. The Plan-Coordinator pre-groups by model before calling. If you call
  this adapter directly from a future use case that batches multiple models,
  you must split into one createImageBatch per model.
- DO NOT write a cost log inside HeroImageStep's batch-resume branch — the
  image-batch-processor worker is the authoritative `image_batch:result`
  logger (cost is paid at billing-time, not at pipeline-resume time). Adding
  a step-level log would duplicate the row and double the dashboard total.
- DO NOT pass an empty `requests` array to `createImageBatch()` — the adapter
  throws `NanoBananaGenerationError` instead of submitting a no-op batch.
  The Plan-Coordinator handles this via its `no_pending` short-circuit; if
  you're calling the adapter directly, gate on `requests.length > 0` first.
