# Social Templates Discovery — Pre-Spec 59.3-59.5

**Date:** 2026-05-19
**Phase:** Pre-Spec-59.3 (news-slide, concept-explainer-deck, pro-con-verdict)
**Scope:** Marketing-Automation Platform repo — Social Template architecture state
**Status:** Read-only inspection — no code changes, no DB writes
**Output:** `audit/social-templates-state.md`
**Estimated time:** 1-2 hours

---

## Goal

Before writing specs 59.3-59.5 for three new social templates (news-slide, concept-explainer-deck, pro-con-verdict), document the **current state** of the social template architecture: what templates exist, how they're structured, what's hardcoded vs configurable, where prompts live, what the override system looks like in practice, and what conventions have been established.

The output of this discovery directly informs the spec architecture for the three new templates. Without it, we risk re-inventing patterns or violating conventions established in Themes 57.x.

This is **NOT** a code review or quality audit. The goal is **observation + categorization**, no critique.

---

## Section 1: Template Inventory

**Question:** What social templates exist today, in what state of completion?

### Inspect:

```bash
# Find all template definitions
ls -la packages/social/src/templates/ 2>/dev/null
ls -la packages/social/src/ 2>/dev/null

# Find Remotion compositions
ls -la apps/web/src/remotion/ 2>/dev/null
ls -la apps/web/remotion/ 2>/dev/null
find . -path '*node_modules' -prune -o -name "*.tsx" -path '*remotion*' -print 2>/dev/null | head -30
find . -path '*node_modules' -prune -o -name "*.tsx" -path '*template*' -print 2>/dev/null | head -30

# Find template registry
grep -rn "TEMPLATE_REGISTRY\|templateRegistry\|registerTemplate\|TemplateSchema\|TemplateDefinition" packages/social/src/ apps/ 2>/dev/null | head -20

# Find template name enum/list
grep -rn "carousel-classic\|news-slide\|pro-con\|concept-explainer\|cover-only\|quote-card" packages/ apps/ 2>/dev/null | head -30
```

### Document per template (table format):

| Template Name | Status | Files (with line ref) | Frontend Remotion | Backend Generator | Implemented Since |
|---|---|---|---|---|---|
| `carousel-classic` | implemented | packages/social/src/templates/carousel-classic.ts:1, apps/web/src/remotion/templates/CarouselClassic.tsx | yes | yes (steps?) | Spec 51a-v2.1 |
| ... | ... | ... | ... | ... | ... |

**Status categories:**
- `implemented`: fully working, used in production
- `partial`: skeleton exists but generator missing or stub
- `proposed`: only mentioned in code comments / TODOs, no implementation
- `deprecated`: exists but no longer triggered (replaced by another)

**Output format:** Markdown table + 1-paragraph narrative summary of "what's actually in production today vs what's planned."

---

## Section 2: Template Architecture Pattern

**Question:** How is one template structured end-to-end? Pick `carousel-classic` (most mature) as reference.

### Inspect:

```bash
# Walk through one template's full lifecycle
# 1. Template definition / schema
find . -path '*node_modules' -prune -o -name "carousel-classic*" -print 2>/dev/null

# 2. Generation step (LLM call producing slides JSON)
grep -rn "carousel.*classic\|CarouselClassic" packages/pipelines/src/ 2>/dev/null | head -20

# 3. Render step (BullMQ → Remotion → file)
grep -rn "renderRemotion\|RemotionRenderJob\|remotionWorker" packages/ apps/ 2>/dev/null | head -20

# 4. Storage / asset URL
grep -rn "r2\.\|s3\.\|uploadAsset\|assetUrl" packages/social/ apps/api/ 2>/dev/null | head -20
```

### Document the full template lifecycle for `carousel-classic`:

```
1. BRIEF/INTENT
   - When is this template chosen?
   - Currently: manual selection? auto-suggest?
   - Where in code: ___

2. CONTENT GENERATION
   - LLM step name: ___
   - Model used: ___
   - Cost per generation: ~€___
   - Output schema: where defined?
   - Persisted to: social_posts.content (JSONB)

3. RENDER
   - Render job queue: ___
   - Worker location: ___
   - Remotion composition file: ___
   - Output format: 4:5? other ratios?
   - Output size: 1080×1350? other?
   - Persisted to: R2? local?

4. STORAGE / DELIVERY
   - Where final video/image lives: ___
   - social_posts.assetUrl: ___
   - Download UI exists: yes/no
   - Auto-publish: no (manual download)

5. OVERRIDE SYSTEM
   - Per-template overrides location: src/templates/overrides/carousel-classic.overrides.ts
   - What can be overridden? (text fields? colors? structural?)
   - How is override applied at render time?
```

