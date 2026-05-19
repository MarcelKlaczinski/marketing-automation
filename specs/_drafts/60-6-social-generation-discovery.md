# Spec 60.6 — Social Generation Discovery: Ist-Stand

**Generated:** 2026-05-19
**Purpose:** Document the current state of social post triggering, template selection, eligibility,
and UI — to inform a spec for LLM-based template suggestion + UI template picker.

---

## Q1: Trigger — Social Post Einstiegspunkte

**File:** `apps/api/src/routes/social-posts.ts`

### Five relevant endpoints:

#### 1. `POST /api/articles/:articleId/social-posts/generate`
- **Inputs:** `{ format: "list_carousel", theme: "dark"|"light", variant: "stunning", locales: string[] }`
- **templateKey:** NOT from client — pipeline (`RenderSlidesStep`) determines it automatically
- **Action:** Enqueues `article:social-image` via `triggerWithPreRunId()`, returns `{ ok, runId, jobId }`
- **Cost:** ~€0.028 per locale

```typescript
// Handler signature (lines 32-71)
app.post("/articles/:articleId/social-posts/generate", async (c) => {
  const { articleId } = c.req.param();
  const body = generateSocialPostBodySchema.parse(await c.req.json());
  // ... checks article exists ...
  return triggerWithPreRunId(c, {
    pipelineKey: "article:social-image",
    jobData: { articleId, ...body },
    estimatedCostEur: COST_OPS.SOCIAL_IMAGE_GENERATE * body.locales.length,
  });
});
```

#### 2. `POST /api/articles/:articleId/generate-templates`
- **Inputs:** `{ templateKeys: string[], locale: "de"|"en", theme: "dark"|"light" }`
- **templateKey:** FROM client — user explicitly specifies which templates to render
- **Action:** Checks eligibility per template, calls `template.buildInput()`, enqueues `enqueueSocialRenderJob()`
- Creates `templateRenders` rows (not `social_posts`)

#### 3. `GET /api/articles/:articleId/all-templates`
- Returns ALL registered templates with per-template eligibility result + existing render status + slide URLs
- Calls `template.eligibility(article, discovery)` for each template
- **This is the "template picker" data source** — not yet integrated in UI

#### 4. `GET /api/articles/:articleId/template-suggestions`
- Returns `article_discovery.suggestedTemplates` (LLM suggestions from discovery phase)
- Paired with current render statuses from `social_posts`
- Purely informational — no action taken

#### 5. `POST /api/social-posts/:id/re-render`
- Re-renders existing post with fresh brand tokens + template overrides (Spec 58.2)
- Reads persisted `content.renderInput` snapshot from DB — no re-pipeline needed
- Enqueues `enqueueSocialRenderJob()` with timestamp-based jobId

---

## Q2: Template-Selektion heute

### Automatic selection exists at two levels:

**Level 1 — Discovery phase (LLM suggestion):**
`packages/pipelines/src/article/discovery/llmEnrichment.ts`
- During article discovery, Claude Sonnet suggests eligible templates
- Analyzes: title, bodyMd structure, collection, intentType, toolSlugs count
- Returns array of `{ templateKey, confidence, primaryAngle, estimatedSlides, justification }`
- Stored in `article_discovery.suggestedTemplates`

**Level 2 — Render time (comparison routing):**
`packages/pipelines/src/article/social-image/steps.ts` → `RenderSlidesStep`
- For comparison articles: auto-selects `comparison-grid-3` vs `comparison-grid-4` based on tool count
- This is the **only** template auto-selection that happens at render time
- Everything else requires explicit `templateKey` from the client (via `generate-templates` endpoint)

### Summary:
- `templateKey` is **always from client** for the primary `social-posts/generate` endpoint
- The discovery pipeline suggests candidates, but the user/system must act on suggestions manually
- No "pick best template and generate" server-side flow exists yet

---

## Q3: Eligibility-System — vollständige Analyse

**File:** `packages/social/src/templates/definitions/` + `packages/social/src/templates/registry.ts`

### All templates with eligibility rules:

