# Hashtag Research Decisions (Theme 57.4 Pre-Spec)

**Date:** 2026-05-17
**Investigator:** Claude Code via discovery prompt

---

## Current State

### ResearchHashtagsStep — Actual Implementation

**Key finding: This step does NOT call DataForSEO. It calls Claude Haiku.**

```typescript
// packages/pipelines/src/article/social-image/steps.ts

export class ResearchHashtagsStep extends BaseStep<...> {
  readonly name = "research-hashtags";
  override estimatedCostEur(): number { return 0.005; }

  async execute(input, ctx) {
    const toolNames = input.resolvedTools.map((t) => t.name).join(", ");

    const response = await anthropic.messages({
      operation: COST_OPS.SOCIAL_IMAGE_HASHTAGS,
      model: "claude-haiku-4-5",
      systemSuffix: "Return only a JSON array of hashtag strings.",
      userMessage: `Generate 15-20 Instagram hashtags in German and English for a carousel about: "${input.articleTitle}".\nTools featured: ${toolNames}.\nReturn ONLY a JSON array of strings, e.g. ["#KITools","#ArtificialIntelligence"]`,
      maxTokens: 300,
      jsonMode: true,
    });

    const rawText = response.raw;
    let hashtags: string[] = [];
    try {
      const match = rawText.match(/\[[\s\S]*\]/);
      hashtags = match ? JSON.parse(match[0]) : [];
    } catch {
      hashtags = ["#KITools", "#ArtificialIntelligence", "#Technologie"];
    }

    return { ...input, hashtags: hashtags.slice(0, 20) };
  }
}
```

**What's wrong with this:**
- Uses Haiku 4.5 while caption uses Sonnet 4.6 — quality gap between caption and hashtags
- Prompt only passes article title + tool names — no article intent, no brand voice, no content type
- Requests 15-20 hashtags — too many for modern Instagram best practices (5-15 optimal)
- Slices to 20 but never validates minimum count or quality
- Fallback is 3 generic tags with no relation to the article
- The step name "Research" implies external data lookup — but it's just a cheap LLM call

### Step Order

```
1. LoadArticleStep
2. ExtractToolsStep
3. ResolveAssetsStep
4. RenderSlidesStep
5. UploadSlidesStep
6. GenerateCaptionStep   ← Sonnet 4.6, full brand voice context
7. ResearchHashtagsStep  ← Haiku 4.5, title + tool names only
8. PersistSocialPostStep ← hashtags and caption stored together
```

Caption (step 6) and hashtags (step 7) are fully decoupled — the caption LLM call does not see the hashtags and vice versa.

### GenerateCaptionStep

```typescript
async execute(input, ctx) {
  const brandVoice = input.brandTokens?.voice;
  const signaturePhrases = brandVoice?.signaturePhrases?.join(", ") ?? "redaktionell verifiziert, ehrlich";
  const addressForm = brandVoice?.addressForm ?? "du";

  const captionPrompt = `Write an Instagram caption in GERMAN for a carousel post about: "${input.articleTitle}"

The post shows ${input.resolvedTools.length} AI tools in a visual list-carousel format.
Brand voice: ${signaturePhrases}. Use "${addressForm}" form. Max 300 characters. Use 1-2 fitting emojis.
End with: Link in Bio → ${input.articleUrl}

Return ONLY the caption text, no JSON.`;
  // ...
}
```

Caption prompt has no hashtag instruction — it doesn't generate or even mention hashtags.

### Hashtag Storage

```typescript
// social_posts.content (JSONB)
{
  kind: "carousel",
  slides: [...],
  caption: "...",
  hashtags: string[]  // stored here, nested in JSONB
}
```

Hashtags are persisted, exported as `hashtags.txt` in ZIP bundles, and returned in pipeline output. The storage and consumption machinery works fine — it's only the generation quality that's lacking.

### Production Hashtag Samples (Last 3 Posts — All Same Article: AI Code Editors)

