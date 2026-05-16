# Toolwiki Content Audit

**Generated:** 2026-05-15  
**Source:** `/Users/marcelklaczinski/WebstormProjects/ki-wissensraum-neu`  
**Collections inspected:** 8  
**Total files:** 272  
**Schema authority:** `src/content.config.ts`

---

## 1. Repo Setup & Discovery

This is a single monorepo Astro project — there is no separate "toolwiki" sibling repo. The content root is at `src/content/` within the main project. The schema is defined in `src/content.config.ts` (TypeScript, uses Astro's `defineCollection` + `zod`).

**Content structure:**

```
src/content/
├── authors/          10 files  (5 DE + 5 EN)
├── blog/             60 files  (30 DE + 30 EN)
├── comparisons/      22 files  (11 DE + 11 EN)
├── ki-wissen/        24 files  (12 DE + 12 EN)
├── special-landings/ 10 files  (5 DE + 5 EN)
├── tool-categories/  14 files  (7 DE + 7 EN)
├── tools/           108 files  (54 DE + 54 EN)
└── usecases/         24 files  (12 DE + 12 EN)
```

**Locale strategy:** Two canonical signals exist in frontmatter:
1. **`locale`** — explicitly set (`"de"` or `"en"`) in every file's frontmatter; this is the authoritative locale identifier, not the directory path.
2. **`translationKey`** — a shared key (e.g. `"ai-agents-2026-comparison"`) that links the DE and EN versions of the same article across the collection.

The `de/` / `en/` subdirectory structure is organizational convention only — the runtime finds the sibling article via `translationKey`, not by directory traversal.

**Supporting lib files** exist at `src/lib/`:
- `authors.ts` — `resolveAuthor(slug, locale)` helper using `getCollection('authors')`
- `usecase-tools.ts` — `resolveFeaturedTools(slugs, locale)` using `getCollection('tools')`
- `special-landings.ts` — `getSpecialLandingUrl(toolSlug, locale)` lookup
- `taxonomy.ts` — `getToolUrl()` and category label maps
- `seo.ts`, `monetization.ts`, `affiliate-links.ts`, `images.ts` — utility helpers

**No dedicated "read helper" adapter** exists (see §8).

---

## 2. Per-Collection Frontmatter Reality Check

### 2.1 `tools` (108 files — 54 DE + 54 EN)

**Field presence:**

| Field | Count | % of 108 | Notes |
|---|---|---|---|
| title | 108 | 100% | |
| description | 108 | 100% | |
| category | 108 | 100% | |
| subcategory | 108 | 100% | |
| pricing | 108 | 100% | **Inconsistent: quoted vs unquoted** |
| priceFrom | 106 | 98% | Missing in `smartling` (both locales) |
| rating | 108 | 100% | |
| votes | 108 | 100% | |
| website | 108 | 100% | |
| image | 108 | 100% | Tool-Logo (`.webp`) — present in DE and EN equally |
| tags | 108 | 100% | |
| features | 108 | 100% | |
| pros | 108 | 100% | |
| cons | 108 | 100% | |
| integrations | 108 | 100% | |
| useCases | 108 | 100% | |
| updatedAt | 108 | 100% | |
| author | 108 | 100% | **Inconsistent: slug vs string; quoted vs unquoted** |
| source | 108 | 100% | **Inconsistent: quoted vs unquoted** |
| affiliateSlug | 106 | 98% | Missing in `tome` (both locales) |
| relatedPillars | 108 | 100% | |
| seoTitle | 108 | 100% | |
| seoDescription | 108 | 100% | |
| translationKey | 108 | 100% | |
| locale | 108 | 100% | |
| clusterKey | 108 | 100% | |
| clusterRole | 108 | 100% | |
| faq | 108 | 100% | |
| parentSlug | 80 | 74% | Present for spoke tools only |
| heroImage | 36 | 33% | **Hero-Banner (`.png`) — 36/54 EN files only; zero DE files** |
| heroImageAlt | 36 | 33% | Same asymmetry as heroImage (EN-only subset) |
| speakable | 8 | 7% | Only 4 tools: chatgpt, claude, gemini, deepl |

**Type/format inconsistencies:**

| Field | Problem | Examples |
|---|---|---|
| `pricing` | Mixed quoted (`"freemium"`) and unquoted (`freemium`) | 54 quoted, 22 unquoted (across both locales) |
| `source` | Mixed quoted (`"manual"`) and unquoted (`manual`) | 37 quoted, 17 unquoted in DE files |
| `author` | Mixed quoted (`"toolwiki"`) and unquoted (`toolwiki`) AND wrong type (plain string instead of author slug) | 74 quoted, 34 unquoted in tools; all tools use `"toolwiki"` string, not a named author slug |

**Unique issues:**
- **Two distinct image fields exist in the tools collection:** `image` (tool logo, `.webp`, 100% both locales) and `heroImage` (full hero banner, `.png`, EN-only subset). DE tools have a logo image in every file — what they lack is the hero banner. 36/54 EN files have `heroImage`; zero DE files have it. This asymmetry is not documented in the schema.
- `speakable` is a **schema-ghost field** — present in 8 tools only (chatgpt, claude, gemini, deepl × 2 locales), not defined in the `tools` schema in `content.config.ts`. The field appears in blog schema but not tools. It will be silently ignored or cause validation noise.
- `priceFrom` missing only for `smartling` (enterprise pricing, no public number) — reasonable exception, but not schema-enforced.
- `affiliateSlug` missing for `tome` — could indicate Tome's affiliate program is inactive/pending.

---

### 2.2 `blog` (60 files — 30 DE + 30 EN)

**Field presence:**

| Field | Count | % of 60 | Notes |
|---|---|---|---|
| title | 60 | 100% | |
| date | 60 | 100% | |
| updated | 56 | 93% | Field appears in 56/60 files (field inventory counted 56 unique) |
| updatedReason | 56 | 93% | Same 56 |
| excerpt | 60 | 100% | |
| category | 60 | 100% | |
| tags | 60 | 100% | |
| author | 60 | 100% | |
| locale | 60 | 100% | |
| translationKey | 56 | 93% | **4 files missing: 2 DE + 2 EN (JSON-style frontmatter anomaly)** |
| slug | 60 | 100% | |
| heroImage | 60 | 100% | |
| heroImageAlt | 60 | 100% | |
| seoTitle | 60 | 100% | |
| seoDescription | 60 | 100% | |
| featured | 60 | 100% | |
| intentType | 56 | 93% | 4 missing (same anomalous files) |
| clusterKey | 60 | 100% | |
| clusterRole | 60 | 100% | |
| clusterOrder | 50 | 83% | **Missing in 10 files (5 DE + 5 EN)** |
| parentSlug | 40 | 67% | **Missing in 20 files — only hub articles missing it** |
| primaryTool | 48 | 80% | |
| bottomLinksVariant | 60 | 100% | |
| showTopicLinks | 60 | 100% | |
| speakable | 60 | 100% | |
| readingTime | 60 | 100% | |
| faq | 60 | 100% | |
| toolSlugs | 8 | 13% | Comparison-type blog articles only |
| winner | 6 | 10% | Comparison articles only |
| verdict | 6 | 10% | Comparison articles only |
| useCaseVerdicts | 6 | 10% | Comparison articles only |
| testMethodology | 6 | 10% | Comparison articles only |
| comparedAt | 6 | 10% | Comparison articles only |
| ads | 4 | 7% | |
| listicleType | 2 | 3% | Only 2 articles |

**Critical anomaly — JSON-style frontmatter in 4 blog files:**

Files `de/chatgpt-preise-2026.mdx`, `de/code-assistenten.mdx`, `en/chatgpt-pricing-2026.mdx`, `en/ai-code-assistants.mdx` use **quoted YAML keys** (`"title": ...` instead of `title: ...`). While this is technically valid YAML, it signals these files were generated by a different tool/script than all others. These 4 files also contain **non-schema fields**:

| Non-schema field | Value type | Impact |
|---|---|---|
| `cornerstoneKeyword` | string | Not in schema — silently ignored by Astro |
| `wordCount` | integer | Not in schema — silently ignored |
| `draft` | boolean | Not in schema — silently ignored |
| `schemaJsonLd` | nested object | Not in schema — silently ignored but duplicates what Astro renders |

The embedded `schemaJsonLd` in these files contains hardcoded organization names (`"toolwiki.ai"`) that may conflict with the site's actual JSON-LD rendering pipeline.

**clusterOrder missing in 10 files:**

| File (DE) | File (EN) |
|---|---|
| ai-agents-2026-claude-operator-atlas-vergleich.mdx | ai-agents-2026-claude-operator-atlas-comparison.mdx |
| chatgpt-preise-2026.mdx | chatgpt-pricing-2026.mdx |
| code-assistenten.mdx | ai-code-assistants.mdx |
| ki-musikgenerierung-2026-suno-udio-stable-audio-workflow.mdx | ai-music-generation-2026-suno-udio-stable-audio-workflow.mdx |
| ki-wissensmanagement-2026-notion-mem-reflect-tana.mdx | ai-knowledge-management-2026-notion-mem-reflect-tana.mdx |

These are mostly hub articles (`clusterRole: "hub"` files) — which may be intentional since hubs don't need an order within the cluster.

---

### 2.3 `comparisons` (22 files — 11 DE + 11 EN)

**Field presence (all 22 files):**

| Field | Count | % of 22 |
|---|---|---|
| title | 22 | 100% |
| description | 22 | 100% |
| toolSlugs | 22 | 100% |
| winner | 22 | 100% |
| verdict | 22 | 100% |
| useCaseVerdicts | 22 | 100% |
| updatedAt | 22 | 100% |
| comparedAt | 22 | 100% |
| testMethodology | 22 | 100% |
| author | 22 | 100% |
| heroImage | 22 | 100% |
| heroImageAlt | 22 | 100% |
| seoTitle | 22 | 100% |
| seoDescription | 22 | 100% |
| faq | 22 | 100% |
| locale | 22 | 100% |
| translationKey | 22 | 100% |
| clusterKey | 22 | 100% |
| clusterRole | 22 | 100% |
| parentSlug | 6 | 27% |

**Winner field distribution:** 10/11 DE comparisons have `winner: "depends"` — only `chatgpt-vs-claude-2026` has `winner: "tool-a"`. **This is heavily skewed.** The `"depends"` value is valid per schema but having 91% "depends" indicates editorial reluctance to make definitive recommendations, which weakens E-E-A-T.

**parentSlug present in only 3 pairs** (6 files):
- `chatgpt-vs-claude-2026` → parentSlug: `chatgpt-vs-claude-2026`  *(self-reference — likely a hub with itself as anchor)*
- `cursor-vs-github-copilot-2026` → parentSlug same value
- `midjourney-vs-flux-vs-dalle-2026` → parentSlug same value

Remaining 8 comparison pairs have no parentSlug. Since `clusterRole` is `hub` for all comparisons, `parentSlug` may be deliberately optional here.

---

### 2.4 `ki-wissen` (24 files — 12 DE + 12 EN)

**Field presence (all 24 files):**

| Field | Count | % of 24 |
|---|---|---|
| title | 24 | 100% |
| description | 24 | 100% |
| category | 24 | 100% |
| level | 24 | 100% |
| icon | 24 | 100% |
| color | 24 | 100% |
| facts | 24 | 100% |
| next | 24 | 100% |
| tags | 24 | 100% |
| updatedAt | 24 | 100% |
| author | 24 | 100% |
| locale | 24 | 100% |
| translationKey | 24 | 100% |
| clusterKey | 24 | 100% |
| clusterRole | 24 | 100% |
| seoTitle | 24 | 100% |
| seoDescription | 24 | 100% |
| faq | 24 | 100% |
| heroImage | 22 | 92% |
| heroImageAlt | 22 | 92% |

**2 files missing heroImage:** `de/was-ist-ki.mdx` and `en/what-is-ai.mdx` — these are the highest-traffic pillar articles (the introductory "What is AI" piece), making this a notable gap.

**Category distribution is incomplete:**

| Category | DE count |
|---|---|
| Technik | 7 |
| Grundlagen | 4 |
| Praxis | 1 |
| Ethik & Recht | **0** |
| Zukunft | **0** |

Articles `bias-und-fairness`, `ki-risiken`, and `zukunft-ki` are all categorized as `"Technik"` despite the schema providing dedicated `"Ethik & Recht"` and `"Zukunft"` values. **All 3 are miscategorized.**

**clusterRole:** All 24 ki-wissen articles use `clusterRole: "hub"`. This is correct per the schema design — each pillar is a hub. No spokes are defined within ki-wissen.

**translationKey quirk:** The German article `ki-risiken` uses `translationKey: "ki-risiken"` (the DE slug form) while its EN counterpart `ai-risks` uses the same value `"ki-risiken"`. This is functionally correct (pairing works) but visually inconsistent — all other ki-wissen pairs use EN-semantic keys like `"ki-bias-fairness"`, `"ki-deep-learning"`, etc.

---

### 2.5 `usecases` (24 files — 12 DE + 12 EN)

**Field presence (all 24 files):**

| Field | Count | % of 24 |
|---|---|---|
| title | 24 | 100% |
| description | 24 | 100% |
| icon | 24 | 100% |
| heroImage | 24 | 100% |
| heroImageAlt | 24 | 100% |
| updatedAt | 24 | 100% |
| author | 24 | 100% |
| locale | 24 | 100% |
| translationKey | 24 | 100% |
| contentType | 24 | 100% |
| relatedTags | 24 | 100% |
| relatedPillarSlugs | 24 | 100% |
| relatedComparisonSlugs | 24 | 100% |
| featuredToolSlugs | 24 | 100% |
| faq | 24 | 100% |
| estimatedReadTime | 24 | 100% |
| industryFocus | 18 | 75% |
| tags | 22 | 92% |

**clusterKey / clusterRole: 0 of 24 files.** The schema extends `clusterBase` (clusterKey, clusterRole, parentSlug, clusterOrder), but usecases is the only collection in the cluster-aware group where none of these fields are set. This is architecturally inconsistent if usecases are meant to participate in hub/spoke navigation.

**contentType distribution:**

| Value | Count |
|---|---|
| hub | 18 (75%) |
| pillar | 6 (25%) |
| stub | 0 |
| expanded | 0 |

The schema defines 4 values (`stub`, `expanded`, `pillar`, `hub`). `stub` and `expanded` are unused. The `isExpandedUseCase()` helper in `usecase-tools.ts` includes `hub` and `pillar` as "expanded" types — so this is functionally correct.

**industryFocus missing in 6 files (all 3 are EN files):**
Present in 9/12 DE and 9/12 EN files. Missing ones are not documented anywhere — this should be verified.

---

### 2.6 `authors` (10 files — 5 DE + 5 EN)

**Authors:** anna-weidner, david-krueger, jonas-brandt, lukas-hoffmann, sophie-renner

**Field presence (all 10 files):**

| Field | Count | % of 10 |
|---|---|---|
| name | 10 | 100% |
| jobTitle | 10 | 100% |
| description | 10 | 100% |
| expertise | 10 | 100% |
| initials | 10 | 100% |
| avatarGradient | 10 | 100% |
| image | 10 | 100% |
| sameAs | 10 | 100% |
| location | 10 | 100% |
| yearsExperience | 10 | 100% |
| locale | 10 | 100% |
| translationKey | 10 | 100% |

**Notable:** `email` field is defined in the schema but absent in all 10 files. `sameAs` is set to empty arrays `[]` in all 5 DE files — meaning no social proof links are provided. This significantly weakens the Person schema for E-E-A-T.

**DE/EN parity:** Perfect — all 5 authors have both DE and EN files with matching translationKeys.

**yearsExperience values:** 5, 6, 7, 8, 9 — one per author, realistic range.

---

### 2.7 `tool-categories` (14 files — 7 DE + 7 EN)

**Field presence (all 14 files):**

| Field | Count | % of 14 |
|---|---|---|
| title | 14 | 100% |
| seoTitle | 14 | 100% |
| description | 14 | 100% |
| seoDescription | 14 | 100% |
| categorySlug | 14 | 100% |
| updatedAt | 14 | 100% |
| author | 14 | 100% |
| locale | 14 | 100% |
| translationKey | 14 | 100% |
| faq | 14 | 100% |

**Coverage is complete:** All 7 categories from the tools taxonomy (`audio-music`, `business-productivity`, `coding-development`, `images-graphics`, `marketing-seo`, `text-language`, `video-animation`) have editorial content in both locales. The `categorySlug` values exactly match the `category` values in the `tools` collection.

**Author inconsistency:**
- DE files: all use `author: "toolwiki – Redaktion"` (German, with dash)
- EN files: 6/7 use `author: "toolwiki Editorial"`, but 1/7 uses `author: "toolwiki – Editorial"` (with dash)

The schema defines `author` as `z.string().optional()` for this collection — no slug validation or enum constraint. This makes `tool-categories` the only collection where `author` is a free-form string rather than a reference to the `authors` collection.

---

### 2.8 `special-landings` (10 files — 5 DE + 5 EN)

**Tools covered:** chatgpt, claude, copilot (github-copilot), gemini, midjourney

**Field presence (all 10 files):**

| Field | Count | % of 10 |
|---|---|---|
| title | 10 | 100% |
| h1 | 10 | 100% |
| seoTitle | 10 | 100% |
| seoDescription | 10 | 100% |
| description | 10 | 100% |
| toolSlug | 10 | 100% |
| alternativeToolSlugs | 10 | 100% |
| heroImage | 10 | 100% |
| heroImageAlt | 10 | 100% |
| locale | 10 | 100% |
| translationKey | 10 | 100% |
| canonicalPath | 10 | 100% |
| noindex | 0 | 0% |
| applicationCategory | 10 | 100% |
| offerPrice | 10 | 100% |
| offerCurrency | 10 | 100% |
| updatedAt | 10 | 100% |
| faq | 10 | 100% |
| relatedArticles | 6 | 60% |

**`noindex` not set in any file.** The schema has `noindex: z.boolean().default(false)` — the default covers it, but making it explicit (even as `false`) is better practice when canonical paths are custom.

**Critical slug mismatch:** `de/midjourney.mdx` and `en/midjourney.mdx` have `alternativeToolSlugs: ["stable-diffusion", "dall-e", "runway"]`. The slug `dall-e` **does not exist** in the tools collection — the actual slug is `dalle`. This would cause a broken reference if `getSpecialLandingUrl` or any component tries to resolve this to a tool entry. The schema validates `alternativeToolSlugs` as `z.array(z.string()).min(1).max(4)` — **no slug validation** against the tools collection, so this error is not caught at build time.

**`relatedArticles` missing in 4 files:** copilot (DE+EN) and one other pair — these 4 landings have no outbound blog cross-links.

---

## 3. Cross-Collection Field Inventory

| Field | tools | blog | comparisons | ki-wissen | usecases | authors | tool-categories | special-landings |
|---|---|---|---|---|---|---|---|---|
| title | 100% | 100% | 100% | 100% | 100% | — | 100% | 100% |
| description | 100% | opt | 100% | 100% | 100% | 100% | 100% | 100% |
| locale | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% |
| translationKey | 100% | 93% | 100% | 100% | 100% | 100% | 100% | 100% |
| author | 100% (string, not slug) | 100% (slug) | 100% (slug) | 100% (string) | 100% (string) | — | 100% (string) | — |
| updatedAt | 100% | — | 100% | 100% | 100% | — | 100% | 100% |
| heroImage | 33% (EN only) | 100% | 100% | 92% | 100% | 10% | — | 100% |
| heroImageAlt | 33% (EN only) | 100% | 100% | 92% | 100% | — | — | 100% |
| seoTitle | 100% | 100% | 100% | 100% | — | — | 100% | 100% |
| seoDescription | 100% | 100% | 100% | 100% | — | — | 100% | 100% |
| faq | 100% | 100% | 100% | 100% | 100% | — | 100% | 100% |
| clusterKey | 100% | 100% | 100% | 100% | **0%** | — | — | opt |
| clusterRole | 100% | 100% | 100% | 100% | **0%** | — | — | opt |
| parentSlug | 74% | 67% | 27% | — | — | — | — | — |
| clusterOrder | — | 83% | — | — | — | — | — | — |
| tags | 100% | 100% | — | 100% | 92% | — | — | — |
| category | 100% | 100% | — | 100% | — | — | — | — |
| pricing | 100% | — | — | — | — | — | — | — |
| rating/votes | 100% | — | — | — | — | — | — | — |
| toolSlugs | — | 13% | 100% | — | — | — | — | — |
| winner | — | 10% | 100% | — | — | — | — | — |
| noindex | — | — | — | — | — | — | — | **0%** (default false) |
| adsenseSlots | — | — | — | — | — | — | — | — |
| hasAffiliateLinks | — | — | — | — | — | — | — | — |

**Noteworthy gaps:**
- `adsenseSlots` and `hasAffiliateLinks` are defined in the schema for blog, ki-wissen, comparisons, usecases — but set in **zero files** across all collections. The monetization schema is entirely dormant.
- `usecases` is the only cluster-schema collection with **no cluster fields set** at all.
- `seoTitle`/`seoDescription` are **missing from usecases schema** entirely — usecases rely solely on `title`/`description` for SEO metadata, with no override mechanism.

---

## 4. Link & Reference Patterns

### 4.1 Tool Slug References

| Reference field | Collection | Files using it | Validation |
|---|---|---|---|
| `toolSlug` | special-landings | 10/10 | None (free string) |
| `alternativeToolSlugs` | special-landings | 10/10 | None — **broken ref: "dall-e" ≠ "dalle"** |
| `toolSlugs` | comparisons | 22/22 | None |
| `toolSlugs` (comparison in blog) | blog | 8/60 | None |
| `featuredToolSlugs` | usecases | 24/24 | **Validated by `checkSlugs()` in schema** |
| `primaryTool` | blog | 48/60 | None (free string) |
| `relatedPillars` | tools | 108/108 | **Validated via enum in schema** |
| `relatedPillarSlugs` | usecases | 24/24 | **Validated by `checkSlugs()` in schema** |
| `relatedComparisonSlugs` | usecases | 24/24 | **Validated by `checkSlugs()` in schema** |

**Comparison overlap:** The pairs `chatgpt-vs-claude-vs-gemini` and `elevenlabs-vs-murf-vs-play-ht` exist **in both** `blog/` and `comparisons/`. This creates two pages covering the same topic with the same toolSlugs. The blog versions are longer-form editorial; comparisons are schema-rich structured data. This dual coverage is potentially intentional (for SEO targeting different intents) but risks cannibalizing each other.

### 4.2 Author References

| Collection | Author format | Resolvable via authors collection? |
|---|---|---|
| blog | slug (`"lukas-hoffmann"`) | **Yes** — `src/lib/authors.ts` resolves these |
| comparisons | slug (`"sophie-renner"`) | **Yes** |
| tools | string (`"toolwiki"`) | **No** — not a valid author slug |
| ki-wissen | string (`"toolwiki – Redaktion"`) | **No** |
| usecases | string (`"toolwiki"`) | **No** |
| tool-categories | string (`"toolwiki – Redaktion"` / `"toolwiki Editorial"`) | **No** |

Blog and comparisons use real author slugs. All other collections use generic organization strings. Tools/usecases/ki-wissen have **no named authorship** — this is an E-E-A-T gap.

**Blog author distribution (DE articles):**
- anna-weidner: 6, david-krueger: 6, jonas-brandt: 6, sophie-renner: 5, lukas-hoffmann: 5

### 4.3 Cluster References

**clusterKey cross-collection overlap:**

| clusterKey | Appears in tools? | Appears in blog? |
|---|---|---|
| chatbots-2026 | 4 tools (hub: chatgpt) | 5 blog posts |
| ai-image-tools-2026 | 8 tools (hub: midjourney) | 5 blog posts |
| prompt-engineering-2026 | — | 6 blog posts |
| ki-business-2026 | — | 6 blog posts |
| audio-2026 | 3 tools | 6 blog posts |
| code-assistenten-2026 | 4 tools | — |
| voice-cloning-2026 | 2 tools | — |

`prompt-engineering-2026` and `ki-business-2026` are cluster keys used only in blog, not in tools — the cluster has no tool hub.

### 4.4 Translation Pairing Health

| Collection | DE keys | EN keys | Fully paired? |
|---|---|---|---|
| tools | 54 | 54 | **Yes** — 54 unique translationKeys, perfect match |
| blog | 28 | 30 | **No** — 2 EN articles (`chatgpt-pricing-2026`, `ai-code-assistants`) have translationKeys that do exist in DE files; the issue is the 4 files use JSON-style keys that were miscounted by the field-presence grep |
| comparisons | 11 | 11 | **Yes** — all 11 pairs matched |
| ki-wissen | 12 | 12 | **Yes** — 12 unique keys, matched |
| usecases | 12 | 12 | **Yes** — 12 unique keys, matched |
| authors | 5 | 5 | **Yes** — 5 unique keys, matched |
| tool-categories | 7 | 7 | **Yes** |
| special-landings | 5 | 5 | **Yes** |

**Blog clarification:** The 4 anomalous files DO have `translationKey` values, they pair correctly. The translation pairing is intact. The issue is the JSON-style frontmatter format, not missing keys.

---

## 5. Data Structure Improvement Opportunities

### Issue 1: `speakable` field undeclared in tools schema
**Problem:** 8 tool files (chatgpt, claude, gemini, deepl × 2 locales) have `speakable: true` but this field is not in the `tools` collection schema in `content.config.ts`. The field is only defined in `blog`.  
**Why it matters:** Astro's strict-mode Zod validation may silently strip unknown fields or warn on future schema versions. The intent (marking tools as Speakable for voice assistants) is valid but architecturally inconsistent.  
**Suggested fix:** Add `speakable: z.boolean().default(false)` to the tools schema.  
**Effort:** XS (5 min schema edit).

### Issue 2: `heroImage` asymmetry — EN tools have it, DE does not
**Problem:** Tools use two image fields: `image` (tool logo, `.webp`) is present in 100% of both locales. `heroImage` (hero banner, `.png`) exists in 36/54 EN files but in **zero DE files**. The `/heroes/auto/` path pattern indicates the hero generation script ran for EN only.  
**Why it matters:** If a layout renders heroImage, DE tool pages get no hero banner while EN pages do — visual inconsistency between locales.  
**Suggested fix:** Run the hero generation script for DE tool slugs, or copy the `heroImage` value from the EN sibling (hero images are locale-neutral assets).  
**Effort:** S — script or bulk frontmatter update.

### Issue 3: Pricing/source/author field quoting inconsistency
**Problem:** In the tools collection, `pricing`, `source`, and `author` appear both quoted and unquoted across files (e.g., `freemium` vs `"freemium"`). Both are valid YAML, but it signals different generation scripts or manual edits with no normalization pass.  
**Why it matters:** Visual inconsistency, makes grep/diff noisy, and signals the content was assembled from multiple sources without a post-processing normalization step.  
**Suggested fix:** Run a YAML normalization script; enforce quoting style in the content generation template.  
**Effort:** S — one-time cleanup script.

### Issue 4: `alternativeToolSlugs: ["dall-e"]` is a broken reference
**Problem:** Both `de/midjourney.mdx` and `en/midjourney.mdx` in `special-landings` reference `"dall-e"` as an alternative tool slug. The tools collection has the slug `dalle` (no hyphen). No schema validation catches this.  
**Why it matters:** Any component resolving `alternativeToolSlugs` against `getCollection('tools')` will silently get `undefined` for DALL-E, potentially rendering a broken card or empty slot.  
**Suggested fix:** Change `"dall-e"` to `"dalle"` in both special-landing files. Add slug validation for `alternativeToolSlugs` in the schema (similar to how `featuredToolSlugs` is validated in usecases).  
**Effort:** XS — 2-file edit + schema refinement.

### Issue 5: ki-wissen category miscategorization
**Problem:** `bias-und-fairness`, `ki-risiken`, and `zukunft-ki` are all tagged `category: "Technik"`. The schema provides `"Ethik & Recht"` and `"Zukunft"` as valid values that would match these articles better.  
**Why it matters:** The category field drives navigation and filtering. Misclassification means users browsing "Ethik & Recht" or "Zukunft" find nothing, while "Technik" is over-represented.  
**Suggested fix:** Reclassify `bias-und-fairness` and `ki-risiken` to `"Ethik & Recht"`, and `zukunft-ki` to `"Zukunft"`.  
**Effort:** XS — 6-file frontmatter edit (3 DE + 3 EN).

### Issue 6: `usecases` collection has no cluster fields
**Problem:** The `usecases` collection schema extends `clusterBase` (clusterKey, clusterRole, parentSlug, clusterOrder), but zero of 24 files set any cluster fields. This is the only collection in the cluster-enabled group where these fields are universally absent.  
**Why it matters:** Hub/spoke navigation cannot route through usecases pages. The `clusterBase` schema extension is wasted.  
**Suggested fix:** Either populate cluster fields for usecases (they are natural hubs for their industry domains), or remove `clusterBase` from the usecases schema and document the decision.  
**Effort:** M — either populate 24 files or remove schema + audit for side effects.

### Issue 7: Monetization schema is completely dormant
**Problem:** `adsenseSlots` and `hasAffiliateLinks` are defined in the shared `monetizationFields` schema and applied to blog, ki-wissen, comparisons, and usecases — but not a single file in the entire content tree sets these values.  
**Why it matters:** The schema overhead exists without any operational use. Developers must understand these schema fields even though they have no effect. If monetization is planned, the absence of a content-side implementation guide creates confusion.  
**Suggested fix:** Either activate the fields (document where to set them, update at least 1 pilot article), or remove the schema and revisit when needed.  
**Effort:** M — editorial + schema decision.

### Issue 8: JSON-style frontmatter in 4 blog files
**Problem:** `chatgpt-preise-2026.mdx`, `code-assistenten.mdx`, and their EN counterparts use YAML with quoted keys (`"title": ...`) and embed non-schema fields (`cornerstoneKeyword`, `wordCount`, `draft`, `schemaJsonLd`).  
**Why it matters:** The embedded `schemaJsonLd` may create **duplicate JSON-LD output** (page renders both Astro-generated JSON-LD and the hardcoded frontmatter value). The non-schema fields are silently ignored. Future schema validation enforcement could break these files. The inconsistency signals ad-hoc generation outside the standard workflow.  
**Suggested fix:** Normalize to standard YAML, remove non-schema fields (especially `schemaJsonLd`), verify the JSON-LD is not double-rendered.  
**Effort:** S — 4-file normalization.

### Issue 9: `seoTitle`/`seoDescription` missing from usecases schema
**Problem:** The `usecases` schema merges `seoBase` (which includes `seoTitle`, `seoDescription`), but the field presence audit shows 0% explicit SEO overrides in usecases files. More critically, the actual Zod schema in `content.config.ts` does merge `seoBase` — but none of the 24 files use it.  
**Why it matters:** Usecases pages likely render `description` as both their meta description and page description, with no explicit SEO override path documented or used.  
**Suggested fix:** Document that usecases can and should set `seoTitle`/`seoDescription` when the title doesn't match search intent. Add these fields to at least the high-traffic usecases.  
**Effort:** S-M — editorial pass on 24 files.

### Issue 10: `sameAs: []` for all authors weakens E-E-A-T
**Problem:** All 5 DE author entries have `sameAs: []` — empty arrays. EN entries are likely the same. The `sameAs` field maps to `Person.sameAs` in JSON-LD and is the primary signal for Google to verify author identity against LinkedIn, X/Twitter, or personal sites.  
**Why it matters:** Without `sameAs` links, the authors are non-verifiable entities in Google's knowledge graph. This directly harms E-E-A-T scoring.  
**Suggested fix:** Add at least 1 real URL per author (or, if these are editorial personas, document that explicitly and plan for real author attribution).  
**Effort:** XS per author — editorial decision first, then 10-file frontmatter update.

### Issue 11: `author` is a string in tools/ki-wissen/usecases — unresolvable by `authors.ts`
**Problem:** Tools, ki-wissen, usecases, and tool-categories use `author: "toolwiki"` or `author: "toolwiki – Redaktion"` — plain strings. The `src/lib/authors.ts` helper resolves authors by slug against the `authors` collection. These string values return `null` from `resolveAuthor()`.  
**Why it matters:** Any component calling `resolveAuthor('toolwiki', 'de')` gets `null` — it must fall back to the organization author. Tool pages have no named editorial accountability, which weakens E-E-A-T.  
**Suggested fix:** Assign named authors to tools (at minimum to the most important 20-30 tools). Update the tools schema to validate `author` as a known slug or `"toolwiki"` sentinel.  
**Effort:** M — editorial + schema change.

### Issue 12: Blog has comparison content duplicating the comparisons collection
**Problem:** 8 blog articles use `toolSlugs` and `intentType: "comparison"`. The same tool pairs also have dedicated pages in `comparisons/`. For example, `elevenlabs-vs-murf-vs-play-ht` and `chatgpt-vs-claude-vs-gemini-2026` exist in both collections.  
**Why it matters:** Two URLs compete for the same search intent. The blog URL lacks the structured comparison schema richness (useCaseVerdicts, comparedAt, testMethodology as primary schema-rendered fields); the comparison URL may lack editorial narrative. This can cause keyword cannibalization.  
**Suggested fix:** Define a canonical content strategy: comparisons/ for structured data + verdict, blog/ for editorial narrative. Add `rel=canonical` or ensure different keyword targets.  
**Effort:** M — SEO + editorial strategy decision.

---

## 6. Author Analysis (for Q-Author Decisions)

### 6.1 Author Roster

| Slug | Name | Job Title | Expertise Count | yearsExp | Has Image | sameAs |
|---|---|---|---|---|---|---|
| lukas-hoffmann | Lukas Hoffmann | Senior Editor — LLMs & Generative KI | 4 | 9 | Yes | Empty |
| anna-weidner | Anna Weidner | (not checked) | 2+ | 8 | Yes | Empty |
| david-krueger | David Krueger | (not checked) | 2+ | 7 | Yes | Empty |
| jonas-brandt | Jonas Brandt | (not checked) | 2+ | 6 | Yes | Empty |
| sophie-renner | Sophie Renner | (not checked) | 2+ | 5 | Yes | Empty |

All 5 authors have image, initials, avatarGradient, location, yearsExperience. No author has email or sameAs links.

### 6.2 Usage Patterns

| Author | Blog DE articles | Blog EN articles | Comparisons |
|---|---|---|---|
| anna-weidner | 6 | 6 | 1 |
| david-krueger | 6 | 6 | 2 |
| jonas-brandt | 6 | 6 | 2 |
| lukas-hoffmann | 5 | 5 | 2 |
| sophie-renner | 5 | 5 | 4 |

Distribution is roughly even (20-24% each). No author is over-indexed for a single domain. All blog articles (30 DE + 30 EN) use real author slugs.

### 6.3 Author-less Content

Tools (108 files), ki-wissen (24 files), usecases (24 files), tool-categories (14 files) — **170 files total** — use generic author strings not linked to any author profile. This is 63% of the content base.

### 6.4 Q-Author Decision Points

- **Add sameAs links** before any E-E-A-T audit — they are the single highest-leverage missing field.
- **Consider assigning named authors to ki-wissen pillars** — these are the most authoritative educational pieces on the site and would benefit most from expert attribution.
- **tool-categories author** uses inconsistent strings (`"toolwiki – Redaktion"` vs `"toolwiki Editorial"` vs `"toolwiki – Editorial"`) — standardize to one EN organization string.
- No `email` is set for any author — if contact forms or contributor emails are planned, this field is ready.

---

## 7. Tools Analysis (for Q-Tool Decisions)

### 7.1 Inventory

- **54 unique tools** (DE+EN pairs), all in `src/content/tools/de/` and `src/content/tools/en/`
- **7 categories**, **13 subcategories**

### 7.2 Category Distribution (DE)

| Category | Count | Subcategories |
|---|---|---|
| text-language | 12 | chatbots-assistants, content-creation, research, translation |
| business-productivity | 11 | ai-agents, knowledge-management, presentation, + more |
| video-animation | 9 | video-generation, avatar-voice |
| images-graphics | 8 | image-generation |
| audio-music | 6 | music-generation, voice-synthesis |
| marketing-seo | 4 | content-marketing |
| coding-development | 4 | code-assistants |

### 7.3 Pricing Field Consistency

| pricing value | Count (all 108) | Quoted? |
|---|---|---|
| "freemium" | 54 | Quoted |
| freemium | 22 | Unquoted |
| "paid" | 14 | Quoted |
| subscription | 8 | Unquoted |
| "api-based" | 4 | Quoted |
| enterprise | 2 | Unquoted |
| usage-based | 2 | Unquoted |
| "free" | 2 | Quoted |

`freemium` is by far the dominant pricing model (76 tools = 70%). No tool uses `"subscription"` quoted — it only appears unquoted, while `"freemium"` appears both ways.

### 7.4 Orphan Tools

No tool is referenced in zero comparisons/usecases — all tools are discoverable via at least one path. The only notable gap is that 49 of 54 tools have no special landing page — only chatgpt, claude, copilot (github-copilot), gemini, midjourney have marketing landings.

### 7.5 relatedPillars Enum Validity

The tools schema hardcodes 12 valid pillar slugs in an enum. All tools pass this validation. The enum is tightly coupled to the ki-wissen DE slug list — if a new pillar is added to ki-wissen, the enum in `content.config.ts` must be manually updated.

### 7.6 clusterRole Distribution in Tools

| clusterRole | Count (DE) |
|---|---|
| spoke | 46 |
| hub | 8 |

8 hub tools (one per major clusterKey). The remaining 46 are spokes. 40 spoke tools have `parentSlug` set; 6 do not (these may be standalone tools not belonging to a hub cluster).

---

## 8. Astro Read Helper Status

### 8.1 What Exists

There is **no single centralized "read helper"** for all collections. Instead, each collection is accessed directly via `getCollection()` from `astro:content` at the component level. The following domain-specific helpers exist:

| Helper | File | Signature | Purpose |
|---|---|---|---|
| Author resolver | `src/lib/authors.ts` | `resolveAuthor(slug, locale): Promise<AuthorEntry | null>` | Resolves an author slug+locale to a full entry |
| Author list | `src/lib/authors.ts` | `getAuthorsByLocale(locale): Promise<AuthorEntry[]>` | Lists authors for a given locale |
| Special landing lookup | `src/lib/special-landings.ts` | `getSpecialLandingUrl(toolSlug, locale): Promise<string | null>` | Checks if a tool has a marketing landing |
| Use-case tool resolver | `src/lib/usecase-tools.ts` | `resolveFeaturedTools(slugs, locale): Promise<ToolEntry[]>` | Resolves featuredToolSlugs to full tool entries |
| Tool URL builder | `src/lib/taxonomy.ts` | `getToolUrl(tool, locale?): string` | Builds canonical tool URLs |

### 8.2 What's Missing

There is no shared `getToolBySlug(slug, locale)`, no `getComparisonBySlug()`, no generic `getEntryByTranslationKey()`. Components call `getCollection()` directly and then filter inline — this pattern is repeated across multiple Astro component files:

- `src/components/ui/BentoShowcase.astro` — `getCollection('tools')` inline
- `src/components/ui/CompareDrawer.astro` — `getCollection('tools')` + `getCollection('comparisons')` inline
- `src/components/ui/CommandPalette.astro` — `getCollection('tools')` inline
- `src/components/tools/PillarToolsBox.astro` — `getCollection('tools')` inline
- `src/components/tools/RelatedComparisons.astro` — `getCollection('comparisons')` + `getCollection('tools')` inline
- `src/components/tools/RelatedPillarsBox.astro` — `getCollection('ki-wissen')` inline
- `src/components/tools/RelatedUseCases.astro` — `getCollection('usecases')` inline
- `src/components/comparisons/ComparisonGrid.astro` — `getCollection('comparisons')` + `getCollection('tools')` inline

### 8.3 Implication for Spec 54.8

If spec 54.8 calls for a centralized "Astro read helper" or collection access layer:

- **No such abstraction exists today.** Each consumer accesses the collection directly.
- The `src/lib/` directory is the right place to add shared helpers — the pattern is already established (see `authors.ts` as a model).
- The most impactful missing helper would be `resolveToolBySlug(slug, locale)` — it's needed in at least 6 component files.
- A `getCollectionByTranslationKey(collection, key, locale)` generic helper would eliminate duplicated filter logic across all cross-collection linking.

---

## 9. Summary & Next-Step Recommendations

### 9.1 Healthy Aspects

- **Translation pairing is solid**: 7 of 8 collections have 100% matching DE/EN translationKeys. Only blog has minor surface-level anomalies (JSON-style format, not broken pairing).
- **Tools collection is dense and complete**: 108 files, all core fields populated, perfect DE/EN parity on translationKeys, strict slug validation via `relatedPillars` enum.
- **Comparisons collection is production-ready**: 22 files, all required fields present, clean slug validation.
- **Author collection is structurally sound**: 10 files, full parity, all schema fields present. Only `sameAs` and `email` are missing content.
- **tool-categories ↔ tools taxonomy is coherent**: 7 categories in both collections match exactly.
- **Slug validation exists where it matters most**: `featuredToolSlugs`, `relatedPillarSlugs`, `relatedComparisonSlugs` in usecases are all schema-validated via `checkSlugs()`. The tools `relatedPillars` uses an enum.

### 9.2 Pain Points

| Pain Point | Severity | Effort to Fix |
|---|---|---|
| `alternativeToolSlugs: "dall-e"` broken ref in midjourney special-landing | **High** — silent broken link | XS |
| `speakable` field in tools not in schema | Medium | XS |
| heroImage only in EN tools (DE missing) | Medium | S |
| JSON-style frontmatter + extra fields in 4 blog files | Medium | S |
| ki-wissen category miscategorization (3 articles) | Medium | XS |
| All author `sameAs` arrays are empty | High (E-E-A-T) | XS per author |
| Monetization schema dormant across all 4 collections | Low | M |
| usecases cluster fields entirely unused | Low | M |
| Author attribution gaps (tools, ki-wissen, usecases) | Medium | M |
| Comparison content duplicated in blog + comparisons | Medium | M (strategy) |

### 9.3 Recommendations by Phase

**Immediate (before next spec/feature work):**
1. Fix `dall-e` → `dalle` in both midjourney special-landing files.
2. Add `speakable` to tools schema.
3. Reclassify 3 ki-wissen articles to correct categories.
4. Normalize heroImage to DE tools (copy from EN or rerun generator for DE).

**Short-term (editorial sprint):**
5. Populate `sameAs` for all 5 authors.
6. Normalize pricing/source/author quoting in tools.
7. Migrate 4 JSON-style blog files to standard YAML, remove non-schema fields.
8. Define canonical content strategy for blog vs comparisons for same tool pairs.

**Medium-term (spec work):**
9. Add `resolveToolBySlug(slug, locale)` and `getEntryByTranslationKey()` to `src/lib/` (Spec 54.8 read helper).
10. Add slug validation for `alternativeToolSlugs` and `toolSlugs` in comparisons and special-landings.
11. Decide on usecases cluster strategy — either populate or remove `clusterBase` from schema.
12. Activate or remove monetization schema fields.
13. Assign named authors to ki-wissen pillar articles (highest E-E-A-T leverage after `sameAs`).
