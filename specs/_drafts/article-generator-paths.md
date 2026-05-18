# Article Generator Paths — Mini Discovery

**Date:** 2026-05-18

## Q1: intentType usage

- **Branching exists?** Partial — intentType is used for **conditional prompt sections** inside DraftStep and for **routing warnings**, not for separate LLM call trees.
- **Where:**
  - `packages/pipelines/src/article/steps/draft.ts` lines 124–174: the single large prompt block has two conditional sections gated on intentType values
  - `packages/pipelines/src/article/author-picker/step.ts` lines 51–55: `intentType === "comparison"` triggers a `log.warn` about routing (no different logic, just a warning)
  - `packages/pipelines/src/article/translation/body-step.ts` line 181, 239: intentType passed to translator as context string
  - `packages/pipelines/src/article/author-picker/historic.ts` lines 33, 37: intentType used as a filter in the SQL scoring query for author selection (weighted bonus for matching intent)
  - `packages/pipelines/src/article/social-image/steps.ts` line 676: `deriveContentType(input.intentType)` selects a social template; line 785: `comparison-stunning-3` vs `comparison-stunning` template is chosen based on tool count
- **Recognized values:** (from `packages/pipelines/src/article/steps/draft.ts` line 125 prompt text)
  `"overview" | "pricing" | "features" | "use-cases" | "comparison" | "tutorial" | "review" | "ethics" | "general"`
  Additionally from `packages/db/src/schema/identity.ts` line 74 (ToolArticleIdentity type):
  `"review" | "comparison" | "pricing" | "tutorial" | "use-cases" | "features"` (for tool articles)
  and line 83: `"overview" | "general"` (for general articles)
- **Behavior:** Both — intentType is (a) persisted as frontmatter metadata AND (b) used to conditionally vary the LLM prompt output. There is no separate LLM system prompt per intentType; instead, DraftStep's single prompt has two conditional output blocks keyed on intentType:

**Code excerpt (draft.ts lines 142–174):**
```
  COMPARISON/REVIEW FIELDS — include ONLY when ALL three conditions are true:
    (a) intentType is "comparison" or "review"
    (b) the article directly compares or reviews 2 or more named tools
    (c) you can list at least 2 real tool slugs
  If any condition is false, OMIT these fields entirely:
  - "toolSlugs": array of exactly 2-8 tool slugs...
  - "winner": pick from the allowed winner enum...
  - "verdict": 1-2 sentence summary...
  - "testMethodology": ...
  - "useCaseVerdicts": ...

  TOOL SPOTLIGHT FIELDS — include ONLY when ALL three conditions are true:
    (a) intentType is "overview", "features", "review", "pricing", or "use-cases"
    (b) the article focuses on a single named AI tool (primaryTool is set)
    (c) you have enough information...
  If any condition is false, OMIT these fields entirely:
  - "pros": array of 2-5 objects...
  - "cons": ...
  - "features": ...
  - "useCases": ...
  - "pricingTier": ...
  - "priceFrom": ...
  - "rating": ...
```

The outline step (`packages/pipelines/src/article/steps/outline.ts`) has NO intentType branching — confirmed by grep (lines 59-60 are only comments mentioning comparison/use-cases as examples of scope).

## Q2: Comparison generation

- **Dedicated path?** No — there is no `comparison/` pipeline directory under `packages/pipelines/src/article/`. Comparisons run through the same blog pipeline steps.
- **Files with "comparison":**
  - `packages/pipelines/src/article/steps/draft.ts` — conditional FRONTMATTER_EXTRAS fields (toolSlugs, winner, verdict)
  - `packages/pipelines/src/article/social-image/steps.ts` — `comparison-stunning` vs `comparison-stunning-3` template selection
  - `packages/pipelines/src/article/discovery/deterministicEnrichment.ts` — `collection === "comparisons"` → `containerFormHint = "comparison-2"` or `"comparison-list"` (article import/discovery analysis only, not generation)
  - `packages/pipelines/src/article/discovery/llmEnrichment.ts` — social template eligibility hints (not generation)
  - `packages/pipelines/src/article/author-picker/step.ts` — `intentType === "comparison"` logs a warning that a dedicated routing path (spec "54.9b") is a future TODO
- **Differentiation:** DraftStep emits extra FRONTMATTER_EXTRAS fields (`toolSlugs`, `winner`, `verdict`, `testMethodology`, `useCaseVerdicts`) when `intentType === "comparison"`. The outline step generates identical structure. The social-image pipeline selects a different Remotion template. There is NO separate LLM prompt, NO separate step sequence, NO separate pipeline file.
- **Key signal:** `author-picker/step.ts` line 53 explicitly says: _"comparison intent passed through blog generator; consider 54.9b for proper comparisons-collection routing"_ — a TODOed future spec, not implemented.