**Post 1 (2026-05-13, 20 tags):**
```
#AICoder, #CursorAI, #Windsurf, #Codeium, #AITools, #Programmierung, #SoftwareDevelopment,
#CodeAssistant, #KI, #ArtificialIntelligence, #Developer, #CodingTools, #TechComparison,
#Programming2024, #AIforDevelopers, #CodeEditor, #DevTools, #WebDevelopment, #TechStack,
#IntelligentCoding
```

**Post 2 (2026-05-13, 20 tags):**
```
#Cursor, #Windsurf, #Codeium, #AICoder, #KIProgrammierung, #CodeGeneration, #DeveloperTools,
#SoftwareDevelopment, #AIAssistant, #Coding, #TechComparison, #ProgrammierenMitKI,
#WebDevelopment, #DevTools, #KI2026, #ArtificialIntelligence, #MachineLearning, #CodeEditor,
#Programmierung, #TechStack
```

**Post 3 (2026-05-13, 20 tags):**
```
#Cursor, #Windsurf, #Codeium, #AICoder, #KI-Entwicklung, #CodeGeneration, #AITools,
#SoftwareDevelopment, #DevTools, #Programming, #KünstlicheIntelligenz, #Programmierung,
#CodeEditor, #AIAssistant, #DeveloperTools, #TechComparison, #WebDevelopment, #CodingTools,
#2026Tech, #KI-Tools
```

**Quality diagnosis of production hashtags:**

| Issue | Severity | Examples |
|-------|----------|---------|
| Too many (20 vs Instagram optimal 5-15) | Medium | all posts |
| Year anchoring — will age out | High | `#Programming2024`, `#KI2026`, `#2026Tech` |
| Hyphens in German tags — not clickable on Instagram | High | `#KI-Entwicklung`, `#KI-Tools` |
| Redundant developer-domain tags | Medium | `#DeveloperTools` + `#DevTools` + `#CodingTools` + `#TechStack` in same post |
| Missing community/engagement hashtags | Medium | No `#100DaysOfCode`, `#LearnToCode`, `#CodeNewbie` |
| Generic padding | Medium | `#MachineLearning`, `#ArtificialIntelligence`, `#WebDevelopment` — low niche value for a code-editor comparison post |
| No content-type awareness | High | Same mix whether article is a review, comparison, or tutorial |

---

## DataForSEO Capability

### Endpoints Available in Codebase

| Method | Endpoint type | Used in |
|--------|--------------|---------|
| `serp()` | Organic SERP results | `article/steps/research.ts` (SERP research for blog outlines) |
| `keywordOverview()` | Volume/CPC/difficulty per keyword | `cold-start/03-cluster-plan` |
| `relatedKeywords()` | Keyword expansion | `cold-start/03-cluster-plan`, `gap-service.ts` |
| `rankedKeywords()` | Competitor footprint | `cold-start/02-competitor-analysis` |
| `trendsExplore()` | YoY growth trends | `topic-sources/trend-discovery/score.ts` (Spec 54.5) |

**None of these endpoints is called by ResearchHashtagsStep.** The step uses LLM directly.

### Could These Endpoints Power Hashtag Research?

**Short answer: No, not meaningfully.**

- **`relatedKeywords()`** returns semantically related *search* keywords with volume/CPC. `#AICoder` and `code editor ai tool comparison germany` are not the same thing — search queries are long, hashtags are short fragments.
- **`keywordOverview()`** gives search volume for a keyword. High search volume ≠ effective Instagram hashtag. `#WebDevelopment` has massive search volume but minimal Instagram engagement density vs. niche tags.
- **`trendsExplore()`** gives growth rate over time. Useful for *article topic selection* (already used for trend scoring); doesn't predict social platform hashtag performance.
- **`serp()`** returns organic ranking pages — irrelevant for hashtag selection.

**No DataForSEO endpoint models social platform hashtag algorithms.** Instagram ranks posts using: hashtag relevance to image/caption content, posting frequency, community engagement per hashtag, author authority per hashtag. None of these signals appear in DataForSEO's search-focused APIs.

### Cost Analysis

DataForSEO costs from `cost_logs` (service = "dataforseo"):
- `relatedKeywords()`: ~€0.003–0.010 per call depending on keyword count
- `keywordOverview()`: ~€0.001–0.005 per call
- `trendsExplore()`: ~€0.002–0.008 per call

