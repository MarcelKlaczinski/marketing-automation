# Theme 65 — Recurring Content System

**Status:** Backlog (planning complete, ready to break into sprint-sized specs)
**Estimated total effort:** 6–7 weeks across 13 sub-specs
**Depends on:** Theme 60 (multi-template architecture), Spec 54a–54l (TemplateRegistry), Spec 62.0a/62.8 (cron + pipeline-router)
**Strategic context:** Shift from manual one-off content to recurring, configurable, hook-driven content production targeting broad-mass AI-beginners — without sacrificing Toolwiki's tool-DB-driven differentiation.

---

## §0 Theme Goal

Build a recurring content system that lets Marcel define content rubrics per project, each running on a configurable schedule, drawing on Toolwiki's tool DB + signals + LLM curation, producing both social-media carousels and long-form articles in a hub-spoke pattern.

The system serves two parallel content families:

**Family A — Data-driven listicles** (~30% of output): "Top 5 LLMs Juni 2026", head-to-head comparisons, what's-new roundups. Driven by tool DB + signals. Perfect for SEO and tool-discovery.

**Family B — Hook-driven narratives** (~70% of output): "I lost my job because Claude…", "How Claude could change your life", "Why everyone should have ChatGPT Premium". Driven by hook templates + persona pools. Aimed at broad-mass virality.

Both families share infrastructure (recurring definitions, cron, brand assets, end-slides, article output) but have distinct templates and brief generators.

---

## §0.1 Strategic Decisions (locked-in during planning discussion)

| Decision | Choice |
|---|---|
| Target audience | Breite Masse, AI-Anfänger (Jugendliche, junge Erwachsene, ältere Leute mit Alltagstipps) |
| Family mix | 70% Family B (Hook-driven), 30% Family A (Data-driven) |
| Persona-Tags | Just-in-time LLM-scoring with caching (no manual tagging) |
| Brand-Assets | Brandfetch primary → Clearbit/favicon fallback chain |
| Video output | Deferred (Phase 2 or later); v1 is static carousels only |
| AppSumo Deals | Separate future system, NOT in this theme |
| Article output | Included from v1 (hub-spoke value) |
| End-Slide variants | Required from v1 (`comment-to-get` is engagement multiplier) |
| ManyChat integration | Manual setup in v1, API integration deferred |
| Template-Variety | 2 style-variants per base template (LRU rotation for visual freshness) |
| v1 launch scope | 5 of 14 format-types live; rest iteratively added |

---

## §0.2 v1 Launch Format-Types (Phase 1)

Five format-types, covering both families:

1. `top_n_comparison` — Family A, workhorse
2. `head_to_head` — Family A, SEO-strong
3. `story_arc_clickbait` — Family B, viral ("I lost my Job…")
4. `lifestyle_listicle` — Family B, broad-mass ("How Claude could change your life")
5. `opinion_recommendation` — Family B, affiliate-revenue ("Why everyone should have ChatGPT Premium")

Plus 9 additional format-types defined as schemas but UI-unblocked for v1.5/v2:

6. `whats_new` (Family A)
7. `free_tool_spotlight` (Family A)
8. `tutorial_sidebyside` (Family B — "Same prompt, different AIs")
9. `persona_top_n` (Family B — "5 KI-Tools für Eltern")
10. `cheatsheet_master` (Family B — "Master Midjourney in 5 Slides")
11. `anti_hype` (Family B — "5 überschätzte KI-Tools")
12. `personal_stack` (Family B — "Mein KI-Stack als Solopreneur")
13. `experiment_style` (Family B — "Was passiert wenn du Claude für X nutzt")
14. `truths_education` (Family B — "5 Wahrheiten über KI-Bildgenerierung")

---

## §0.3 Backlog — Sub-Spec Inventory

| Spec | Title | Effort | Depends on | Phase |
|---|---|---|---|---|
| **65.1** | DB Foundation | 2 days | none | 1 |
| **65.2** | Brand-Asset Acquisition Pipeline | 3 days | 65.1 | 2 |
| **65.3** | Persona-Scoring + Tool-Data Refresh | 3 days | 65.1, 65.2 | 2 |
| **65.4** | Hook-Library + Format-Type Registry | 2 days | 65.1 | 2 |
| **65.5** | Brief-Generator + Cron + Pipeline-Router | 3 days | 65.1–65.4 | 3 |
| **65.6** | Template-Registry Extension (3-Layer Selection) | 2 days | 54a (existing) | 3 |
| **65.7** | Template Family A (4 templates × 2 variants) | 7 days | 65.6 | 4 |
| **65.8** | Template Family B (5 templates × 2 variants) | 11 days | 65.6 | 4 |
| **65.9** | End-Slide-System | 4 days | 65.1 | 5 |
| **65.10** | Article-Output + Hub-Spoke | 4 days | 65.5 | 5 |
| **65.11** | Settings-UI Foundation (Form-Engine + Widgets) | 5 days | 65.1 | 6 |
| **65.12** | Settings-UI Pages (CRUD + End-Slide + Resources) | 4 days | 65.11, 65.9 | 6 |
| **65.13** | ManyChat API Integration (optional, deferred) | 3 days | 65.9 | Later |

**Total:** ~50 working days (6–7 calendar weeks).

---

# Sub-Specs

## Spec 65.1 — DB Foundation

**Goal:** All persistent state required by Theme 65, established in one focused schema sprint.

