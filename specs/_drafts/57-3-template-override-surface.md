# Spec 57.3 Template Override Surface Inventory

**Date:** 2026-05-18  
**Investigator:** Claude Code via discovery prompt

---

## Area A: Copy String Inventory

### A.1 Classification Key

- **HARDCODED** — String literal in `.tsx` or `render()` function (no variable substitution)
- **HARDCODED-TEMPLATE** — String with variable substitution but the surrounding copy is hardcoded (`"ab ${n}€/Monat"`)
- **DATA-DRIVEN** — Comes from article/tool props
- **LLM-GENERATED** — Produced by `generateContentWithGate()` / `GenerateCaptionStep`
- **BRAND-TOKEN** — Configurable via `brandTokens.social.*`

---

### Template: CoverSlideStunning (list-carousel cover — used by `comparison-stunning` and `comparison-stunning-3`)

| Element | Source Category | Current Value / Source | Override-Candidate? |
|---------|----------------|----------------------|---------------------|
| Eyebrow text | HARDCODED-TEMPLATE | Computed in `render()`: DE `"TOOL-VERGLEICH · ${year}"` / EN `"TOOL COMPARISON · ${year}"` | YES — label prefix ("TOOL-VERGLEICH") |
| Hook lead phrase | LLM-GENERATED | `hookOutput.leadPhrase` | NO — LLM produces |
| Hook highlight word | LLM-GENERATED | `hookOutput.highlightWord` | NO — LLM produces |
| Hook trail phrase | LLM-GENERATED | `hookOutput.trailPhrase` | NO — LLM produces |
| Promise block line 1 | LLM-GENERATED | `hookOutput.promiseBlock.line1` | NO — LLM produces |
| Promise block line 2 | LLM-GENERATED | `hookOutput.promiseBlock.line2` | NO — LLM produces |
| Cover subhead | DATA-DRIVEN | `cover.subhead` (optional) | NO — data-driven |
| Tool names in ToolPreviewRow | DATA-DRIVEN | `tool.name` | NO |
| Tool bestFor/tagline in ToolPreviewRow | DATA-DRIVEN | `tool.bestFor ?? tool.tagline` | NO |
| Slide indicator | DATA-DRIVEN | `1/${totalSlides}` | NO |
| Website URL (footer) | BRAND-TOKEN | `brandTokens.social.websiteUrl` | ALREADY |
| Instagram handle (footer) | BRAND-TOKEN | `brandTokens.social.instagramHandle` | ALREADY |

**Interpolation alert:** `hookOutput.promiseBlock.line1` in the fallback is built in `render()` as `"${toolNamesStr} im Praxistest."` — the `" im Praxistest."` suffix is HARDCODED, wrapping DATA-DRIVEN `toolNamesStr`. This is the only LLM-adjacent interpolation on this slide.

---

### Template: ToolSlideStunning (list-carousel tool slides)

| Element | Source Category | Current Value / Source | Override-Candidate? |
|---------|----------------|----------------------|---------------------|
| Rank badge | DATA-DRIVEN | `#${String(tool.rank).padStart(2, "0")}` | NO |
| Tool name eyebrow | DATA-DRIVEN | `tool.name.toUpperCase()` | NO |
| Tool icon | DATA-DRIVEN | `tool.iconSvg / iconInitials / iconHue` | NO |
| Tool name (large) | DATA-DRIVEN | `tool.name` | NO |
| Tool domain | DATA-DRIVEN | `tool.domain` | NO |
| bestFor tag | DATA-DRIVEN | `tool.bestFor` (optional) | NO |
| Tagline (with highlight) | DATA-DRIVEN | `tool.tagline` + `tool.keyDifferentiator` | NO |
| Star strength | DATA-DRIVEN | `tool.starStrength ?? tool.strengths[0]` | NO |
| Regular strengths | DATA-DRIVEN | `tool.strengths` array | NO |
| **"Perfekt für"** panel label | **HARDCODED** | `"Perfekt für"` — **DE-only, no locale switch!** | **YES — brand voice + missing EN variant** |
| Derived use-case text | DATA-DRIVEN | `deriveInfinitiveUseCase(tool.identityVerb)` | NO |
| PricingChip content | DATA-DRIVEN | `tool.pricing.tier + label` | NO |
| Slide indicator (footer) | DATA-DRIVEN | `${slideNumber}/${totalSlides}` | NO |
| Website URL (footer) | BRAND-TOKEN | `brandTokens.social.websiteUrl` | ALREADY |
| Instagram handle (footer) | BRAND-TOKEN | `brandTokens.social.instagramHandle` | ALREADY |

**Critical finding:** `"Perfekt für"` at `ToolSlideStunning.tsx:285` has no `locale` switch. This is a DE-hardcode that renders on EN slides too. It's both a bug and an override candidate.

---

### Template: EndSlideStunning (list-carousel end slide)

| Element | Source Category | Current Value / Source | Override-Candidate? |
|---------|----------------|----------------------|---------------------|
| **Eyebrow** | **HARDCODED** | `"ZUR VERTIEFUNG"` — DE-only, no locale switch! | **YES — missing EN variant, brand voice** |
| Closer headline line1 | HARDCODED-TEMPLATE | From `render()`: DE `"Unser Sieger:"` / `"Unser Fazit:"` / EN `"Our winner:"` / `"Our verdict:"` | YES — verdict label |
| Closer highlight (winner name) | DATA-DRIVEN | `tools.find(t => t.slug === input.winner)?.name` | NO |
| Closer line2 lead | HARDCODED | From `render()`: DE `"Speichere für"` / EN `"Save for"` | YES — CTA copy |
| Closer line2 highlight | HARDCODED | From `render()`: DE `"später"` / EN `"later"` | YES — CTA copy |
| **Save-action emoji** | **HARDCODED** | `"📌"` | YES (minor) — brand style |
| **Save-action label** | **HARDCODED** | `"Speichere diesen Post"` — DE-only, no locale switch! | **YES — missing EN variant** |
| **Save-action subline** | **HARDCODED** | `"als Cheat-Sheet für deinen Workflow"` — DE-only! | **YES — brand voice + missing EN variant** |
| **Follow CTA emoji** | **HARDCODED** | `"📱"` | YES (minor) |
| **Follow CTA label** | **HARDCODED** | `"Mehr ehrliche Vergleiche"` — DE-only! | **YES — missing EN variant** |
| Instagram handle | BRAND-TOKEN | `brandTokens.social.instagramHandle` | ALREADY |
| **Article link emoji** | **HARDCODED** | `"🌐"` | YES (minor) |
| **Article link label** | **HARDCODED** | `"Vollständiger Artikel"` — DE-only! | **YES — missing EN variant** |
| Article URL | DATA-DRIVEN | `end.articleUrl.replace(/^https?:\/\//, "")` | NO |
| **Recap grid section label** | **HARDCODED** | `"Tools im Detail"` — DE-only! | **YES — missing EN variant** |
| Tool names in recap | DATA-DRIVEN | `tool.name` | NO |
| `"für "` before endSlideToken | **HARDCODED** | `"für "` prefix at `EndSlideStunning.tsx:108` — DE-only! | **YES — missing EN variant** |
| `tool.endSlideToken` text | DATA-DRIVEN | `tool.endSlideToken` | NO |