Adding DataForSEO calls to ResearchHashtagsStep would add €0.003–0.010 per post while the quality gain is near zero. Current Haiku cost is €0.005/call. Worse ROI.

### Honest Quality Assessment

DataForSEO is the right tool for SEO keyword research, content gap analysis, and topic trend scoring. It is not useful for Instagram hashtag strategy. The data models are incompatible:

- Search: one user enters a query → one result session
- Instagram hashtag: millions of posts tagged → millions of users browsing that community stream

What actually drives hashtag effectiveness on Instagram: niche tag size (posts/week), post quality in that niche, account standing in the niche, content-tag alignment. None of these come from DataForSEO.

---

## Integration Analysis

### Caption Prompt Today

The `hookPrompt.ts` system (used by the social hooks / discovery worker flow — **separate from the pipeline**) has significantly better hashtag generation logic:

```typescript
// packages/core/src/social-hooks/hookPrompt.ts — buildCaptionSection()

// For German + comparison content type:
`HASHTAGS (7 tags, bilingual for dual search intent on Instagram):
- German: #KITools, #KIVergleich, #KIFürBusiness + 1 niche German tag (e.g. #SoftwareTest)
- English: #AITools, #AIComparison, #AIForBusiness + 1 niche English tag (e.g. #SoftwareReview)
- Total: exactly 7 tags
- NO self-promotional tags like #Toolwiki`

// For German + non-comparison content type:
`HASHTAGS (7 tags, bilingual for dual search intent on Instagram):
- German: #KITools, #KIFürBusiness, #Produktivität + 1 niche German tag based on tool category
- English: #AITools, #AIForBusiness, #DigitalTools + 1 niche English tag based on tool category
- Total: exactly 7 tags
- NO self-promotional tags like #Toolwiki`
```

This is better than ResearchHashtagsStep because:
- Exact count (7 vs 15-20)
- Bilingual with defined slots (3 German + 1 niche DE + 3 English + niche EN — implicit 8 but described as 7)
- Content-type aware (comparison gets different mix than general)
- Anchor tags specified (prevents generic padding)
- Anti-spam rule (no self-promotion)

**The pipeline ResearchHashtagsStep is worse than the existing hookPrompt.ts implementation.** The two systems developed separately and the better logic was never ported into the pipeline.

### Where Hashtags Fit in the 8-Step Pipeline

Current order:
```
6 → GenerateCaptionStep (Sonnet 4.6) → returns: caption only
7 → ResearchHashtagsStep (Haiku 4.5) → returns: hashtags, decoupled from caption
8 → PersistSocialPostStep → merges caption + hashtags into JSONB
```

The problem: caption and hashtags are semantically coupled (they're presented together in the post, they should reinforce each other) but generated by separate models in separate calls with no shared context.

**Proposed order (Option 2 implementation):**
```
6 → GenerateCaptionStep (Sonnet 4.6) → returns: { caption, hashtags } as unified JSON
                                         ← step 7 deleted
