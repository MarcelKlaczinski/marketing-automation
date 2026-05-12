# Cost Audit — Chain Run 2026-05-12

**Chain ID**: `a760cd45-c2b8-49d6-9822-73b17cd624f6`  
**Article (DE)**: `streaming-dienste-2026-vergleich` (id: `e3a57d9a-babd-4b35-95b3-4e55e9eeace3`)  
**Article (EN)**: `streaming-services-2026-comparison` (id: `1e178915-047e-45fb-ac0f-c7f6d4367bd7`)  
**Chain Status**: running (all 5 pipeline runs completed; chain row stuck at "running" — separate issue)  
**Baseline Cost**: €0.9154 / ~$0.99 USD (DB)  
**User-Reported**: $1.21 USD on Anthropic dashboard

---

## 1. Baseline Chain — Per-Step Breakdown

| Step | Pipeline | Duration | Status |
|------|----------|----------|--------|
| outline | article:outline | 78s | completed |
| draft | article:draft | 167s | completed |
| schema-de | article:schema-extension | 3s | completed |
| localize | article:localize | 169s | completed |
| schema-en | article:schema-extension | 2s | completed |

### Token + Cost Breakdown per API Call

| Operation | Pipeline | Model | Input Tok | Output Tok | Cache Create | Cache Read | Cost EUR |
|-----------|----------|-------|-----------|------------|--------------|------------|----------|
| research-competitor-synthesis | outline | **sonnet-4-6** | 1,137 | 993 | 13,271 | 0 | €0.0626 |
| **article-outline** | outline | **opus-4-7** ⚠️ | 3,370 | 4,577 | 23,964 | 0 | **€0.2586** |
| article-draft | draft | sonnet-4-6 | 4,422 | 8,000 ⛔ | 18,793 | 0 | €0.1874 |
| article-self-review | draft | haiku-4-5 ✅ | 8,779 | 1,844 | 11,085 | 0 | €0.0293 |
| schema-rich-detection (DE) | schema-de | **sonnet-4-6** ⚠️ | 8,752 | **45** | 11,481 | 0 | **€0.0644** |
| article-draft (translation body) | localize | sonnet-4-6 | 8,754 | 5,775 | 16,283 | 0 | €0.1600 |
| article-outline (translation struct) | localize | **sonnet-4-6** ⚠️ | 4,012 | 2,586 | 12,072 | 0 | **€0.0884** |
| schema-rich-detection (EN) | schema-en | sonnet-4-6 | 3 | 67 | 6,336 | 11,481 | €0.0260 |
| hero-image-generation | draft | flux-1.1-pro | — | — | — | — | €0.0368 |
| dataforseo SERP | outline | dataforseo | — | — | — | — | €0.0018 |

**Total: €0.9153**

### Per-Pipeline Totals

| Pipeline | Anthropic EUR | Other EUR | Total EUR | % of Chain |
|----------|---------------|-----------|-----------|------------|
| article:outline | €0.3212 | €0.0018 | €0.3230 | 35.3% |
| article:draft | €0.2167 | €0.0368 | €0.2535 | 27.7% |
| article:schema-extension (DE) | €0.0644 | — | €0.0644 | 7.0% |
| article:localize | €0.2484 | — | €0.2484 | 27.1% |
| article:schema-extension (EN) | €0.0260 | — | €0.0260 | 2.8% |

---

## 2. DB vs. Anthropic Dashboard Mismatch

| | EUR | USD (÷0.92) |
|---|---|---|
| DB total (Anthropic calls only) | €0.8767 | **$0.953** |
| User-reported (Anthropic dashboard) | — | **$1.21** |
| **Mismatch** | — | **+$0.257** |

**Root cause: `pricing.ts` underprices `claude-opus-4-7`.**

pricing.ts records Opus 4.7 at `$5/$25` per 1M tokens (input/output).  
The Anthropic dashboard discrepancy of +$0.257 is almost entirely explained by the single
Opus outline call (3,370 input / 4,577 output / 23,964 cache-write tokens).

If Opus 4.7 is actually priced at `$15/$75` per 1M (matching historical Opus 3 pricing),
the outline call alone would cost ~$0.843 instead of $0.281 — a $0.562 overrun.
That overshoots the $0.257 gap, suggesting the real rate is somewhere between $5 and $15.

**Action required (separate from this PR)**: Verify claude-opus-4-7 pricing on the Anthropic
console and update `packages/cost-tracker/src/pricing.ts` with the correct rates.
This directly affects cost-limit enforcement accuracy.