**Critical finding:** The EndSlideStunning has 6+ DE-only hardcoded strings with no `locale` branching. EN renders show German text. These are the highest-priority override candidates.

---

### Template: CoverSlide (single-tool-spotlight)

| Element | Source Category | Current Value / Source | Override-Candidate? |
|---------|----------------|----------------------|---------------------|
| `category` fallback | HARDCODED | DE `"KI-TOOL"` / EN `"AI TOOL"` | YES — category label |
| Eyebrow suffix | HARDCODED | DE `" IM CHECK · ${year}"` / EN `" REVIEW · ${year}"` | YES — review type label |
| Hook lead (tool name) | DATA-DRIVEN | `tool.name` | NO |
| **Hook highlight question** | **HARDCODED** | DE `"lohnt es sich?"` / EN `"worth it?"` | **YES — brand voice** |
| Subline (fallback) | HARDCODED-TEMPLATE | DE `"${categoryLabel} im ehrlichen Test."` / EN `"${categoryLabel} — honest review."` | YES — review promise copy |
| **Promise line 1** | **HARDCODED** | DE `"Stärken & Schwächen"` / EN `"Strengths & weaknesses"` | **YES — brand voice** |
| **Promise line 2** | **HARDCODED** | DE `"Ehrlich. Ohne Hype."` / EN `"Honest. No hype."` | **YES — brand voice, signature phrase** |
| **Pros section label** | **HARDCODED** | DE `"Warum es sich lohnt"` / EN `"Why it matters"` | **YES — brand voice** |
| Pro item text | DATA-DRIVEN | `pro.text` | NO |
| Website URL (footer) | BRAND-TOKEN | `websiteUrl` prop | ALREADY |
| Instagram handle (footer) | BRAND-TOKEN | `instagramHandle` prop | ALREADY |

**Note:** `single-tool-spotlight` passes `websiteUrl` and `instagramHandle` directly as flat props (not via `brandTokens`), unlike the list-carousel which uses `brandTokens.social.*`. This is an inconsistency to note for Spec 57.3.

---

### Template: StrengthsSlide (single-tool-spotlight)

| Element | Source Category | Current Value / Source | Override-Candidate? |
|---------|----------------|----------------------|---------------------|
| **Eyebrow** | **HARDCODED** | DE `"STÄRKEN"` / EN `"STRENGTHS"` | **YES — section label** |
| **Headline lead** | **HARDCODED** | DE `"Warum"` / EN `"Why"` | **YES — brand voice** |
| Headline highlight | DATA-DRIVEN | `"${tool.name}?"` | NO |
| Rating stars | DATA-DRIVEN | `tool.rating` (optional) | NO |
| **"Top-Stärke" label** | **HARDCODED** | DE `"Top-Stärke"` / EN `"Top strength"` | **YES — section label** |
| Star pro text | DATA-DRIVEN | `starPro.text` | NO |
| Regular pros text | DATA-DRIVEN | `pro.text` array | NO |
| **Cons section label** | **HARDCODED** | DE `"Schwächen"` / EN `"Weaknesses"` | **YES — section label** |
| Con text | DATA-DRIVEN | `con.text` | NO |

---

### Template: PricingForWhomSlide (single-tool-spotlight)

| Element | Source Category | Current Value / Source | Override-Candidate? |
|---------|----------------|----------------------|---------------------|
| **Eyebrow** | **HARDCODED** | DE `"PRICING & FÜR WEN"` / EN `"PRICING & FOR WHOM"` | **YES — section label** |
| Tool name | DATA-DRIVEN | `tool.name` | NO |
| Pricing label `"Pricing"` | HARDCODED | `"Pricing"` (same both locales) | NO (negligible) |
| PricingChip label | HARDCODED-TEMPLATE | DE `"ab ${n}€/Monat"` / EN `"from $${n}/month"`, `"Kostenlos"` etc. | YES — currency + format |
| `"Free-Plan verfügbar"` detail | HARDCODED-TEMPLATE | DE/EN variants with `priceFrom` | YES — pricing copy |
| **`forWhomLabel`** | **HARDCODED** | DE `"Perfekt für"` / EN `"Perfect for"` | **YES — brand voice** |
| Use case text | DATA-DRIVEN | `uc` string | NO |
| **`notForLabel`** | **HARDCODED** | DE `"Weniger geeignet wenn…"` / EN `"Skip if…"` | **YES — brand voice** |
| Con text | DATA-DRIVEN | `con.text` | NO |

---

### Template: UseCaseDetailSlide (single-tool-spotlight)

| Element | Source Category | Current Value / Source | Override-Candidate? |
|---------|----------------|----------------------|---------------------|
| **Eyebrow** | **HARDCODED** | `"USE CASES"` (both locales — same) | NO (already bilingual-neutral) |
| **Headline** | **HARDCODED** | DE `"Wofür?"` / EN `"Best for?"` | **YES — brand voice** |
| Use case text | DATA-DRIVEN | `useCases[]` | NO |
| Numbered badges | DATA-DRIVEN | `String(i+1).padStart(2, "0")` | NO |

---

### Template: EndSlide (single-tool-spotlight)