### New tables

```sql
-- Core: recurring definitions per project
CREATE TABLE recurring_content_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  format_type text NOT NULL,              -- 'top_n_comparison' | 'story_arc_clickbait' | ...
  format_config jsonb NOT NULL,           -- type-specific config, validated per format-type
  frequency text NOT NULL,                -- 'weekly' | 'biweekly' | 'monthly'
  next_run_at timestamptz NOT NULL,
  last_run_at timestamptz,
  output_targets jsonb NOT NULL,          -- { article: bool, social: bool }
  template_selection_strategy text NOT NULL DEFAULT 'lru', -- 'fixed' | 'lru' | 'llm-picks' | 'latest'
  fixed_template_key text,                -- only if strategy='fixed'
  end_slide_strategy text NOT NULL DEFAULT 'rotation',
  end_slide_pool jsonb NOT NULL DEFAULT '[]'::jsonb, -- array of end_slide_definition IDs
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_recurring_defs_next_run ON recurring_content_definitions(next_run_at) WHERE is_active = true;
CREATE INDEX idx_recurring_defs_project ON recurring_content_definitions(project_id);

-- Hook-Library
CREATE TABLE hook_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  format_type text NOT NULL,              -- which format-type this hook serves
  pattern text NOT NULL,                  -- "I lost my {profession} job because of {tool}"
  language text NOT NULL,                 -- 'de' | 'en'
  variables jsonb NOT NULL,               -- ["profession", "tool"]
  usage_count int NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_hook_templates_format_type ON hook_templates(format_type, language) WHERE is_active = true;

-- Brand-Assets per tool
CREATE TABLE tool_brand_assets (
  tool_id uuid PRIMARY KEY REFERENCES tools(id) ON DELETE CASCADE,
  logo_url text,                          -- R2 key
  logo_dark_url text,                     -- variant for dark backgrounds
  primary_color text,                     -- hex #RRGGBB
  secondary_color text,                   -- hex #RRGGBB
  brand_name_canonical text,
  source text NOT NULL,                   -- 'brandfetch' | 'clearbit' | 'favicon' | 'manual'
  needs_review boolean NOT NULL DEFAULT false,
  fetched_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Persona-Scoring cache
CREATE TABLE tool_persona_scores (
  tool_id uuid NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  persona text NOT NULL,                  -- 'beginners' | 'students' | 'eltern' | ...
  score int NOT NULL,                     -- 0..10
  reasoning text NOT NULL,
  scored_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tool_id, persona)
);

CREATE INDEX idx_persona_scores_persona ON tool_persona_scores(persona, score DESC);

-- End-Slide definitions
CREATE TABLE end_slide_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL,                     -- 'follow-cta' | 'comment-to-get' | 'link-in-bio' | ...
  config jsonb NOT NULL,                  -- type-specific
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Engagement resources (PDFs etc for comment-to-get)
CREATE TABLE engagement_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  file_url text NOT NULL,                 -- R2 key
  keyword text NOT NULL,                  -- "CLAUDE", "PROMPT", "FREE"
  resource_type text NOT NULL,            -- 'pdf' | 'link' | 'prompt-list'
  manychat_flow_id text,                  -- for future auto-DM integration
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Template usage log for LRU selection
CREATE TABLE template_usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recurring_definition_id uuid NOT NULL REFERENCES recurring_content_definitions(id) ON DELETE CASCADE,
  template_key text NOT NULL,
  end_slide_type text,                    -- which end-slide variant was used
  used_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_template_usage_def_time ON template_usage_log(recurring_definition_id, used_at DESC);
```

### New `topic_briefs` metadata bucket

Following the typed metadata bucket pattern from Spec 63.3b — NO generic metadata field. Add new typed bucket:

```typescript
// In packages/db/schema/topic-briefs.ts
recurringMetadata: jsonb('recurring_metadata').$type<{
  definitionId: string;
  runNumber: number;                      // 1st, 2nd, 3rd run of this definition
  previousToolIds?: string[];             // for rotation/freshness
  formatType: string;
  formatConfig: Record<string, unknown>;
} | null>(),
```

### Helpers (packages/db split pattern)

```
packages/db/helpers/
├── recurring-definitions-read.ts
├── recurring-definitions-write.ts
├── hook-templates-read.ts
├── hook-templates-write.ts
├── tool-brand-assets-read.ts
├── tool-brand-assets-write.ts
├── tool-persona-scores-read.ts
├── tool-persona-scores-write.ts
├── end-slide-definitions-read.ts
├── end-slide-definitions-write.ts
├── engagement-resources-read.ts
├── engagement-resources-write.ts
├── template-usage-log-read.ts
└── template-usage-log-write.ts
```

### Migrations (3 separate migrations)

```
apps/api/migrations/00XX_recurring_content_system_tables.sql
apps/api/migrations/00XY_topic_briefs_recurring_metadata_column.sql
apps/api/migrations/00XZ_recurring_content_seed_default_personas.sql
```

(Separate migrations because — per discovery 124 — `ALTER TYPE ADD VALUE` and seed data must never share a migration.)

### Implementation steps

Day 1: Drizzle schema + migrations + helpers split skeleton
Day 2: Helpers implementation + unit tests + cross-spec import checks (no cycles)

### Open Questions

1. `frequency` as enum or text? → text for flexibility (cron-like expressions later)
2. `format_config` validation: Zod schema per format_type registered centrally?
3. Should `template_usage_log` retention be capped (e.g. last 50 entries per definition)?