**Output format:** Numbered list + a diagram-style ASCII flow if helpful.

---

## Section 3: Brand Tokens + Theme System

**Question:** How does brand-token theming work in templates today?

### Inspect:

```bash
# Brand tokens schema
grep -rn "brand_tokens\|brandTokens\|BrandTokens" packages/db/src/schema/ 2>/dev/null | head -10

# Brand tokens consumer in templates
grep -rn "brandTokens\.\|brand_tokens\." packages/social/ apps/web/src/remotion/ 2>/dev/null | head -20

# Color/font/spacing resolution at render time
grep -rn "resolveBrandTokens\|applyBrandTokens\|buildTheme" packages/ apps/ 2>/dev/null | head -10
```

### Document:

- Where are brand_tokens stored? (project-level? template-level?)
- What fields exist? (colors, fonts, accents, logo URLs, ...)
- How are they injected into the Remotion render? (props? CSS vars? config?)
- Per-template overrides: do they layer on top of project brand tokens, or replace them entirely?
- Are tokens resolved at generation-time (LLM-aware) or render-time only?
- Examples of token usage in carousel-classic: color of hook slide, accent bar in Promise-Block, etc.

**Output format:** 2-3 paragraphs + reference to specific files.

---

## Section 4: Content-Type vs Template Mapping

**Question:** What relationship exists between article intent_type / content patterns and template suitability?

### Inspect:

```bash
# Are there content-type → template heuristics anywhere?
grep -rn "intentType.*template\|template.*intentType" packages/ apps/ 2>/dev/null | head -10

# Hook engine? Template suggestion logic?
grep -rn "hookPrompt\|suggestTemplate\|recommendTemplate" packages/ apps/ 2>/dev/null | head -10

# Past-posts pattern
grep -rn "past.*posts\|recentSocial\|past_pattern" packages/ apps/ 2>/dev/null | head -10
```

### Document:

- Is template selection currently manual (Marcel picks) or auto?
- Is there a registry of "which templates suit which intent_types"?
- Is there a "hook engine" or similar pre-content step?
- Backlog item: "LLM-based auto-template-suggestion bei article generation" — is any scaffolding for this present?

**Output format:** Brief paragraph stating the current state. If the answer is "selection is fully manual", say so cleanly.

---

## Section 5: Multi-Slide Carousel Structure

**Question:** For multi-slide templates like carousel-classic, what's the slide structure pattern?

### Inspect:

```bash
# Slide schema definition
grep -rn "slides:.*array\|SlideSchema\|CarouselSlide" packages/social/src/ packages/db/src/ 2>/dev/null | head -10

# Slide types / variants
grep -rn "slideType\|slide_type\|hookSlide\|coverSlide\|verdictSlide" packages/ apps/ 2>/dev/null | head -10
```

### Document:

- Schema of `social_posts.content.slides[]`
- Are slides typed by role (hook / context / claim / verdict / cta)?
- How many slides per template? (carousel-classic = ?)
- Min/max slide counts enforced anywhere?
- Slide-level styling overrides possible?

**Output format:** Code-block of the typescript type/Zod schema + 1-paragraph explanation.

---

## Section 6: Existing Bilingual Support

**Question:** How do templates handle DE/EN locale switching today?

### Inspect:

```bash
# Locale in template generation
grep -rn "locale.*template\|template.*locale" packages/social/ packages/pipelines/src/social/ 2>/dev/null | head -10

# Bilingual prompts in steps
grep -rn "hookPrompt\|captionPrompt" packages/ 2>/dev/null | head -10
cat packages/pipelines/src/social/steps/hookPrompt.ts 2>/dev/null | head -60
cat packages/pipelines/src/social/steps/generate-caption.ts 2>/dev/null | head -60
```

### Document:

- Are templates locale-aware at generation time?
- Where does the LLM prompt include locale context?
- Bilingual hook engine (per 57.0 Discovery: "7 bilingual hooks, content-type aware")  — confirm in code
- For 59.3-59.5: will new templates default to bilingual or single-locale?

**Output format:** 1-2 paragraphs.

---

## Section 7: Render Worker + BullMQ Integration

**Question:** What's the render job lifecycle?

### Inspect:

```bash
# Find render worker
find . -path '*node_modules' -prune -o -name "*remotion*worker*" -print 2>/dev/null
find . -path '*node_modules' -prune -o -name "*render*worker*" -print 2>/dev/null
grep -rn "RemotionRenderQueue\|socialRenderQueue\|renderQueue" packages/ apps/ 2>/dev/null | head -10

# Render job retry / failure handling
grep -rn "attempts.*=\s*1\|attempts.*=\s*[0-9]" packages/social/ packages/pipelines/src/social/ apps/api/src/workers/ 2>/dev/null | head -10
```

### Document:

- Queue name
- Worker location (per Memory #24: `apps/api/src/workers/`)
- attempts policy (per Memory: `attempts: 1` for paid jobs)
- Render time per template (avg)
- Render cost per template (compute? Cloudflare? local FFmpeg?)
- Failure modes (memory, timeout, malformed slides JSON)

**Output format:** Brief table + 1-paragraph commentary.

---

## Section 8: Override System State

**Question:** What's the current state of the per-template override system?

### Inspect:

```bash
# Per 57.3 (Memory #21): src/templates/overrides/<name>.overrides.ts with barrel
ls -la packages/social/src/templates/overrides/ 2>/dev/null
cat packages/social/src/templates/overrides/index.ts 2>/dev/null
```

### Document:

- Overrides file structure
- Schema pattern (Zod)
- Which fields are overridable per template (text? color? slide-count? structural?)
- Persistence: where is the override stored? (project-level? cluster-level? article-level?)
- UI: is there an override-edit UI?
- For 59.3-59.5 new templates: which override fields would make sense?

**Output format:** Code-block example of one existing override + 2-3 paragraph discussion.

---

## Section 9: Template Gaps (Memory #14, #18, etc.)

**Question:** What templates are documented as "needed but not built"?

### Inspect:

```bash
# Find TODO / Backlog comments for templates
grep -rn "TODO.*template\|FIXME.*template\|backlog.*template" packages/social/ packages/pipelines/src/social/ 2>/dev/null | head -10

# Phase D / Phase E references
grep -rn "phase.D\|phase.E\|backlog\|future.template" packages/social/ packages/pipelines/src/social/ 2>/dev/null | head -10
```

### Document:

- Memory references say "decision-tree-carousel" and "category-comparison" gaps were found post-54
- Memory #14 says: "Vor Theme 57: Discovery-Prompt — was existiert, hardcoded dynamisierbar ohne Quality-Loss, welche Templates implementiert vs Stub, Sprache configurable"
- Memory #27 says: "59.3-59.5 Social Templates (news-slide, concept-explainer-deck, pro-con-verdict)"
- Question: in code, are any of these three (news-slide, concept-explainer-deck, pro-con-verdict) **already started as stubs**, or are they pure greenfield?

**Output format:** Table mapping (memory-mentioned template) → (current code state: stub / partial / not started).

---

## Section 10: Open Items for 59.3-59.5 Consideration

After completing sections 1-9, list any observations that don't fit cleanly above but are relevant for the three new template specs:

- Anti-patterns observed in existing templates that 59.3-59.5 should avoid
- Architectural patterns introduced after 57.x that the new templates must follow
- Files / folders / conventions the new templates must use
- New types / interfaces in `packages/social/src/` that 59.3-59.5 will need
- Performance bottlenecks if any (Remotion render time, LLM prompt token bloat)
- Cost regressions if any (carousel-classic shipped at €X, current Y)
- Files where slide-schema must be extended (vs files that are static)
- Test convention examples in `packages/social/test/`
- Recommendation: should 59.3-59.5 each be their own spec (3 specs) or one combined (more efficient)?

**Output format:** Bullet list with sub-points.

---

## Section 11: Recommended Format for 59.3-59.5 Specs

Based on findings in 1-10, recommend:

- Should each new template be its own spec, or combined into one (e.g., "59.3 = three new templates")?
- What sections should each new template spec include? (Schema, LLM Prompt, Remotion Composition, Override Fields, Tests, Smoke)
- Estimated effort per template based on carousel-classic baseline
- Order of implementation (which template first and why)
- Cross-cutting concerns that all three share (bilingual support, brand-tokens integration, etc.)

**Output format:** Recommendation paragraph + bullet list of cross-cutting concerns.

---

## Constraints

- **Read-only**: no code changes, no DB writes, no migrations
- **Source-of-truth is actual code**, not Memory references or specs
- **Empirical observations** over assumptions — if something isn't observable, say "not observed" rather than guess
- **Cite file paths and line numbers** where claims come from code
- **No code suggestions** — analysis only

## Output Location

Save analysis as `audit/social-templates-state.md` in the marketing-automation-platform repo. Format: markdown matching the section structure above.