| Template | Collection | Key Conditions | Required Fields |
|----------|-----------|----------------|-----------------|
| `single-tool-spotlight` | `tools` | has pros + cons | `frontmatterExtras.pros ≥ 1, cons ≥ 1` |
| `pro-con-verdict` | `tools` | `has_pro_con_lists=true` | `frontmatterExtras.pros ≥ 3 AND cons ≥ 3` |
| `comparison-grid-3` | any | `has_verdict && toolSlugs.length >= 3` | `frontmatterExtras.tools[].score` |
| `comparison-grid-4` | any | `has_verdict && toolSlugs.length >= 4` | `frontmatterExtras.tools[].score`, exactly 4 tools |
| `verdict-per-use-case` | any | `has_comparison && useCaseVerdicts >= 5` | `frontmatterExtras.useCaseVerdicts` (3–8 items) |
| `news-slide` | `news-update` | article < 60 days old | container form hint "news" |
| `concept-explainer-deck` | `ki-wissen` | OR container form "concept-explainer" | — |

### Runtime eligibility check chain:

1. **Display-time:** `templateRegistry.listEligibleFor(article, discovery)` — filters all templates through `eligibility()` predicate, returns `{ template, eligible, reason }[]`
2. **Override gates:** `checkEligibilityWithOverrides(template, article, discovery, projectId)` — applies project-scoped min/max constraints from `project_template_overrides`
   - `single-tool-spotlight`: `minProsCount`, `maxProsCount` from override schema
   - `verdict-per-use-case`: `minVerdictsCount` from override schema
3. **Render-time routing:** `RenderSlidesStep` chooses grid-3 vs grid-4 dynamically

### What happens when not eligible:
- Template is excluded from `listEligibleFor()` results (not rendered, not shown in picker)
- `all-templates` endpoint still returns it with `eligible: false` + `reason` string
- User cannot select ineligible templates in the template picker UI (not yet built)

### Existing function:
```typescript
templateRegistry.listEligibleFor(article: Article, discovery: ArticleDiscovery): EligibilityResult[]
// in packages/social/src/templates/registry.ts
```
No `getEligibleTemplates()` top-level export — use registry method directly.

---

## Q4: UI — ArticleSocialTab

**File:** `apps/web/src/pages/articles/tabs/ArticleSocialTab.vue`

### Current state:
- **No template picker UI** — generate button fires `POST /social-posts/generate` with fixed format/theme/locales
- **No "recommended template" area** — suggestions from discovery phase not surfaced here
- **templateKey submission:** None — client sends `{ format, theme, variant, locales }` only; pipeline decides template
- **History display:** Shows previously generated posts by locale with re-render button

### Relevant API call (lines ~466-471):
```javascript
// Generate social post (no templateKey)
await apiPost(`/articles/${articleId}/social-posts/generate`, {
  format: "list_carousel",
  theme: "dark",
  variant: "stunning",
  locales: selectedLocales,
});
```

### Gap:
- `GET /articles/:articleId/all-templates` exists on the backend (returns eligibility + descriptions)
- `GET /articles/:articleId/template-suggestions` exists (returns LLM suggestions from discovery)
- Neither is called from ArticleSocialTab — template picker is not yet built

---

## Q5: LLM-Template-Suggestion — existiert sie?

**Yes — in discovery pipeline.**

**File:** `packages/pipelines/src/article/discovery/llmEnrichment.ts` (lines 8–126)

### Current implementation:
- **Trigger:** During `article:discovery` pipeline enrichment phase
- **Model:** Claude Sonnet (single call)
- **Analyzes:** 5 content dimensions → suggests 3–5 templates with confidence scores
- **Prompt asks for:** `{ templateKey, confidence: 0–1, primaryAngle, estimatedSlides, justification }`
- **Stored in:** `article_discovery.suggestedTemplates` JSONB field

### Article fields used as inputs:
```typescript
// From articles table:
articles.collection         // "tools" | "blog" | "news-update" | "ki-wissen"
articles.intentType         // "feature_comparison" | "use_case" | "pricing" | "review" | "single_tool" | "overview"
articles.frontmatterExtras  // JSONB: toolSlugs[], tools[], pros[], cons[], useCaseVerdicts[]
// From article_discovery:
articleDiscovery.estimatedAngles    // count of distinct content angles
articleDiscovery.narrativeArc       // content structure description
```