---

## Spec 65.2 — Brand-Asset Acquisition Pipeline

**Goal:** Automate fetching of logos + brand colors for all tools in the DB, with fallback chain.

### Architecture

New BullMQ worker `apps/api/src/workers/brand-asset-fetcher.worker.ts`:

```
Job input: { toolId, force?: boolean }
Job output: { status: 'fetched'|'cached'|'fallback'|'needs_review', source }

Fallback chain:
1. Brandfetch API → logo + colors + canonical name
2. Clearbit Logo API → logo only (extract dominant color from logo)
3. Favicon + manifest.json + OG image scrape → low-quality fallback
4. needs_review=true → surface in admin UI for manual override
```

### Pre-flight gate in pipeline

Before rendering any carousel that uses tool logos, pipeline checks `tool_brand_assets` exists for all picked tools. Missing → trigger sync fetch (block up to 5s) OR swap to next eligible tool from a +2 oversampled pool (better UX).

### Initial backfill

One-off script `apps/api/src/scripts/backfill-brand-assets.ts` to seed all existing tools. Cost estimate: 108 tools × ~$0.01 Brandfetch = ~$1.10.

### Config (env via getEnv())

```
BRANDFETCH_API_KEY
CLEARBIT_LOGO_BASE_URL (default https://logo.clearbit.com)
BRAND_ASSET_FETCH_TIMEOUT_MS (default 5000)
```

### Files

```
apps/api/src/workers/brand-asset-fetcher.worker.ts
apps/api/src/lib/brand-asset/
├── fetcher.ts               # main orchestrator
├── brandfetch-adapter.ts
├── clearbit-adapter.ts
├── favicon-fallback.ts
└── color-extractor.ts       # for fallback color detection
apps/api/src/scripts/backfill-brand-assets.ts
apps/web/src/pages/admin/BrandAssetsReviewPage.vue   # manual override UI
```

### Open Questions

1. Brandfetch vs alternative provider? → evaluate at implementation time
2. Logo dark-variant: generate via SVG-recolor or fetch separately?
3. Review-queue UI scope: simple list-and-upload or full editor?

---

## Spec 65.3 — Persona-Scoring + Tool-Data Refresh

**Goal:** Two related pre-pipeline enrichment layers — both LLM-driven, both cached.

### Part A: Persona-Scoring Cache

When a format-type needs persona-filtered tools (e.g. `persona_top_n` "5 KI-Tools für Eltern"), pipeline checks `tool_persona_scores` for `persona=eltern` across all tools. Missing or stale (>6 months) → trigger LLM batch-scoring step.

LLM input: tool list (name + description + use cases) + persona definition
LLM output: { toolId, score 0-10, reasoning } per tool

Cost: ~$0.20 per persona × 8 personas = ~$1.60 initial backfill, then near-zero (cache).

Default personas (configurable per project):

```typescript
const DEFAULT_PERSONAS = [
  'beginners', 'students', 'parents', 'seniors',
  'solopreneurs', 'marketers', 'developers', 'designers',
  'teachers', 'creators'
] as const;
```

### Part B: Tool-Data Refresh Pipeline

For brand-actuality ("Top 5 LLMs Juni 2026" needs current pricing + features), tools that haven't been refreshed in 30+ days get a web-search refresh step before being included in a recurring run.

Worker: `tool-data-refresh.worker.ts`
Adapter: web-search → LLM extraction → diff against current `tools.metadata` → update if material change → notify in admin UI.

Per-tool refresh cost: ~€0.05 (web-search + LLM). 5 tools per top-N post × 14 posts/month = ~€3.50/month. Acceptable.

### Files

```
apps/api/src/workers/
├── persona-scoring.worker.ts
└── tool-data-refresh.worker.ts
apps/api/src/lib/persona-scoring/
├── score-tools-for-persona.ts
└── persona-definitions.ts
apps/api/src/lib/tool-data-refresh/
├── fetch-current-tool-data.ts
└── diff-detector.ts
```

### Open Questions

1. Persona-Score TTL: 6 months too long? Re-score on tool-data refresh?
2. Tool-data refresh frequency: 30 days vs 60? Per-tool vs per-category?
3. Material-change threshold for surfacing in admin?

---

## Spec 65.4 — Hook-Library + Format-Type Registry

**Goal:** Centralized, version-controlled hook patterns (the soul of Family B) and the format-type registry that ties everything together.

### Hook-Library

Hook templates stored per project per format-type per language. Examples:

```
format_type: 'story_arc_clickbait', language: 'de'
- "Ich habe meinen {profession}-Job verloren — wegen {tool}"
- "{tool} hat meinen Job als {profession} obsolet gemacht — und mich befreit"
- "Warum ich als {profession} {tool} eigentlich danken sollte"

format_type: 'opinion_recommendation', language: 'de'
- "Warum jeder {tool} Premium haben sollte"
- "{tool} Pro hat sich für mich gelohnt — hier ist warum"
- "Lohnt sich {tool} Pro 2026?"
```

LLM-Picker step: receives content context + eligible hooks → ranks → picks top-1. Updates `usage_count` + `last_used_at` for LRU rotation.

### Format-Type Registry

Central registry in `packages/shared/format-types/`:

```typescript
// packages/shared/format-types/registry.ts
export const FORMAT_TYPES = {
  top_n_comparison: {
    family: 'A',
    eligibleTemplates: ['comparison-grid-3', 'comparison-grid-5', 'comparison-grid-10'],
    defaultStrategy: 'lru',
    defaultEndSlides: ['comment-to-get', 'link-in-bio'],
    configSchema: topNComparisonConfigSchema,
    briefGenerator: 'top-n-comparison-brief-generator',
  },
  story_arc_clickbait: {
    family: 'B',
    eligibleTemplates: ['story-arc-clickbait-dramatic', 'story-arc-clickbait-minimal'],
    defaultStrategy: 'llm-picks',
    defaultEndSlides: ['tag-friend'],
    configSchema: storyArcClickbaitConfigSchema,
    briefGenerator: 'story-arc-clickbait-brief-generator',
  },
  // ... 12 more
} as const satisfies Record<string, FormatTypeDefinition>;
```

### Files

```
packages/shared/format-types/
├── registry.ts
├── types.ts
├── top-n-comparison.ts        # schema + UI hints + brief-generator key
├── head-to-head.ts
├── story-arc-clickbait.ts
├── lifestyle-listicle.ts
├── opinion-recommendation.ts
├── ... (9 more for v1.5/v2)
apps/api/src/lib/hook-library/
├── pick-hook.ts               # LLM-driven picker
└── render-hook.ts             # variable substitution
```

### Open Questions

1. Hook-Library UI: separate page or inline in Settings-UI per definition?
2. Hook A/B testing: track engagement per hook → boost winners?
3. Format-type-config-schema location: shared package OR per-template package?

---

## Spec 65.5 — Brief-Generator + Cron + Pipeline-Router Extension

**Goal:** Wire recurring definitions into the existing pipeline infrastructure.

### Cron Integration (per-project pattern from Spec 62.0a)

New cron job `recurring-content-trigger.cron.ts` runs every 5 minutes:

```sql
SELECT * FROM recurring_content_definitions
WHERE is_active = true
  AND next_run_at <= now()
  AND created_at < now() - interval '30 seconds'  -- transaction-race buffer
ORDER BY next_run_at ASC
LIMIT 10;
```

For each due definition: create `topic_brief` with `recurringMetadata` bucket populated, enqueue via pipeline-router.

### Brief-Generators (per format-type)

Each format-type has its own brief-generator following a common interface:

```typescript
interface BriefGenerator {
  format_type: string;
  generate(input: {
    projectId: string;
    definition: RecurringContentDefinition;
    runNumber: number;
    previousRunMetadata?: PreviousRunMetadata;
  }): Promise<TopicBrief>;
}
```

Examples:

- `top-n-comparison-brief-generator`: queries tools by category → applies ranking source → picks N → builds brief with comparison metadata bucket
- `story-arc-clickbait-brief-generator`: picks profession from rotation pool + matching tool + hook from library → builds brief with custom metadata
- `head-to-head-brief-generator`: picks tool pair (curated or auto-paired) → builds brief

### Pipeline-Router Extension (62.8 pattern)

Existing pipeline-router has discriminated union `kind: "enqueue" | "inline"`. Add new routing branch:

```typescript
// In pipeline-router.ts
if (pipelineInput.kind === 'recurring') {
  // Route based on format-type + output_targets
  if (output_targets.social && output_targets.article) {
    // Spawn 2 parallel pipelines: social-render + article-generation
    return { kind: 'enqueue', pipelines: ['social', 'article'] };
  }
  // ... single-target routing
}
```

### Files

```
apps/api/src/workers/recurring-content-trigger.cron.ts
apps/api/src/lib/recurring-content/
├── brief-generators/
│   ├── index.ts                          # registry mapping format_type → generator
│   ├── top-n-comparison.ts
│   ├── head-to-head.ts
│   ├── story-arc-clickbait.ts
│   ├── lifestyle-listicle.ts
│   └── opinion-recommendation.ts
├── compute-next-run-at.ts                # frequency → next timestamp
└── update-after-run.ts                   # mark last_run_at, advance next_run_at
packages/pipelines/engine/router.ts       # extended with 'recurring' kind
```

### Open Questions

1. What if 2 definitions due simultaneously? Sequential (safe) or parallel (faster)?
2. Failure handling: retry vs skip vs mark broken?
3. Should `next_run_at` advance on failure or wait for retry success?

---

## Spec 65.6 — Template-Registry Extension (3-Layer Selection)

**Goal:** Extend existing TemplateRegistry (from Spec 54a) to support style-variants and LRU rotation.

### 3-Layer Selection

```
Layer 1: Format-Type → Template-Pool         (declarative, from format-type registry)
Layer 2: Content-Eligibility Gates            (deterministic filter, from each template definition)
Layer 3: Selection-Strategy                   (fixed | lru | llm-picks | latest)
```

### LRU Selection Logic

```typescript
async function pickTemplateLRU(input: {
  definitionId: string;
  eligibleTemplates: TemplateKey[];
}): Promise<TemplateKey> {
  // Get last 5 uses for this definition
  const recent = await getRecentTemplateUsage(input.definitionId, 5);
  const recentKeys = new Set(recent.map(r => r.templateKey));

  // Prefer templates NOT in recent
  const fresh = input.eligibleTemplates.filter(t => !recentKeys.has(t));
  if (fresh.length > 0) {
    return randomPick(fresh);
  }

  // All recently used: pick least-recent
  return getLeastRecentTemplate(input.eligibleTemplates, recent);
}
```