| Element | Source Category | Current Value / Source | Override-Candidate? |
|---------|----------------|----------------------|---------------------|
| **Eyebrow** | **HARDCODED** | DE `"ZUR VERTIEFUNG"` / EN `"DIVE DEEPER"` | **YES — same as list-carousel** |
| **CTA headline** | **HARDCODED** | DE `"Speichere diesen"` + `"Post"` + `"für später."` / EN variants | **YES — brand voice** |
| **Save card label** | **HARDCODED** | DE `"Speichere diesen Post"` / EN `"Save this post"` | **YES — CTA copy** |
| **Save card subline** | **HARDCODED-TEMPLATE** | DE `"als ${tool.name}-Cheat-Sheet"` / EN `"as your ${tool.name} cheat sheet"` | **YES — brand voice** |
| **Follow card label** | **HARDCODED** | DE `"Mehr ehrliche Vergleiche"` / EN `"More honest reviews"` | **YES — brand voice** |
| Instagram handle | BRAND-TOKEN | `instagramHandle` prop | ALREADY |
| **Article URL card label** | **HARDCODED** | DE `"Vollständiger Test"` / EN `"Full review"` | **YES — review type label** |
| Article URL | DATA-DRIVEN | `websiteUrl/{articleSlug}` | NO |
| **Recap section label** | **HARDCODED** | DE `"Im Check"` / EN `"Reviewed"` | **YES — section label** |
| Tool name in recap | DATA-DRIVEN | `tool.name` | NO |

---

### Template: UseCaseVerdictCoverSlide (use-case-verdict)

| Element | Source Category | Current Value / Source | Override-Candidate? |
|---------|----------------|----------------------|---------------------|
| **Eyebrow** | **HARDCODED-TEMPLATE** | DE `"TOOL-VERGLEICH · ${year}"` / EN `"TOOL COMPARISON · ${year}"` | **YES — label prefix** |
| **Hook headline** | **HARDCODED** | DE `"So wählst du"` + `"das richtige"` + `"Tool"` / EN `"How to choose"` + `"the right"` + `"tool"` | **YES — brand voice** |
| Tool names subline | DATA-DRIVEN | `tools.map(t=>t.name).join(" vs. ")` | NO |
| Verdict count subline | HARDCODED-TEMPLATE | DE `"${n} Use-Cases im direkten Vergleich"` / EN `"${n} use cases compared directly"` | YES (minor) |
| **Promise line 1** | **HARDCODED** | DE `"Jeder Use-Case bekommt einen Gewinner."` / EN `"Every use case gets a winner."` | **YES — brand voice** |
| **Promise line 2** | **HARDCODED** | DE `"Keine Hype-Antworten."` / EN `"No hype answers."` | **YES — brand voice** |
| **Preview grid label** | **HARDCODED** | DE `"Was dich erwartet"` / EN `"What's inside"` | **YES — brand voice** |
| Verdict use-case text (preview) | DATA-DRIVEN | `v.useCase` | NO |
| Website URL (footer) | BRAND-TOKEN | `websiteUrl` prop | ALREADY |
| Instagram handle (footer) | BRAND-TOKEN | `instagramHandle` prop | ALREADY |

---

### Template: UseCaseVerdictSlide (use-case-verdict)

| Element | Source Category | Current Value / Source | Override-Candidate? |
|---------|----------------|----------------------|---------------------|
| **Eyebrow** | **HARDCODED-TEMPLATE** | DE `"USE-CASE 01/05"` / EN `"USE CASE 01/05"` | NO (data-driven count; label "USE-CASE" is minimal) |
| Use-case title | DATA-DRIVEN | `verdict.useCase` | NO |
| **Winner label** | **HARDCODED** | DE `"GEWINNT"` / EN `"WINS"` | **YES — terminology** |
| Winner tool name | DATA-DRIVEN | `winnerTool?.name ?? verdict.winner` | NO |
| Verdict reason | DATA-DRIVEN | `verdict.reason` | NO |
| Progress dots | DATA-DRIVEN | (count from `verdicts.length`) | NO |

---

### Template: UseCaseVerdictRecapSlide (use-case-verdict)

| Element | Source Category | Current Value / Source | Override-Candidate? |
|---------|----------------|----------------------|---------------------|
| **Eyebrow** | **HARDCODED** | DE `"GESAMT-ERGEBNIS"` / EN `"OVERALL RESULT"` | **YES — section label** |
| **Headline** | **HARDCODED** | DE `"Wer gewinnt?"` / EN `"Who wins?"` | **YES — brand voice** |
| `winsLabel` | HARDCODED-TEMPLATE | DE `"${n}× Gewinner"` / EN `"${n}× winner"` | YES (minor) |
| Tool names | DATA-DRIVEN | `tool?.name ?? entry.slug` | NO |
| Summary sentence | HARDCODED-TEMPLATE | DE/EN dynamic template with tool names embedded | YES — brand voice framing |
| **"Alle Verdicts" label** | **HARDCODED** | DE `"Alle Verdicts"` / EN `"All verdicts"` | **YES — section label** |
| Verdict use-case text | DATA-DRIVEN | `v.useCase` | NO |

---

### A.3 LLM-Generated Surface (NOT for override)

All LLM-generated text comes from `generateContentWithGate()` (called before render) and the step-level `GenerateCaptionStep`:

| Content | Where it appears in slides |
|---------|---------------------------|
| `hookOutput.leadPhrase` | CoverSlideStunning hook line 1 |
| `hookOutput.highlightWord` | CoverSlideStunning hook line 2 (brand color) |
| `hookOutput.trailPhrase` | CoverSlideStunning hook line 3 (when long) |
| `hookOutput.promiseBlock.line1/.line2` | CoverSlideStunning promise block |
| `caption` | Goes to `social_posts.content.caption` — NOT in slides |
| `hashtags` | Goes to `social_posts.content.hashtags` — NOT in slides |

**No mixed interpolation on LLM slides:** The hook lines are rendered as independent `<span>` elements — there are no templates like `"${hook.leadPhrase} mit Tools"`. The promise block lines are fully LLM-generated. Safe.

**Exception in render() fallbacks:** When `hookOutput` is absent (re-render of old post), `render()` computes `promiseBlock.line1 = "${toolNamesStr} im Praxistest."` — the `"im Praxistest."` suffix is HARDCODED but the whole string is just a fallback, not the primary path.

---

### A.4 Bilingual / Locale-Variant Strings

Summary of all `locale.startsWith("de")` / `locale === "de"` branches found:

| File | DE string | EN string | Note |
|------|-----------|-----------|------|
| `CoverSlide.tsx` | `"KI-TOOL"` | `"AI TOOL"` | category fallback |
| `CoverSlide.tsx` | `"IM CHECK · ${year}"` | `"REVIEW · ${year}"` | eyebrow suffix |
| `CoverSlide.tsx` | `"lohnt es sich?"` | `"worth it?"` | hook question |
| `CoverSlide.tsx` | `"${cat} im ehrlichen Test."` | `"${cat} — honest review."` | subline fallback |
| `CoverSlide.tsx` | `"Stärken & Schwächen"` | `"Strengths & weaknesses"` | promise 1 |
| `CoverSlide.tsx` | `"Ehrlich. Ohne Hype."` | `"Honest. No hype."` | promise 2 |
| `CoverSlide.tsx` | `"Warum es sich lohnt"` | `"Why it matters"` | pros section label |
| `StrengthsSlide.tsx` | `"STÄRKEN"` | `"STRENGTHS"` | eyebrow |
| `StrengthsSlide.tsx` | `"Warum"` | `"Why"` | headline lead |
| `StrengthsSlide.tsx` | `"Top-Stärke"` | `"Top strength"` | star label |
| `StrengthsSlide.tsx` | `"Schwächen"` | `"Weaknesses"` | cons label |
| `PricingForWhomSlide.tsx` | `"PRICING & FÜR WEN"` | `"PRICING & FOR WHOM"` | eyebrow |
| `PricingForWhomSlide.tsx` | `"Kostenlos"` / `"ab ${n}€/Monat"` etc. | `"Free"` / `"from $${n}/month"` etc. | pricing labels |
| `PricingForWhomSlide.tsx` | `"Perfekt für"` | `"Perfect for"` | for-whom label |
| `PricingForWhomSlide.tsx` | `"Weniger geeignet wenn…"` | `"Skip if…"` | not-for label |
| `PricingForWhomSlide.tsx` | `"Free-Plan verfügbar…"` | `"Free plan available…"` | detail text |
| `UseCaseDetailSlide.tsx` | `"Wofür?"` | `"Best for?"` | headline |
| `EndSlide.tsx` | `"ZUR VERTIEFUNG"` | `"DIVE DEEPER"` | eyebrow |
| `EndSlide.tsx` | `"Speichere diesen"` etc. | `"Save this"` etc. | CTA headline |
| `EndSlide.tsx` | `"Speichere diesen Post"` | `"Save this post"` | save label |
| `EndSlide.tsx` | `"als ${name}-Cheat-Sheet"` | `"as your ${name} cheat sheet"` | save subline |
| `EndSlide.tsx` | `"Mehr ehrliche Vergleiche"` | `"More honest reviews"` | follow label |
| `EndSlide.tsx` | `"Vollständiger Test"` | `"Full review"` | article label |
| `EndSlide.tsx` | `"Im Check"` | `"Reviewed"` | recap label |
| `UseCaseVerdictCoverSlide.tsx` | `"TOOL-VERGLEICH · ${year}"` | `"TOOL COMPARISON · ${year}"` | eyebrow |
| `UseCaseVerdictCoverSlide.tsx` | `"So wählst du"` + `"das richtige"` etc. | `"How to choose"` etc. | hook headline |
| `UseCaseVerdictCoverSlide.tsx` | `"Jeder Use-Case bekommt einen Gewinner."` | `"Every use case gets a winner."` | promise 1 |
| `UseCaseVerdictCoverSlide.tsx` | `"Keine Hype-Antworten."` | `"No hype answers."` | promise 2 |
| `UseCaseVerdictCoverSlide.tsx` | `"Was dich erwartet"` | `"What's inside"` | preview label |
| `UseCaseVerdictSlide.tsx` | `"GEWINNT"` | `"WINS"` | winner label |
| `UseCaseVerdictRecapSlide.tsx` | `"GESAMT-ERGEBNIS"` | `"OVERALL RESULT"` | eyebrow |
| `UseCaseVerdictRecapSlide.tsx` | `"Wer gewinnt?"` | `"Who wins?"` | headline |
| `UseCaseVerdictRecapSlide.tsx` | `"${n}× Gewinner"` | `"${n}× winner"` | wins label |
| `UseCaseVerdictRecapSlide.tsx` | `"Alle Verdicts"` | `"All verdicts"` | verdicts label |

**Missing locale switches (bugs):**
- `ToolSlideStunning.tsx:285` — `"Perfekt für"` always DE
- `EndSlideStunning.tsx:186` — `"ZUR VERTIEFUNG"` always DE (no EN variant at all)
- `EndSlideStunning.tsx:232` — `"Speichere diesen Post"` always DE
- `EndSlideStunning.tsx:245` — `"als Cheat-Sheet für deinen Workflow"` always DE
- `EndSlideStunning.tsx:272` — `"Mehr ehrliche Vergleiche"` always DE
- `EndSlideStunning.tsx:300` — `"Vollständiger Artikel"` always DE
- `EndSlideStunning.tsx:68` — `"Tools im Detail"` always DE
- `EndSlideStunning.tsx:108` — `"für "` prefix always DE

These 8 strings are both locale-bug fixes AND override candidates. Spec 57.3 should add their locale variants while adding the override hook.

---

## Area B: Layout Knob Surface

### Template: CoverSlideStunning (list-carousel)

| Element | Currently Optional? | How Gated | Override Candidate? |
|---------|--------------------|-----------|--------------------|
| ToolLogosTopRight (4 logos, top-right) | NO | always rendered | YES — minimalist brands might want clean cover |
| BigNumberAnchor (ghost number) | NO | always rendered | YES — ghost anchor can conflict with some backgrounds |
| ToolPreviewRow (5 chip cards) | YES | returns null if `tools.length === 0` | YES — threshold: `tools.slice(0, 5)` |
| Hook block | YES | requires `hookOutput` present | NO — data presence |
| Editorial headline fallback | YES | triggered when no `hookOutput` | NO — fallback path only |
| `cover.subhead` | YES | data presence | NO — data-driven |
| BrandFooter | NO | always rendered | NO — brand requirement |

**Plausible project want to hide:** BigNumberAnchor (design clash), ToolLogosTopRight (unbranded look). Both currently hardwired.

---

### Template: ToolSlideStunning (list-carousel)