## Q3: Use-case generation

- **Dedicated path?** No.
- **Files:**
  - `packages/pipelines/src/article/steps/draft.ts` — `"use-cases"` is one of the intentType values recognized in the TOOL SPOTLIGHT FIELDS conditional block
  - `packages/pipelines/src/article/social-image/enrichment/toolUseCaseTokens.ts` — enrichment helper for social images (post-generation, not generation pipeline)
  - `packages/pipelines/src/article/discovery/deterministicEnrichment.ts` line 103, 119-122 — `collection === "usecases"` in article discovery/import analysis (not generation)
  - `packages/pipelines/src/article/social-image/closerEngine.ts` — use-case token extraction for social slide text
- **Summary:** `use-cases` as intentType triggers the TOOL SPOTLIGHT FIELDS block in DraftStep (same as overview/features/review/pricing). No separate pipeline, no separate step. The `usecases` collection handling in deterministicEnrichment only applies to IMPORTED articles, not pipeline-generated ones.

## Q4: ki-wissen generation

- **Dedicated path?** No.
- **Files:**
  - `packages/pipelines/src/article/discovery/deterministicEnrichment.ts` line 102: `case "ki-wissen": return "concept-explainer"` — this is article DISCOVERY/IMPORT enrichment, mapping the Astro collection name to a container form hint for quality analysis
  - `packages/pipelines/src/article/discovery/llmEnrichment.ts` line 19: mentions `ki-wissen collection` as one of the eligibility conditions for the `concept-explainer-deck` social template
  - Test fixtures throughout `packages/pipelines/test/` use `pipelineTemplate: "educational"` — this is the project's `pipelineTemplate` field, not a pipeline variant
- **Summary:** `ki-wissen` appears only in article import/discovery analysis (to classify already-imported Astro articles) and in social image template eligibility. There is zero ki-wissen-specific branching in the generation pipeline (outline, draft, research steps). The `"educational"` pipelineTemplate in tests is a project-level attribute, not a pipeline variant.

## Q5: Design intent

- **Documented direction:** The CLAUDE.md and pipelines CLAUDE.md describe a **unified blog pipeline with intentType variants**. There is no documented plan for separate comparison/ki-wissen/usecases generation pipelines.
- **Source:**
  - `packages/pipelines/src/article/author-picker/step.ts` line 53 references `"54.9b for proper comparisons-collection routing"` as a future spec — confirming that proper comparison routing is NOT yet built
  - `packages/pipelines/CLAUDE.md` blog generator section lists 13 steps; zero are comparison- or ki-wissen-specific
  - The `TopicRoutingPolicy` in `packages/pipelines/CLAUDE.md` shows `cluster_too_small → create_article (defaults intentType to "use_case")` — use cases are routed into the same article creation path, not a separate pipeline
  - `deterministicEnrichment.ts` shows `comparisons`, `ki-wissen`, `usecases` as **Astro collection names** (for imported content) — these are content storage categories, not generation pipeline variants

## Verdict

**They are prompt variants / step-branches inside the blog pipeline — 1-2 days each, not 3-5 days.**

Evidence:
1. **Single LLM prompt, conditional blocks:** `DraftStep` uses ONE prompt with two `if intentType === X` output sections. Comparison and tool-spotlight (overview/features/review/pricing/use-cases) differ only in which FRONTMATTER_EXTRAS fields the LLM emits. The article body structure, section sequence, and step order are identical.
2. **No dedicated pipeline directories:** `packages/pipelines/src/article/` has `blog/`, `refresh/`, `translation/`, `localize/`, `social-image/`, `hero-generation/` — zero directories named `comparison/`, `ki-wissen/`, or `usecases/`.
3. **ki-wissen is a collection name, not a pipeline:** The string only appears in article import enrichment (`deterministicEnrichment.ts`) to classify already-published Astro articles. The generation pipeline has no awareness of it.
4. **Explicit TODO for future routing:** `author-picker/step.ts` logs a warning that `"comparison"` intent in the blog generator is suboptimal and references a future spec "54.9b" — confirming the proper dedicated comparison path does not exist yet and was knowingly deferred.
5. **Social image selection is the deepest branching:** The social-image pipeline (`steps.ts` line 785) selects `comparison-stunning-3` vs `comparison-stunning` based on tool count, and `deriveContentType(intentType)` selects a template family. This is post-generation social repurposing, not a generation pipeline variant.

**Implementation estimate:** Adding intentType-specific prompt improvements (better comparison structure, ki-wissen concept-explainer format, richer use-case angles) = 1-2 days. That means modifying `DraftStep`'s prompt and potentially `OutlineStep`'s prompt to include intentType-aware structural guidance. No new step classes, no new pipeline files, no new queue registrations needed.