### Style-Variants Convention

Each base template gets 2 style-variants. Naming pattern: `{base-template-key}-{variant-suffix}`.

Examples:
- `comparison-grid-5-clean` (Linear-style, tech-clean)
- `comparison-grid-5-warm` (gebrochenes Beige, friendly)

Both variants share the same `definition.ts` slot-map and content-bounds. They differ only in `compositions/<Variant>/` Remotion components.

### Files

```
packages/social/src/template-registry/
├── pick-template.ts                      # main entry, applies 3 layers
├── strategies/
│   ├── lru-strategy.ts
│   ├── llm-picks-strategy.ts
│   ├── fixed-strategy.ts
│   └── latest-strategy.ts
└── eligibility.ts                        # gate evaluator
```

### Open Questions

1. LRU window: last 5 too short for visual variety? Make configurable per project?
2. LLM-picks strategy cost: extra LLM call per render — budget impact for high-volume?
3. Style-variants: build all variants up-front or only base templates for v1 launch?

---

## Spec 65.7 — Template Family A (Data-driven)

**Goal:** Build 4 base templates × 2 style-variants for data-driven format-types.

### Templates

**Base templates (4):**

1. `comparison-grid-5` — 5-tool comparison (covers `top_n_comparison` with N=5)
2. `comparison-grid-3` — 3-tool comparison (N=3 fallback for thin categories)
3. `head-to-head-vs` — A vs B comparison (covers `head_to_head`)
4. `whats-new-roundup` — list of new tools with brief intro per tool

**Style-variants (×2 each = 8 total components):**

- `*-clean` (Linear-Look: tight typography, minimal accent moments, lots of whitespace)
- `*-warm` (Friendly-Look: gebrochenes Beige, softer corners, more visual warmth)

### Slot/Bounds reuse

All variants of a base template share the same `definition.ts` (slot-map, content-bounds, LLM schemas). Only `compositions/<Variant>/` differs.

### Files (per template, repeated × 4)

```
packages/social/src/templates/{template-key}/
├── definition.ts
├── llm-prompt.de.ts
├── llm-prompt.en.ts
└── compositions/
    ├── Clean/
    │   ├── index.tsx
    │   └── slides/...
    └── Warm/
        ├── index.tsx
        └── slides/...
```

### Override schemas

Override schemas in `src/templates/overrides/{template-key}.overrides.ts` for each base template.

### Open Questions

1. Should `comparison-grid-10` also be built in v1 (for "Top 10" lists)? Or defer?
2. Style-variants: same content limits or different (e.g. `warm` allows longer headlines because softer typography)?
3. Tool-logo treatment: same across variants or per-variant styling?

---

## Spec 65.8 — Template Family B (Hook-driven)

**Goal:** Build 5 base templates × 2 style-variants for hook-driven format-types. This is the largest sub-spec because hook-driven templates have more compositional freedom.

### Templates

**Base templates (5):**

1. `story-arc-clickbait` — 6-slide narrative arc (hook → conflict → resolution → CTA)
2. `lifestyle-listicle` — 7-slide listicle ("5 Wege wie…" format)
3. `opinion-recommendation` — 5-slide opinion piece with verdict
4. `tutorial-sidebyside` — image-prompt comparison across tools (for `tutorial_sidebyside`)
5. `persona-top-n` — persona-anchored 5-tool listicle ("Top 5 KI-Tools für Eltern")

**Style-variants per base (×2 = 10 components):**

- `*-dramatic` (Bold, attention-grabbing: heavy typography, emotional color palette, motion-like static design)
- `*-minimal` (Calm, sophisticated: lots of whitespace, gentle pacing, single accent moments)

### Story-Arc structure (example)

```
Slide 1: Hook ("Ich war Texter — bis Claude kam")
Slide 2: Setup / Was passiert ist
Slide 3: Wendepunkt
Slide 4: Was AI besser konnte (concrete examples)
Slide 5: Was menschlich noch wichtig ist (Solution-Spin)
Slide 6: Was du jetzt tun kannst (CTA-Bridge to end-slide)
```

### Hook integration

Every Family B template's LLM prompt receives the picked hook from the hook-library. Prompt structure:

```
[System prompt]
Use this exact hook for slide 1: {hook}
Build the rest of the carousel around this hook...
```

### Files (per template × 5)

Same structure as 65.7 but with hook-aware prompts.

### Open Questions

1. Story-arc 6 slides vs 5 vs 7: A/B test or pick one?
2. `dramatic` variant: how dramatic? Risk of looking AI-generic if too try-hard
3. Persona-tone alignment: does `persona-top-n` for seniors need different visual style than for students? Hardcoded mapping?

---

## Spec 65.9 — End-Slide System

**Goal:** Pluggable end-slide system with 8 end-slide types, orthogonal to templates.

### End-Slide types (v1)

1. `follow-cta` (baseline)
2. `comment-to-get` ⚡ (engagement multiplier)
3. `link-in-bio` (Hub-Spoke traffic)
4. `tag-friend` (viral spread)
5. `save-share-cta` (algorithmic save-signal)
6. `opinion-poll` (conversation-trigger)
7. `next-in-series` (series-binding)
8. `download-resource` (DM-funnel via keyword)

### Architecture

End-slide is appended to template output:

```
Final Carousel = [content slides from Template]
               + [1 end slide from End-Slide-Registry]
```

End-slide picker runs after template content is generated:

```typescript
async function pickEndSlide(input: {
  definitionId: string;
  formatType: string;
  contentContext: CarouselContent;
}): Promise<EndSlideInstance> {
  const definition = await getRecurringDefinition(input.definitionId);
  const pool = await getEndSlidePool(definition.endSlidePool);

  switch (definition.endSlideStrategy) {
    case 'fixed': return pool[0];
    case 'rotation': return pickRotation(pool, input.definitionId);
    case 'llm-picks': return pickViaLLM(pool, input.contentContext);
  }
}
```

### End-slide config examples

```typescript
// comment-to-get
{
  keyword: "CLAUDE",
  resource_id: "uuid-of-engagement-resource",
  autoreply_service: "manychat",
  visual_style: "bold"  // template-level styling hint
}

// link-in-bio
{
  destination_url: "https://toolwiki.ai/de/top-5-llms-mai-2026",
  anchor_text: "Vollen Artikel im Link in Bio"
}

// next-in-series
{
  teaser_text: "Nächste Woche: Top 5 Bild-KIs",
  next_definition_id: "uuid-of-next-recurring-def"
}
```

### Files

```
packages/social/src/end-slides/
├── registry.ts                           # type → component mapping
├── types/
│   ├── FollowCtaSlide.tsx
│   ├── CommentToGetSlide.tsx
│   ├── LinkInBioSlide.tsx
│   ├── TagFriendSlide.tsx
│   ├── SaveShareCtaSlide.tsx
│   ├── OpinionPollSlide.tsx
│   ├── NextInSeriesSlide.tsx
│   └── DownloadResourceSlide.tsx
├── pick-end-slide.ts
└── eligibility.ts                        # which end-slides eligible per format-type
```

### Open Questions

1. End-slide visual style: match template's style-variant OR independent style?
2. `comment-to-get` keyword uniqueness: enforce uniqueness per project (avoid keyword collisions)?
3. Should engagement_resources be per-end-slide OR shared across multiple end-slides?

---

## Spec 65.10 — Article-Output + Hub-Spoke

**Goal:** Generate parallel article output alongside social carousel for definitions with `output_targets.article = true`. Hub-Spoke linking.

### ⚠️ Deferred from Spec 64.20 (2026-05-25)

**Profile-Pages Inventory Integration** belongs in this spec. Marcel deferred the standalone implementation during Spec 64.20 — the data layer (`content_source_inventory` table + cron-refresh worker) is live and populated (30 tools + 10 skills for Toolwiki), but no Astro template reads it yet.

The cross-repo work belongs here because 65.10 already owns the Astro-template + schema surface for recurring-content articles. Folding A1 into 65.10 keeps the Astro-side edits in one coherent spec instead of fragmenting across multiple. Three routing options were evaluated during Spec 64.20 Phase-0 — pick one when starting 65.10:

| Option | Aufwand | Trade-off |
|---|---|---|
| **A1.2 Snapshot-Export** | ~0.75d | Marketing-automation writes `src/data/inventory.json` daily into Astro repo via GitHub-App commit. Astro tool-profile template imports + JOINs by slug. One commit/day = manageable history. Works for ALL tool articles (imported + future generated). **Recommended.** |
| A1.1 Forward-compat only | 0.5d | Extend `RenderMdxStep` to inject `github:` frontmatter for future LLM-generated tool articles. Zero value for current 30 imported tools — only helps if Toolwiki starts generating tool articles via pipeline. |
| A1.3 Write-back per-tool MDX | 1.5d | Inventory-worker commits `github:` frontmatter back into each tool's MDX. Noisy Astro commit history (~30 commits per refresh tick). |

Full Discovery + reasoning preserved at [`specs/_drafts/64.20-followup-profile-pages-discovery.md`](_drafts/64.20-followup-profile-pages-discovery.md).

**What lands as part of 65.10 implementation:**
- Pick routing option (default A1.2)
- Astro repo `src/content/config.ts` extension — declare `github:` schema field on `tools` collection
- Astro repo `tools/[slug].astro` template render: stars + license + latest release + "Updated weekly from GitHub" badge
- If A1.2: new `apps/api/src/scripts/export-inventory-snapshot.ts` + post-refresh hook or daily cron to write the JSON

**Verify-points when picking up:**
- Inventory has ≥2 weeks of cron-refresh data (so `last_fetched_at` is meaningful)
- Astro `tools` collection schema doesn't already declare `github*` fields (grep before adding)
- Marcel-decision on UX: badge format + which fields to surface on profile page

### Article Generation

When a recurring definition fires with `output_targets.article = true`:

1. Brief-generator produces a `topic_brief` with `recurringMetadata` bucket
2. Pipeline-router spawns BOTH `social-render` and `article-generation` pipelines in parallel
3. Article-generation pipeline uses a recurring-aware article template (e.g. "comparison-article-top-n") that mirrors the carousel content but in full prose
4. After both complete: Hub-Spoke link is established — article links to social post embed, social end-slide can use `link-in-bio` pointing to article

### Article templates per format-type

| Format-Type | Article Template |
|---|---|
| `top_n_comparison` | `comparison-article-top-n` (full-length comparison article) |
| `head_to_head` | `comparison-article-vs` (focused 2-tool deep-dive) |
| `story_arc_clickbait` | `narrative-article` (long-form story) |
| `lifestyle_listicle` | `listicle-article` ("5 Wege" expanded) |
| `opinion_recommendation` | `opinion-article` (full opinion piece) |