| Element | Currently Optional? | How Gated | Override Candidate? |
|---------|--------------------|-----------|--------------------|
| Rank badge | NO | always rendered | **YES — unranked listicle use case** |
| Tool name eyebrow (upper-case) | NO | always rendered | NO |
| bestFor tag | YES | `tool.bestFor != null` | NO — data presence |
| keyDifferentiator highlight | YES | `tool.keyDifferentiator != null` | NO — data presence |
| Star strength (featured bullet) | YES | `tool.starStrength ?? tool.strengths[0]` | NO |
| "Perfekt für" panel | YES | requires valid `deriveInfinitiveUseCase(tool.identityVerb)` | YES — project may want to suppress |
| PricingChip | NO | always rendered (once pricing data present) | **YES — some projects don't want pricing on every tool slide** |
| BrandFooter | NO | always rendered | NO |

---

### Template: EndSlideStunning (list-carousel)

| Element | Currently Optional? | How Gated | Override Candidate? |
|---------|--------------------|-----------|--------------------|
| Closer headline (structured) | YES | requires `end.closer` set | NO — data presence |
| Fallback headline | YES | when no `end.closer` | NO |
| Save-action block (📌) | NO | always rendered | **YES — some brands prefer no save prompt** |
| Follow CTA block (📱) | NO | always rendered | **YES — some brands want different CTA** |
| Article link block (🌐) | NO | always rendered | **YES — some brands may not have article URL** |
| ToolRecapGrid | YES | returns null if `displayTools.length === 0` | YES — project may want no recap |
| BrandFooter | NO | always rendered | NO |
| **End slide itself** | NO | `ListCarouselStunning.tsx` always adds it as `slideIndex === 1 + tools.length` | **YES — `includeEndSlide` knob needed at composition level** |

---

### Template: SingleToolSpotlight (all slides)

| Element | Currently Optional? | How Gated | Override Candidate? |
|---------|--------------------|-----------|--------------------|
| Pros preview chips (CoverSlide) | YES | `tool.pros.length > 0` | NO |
| Rating stars (StrengthsSlide) | YES | `tool.rating !== undefined` | NO |
| Cons block (StrengthsSlide) | YES | `tool.cons.length > 0` | NO |
| For-whom block (PricingForWhomSlide) | YES | `useCasesToShow.length > 0` | NO |
| "Skip if" cons block (PricingForWhomSlide) | YES | `useCases.length < 3 && cons.length > 0` | NO |
| PricingChip | NO | always rendered | YES — same as list-carousel |
| UseCaseDetailSlide (slide 5) | YES | **threshold: `useCases.length >= 3`** | **YES — project could lower/raise threshold** |

**`useCaseSlideThreshold: number`** (currently hardcoded as `3` in `singleToolSpotlight.ts:115`) is the most useful numeric knob for this template.

---

### Template: UseCaseVerdict (all slides)

| Element | Currently Optional? | How Gated | Override Candidate? |
|---------|--------------------|-----------|--------------------|
| Progress dots (VerdictSlide) | NO | always rendered | YES (minor) — can feel cluttered |
| Tally bars (RecapSlide) | NO | always rendered | NO |
| Summary sentence (RecapSlide) | NO | always rendered | YES — brand voice |
| VerdictSlide count | DATA-DRIVEN | `verdicts.length` drives slides | NO |

---

### B.2 Always-Rendered Elements — Plausibility Assessment

| Element | Template | Would a project plausibly want to hide? | Recommendation |
|---------|----------|----------------------------------------|---------------|
| End slide | list-carousel | YES — some projects want to end on last tool card (simpler flow, saves slide count budget) | Add `includeEndSlide` boolean to `ListCarouselStunning` |
| Save prompt block | all end slides | YES — projects with different CTA strategy | Add `showSavePrompt` boolean |
| Follow CTA block | all end slides | YES — projects without Instagram or with different handle placement | Add `showFollowCTA` boolean |
| Rank badge | ToolSlideStunning | YES — content that's "best tools" not ranked | Add `showRankBadge` boolean |
| Pricing chip | ToolSlideStunning, PricingForWhomSlide | YES — some tools have complex pricing not representable by a chip | Add `showPricingChip` boolean |
| Ghost number | CoverSlideStunning | MAYBE — a significant brand redesign choice | Keep as-is for now |
| Tool logos strip | CoverSlideStunning | MAYBE — rare | Keep as-is for now |

---

### B.3 Numeric / Enum Knob Candidates

| Candidate | Template | Current Value | Type | Notes |
|-----------|----------|--------------|------|-------|
| `useCaseSlideThreshold` | single-tool-spotlight | `3` (hardcoded) | `number` | Controls whether slide 5 (UseCaseDetailSlide) is added |
| `maxToolsInPreviewRow` | CoverSlideStunning | `5` (`tools.slice(0, 5)`) | `number` | Not a knob today |
| `maxRecapTools` | EndSlideStunning | `6` (`displayTools.slice(0, 6)`) | `number` | Not a knob today |
| `pricingDisplay` | ToolSlideStunning | chip always shown | `"chip" \| "hidden"` | Simpler than a full 3-way enum; `showPricingChip` boolean suffices |

---

## Area C: Eligibility Parameters

### C.1 Verbatim Eligibility Predicates

#### Template: comparison-stunning

```typescript
eligibility: (article, _discovery) => {
  if (article.collection !== "comparisons") {
    return { eligible: false, reason: "Nur für comparisons-Collection" };
  }
  const extras = (article.frontmatterExtras ?? {}) as { toolSlugs?: string[]; verdict?: string };
  const toolCount = extras.toolSlugs?.length ?? 0;
  if (toolCount !== 2) {
    return { eligible: false, reason: "Benötigt exakt 2 Tools", requirements: ["frontmatter.toolSlugs.length === 2"] };
  }
  if (!extras.verdict) {
    return { eligible: false, reason: "Verdict-Feld fehlt", requirements: ["frontmatter.verdict"] };
  }
  return { eligible: true };
}
```

Extracted parameters:
- `requiredCollection: "comparisons"` — structural, NOT parameterizable (slide layout assumes comparison)
- `exactToolCount: 2` — structural (slide count = 1 cover + 2 tool-slides + 1 end = 4), NOT safely parameterizable without layout changes
- `requiresVerdict: true` — structural (EndSlide closer uses it)

#### Template: comparison-stunning-3

Identical structure to `comparison-stunning` except `toolCount !== 3`. Same conclusions — `exactToolCount` is structural.

#### Template: single-tool-spotlight