### Gap: suggestion→social_post link is lost
- Suggestions live in `article_discovery.suggestedTemplates`
- Once a `social_posts` row is created, there's no FK back to which suggestion was used
- No `user_override` tracking — no analytics on whether users follow LLM suggestions

---

## Q6: Social in Article-Pipeline

**Social is a SEPARATE pipeline**, NOT part of BlogPipeline.

### Pipeline: `article:social-image` (6 steps)
```
LoadArticleStep
  → ExtractToolsStep
  → ResolveAssetsStep
  → GenerateComparisonGrid4Step  (conditional: only if exactly 4 tools + verdict)
  → GenerateCaptionStep          (Sonnet JSON: caption + hashtags)
  → RenderSlidesStep             (Remotion render → R2 upload → DB persist)
```

### Optional auto-trigger via project config:
- `projects.socialAutoRenderLocales: "one" | "all" | null` — controls post-generation auto-render
- When set, `BlogPipeline.afterComplete()` enqueues `article:social-image` automatically
- **This hook exists** — but only fires for the default template choice (no template picker involved)

### Best fit for a new `SocialGenerationStep`:
If we want auto-generation with template selection, the cleanest extension is:
1. **Enhance `BlogPipeline.afterComplete()`** — add template suggestion lookup, pick top-1 suggestion by confidence, enqueue `article:social-image` with explicit `templateKey` in job data
2. **Extend `RenderSlidesStep`** — accept optional `templateKey` in job data to override auto-routing
3. **No new pipeline step needed** — the auto-trigger mechanism already exists via `afterComplete()`

---

## Q7: social_posts DB Schema

**File:** `packages/db/src/schema/content.ts`

### Current columns:
```typescript
id: uuid PRIMARY KEY
projectId: uuid FK → projects.id (CASCADE)
articleId: uuid FK → articles.id (SET NULL)

// Content
platform: enum(instagram | tiktok | linkedin)
format: enum(list_carousel)
status: enum(draft | in_review | approved | scheduled | published | failed | replaced)
content: JSONB  // { slides, caption, hashtags, renderInput (Spec 58.2 snapshot), warnings? }

// Publishing
scheduledAt: timestamp with timezone
publishedAt: timestamp with timezone
publishedUrl: text
metrics: JSONB  // Record<string, number>

// Spec 54k: Template + locale
templateKey: text                    // e.g. "single-tool-spotlight"
locale: text NOT NULL DEFAULT "de-DE"

// Spec 57.2: Render lifecycle
theme: text                          // "dark" | "light"
totalSlides: integer
costEur: numeric(10,4)
generatedAt: timestamp
renderStatus: enum(pending | rendering | rendered | superseded | failed)
renderJobId: text
renderStartedAt: timestamp
renderCompletedAt: timestamp
renderError: JSONB                   // { code, message, stack }

createdAt: timestamp NOT NULL defaultNow
updatedAt: timestamp NOT NULL defaultNow
```

### New columns needed for suggestion tracking:
```sql
suggested_template    text       -- template key suggested by LLM discovery
suggestion_confidence numeric(3,2) -- 0.00–1.00 from article_discovery.suggestedTemplates
suggestion_reason     text       -- justification from LLM
user_override        boolean    -- true if user picked different template than suggested
```

These columns would close the analytics loop: track whether the LLM suggestion was followed, and measure suggestion accuracy over time.

---

## Synthesis: Extension Points for Spec 60.6 proper

| Feature | Extension Point | Status |
|---------|----------------|--------|
| **LLM suggestion** | `llmEnrichment.ts` in discovery | ✅ Exists, stores in `article_discovery` |
| **Eligibility check** | `templateRegistry.listEligibleFor()` | ✅ Exists, usable directly |
| **Backend template picker data** | `GET /all-templates` + `GET /template-suggestions` | ✅ Exists, not yet wired to UI |
| **Frontend picker** | ArticleSocialTab.vue | ❌ Not built |
| **Auto-generate with suggested template** | `BlogPipeline.afterComplete()` | 🔶 Partial — auto-trigger exists, no template routing |
| **Suggestion tracking on `social_posts`** | DB schema | ❌ Missing columns |
| **Client-driven multi-template generation** | `POST /generate-templates` | ✅ Exists (templateRenders, not socialPosts) |