### Hub-Spoke connection

- Article frontmatter: `socialPostId`, `socialPostUrl`
- Social end-slide `link-in-bio`: auto-populated with article URL
- Article body: embed/reference social post visually
- `articles.cluster_id` relationship: recurring runs can opt to thread into a topical cluster

### Files

```
apps/api/src/lib/article-generation/recurring-aware/
├── article-from-brief.ts                 # brief → article pipeline entry
├── templates/
│   ├── comparison-article-top-n.ts
│   ├── comparison-article-vs.ts
│   ├── narrative-article.ts
│   ├── listicle-article.ts
│   └── opinion-article.ts
└── hub-spoke-linker.ts                   # post-completion linker
```

### Open Questions

1. Article first or social first? Render order matters for end-slide `link-in-bio` (needs article URL)
2. Should recurring articles flow through existing article-review queue OR auto-publish?
3. Article SEO: own slugs OR threaded under existing clusters?

---

## Spec 65.11 — Settings-UI Foundation (Form-Engine + Widgets)

**Goal:** Generic Vue-Komponente that renders any format-type's config schema as a form. Plus 7 reusable widgets.

### Form-Engine

```vue
<template>
  <q-form @submit="handleSubmit">
    <component
      v-for="field in resolvedFields"
      :key="field.name"
      :is="widgetFor(field)"
      v-model="config[field.name]"
      v-bind="field.props"
    />
  </q-form>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import { resolveFieldsFromZodSchema } from '@/lib/form-engine';
import type { ZodSchema } from 'zod';

export default defineComponent({
  name: 'RecurringDefinitionForm',
  props: {
    formatType: { type: String, required: true },
    modelValue: { type: Object, required: true },
  },
  emits: ['update:modelValue'],
  data: () => ({
    config: {} as Record<string, unknown>,
  }),
  computed: {
    schema(): ZodSchema {
      return getFormatTypeSchema(this.formatType);
    },
    resolvedFields(): ResolvedField[] {
      return resolveFieldsFromZodSchema(this.schema);
    },
  },
  // ...
});
</script>
```

### Reusable Widgets (7)

1. `<ToolMultiSelect>` — tool search + select multiple with logo preview
2. `<RotationListBuilder>` — drag-drop rotation pools (professions, life-areas, etc.)
3. `<HookTemplatePicker>` — browse hook-library + select
4. `<CategoryPicker>` — category select with live tool-count display
5. `<PersonaSelect>` — multi/single persona picker
6. `<ToneSelector>` — visual tone picker (dramatic/minimal/neutral)
7. `<FrequencyPicker>` — daily/weekly/biweekly/monthly

### Zod-Schema → UI-Hints

Following the meta-pattern from packages/shared/format-types:

```typescript
z.enum([...]).meta({
  label: 'Kategorie',
  widget: 'category-picker',
  description: 'Welche Tool-Kategorie soll geranked werden?',
});
```

Resolver reads `.meta()` to pick the right widget.

### Files

```
apps/web/src/components/form-engine/
├── RecurringDefinitionForm.vue           # main engine
├── FieldRenderer.vue                     # per-field rendering
└── widgets/
    ├── ToolMultiSelect.vue
    ├── RotationListBuilder.vue
    ├── HookTemplatePicker.vue
    ├── CategoryPicker.vue
    ├── PersonaSelect.vue
    ├── ToneSelector.vue
    └── FrequencyPicker.vue
apps/web/src/lib/form-engine/
├── resolve-fields-from-zod-schema.ts
├── widget-for-field.ts
└── types.ts
```

### Open Questions

1. Validation: live (on every keystroke) vs on-blur vs on-submit?
2. Multi-step wizard or single-page form? Some format-types have 10+ fields
3. Preview: live render of resulting brief OR only after save?

---

## Spec 65.12 — Settings-UI Pages

**Goal:** CRUD-Seiten für Recurring Definitions, End-Slide-Definitions, Resource-Library. Plus Cmd+K integration.

### Pages

```
/settings/recurring-content
├── index            # list all definitions for current project
├── new              # picker: which format-type? → create form
├── :id              # edit existing definition
└── :id/runs         # history of past runs + status

/settings/end-slides
├── index            # list end-slide definitions
├── new              # type picker → config form
└── :id              # edit

/settings/engagement-resources
├── index            # list resources (PDFs etc.)
└── new              # upload + keyword + type
```

### Definition list UX

Table view with columns:
- Name
- Format-Type (badge)
- Frequency
- Next run
- Last run (status)
- Active toggle
- Actions (edit, duplicate, archive)

### Cmd+K integration

Following Spec 51e+ Cmd+K pattern:

```
i18n/{de,en}/search.ts → new entries:
- "settings.recurring_content.create" → "Neue Content-Rubrik erstellen"
- "settings.end_slides.create" → "Neuen End-Slide erstellen"
- "settings.engagement_resources.upload" → "Resource hochladen"
```

Plus i18n key `settings.sections.recurring_content` for sidebar.

### Files