```typescript
eligibility: (article, _discovery) => {
  if (article.collection !== "tools") {
    return { eligible: false, reason: "Nur für tools-Collection" };
  }
  const pros = extras.pros ?? [];
  if (pros.length < SINGLE_TOOL_SPOTLIGHT_CONSTRAINTS.fieldBounds.pros.minItems) {
    return { eligible: false, reason: `Benötigt mindestens 2 Pros`, requirements: [`frontmatter.pros.length >= 2`] };
  }
  if (pros.length > SINGLE_TOOL_SPOTLIGHT_CONSTRAINTS.fieldBounds.pros.maxItems) {
    return { eligible: false, reason: `Zu viele Pros (max. 5)`, requirements: [`frontmatter.pros.length <= 5`] };
  }
  if (!extras.pricingTier && !extras.pricing) {
    return { eligible: false, reason: "Pricing-Feld fehlt", requirements: ["frontmatter.pricingTier oder frontmatter.pricing"] };
  }
  return { eligible: true };
}
```

Extracted parameters:
- `requiredCollection: "tools"` — structural
- **`minProsCount: 2`** — **parameterizable** (project with brand-voice brevity might accept 1 strong pro)
- **`maxProsCount: 5`** — **parameterizable** (layout allows up to 5 before overflow, but a project might cap at 3)
- `requiresPricing: true` — structural (PricingForWhomSlide always renders)

#### Template: use-case-verdict-per-tool

```typescript
eligibility: (article, _discovery) => {
  if (article.collection !== "comparisons") {
    return { eligible: false, reason: "Nur für comparisons-Collection" };
  }
  const verdicts = extras.useCaseVerdicts ?? [];
  if (verdicts.length < 3) {
    return { eligible: false, reason: "Benötigt mindestens 3 Use-Case-Verdicts", requirements: ["frontmatter.useCaseVerdicts.length >= 3"] };
  }
  const incomplete = verdicts.filter((v) => !v.winner || !v.reason);
  if (incomplete.length > 0) {
    return { eligible: false, reason: `${incomplete.length} Verdicts ohne winner/reason` };
  }
  return { eligible: true };
}
```