7 → PersistSocialPostStep
```

---

## Recommendation

### Option chosen: **2 — Remove ResearchHashtagsStep, merge hashtag generation into GenerateCaptionStep**

**Why:**

1. **DataForSEO data is not useful for social hashtags.** Search volume and social community density are different signals. Adding a DataForSEO call would add cost with near-zero quality gain. This rules out Option 1.

2. **The step is already LLM-based.** The name "ResearchHashtags" is misleading — there's no research, just a Haiku call. We're already doing Option 2, just doing it badly.

3. **hookPrompt.ts already solved this better.** The pattern (7 bilingual tags, content-type specific anchor tags, exact count) exists in the codebase. It should be ported into the pipeline rather than duplicated.

4. **Merging caption + hashtags into one call is strictly better.** One Sonnet 4.6 call that outputs `{ caption, hashtags }` as JSON is:
   - More coherent (hashtags align with what the caption actually says)
   - Cheaper (one Sonnet call < one Sonnet call + one Haiku call)
   - Less code (one step instead of two)
   - Better quality (Sonnet vs Haiku)

5. **Curated library (Option 3) adds maintenance burden** without clear quality advantage. The LLM already has the domain knowledge needed to pick good niche hashtags given good instructions. A library gets stale; the LLM adapts.

**Why not Option 1:** DataForSEO search APIs don't model Instagram hashtag community dynamics. Cost increases, complexity increases, quality gain is marginal to zero.

**Why not Option 3:** Maintenance cost for a hashtag library that needs to stay current per tool category, locale, and content type is high. The LLM can derive this from instructions with good prompting.

### Comparison Table

| Option | Effort | DataForSEO cost/post | Quality estimate | Maintenance |
|--------|--------|---------------------|-----------------|-------------|
| 1: Complete DataForSEO integration | 3–4 days | +€0.005–0.010 | ≈ current (low quality) | High |
| **2: LLM-only (merged)** | **0.5 days** | **€0 extra** | **Significantly better** | **Low** |
| 3: Curated library | 2 days | €0 | Decent but static | Medium |

### Implementation Outline (Spec 57.4)

**Step 1: Update `GenerateCaptionStep` to output `{ caption, hashtags }`**

Change return type from `{ caption: string }` to `{ caption: string; hashtags: string[] }`.

Change prompt to request JSON output:

```typescript
const prompt = `
Write an Instagram post in GERMAN for a carousel about: "${input.articleTitle}"
Post shows ${toolCount} AI tools. Brand voice: ${signaturePhrases}. Address form: ${addressForm}.
Article URL: ${input.articleUrl}
Content type: ${contentType}  // "comparison" | "review" | "general"

Return JSON:
{
  "caption": "<max 280 chars per paragraph, 4 paragraphs, end with → URL, 1-2 emojis>",
  "hashtags": [
    // Exactly 7 tags. Bilingual — mix German and English.
    // German anchor: #KITools + 1-2 niche DE tags matching tool category (no hyphens)
    // English anchor: #AITools + 1-2 niche EN tags
    // Tool names as tags: ${toolNames}
    // Content-type tag: ${contentType === "comparison" ? "#KIVergleich, #AIComparison" : "#KIFürBusiness, #AIForBusiness"}
    // No year tags. No hyphens. No self-promotional tags.
  ]
}`;
```

**Step 2: Delete `ResearchHashtagsStep`**

Remove class definition from `steps.ts`. Remove import from `pipeline.ts`. Remove from steps array.

**Step 3: Update `COST_OPS`**

Remove `SOCIAL_IMAGE_HASHTAGS` op (or keep it archived). The cost is now absorbed into `SOCIAL_IMAGE_CAPTION`.

**Step 4: Update `GenerateCaptionOutputSchema`**

Add `hashtags: z.array(z.string()).min(3).max(10)` to output schema.

**Step 5: Update `PersistSocialPostStep` input schema**

It already reads `input.hashtags` — no change needed if the field flows through correctly.

### Risks / Unknowns

1. **JSON parsing reliability in GenerateCaptionStep.** Currently it returns plain text (`Return ONLY the caption text`). Switching to JSON output requires `jsonMode: true` and robust parsing. Existing pattern from ResearchHashtagsStep (regex match + JSON.parse) can be reused.

2. **Hashtag count might drift.** If we ask for "exactly 7", the LLM sometimes returns 6 or 8. Add a Zod `.min(3).max(10)` validation and a fallback that pads with anchors if needed.

3. **Content type detection.** `GenerateCaptionStep` currently doesn't know `intentType` or `contentType`. This field is available on the article (from `articles.intentType`), but it's loaded in `LoadArticleStep`. Verify that it flows through the step chain into the caption step's input schema — it may not currently be passed through.

4. **hookPrompt.ts divergence.** The discovery worker (`discoveryWorker.ts`) uses `hookPrompt.ts` to generate social hooks separately from the pipeline. After this change, the pipeline and discovery worker will use different hashtag strategies. This is acceptable — they serve different use cases — but should be documented.

5. **Existing posts.** The 20-tag format in existing `social_posts.content.hashtags` is valid JSON. The schema change (7 tags going forward) doesn't require migration; it only affects newly generated posts.