```
apps/web/src/pages/settings/
├── RecurringContentListPage.vue
├── RecurringContentEditPage.vue
├── RecurringContentNewPage.vue
├── RecurringContentRunsPage.vue
├── EndSlideListPage.vue
├── EndSlideEditPage.vue
├── EngagementResourceListPage.vue
└── EngagementResourceUploadPage.vue

apps/web/src/i18n/{de,en}/
├── settings.ts                           # extend with new section
└── search.ts                             # extend with new Cmd+K actions

apps/web/src/router/settings-routes.ts    # add new routes
```

### Per discovery 133

Adding new settings sections requires updates in:
1. SettingsPage.vue `sections` array
2. Route children
3. i18n key `settings.sections.<key>`
4. Cmd+K actions in `i18n/{de,en}/search.ts`

All 4 must be in this spec's PR.

### Open Questions

1. Definition-duplicate UX: silent copy or "edit then save as new"?
2. Run history retention: how many past runs visible per definition?
3. Should past-run page show carousel preview OR just metadata?

---

## Spec 65.13 — ManyChat API Integration (Deferred)

**Goal (later):** Replace manual ManyChat keyword setup with automated API integration.

### Scope

When user creates `comment-to-get` end-slide with keyword + resource → API call to ManyChat creates:
- Auto-DM flow triggered by keyword
- Attachment = the engagement resource PDF
- Tracking webhook back to Marketing-Tool for DM-count metrics

### Implementation effort

~3 days when prioritized. Out of scope for v1 — Marcel sets up ManyChat manually for v1.

### Open Questions

1. ManyChat API vs alternative? (MobileMonkey, Inflact, custom)
2. Per-keyword cost in ManyChat tier — affordable at scale?
3. DM-count attribution back to Marketing-Tool DB?

---

# Cross-cutting Patterns to Respect

(Applies to all sub-specs; do not violate.)

- All BullMQ workers in `apps/api/src/workers/`, NOT `apps/worker/`
- All env access via `packages/shared/src/config.ts` `getEnv()` — never `process.env` directly
- Drizzle numeric columns: `.numeric().$type<string>()` with `toFixed(2)` write + `parseFloat()` read at boundary
- FK constraints via raw SQL migration, not Drizzle `references()` (avoids circular imports)
- Custom errors: never use `'kind'` or `'cause'` as property names (ES2022 reserved)
- `cron_state` seed never in same migration as `ALTER TYPE ADD VALUE` (discovery 124)
- `topic_briefs` extension uses typed metadata bucket pattern (NO generic metadata field) (D143)
- Package boundaries: `packages/social` NO dep on `packages/pipelines`; `packages/db` NO dep on `core/events`
- Helpers split: `packages/db/helpers/<entity>-{read,write}.ts`
- Spec template rule: every spec ends with `§11 Implemented` + `§12 Discovered & Deviations` skeletons (D-track)
- Vue components: Options API (NOT Composition API), `data: () => ({...})` arrow shorthand, English comments only
- TypeScript strict mode throughout, no `console.*` in production
- No smoke tests — unit/component tests in `__tests__/` only

---

# Implementation Order Recommendation

**Sprint 1 (week 1):** 65.1 (DB Foundation) + 65.4 (Hook-Library + Format-Type Registry)
**Sprint 2 (week 2):** 65.2 (Brand-Assets) + 65.3 (Persona-Scoring + Tool-Data Refresh)
**Sprint 3 (week 3):** 65.5 (Brief-Generator + Cron) + 65.6 (Template-Registry Extension)
**Sprint 4 (week 4):** 65.7 (Family A Templates)
**Sprint 5 (week 5):** 65.8 (Family B Templates) — biggest sprint
**Sprint 6 (week 6):** 65.9 (End-Slide System) + 65.10 (Article-Output)
**Sprint 7 (week 7):** 65.11 + 65.12 (Settings-UI Foundation + Pages)
**Later:** 65.13 (ManyChat API Integration) when needed

After Sprint 7: full v1 launch with 5 format-types live. Iterate to add remaining 9 format-types over following weeks.

---

# Cost Model (v1, monthly)

| Component | Cost |
|---|---|
| LLM (briefs + hook-picks + persona-scoring): ~14 posts × ~€0.10 | €1.40 |
| Tool-data refresh: ~70 tool-refreshes × €0.05 | €3.50 |
| Brand-asset fetches: marginal after initial backfill | €0.10 |
| Image generation: TBD if added | — |
| BullMQ render compute (Remotion): ~14 posts × 7 slides × 2s | €0.50 |
| **Total monthly content cost** | **~€5.50** |

Plus one-time costs: Brandfetch backfill (~€1.10) + Persona-scoring backfill (~€1.60).

---

# Risk Register

| Risk | Mitigation |
|---|---|
| Family B templates look "AI-generic" | Build 2 style-variants per template + visual review gate before launch |
| Hook-library too small → repetitive content | Start with 10+ hooks per format-type per language, expand based on usage |
| Brand-assets coverage gaps (smaller tools) | needs_review workflow + manual override UI |
| Persona-scoring quality variable | Cache + re-score on tool-data refresh; quarterly quality review |
| Settings-UI form-engine over-engineered | Build only widgets needed for v1 (7), defer extra complexity |
| Tool-data refresh false-positives (no real change) | Diff-threshold tuning + admin review queue |
| End-slide rotation feels random | LRU + content-context awareness for `llm-picks` strategy |
| Article + Social output mismatch (different angles) | Both pipelines consume same brief; brief is single source of truth |

---

**End of Theme 65 backlog spec.**