Extracted parameters:
- `requiredCollection: "comparisons"` — structural
- **`minVerdictsCount: 3`** — **parameterizable** (a project might want 2-verdict comparisons, or 5+)
- `requiresCompleteVerdicts: true` — structural (can't render a VerdictSlide without `winner` + `reason`)

---

### C.2 Common Parameter Schema Across Templates

| Parameter | Type | Templates | Currently Hardcoded As |
|-----------|------|-----------|----------------------|
| `minProsCount` | `number` | single-tool-spotlight | `2` |
| `maxProsCount` | `number` | single-tool-spotlight | `5` |
| `minVerdictsCount` | `number` | use-case-verdict-per-tool | `3` |
| `requiredFields` | `string[]` | comparison templates | `["verdict"]` |

All four parameterizable values are **numeric bounds on array fields**. A shared `fieldBounds` record covers all of them:

```typescript
type EligibilityOverride = {
  fieldBounds?: {
    pros?:     { minItems?: number; maxItems?: number };
    verdicts?: { minItems?: number };
  };
}
```

---

### C.3 Predicates That Don't Cleanly Parameterize

| Predicate | Template | Reason | Verdict |
|-----------|----------|--------|---------|
| `article.collection !== "comparisons"` | comparison templates | Collection type drives the entire slide architecture; changing it produces broken output | **STAYS IN CODE** |
| `exactToolCount: 2` or `3` | comparison templates | Slide count is mathematically derived from tool count; changing it requires layout code changes | **STAYS IN CODE** |
| `requiresVerdict` | comparison templates | EndSlide closer reads the verdict field directly; always required | **STAYS IN CODE** |
| `incomplete.filter(v => !v.winner || !v.reason)` | use-case-verdict | Complex boolean — but only checks data completeness, not a tunable threshold | **STAYS IN CODE** |
| `requiresPricing` | single-tool-spotlight | PricingForWhomSlide always appears; removing pricing check would produce empty slides | **STAYS IN CODE** |

**Summary:** Only `minProsCount`, `maxProsCount`, and `minVerdictsCount` cleanly parameterize. The collection/tool-count/required-fields predicates are layout-structural and must stay in code.

---

## Area D: Registry & Existing Patterns

### D.1 Template Registry Shape

The registry is a class (not a plain object), defined in `packages/social/src/templates/registry.ts`:

```typescript
class TemplateRegistry {
  private readonly templates = new Map<TemplateKey, TemplateDefinition>();
  register<T>(template: TemplateDefinition<T>): void { ... }
  getById(key: TemplateKey): TemplateDefinition { ... }
  list(): TemplateDefinition[] { ... }
  listEligibleFor(article: Article, discovery: ArticleDiscovery): EligibleTemplate[] { ... }
}
export const templateRegistry = new TemplateRegistry();
```

`TemplateDefinition<TInput>` fields today (from `types.ts`):
- `key`, `displayName`, `description`, `defaultSlideCount`, `estimatedCostUsd`
- `outputFormat`, `compatibleChannels`, `generationClass`, `plannerMeta`
- `eligibility: EligibilityPredicate` (pure function)
- `generateContent: (article, input, locale, llmCaller) => Promise<GeneratedContent>`
- `buildInput: (article, discovery) => Promise<TInput>`
- `render: (context: RenderContext<TInput>) => Promise<RenderResult>`
- `mockFixtures: MockFixtureMap`

Spec 57.3 would add to `TemplateDefinition`:
```typescript
defaultCopyValues?: Record<string, string>;      // locale-keyed
defaultLayoutValues?: Record<string, boolean | number>;
defaultEligibilityParams?: Record<string, number>;
```

And `RenderContext` would gain:
```typescript
templateOverride?: ProjectTemplateOverride;  // project-level override row from DB
```

---

### D.2 Current `brand_tokens.social` Inventory

From `brandTokensSchema` in `packages/social/src/compositions/list-carousel/types.ts`:

```typescript
social: z.object({
  instagramHandle: z.string().default("@toolwiki.ai"),
  websiteUrl:      z.string().default("toolwiki.ai"),
  logoAssetKey:    z.string().default("main"),
}).default({})
```

That is the complete set — 3 fields. No copy strings, no layout flags, no eligibility params. Spec 57.3 adds none of these to `brand_tokens.social` — they go into a separate `project_template_overrides` table.

**Important:** `single-tool-spotlight` passes `websiteUrl` and `instagramHandle` as flat props on `carouselInput`, NOT via `brandTokens.social.*`. This means the brand-token override path (Spec 54e) does not apply to these two fields for the spotlight template. Spec 57.3 should normalise this — either pass them through `brandTokens.social` consistently, or document the divergence.

---

### D.3 Existing Override Patterns

**Pattern A: `brandTokens` Zod deep-merge (Spec 57.1 / Spec 54e)**

`getBrandTokens(projectId)` in `apps/api/src/lib/brand-asset-service.ts`:
```typescript
const tokens = brandTokensSchema.parse(project.brandTokens ?? {});
```
`brandTokensSchema` has `.default()` on every field, so `parse({})` fills in all defaults. The project row stores only the delta. `context.brandTokens ?? DEFAULT_BRAND_TOKENS` in every template `render()` applies the override.

This is the **closest existing analogue** to what Spec 57.3 needs. It is: per-project JSONB column → Zod parse with defaults → injected into render context.

**Pattern B: `cron_state` per-project config table (Spec 56.6)**

`packages/db/src/schema/cron.ts`:
```typescript
unique("cron_state_project_job_type_unique").on(t.projectId, t.jobType)
```
A separate table with `(projectId, jobType)` unique key. One row per (project, job-type) pair. `lastRunAt` is updated on each run. Created lazily (only when user enables the cron job).

This is the closest structural analogue to `project_template_overrides`. Key characteristics:
- **Lazy creation** — row only exists when explicitly configured
- **Unique on (projectId, scope)** — no global defaults table, just absence = use code default
- **Audit columns** — `createdAt`, `updatedAt`, `lastRunAt`

Spec 57.3 should mirror the `cron_state` pattern: `project_template_overrides(projectId, templateKey)` unique, lazy-created, with `last_used_at` instead of `lastRunAt`.

---

## Area E: Cross-cutting Considerations

### E.1 Per-Render vs Per-Project Overrides

**Recommendation: 2-tier only (project → template-default). Do not add per-article overrides.**

Reasoning:
1. All identified copy/layout decisions are brand-voice decisions — they're stable across all articles for a given project.
2. Per-article override would require either a `JSONB` column on `articles` (expanding that table's scope) or a 3-way join in the pipeline hot path.
3. No concrete use case has been identified: `"showPricingChip: false for article X but true for Y"` doesn't make sense for a consistent brand.
4. The `brand_tokens` pattern is also 2-tier and has worked well through Specs 54e–57.1.

If a 3-tier need emerges later, the `RenderContext` can accept an optional `articleOverride?: Partial<ProjectTemplateOverride>` without a schema change to the DB table.

---

### E.2 `last_used_at` Update Strategy

**Recommendation: Approximated — UPDATE only if `last_used_at < NOW() - INTERVAL '1 hour'`.**

Reasoning:
1. The render pipeline can process multiple articles for the same project+template simultaneously (BullMQ parallelism). Synchronous writes would cause write contention on the override row.
2. Fire-and-forget background UPDATE is architecturally cleaner but introduces a new async path with no error visibility.
3. Approximated (skip if recent) gives sub-hour freshness with zero contention risk and stays in the pipeline synchronous path.
4. The codebase precedent (`cron_state.lastRunAt`) is synchronous-in-pipeline, but cron jobs are serial by design — the comparison doesn't fully apply.

Implementation sketch:
```typescript
if (!row.lastUsedAt || row.lastUsedAt < new Date(Date.now() - 3600_000)) {
  await db.update(projectTemplateOverrides)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(...projectId), eq(...templateKey)));
}
```

---

### E.3 Migration Strategy

**Recommendation: Lazy-create only when user saves an override. No one-time migration.**

Reasoning:
1. Simpler — no migration script, no maintenance of "default override" rows.
2. Pipeline's merge logic: `const overrides = await db.select().from(projectTemplateOverrides).where(...); const effective = { ...templateDefaults, ...overrides?.[0]?.values ?? {} };`
3. The `cron_state` table follows the same lazy pattern.
4. One-time migration would create ~N×M rows (projects × templates) of empty rows that add noise and slow the `listEligibleFor` + override join.

---

## Summary

### Override Surface by Category

**Copy overrides — final de-duped list:**

| Key | Used in | DE / EN | Priority |
|-----|---------|---------|---------|
| `coverEyebrowLabel` | all cover slides | `"TOOL-VERGLEICH"` / `"TOOL COMPARISON"` | MEDIUM |
| `hookQuestion` | single-tool-spotlight CoverSlide | `"lohnt es sich?"` / `"worth it?"` | HIGH — brand voice |
| `promiseLine1` | single-tool-spotlight + use-case-verdict cover | `"Stärken & Schwächen"` / `"Strengths & weaknesses"` etc. | HIGH — brand voice |
| `promiseLine2` | single-tool-spotlight + use-case-verdict cover | `"Ehrlich. Ohne Hype."` / `"No hype answers."` etc. | HIGH — brand voice |
| `deepDiveEyebrow` | all end slides | `"ZUR VERTIEFUNG"` / `"DIVE DEEPER"` | MEDIUM |
| `ctaSaveLabel` | all end slides | `"Speichere diesen Post"` / `"Save this post"` | MEDIUM |
| `ctaSaveSubline` | all end slides | `"als Cheat-Sheet…"` / `"as your … cheat sheet"` | HIGH — brand voice |
| `ctaFollowLabel` | all end slides | `"Mehr ehrliche Vergleiche"` / `"More honest reviews"` | HIGH — brand voice |
| `ctaArticleLabel` | all end slides | `"Vollständiger Artikel"` / `"Full review"` | LOW |
| `perfektFürLabel` | ToolSlideStunning | `"Perfekt für"` (DE-only bug) | HIGH — must fix |
| `toolsRecapLabel` | EndSlideStunning | `"Tools im Detail"` (DE-only bug) | HIGH — must fix |
| `forLabel` | EndSlideStunning recap | `"für "` prefix (DE-only bug) | MEDIUM |
| `strengthsEyebrow` | StrengthsSlide | `"STÄRKEN"` / `"STRENGTHS"` | LOW |
| `topStrengthLabel` | StrengthsSlide | `"Top-Stärke"` / `"Top strength"` | LOW |
| `weaknessesLabel` | StrengthsSlide | `"Schwächen"` / `"Weaknesses"` | LOW |
| `pricingEyebrow` | PricingForWhomSlide | `"PRICING & FÜR WEN"` / `"PRICING & FOR WHOM"` | LOW |
| `forWhomLabel` | PricingForWhomSlide | `"Perfekt für"` / `"Perfect for"` | MEDIUM |
| `skipIfLabel` | PricingForWhomSlide | `"Weniger geeignet wenn…"` / `"Skip if…"` | MEDIUM |
| `useCasesHeadline` | UseCaseDetailSlide | `"Wofür?"` / `"Best for?"` | MEDIUM |
| `winnerLabel` | UseCaseVerdictSlide | `"GEWINNT"` / `"WINS"` | LOW |
| `overallResultLabel` | UseCaseVerdictRecapSlide | `"GESAMT-ERGEBNIS"` / `"OVERALL RESULT"` | LOW |
| `whoWinsLabel` | UseCaseVerdictRecapSlide | `"Wer gewinnt?"` / `"Who wins?"` | LOW |
| `allVerdictsLabel` | UseCaseVerdictRecapSlide | `"Alle Verdicts"` / `"All verdicts"` | LOW |

**Scope recommendation:** Phase 1 of Spec 57.3 should implement HIGH-priority overrides only (brand-voice copy + DE-only bug fixes). LOW-priority section labels are cosmetic and can be Phase 2.

---

**Layout knobs — final list:**

| Key | Type | Default | Templates |
|-----|------|---------|-----------|
| `includeEndSlide` | `boolean` | `true` | list-carousel (all comparison templates) |
| `showSavePrompt` | `boolean` | `true` | all end slides |
| `showFollowCTA` | `boolean` | `true` | all end slides |
| `showArticleLink` | `boolean` | `true` | all end slides |
| `showRankBadge` | `boolean` | `true` | list-carousel ToolSlide |
| `showPricingChip` | `boolean` | `true` | list-carousel ToolSlide + single-tool-spotlight PricingSlide |
| `showToolRecap` | `boolean` | `true` | list-carousel EndSlide |

---

**Eligibility parameters — final list:**

| Key | Type | Default | Templates |
|-----|------|---------|-----------|
| `minProsCount` | `number` | `2` | single-tool-spotlight |
| `maxProsCount` | `number` | `5` | single-tool-spotlight |
| `minVerdictsCount` | `number` | `3` | use-case-verdict-per-tool |
| `useCaseSlideThreshold` | `number` | `3` | single-tool-spotlight (controls slide 5) |

Note: `useCaseSlideThreshold` technically affects layout (not just eligibility), but it's a numeric gate checked in `render()`. Group with eligibility params for simplicity.

---

### Recommendations for Spec 57.3

1. **DB schema**: `project_template_overrides` table with `(projectId, templateKey)` unique constraint, a `values JSONB` column for the override values, and `lastUsedAt timestamp` + standard audit columns. Mirror the `cron_state` structure. Lazy-create only on explicit user save.

2. **Override-merge order**: `template-default ← project-override` (2-tier). Override values in `values JSONB` are shallow-merged over `TemplateDefinition.defaultOverrides`. TypeScript discriminated union per-template ensures type safety.

3. **Per-template override schema**: Each template declares an `overrideSchema: z.ZodObject<...>` alongside `TemplateDefinition`. The schema serves as the source of truth for the admin UI form. Override DB values are validated through the schema on write.

4. **`last_used_at` strategy**: Approximated — update only when `lastUsedAt < NOW() - 1h`. Prevents contention from parallel pipeline runs.

5. **Migration strategy**: Lazy — no one-time migration. Pipeline falls through to `TemplateDefinition.defaultOverrides` when no row exists.

6. **DE-only locale bug fixes**: The 8 hardcoded DE-only strings in `EndSlideStunning.tsx` and `ToolSlideStunning.tsx` should be fixed in the same PR as the override surface addition (since the override key will need both variants).

7. **`single-tool-spotlight` brand-token inconsistency**: The template passes `websiteUrl` / `instagramHandle` as flat props instead of through `brandTokens.social`. This should be normalised to match list-carousel's pattern — either in Spec 57.3 or as a separate micro-fix.

---

### Open Questions for Spec Author

1. **Copy override granularity**: Should `ctaSaveSubline` be a single overridable string per locale, or split into `ctaSaveSublinePre` (before tool name) + `ctaSaveSublinePost` (after tool name)? Single string is simpler but requires the project admin to include `${toolName}` as a literal placeholder.

2. **`includeEndSlide` — single-tool-spotlight scope**: The single-tool-spotlight doesn't have an explicit end slide toggle either. Should `includeEndSlide` be a global layout knob (applies to all templates that have an end slide) or per-template?

3. **Copy key namespace**: Should copy keys be flat (`"ctaSaveLabel"`) or template-scoped (`"endSlide.ctaSaveLabel"`)? Flat keys that are shared across templates (e.g. `ctaFollowLabel` appears in both `EndSlideStunning` and `EndSlide`) would reduce duplication; template-scoped keys allow template-specific overrides.

4. **Admin UI**: Will the override UI be in the existing project settings page (alongside brand tokens), or a separate `/projects/:slug/template-overrides` route? Affects API endpoint design.

5. **Override schema validation**: When a project admin saves overrides, should unknown keys in the `values` JSONB be rejected or silently stripped? (Recommendation: strip via Zod `.strip()` to allow schema evolution without breaking existing override rows.)

---

### Estimated Spec Complexity

| Area | Scope | Estimated days |
|------|-------|----------------|
| DB migration + `project_template_overrides` schema | 1 table, manual SQL | 0.5 |
| Copy overrides (HIGH priority only: 10 keys) | Template default declarations + merge in render() | 1.5 |
| Layout knobs (7 boolean + 1 numeric) | Component conditionals + composition-level flags | 1.5 |
| Eligibility param overrides (4 values) | Override `SINGLE_TOOL_SPOTLIGHT_CONSTRAINTS` etc. | 0.5 |
| DE-only locale bug fixes | 8 strings in EndSlideStunning + ToolSlideStunning | 0.5 |
| API endpoints (GET/PUT per project+template) | 2 routes + brand-asset-service extension | 1.0 |
| Admin UI (form per template) | Vue + Quasar form components | 2.0 |
| Tests + review-task | Unit + integration | 1.0 |
| **Total** | | **~8.5 days** |

Original estimate was 5–6 days. The DE-only locale bug fixes add ~0.5 days, and the UI is more complex than anticipated given 23 override keys across 4 templates. Recommend scoping Phase 1 to HIGH-priority copy overrides + layout knobs + eligibility params, leaving LOW-priority section labels for Phase 2.