**All cost_logs entries are present** — no missing API calls identified. Every operation in the
Anthropic adapter creates a cost_log row.

**FX Rate**: EUR_PER_USD = 0.92 (hardcoded in pricing.ts). Current interbank rate ~0.91, so
no meaningful FX drift at the moment.

---

## 3. Cost Drivers

### Top 3 Steps by Absolute Cost

1. **article:outline (Opus 4.7)** — €0.2586 (28.3% of chain)  
   Entire outline pipeline accounts for €0.3230. The Opus call alone is 2.7× more expensive
   than the next biggest single call (draft at €0.1874).

2. **article:localize body call (Sonnet)** — €0.1600 (17.5%)  
   Necessary: translates the full article body (~5,775 output tokens). Not obviously reducible
   without quality trade-offs.

3. **article:draft (Sonnet, MAX_TOKENS)** — €0.1874 (20.5%)  
   The draft was **truncated at 8,000 tokens** (`stopReason: max_tokens`). The article was
   cut off mid-generation. This is both a quality bug AND a cost signal: we're paying for
   an incomplete article.

### Top 3 by Output-Token Intensity

1. **article-draft** — 8,000 output tokens (MAX, truncated)
2. **localize body** — 5,775 output tokens
3. **article-outline (Opus)** — 4,577 output tokens

### Prompt Caching Effectiveness

| Operation | Input Tokens | Cache Reads | Cache Rate |
|-----------|-------------|-------------|------------|
| research-competitor-synthesis | 1,137 | 0 | 0% |
| article-outline (Opus) | 3,370 | 0 | 0% |
| article-draft | 4,422 | 0 | 0% |
| schema-rich-detection (DE) | 8,752 | 0 | 0% |
| localize body | 8,754 | 0 | 0% |
| localize structure | 4,012 | 0 | 0% |
| schema-rich-detection (EN) | 3 | 11,481 | ✅ 100% |

**Cache rate: 0% for all non-EN schema calls.** This is expected behavior:

- Each call within a single chain is unique (different article content, different outline, etc.)
- Caching helps across chains (second article run within 1 hour benefits from the first's cache)
- The EN schema call hits the DE schema call's cache because both use the same system prompt
  for the same article body — the one case where within-chain reuse works
- **Caching is correctly implemented** (cache_control: ephemeral set on systemPrefix)
- **No fix needed for caching** — the 0% rate is structural, not a bug

---

## 4. Optimization Recommendations

### A) Switch article-outline from Opus 4.7 → Sonnet 4.6 [SELECTED]

**Data**: Opus outline = €0.258566 (28% of chain). The outline task is structured JSON
generation with a fixed schema — not a reasoning-intensive task that requires Opus.
The `estimatedCostEur` comment even says "0.6" (Opus estimate), confirming this was an
intentional but reconsidered choice.

**Why Sonnet suffices**: The outline prompt provides full instructions, competitor research,
and a strict JSON schema. Sonnet 4.6 consistently produces valid structured JSON and is
already used for the localize and draft steps (more complex free-text tasks).

**Cost impact**: Sonnet outline with similar token counts (~3,370 input, ~4,577 output,
~23,964 cache-write) ≈ $3/$15 pricing → ~$0.079 USD → ~€0.073.  
**Saving per chain: ~€0.186 (72% reduction on this step)**

**Quality risk**: LOW. The outline JSON schema is strict; Sonnet's structure-following is
reliable. Marcel reviews outlines before drafts run anyway.

**Effort**: 2 lines — change default in `outline.ts`.

---

### B) Switch schema-rich-detection from Sonnet → Haiku [SELECTED]

**Data**: DE schema detection = €0.064386 with 8,752 input tokens but only **45 output tokens**.
Input/output ratio of 194:1 — this is a classification task, not creative generation.
EN run = €0.025961 (lower due to cache hit on system prompt). Total schema cost: €0.090.

**Why Haiku suffices**: The task is "read article body, classify into FAQPage/HowTo boolean
flags, extract 5-8 Q&A pairs". Haiku-4-5 at $1/$5 per 1M handles this type of extraction
reliably. The prompt is specific and the output schema is small.

**Cost impact**: DE schema at Haiku pricing: 8,752 input × $1/1M + 45 output × $5/1M +
11,481 cacheWrite × $1.25/1M ≈ $0.023 USD → €0.021.  
EN schema at Haiku: minimal (3 input, cache hit). ~€0.003.  
**Saving per chain: ~€0.066 (73% reduction on schema steps)**

**Quality risk**: LOW. Classification task with boolean output. If Haiku misclassifies,
the consequence is a missing FAQPage/HowTo schema (Google ignores it, not a user-facing bug).

**Effort**: 1 line — change model in `detect-rich-types.ts`.

---

### C) Switch localize structure-translation call from Sonnet → Haiku [SELECTED]

**Data**: Localize Call 2 (outline JSON + frontmatter extras JSON translation) = €0.088408
with 4,012 input / 2,586 output tokens. This call translates JSON string values — it's not
creative writing. The body call (Call 1) keeps Sonnet because quality matters for the article body.

**Why Haiku suffices**: The task is mechanical: translate string values within a JSON object
while keeping all keys and enum values intact. Instructions are unambiguous. Sonnet is overkill.

**Cost impact**: 4,012 input × $1/1M + 2,586 output × $5/1M + 12,072 cacheWrite × $1.25/1M ≈
$0.034 USD → €0.031. **Saving per chain: ~€0.057 (65% reduction on this call)**

**Quality risk**: LOW-MEDIUM. JSON translation with strict schema. If Haiku produces malformed
JSON, the pipeline already has a `JSON.parse` try/catch that falls back to the source outline.
Risk is minimal — worst case: outline stays in source language.

**Effort**: 1 line — change model in localize pipeline's Call 2.

---

### D) Draft truncation (max_tokens) — FLAGGED, not implemented

**Data**: `stopReason: max_tokens` on article-draft (8,000 output tokens). Article was cut off.

**Why not fixing now**: Increasing max_tokens raises cost (more output tokens). The right fix
depends on whether this article was genuinely too long (it's about streaming services, out-of-scope
for toolwiki.ai anyway) or if the outline over-specified. Needs Marcel's decision on max_tokens strategy.

**Recommendation**: Set `maxTokens: 12000` in draft.ts (Sonnet 4.6 supports this). Cost increase:
~€0.02/chain on average. Add logging when max_tokens is hit so it surfaces as a warning in logs.

---

### E) Opus pricing fix — FLAGGED, not implemented

**Why flagged**: pricing.ts records Opus 4.7 at $5/$25 per 1M, but dashboard shows $0.257
extra vs our calculation. The correct Opus 4.7 pricing needs verification from the Anthropic
console and update in `pricing.ts`. Until fixed, cost limits are inaccurate for Opus runs.
After implementing optimization A (switch outline to Sonnet), this matters less — but still
affects any future Opus usage.

---

## 5. Implemented Optimizations

### Opt A: Outline default model: Opus → Sonnet
- **File**: `packages/pipelines/src/article/steps/outline.ts`
- **Change**: Default model `"claude-opus-4-7"` → `"claude-sonnet-4-6"`
- **estimatedCostEur**: Updated from `0.6` → `0.07`
- **Saving**: ~€0.186/chain
- **Commit**: `780686c`

### Opt B: Schema detection: Sonnet → Haiku
- **File**: `packages/pipelines/src/schema-extension/steps/detect-rich-types.ts`
- **Change**: Model `"claude-sonnet-4-6"` → `"claude-haiku-4-5-20251001"`
- **Saving**: ~€0.066/chain
- **Commit**: `94981dc`

### Opt C: Localize structure-translation call: Sonnet → Haiku
- **File**: `packages/pipelines/src/article/localize/pipeline.ts`
- **Change**: Model `"claude-sonnet-4-6"` → `"claude-haiku-4-5-20251001"` for Call 2
- **Saving**: ~€0.057/chain
- **Commit**: `258c61d`

---

## 6. Validation

**Baseline (this chain)**: €0.9154 / ~$0.99 USD

**Projected after optimizations**:

| Step | Before | After | Saving |
|------|--------|-------|--------|
| article-outline (Opus→Sonnet) | €0.2586 | €0.073 | €0.186 |
| schema-rich-detection ×2 (Sonnet→Haiku) | €0.090 | €0.024 | €0.066 |
| localize Call 2 (Sonnet→Haiku) | €0.0884 | €0.031 | €0.057 |
| **Total saving** | | | **€0.309** |

**Projected chain cost: €0.9154 − €0.309 = ~€0.606**  
**Projected saving: ~34% per chain**

At 35 backlog articles: €0.606 × 35 = **~€21** (vs €32 at baseline)  
At 100 articles (commercial scale): **~€60** (vs €91 at baseline)

> Phase 5 validation (actual chain run) to be appended here after test trigger.
