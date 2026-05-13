# Spec 54a — Template-Library Foundation + use-case-verdict-per-tool

**Type:** Architecture + first new Template
**Estimate:** 5-6h, 5 commits
**Depends on:** Spec 51a-v2.1 (Comparison-Stunning shipped), `article_discovery` Tabelle (Spec 54b oder bereits durch DB-Audit angelegt)
**Goal:** TemplateRegistry mit pluggable Templates + erstes neues Template als Reference-Impl

---

## Context & Why Now

Du hast 22 Comparison-Articles (+ EN-Twins = 44) mit hochstrukturierten `useCaseVerdicts[]`-Arrays im Frontmatter. Aktuell schaltet Comparison-Stunning genau 1 Carousel pro Article frei. Das `useCaseVerdicts`-Array könnte direkt einen 2. Carousel-Typ ausspielen — pure Data-Rendering, KEIN LLM nötig.

Aber: ohne Template-Registry-System gibt's keinen sauberen Weg, mehrere Templates pro Article zu konfigurieren. Heißt diese Spec liefert zwei Dinge gleichzeitig:

1. **Foundation:** Template-Registry, Eligibility-Rules, Mock-Data-System, Frontmatter-Adapters
2. **Reference-Implementation:** `use-case-verdict-per-tool` als erstes neues Template

Plus: existing Comparison-Stunning wird als Registry-Eintrag #1 registriert (kein Render-Code-Change).

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  TemplateRegistry (Singleton, in-memory)                    │
│  - register(template: TemplateDefinition)                   │
│  - getById(key): TemplateDefinition                         │
│  - listEligibleFor(article, discovery): TemplateDefinition[]│
└─────────────────────────────────────────────────────────────┘
                     │
         ┌───────────┼────────────┐
         ▼           ▼            ▼
   ┌──────────┐ ┌─────────┐ ┌──────────────┐
   │ Template │ │ Eligi-  │ │ Mock-Data    │
   │ Render   │ │ bility  │ │ Fixtures     │
   │ Function │ │ Predi-  │ │ (per template)│
   │          │ │ cate    │ │              │
   └──────────┘ └─────────┘ └──────────────┘
                     │
                     ▼
            ┌──────────────────────────────┐
            │ FrontmatterAdapter           │
            │ - getComparisonContext()     │
            │ - getToolContext()           │
            │ - getUseCaseContext()        │
            │ - getKiWissenContext()       │
            │ (typed, collection-spezifisch)│
            └──────────────────────────────┘
```

**Wichtigste Architektur-Entscheidung:** Templates sind **plain TypeScript objects** mit drei Eigenschaften:
- `eligibility`: pure function `(article, discovery) => boolean`
- `render`: pure function `(typedContext, theme) => RemotionComposition`
- `mockData`: fixtures-Map für Preview-Gallery (Spec 54d)

Keine Class-Hierarchy, kein abstract base — flach + funktional. Macht Testing trivial.

---

## DB-Schema-Voraussetzungen

`article_discovery` muss existieren (Migration aus Spec 54b oder bereits durch DB-Audit-Run angelegt). Falls noch nicht, erste Migration in diesem Spec:

```sql
-- migrations/0029_article_template_renders.sql
-- (article_discovery wird in Spec 54b angelegt — falls noch nicht, hier kopieren)

CREATE TABLE "template_renders" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "article_id"      uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  "template_key"    text NOT NULL,
  "locale"          text NOT NULL,           -- 'de' | 'en'
  "theme"           text NOT NULL,           -- 'dark' | 'light'
  "status"          text NOT NULL,           -- 'pending' | 'rendering' | 'ready' | 'failed'
  "render_input"    jsonb NOT NULL,          -- typed context that went into render
  "output_files"    jsonb,                   -- {slides: [], caption, hashtags}
  "cost_usd"        numeric(8,4),
  "duration_ms"     integer,
  "error"           text,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "completed_at"    timestamptz
);

CREATE INDEX template_renders_article_id_idx ON template_renders(article_id);
CREATE INDEX template_renders_template_key_idx ON template_renders(template_key);
CREATE INDEX template_renders_status_idx ON template_renders(status);
CREATE UNIQUE INDEX template_renders_unique_combo
  ON template_renders(article_id, template_key, locale, theme)
  WHERE status IN ('pending', 'rendering', 'ready');
```

Unique-Constraint verhindert Duplikate (gleicher Article × Template × Locale × Theme), erlaubt aber re-render nach `failed`.

---

## Sub-Section 1: Core Types + Registry

**Estimate:** 1h, 1 commit
**Files:**
- `packages/social/src/templates/types.ts` (new)
- `packages/social/src/templates/registry.ts` (new)
- `packages/social/src/templates/index.ts` (barrel export)

### types.ts

```typescript
import type { Article } from '@/db/schema/articles';
import type { ArticleDiscovery } from '@/db/schema/article-discovery';

export type TemplateKey =
  | 'comparison-stunning'           // existing (Spec 51a-v2.1)
  | 'use-case-verdict-per-tool'     // NEW in this spec
  | 'single-tool-spotlight'         // future spec
  | 'news-slide'                    // future spec
  | 'concept-explainer-deck'        // future spec
  | 'price-comparison'              // future spec
  | 'pro-con-verdict';              // future spec

export type Theme = 'dark' | 'light';
export type Locale = 'de' | 'en';

export interface RenderContext<TInput = unknown> {
  article: Article;
  discovery: ArticleDiscovery;
  locale: Locale;
  theme: Theme;
  input: TInput;  // typed per-template context
}

export interface RenderResult {
  slides: SlideOutput[];
  caption: string;
  hashtags: string[];
  metadata: {
    estimatedCostUsd: number;
    templateKey: TemplateKey;
  };
}

export interface SlideOutput {
  filePath: string;  // /mnt/.../slide-01.png
  width: number;
  height: number;
}

/**
 * Eligibility predicate — pure, deterministic, fast.
 * Should answer: kann dieses Template ÜBERHAUPT für diesen Article rendern?
 * NICHT: ist es ein gutes Match? (Das ist Suggestion-Layer in Spec 54c)
 */
export type EligibilityPredicate = (
  article: Article,
  discovery: ArticleDiscovery,
) => EligibilityResult;

export interface EligibilityResult {
  eligible: boolean;
  reason?: string;  // wenn nicht eligible: warum?
  requirements?: string[];  // welche Felder fehlen?
}

export interface TemplateDefinition<TInput = unknown> {
  key: TemplateKey;
  displayName: string;       // "Use-Case Verdict pro Tool" — für UI
  description: string;       // 1-2 Sätze, was macht das Template
  defaultSlideCount: number; // estimate für UI
  estimatedCostUsd: number;  // pro Render (Cover + Slides + Caption-LLM)
  
  eligibility: EligibilityPredicate;
  
  buildInput: (article: Article, discovery: ArticleDiscovery) => TInput;
  render: (context: RenderContext<TInput>) => Promise<RenderResult>;
  
  // Für Preview-Gallery (Spec 54d)
  mockFixtures: MockFixtureMap;
}

export interface MockFixture<TInput = unknown> {
  name: string;             // "Recraft vs Ideogram"
  description: string;      // "2-Tool comparison, German, has useCaseVerdicts"
  input: TInput;
}

export type MockFixtureMap = Record<string, MockFixture>;
```

### registry.ts

```typescript
import type { Article } from '@/db/schema/articles';
import type { ArticleDiscovery } from '@/db/schema/article-discovery';
import type { TemplateDefinition, TemplateKey } from './types';

class TemplateRegistry {
  private templates = new Map<TemplateKey, TemplateDefinition>();
  
  register<T>(template: TemplateDefinition<T>): void {
    if (this.templates.has(template.key)) {
      throw new Error(`Template ${template.key} already registered`);
    }
    this.templates.set(template.key, template as TemplateDefinition);
  }
  
  getById(key: TemplateKey): TemplateDefinition {
    const t = this.templates.get(key);
    if (!t) throw new Error(`Template ${key} not registered`);
    return t;
  }
  
  list(): TemplateDefinition[] {
    return Array.from(this.templates.values());
  }
  
  /**
   * Returns alle Templates die eligible sind für diesen Article.
   * Order: stable (alphabetisch nach key).
   */
  listEligibleFor(
    article: Article,
    discovery: ArticleDiscovery,
  ): EligibleTemplate[] {
    return this.list()
      .map(template => ({
        template,
        eligibility: template.eligibility(article, discovery),
      }))
      .filter(x => x.eligibility.eligible)
      .map(x => ({
        template: x.template,
        reason: x.eligibility.reason,
      }))
      .sort((a, b) => a.template.key.localeCompare(b.template.key));
  }
}

export interface EligibleTemplate {
  template: TemplateDefinition;
  reason?: string;
}

// Singleton — registered lazily im app-bootstrap (Section 5)
export const templateRegistry = new TemplateRegistry();
```

**Acceptance:**
- Unit tests: register/getById/listEligibleFor
- Duplicate-Registration wirft
- Eligibility-Filter funktioniert
- Stable sort order

**Commit message:** `feat(templates): add TemplateRegistry singleton with eligibility-based template listing`

---

## Sub-Section 2: Frontmatter-Adapters

**Estimate:** 1h, 1 commit
**Files:**
- `packages/social/src/templates/adapters/types.ts`
- `packages/social/src/templates/adapters/comparison.ts`
- `packages/social/src/templates/adapters/tool.ts`
- `packages/social/src/templates/adapters/useCase.ts`
- `packages/social/src/templates/adapters/kiWissen.ts`
- `packages/social/src/templates/adapters/index.ts`

Collection-spezifische typed views auf `frontmatter_extras`. Templates konsumieren typed contexts, niemals raw frontmatter.

### adapters/types.ts

```typescript
export interface ToolReference {
  slug: string;
  name: string;
  logoUrl?: string;
  pricingTier?: 'free' | 'freemium' | 'paid' | 'enterprise';
  priceFrom?: number;
  primaryCategory?: string;
  endSlideToken?: string;  // populated lazily (Spec 51a-v2.1 §1.2)
}

export interface ProConItem {
  text: string;
  category?: string;  // optional grouping
}

export interface UseCaseVerdict {
  useCase: string;        // "Logo-Design für Brand"
  winner: string;         // tool slug
  reason: string;         // 1-2 Sätze warum
  score?: number;         // optional 0-10
}
```

### adapters/comparison.ts

```typescript
import type { Article } from '@/db/schema/articles';
import type { ToolReference, UseCaseVerdict } from './types';

export interface ComparisonContext {
  tools: ToolReference[];        // resolved aus toolSlugs
  verdict: string;                // wer hat gewonnen + warum
  winner?: string;                // tool slug
  testMethodology?: string;
  useCaseVerdicts: UseCaseVerdict[];  // KEY field für use-case-verdict-per-tool template
  pricingTable?: PricingRow[];
}

export function getComparisonContext(
  article: Article,
  toolLookup: Map<string, ToolReference>,
): ComparisonContext {
  if (article.collection !== 'comparisons') {
    throw new Error(`Article ${article.slug} is not a comparison`);
  }
  
  const extras = article.frontmatter_extras as ComparisonExtras;
  const tools = (extras.toolSlugs ?? [])
    .map(slug => toolLookup.get(slug))
    .filter((t): t is ToolReference => t != null);
    
  return {
    tools,
    verdict: extras.verdict ?? '',
    winner: extras.winner,
    testMethodology: extras.testMethodology,
    useCaseVerdicts: extras.useCaseVerdicts ?? [],
    pricingTable: extras.pricingTable,
  };
}

interface ComparisonExtras {
  toolSlugs?: string[];
  verdict?: string;
  winner?: string;
  testMethodology?: string;
  useCaseVerdicts?: UseCaseVerdict[];
  pricingTable?: PricingRow[];
}

interface PricingRow {
  tool: string;
  free: boolean;
  monthly?: number;
}
```

Analog: `tool.ts`, `useCase.ts`, `kiWissen.ts` adapters. Jeder hat:
- typed Context-Interface
- Extractor-Function `getXContext(article, ...lookups) => XContext`
- Validation: wirft wenn article.collection nicht passt

**Tool-Lookup-Helper** (gemeinsam genutzt):

```typescript
// adapters/toolLookup.ts
import { db } from '@/db';
import { eq } from 'drizzle-orm';
import { articles } from '@/db/schema/articles';
import type { ToolReference } from './types';

export async function buildToolLookup(
  toolSlugs: string[],
  locale: 'de' | 'en',
): Promise<Map<string, ToolReference>> {
  if (toolSlugs.length === 0) return new Map();
  
  const toolArticles = await db
    .select()
    .from(articles)
    .where(/* collection=tools AND slug IN toolSlugs AND locale=locale */);
    
  return new Map(toolArticles.map(t => [
    t.slug,
    {
      slug: t.slug,
      name: t.title,
      logoUrl: t.frontmatter_extras?.logoUrl,
      pricingTier: t.frontmatter_extras?.pricingTier,
      priceFrom: t.frontmatter_extras?.priceFrom,
      primaryCategory: t.frontmatter_extras?.primaryCategory,
      endSlideToken: t.frontmatter_extras?.endSlideToken,
    },
  ]));
}
```

**Acceptance:**
- Unit tests pro Adapter mit Sample-Articles (Recraft-vs-Ideogram, ChatGPT vs Claude)
- Wrong-collection throws
- Tool-lookup batches korrekt
- Missing-Field handling robust (returns empty arrays, nicht null/undef chaos)

**Commit message:** `feat(templates): add typed frontmatter adapters per collection`

---

## Sub-Section 3: Comparison-Stunning Registry-Entry

**Estimate:** 30min, 1 commit
**Files:**
- `packages/social/src/templates/definitions/comparisonStunning.ts` (new)

Existing Comparison-Stunning wird in der Registry registriert ohne den existing Render-Code zu touchieren.

```typescript
import type { TemplateDefinition } from '../types';
import { getComparisonContext, type ComparisonContext } from '../adapters/comparison';
import { buildToolLookup } from '../adapters/toolLookup';
import { renderComparisonStunning } from '@/slides/comparison-stunning';  // existing
import { COMPARISON_STUNNING_FIXTURES } from './fixtures/comparisonStunning.fixtures';

export const comparisonStunningTemplate: TemplateDefinition<ComparisonContext> = {
  key: 'comparison-stunning',
  displayName: 'Vergleich (Comparison-Stunning)',
  description: 'Cover mit Hook, Tool-Spotlights pro verglichenes Tool, Verdict-Closer. Optimiert für 2-Tool-Vergleiche.',
  defaultSlideCount: 4,
  estimatedCostUsd: 0.01,
  
  eligibility: (article, discovery) => {
    if (article.collection !== 'comparisons') {
      return { eligible: false, reason: 'Nur für comparisons-Collection' };
    }
    
    const extras = article.frontmatter_extras as { toolSlugs?: string[]; verdict?: string };
    const toolCount = extras?.toolSlugs?.length ?? 0;
    
    if (toolCount < 2) {
      return {
        eligible: false,
        reason: 'Benötigt mindestens 2 Tools',
        requirements: ['frontmatter.toolSlugs.length >= 2'],
      };
    }
    if (!extras.verdict) {
      return {
        eligible: false,
        reason: 'Verdict-Feld fehlt',
        requirements: ['frontmatter.verdict'],
      };
    }
    return { eligible: true };
  },
  
  buildInput: async (article, discovery) => {
    const extras = article.frontmatter_extras as { toolSlugs?: string[] };
    const toolLookup = await buildToolLookup(extras.toolSlugs ?? [], article.locale);
    return getComparisonContext(article, toolLookup);
  },
  
  render: async (context) => {
    // Adapter to existing renderer
    return renderComparisonStunning({
      tools: context.input.tools,
      verdict: context.input.verdict,
      winner: context.input.winner,
      theme: context.theme,
      locale: context.locale,
    });
  },
  
  mockFixtures: COMPARISON_STUNNING_FIXTURES,
};
```

**Acceptance:**
- Existing comparison-stunning-Render-Code wird NICHT geändert
- Eligibility liefert correct true für recraft-vs-ideogram, false für tools-collection
- buildInput resolved tool-lookup korrekt

**Commit message:** `feat(templates): register existing comparison-stunning in TemplateRegistry`

---

## Sub-Section 4: NEW Template `use-case-verdict-per-tool`

**Estimate:** 2.5h, 1 commit
**Files:**
- `packages/social/src/templates/definitions/useCaseVerdictPerTool.ts`
- `packages/social/src/slides/UseCaseVerdictCoverSlide.tsx`
- `packages/social/src/slides/UseCaseVerdictSlide.tsx`
- `packages/social/src/slides/UseCaseVerdictRecapSlide.tsx`
- `packages/social/src/templates/definitions/fixtures/useCaseVerdict.fixtures.ts`

### Template Logic

Output-Struktur pro Carousel:
- **Slide 1 — Cover**: Hook ("So wählst du das richtige Tool"), Tool-Logos top-right, BigNumber = useCaseVerdicts.length
- **Slides 2..N — Per Use-Case**: Use-Case-Name (large), Winner-Badge mit Tool-Logo, Reason (2-3 Zeilen)
- **Slide N+1 — Recap**: Tally pro Tool ("Recraft gewinnt 4×, Ideogram 2×")
- **Slide N+2 — End/CTA**: existing Save-Action-Pattern

Bei z.B. 5 useCaseVerdicts = 1 + 5 + 1 + 1 = **8 Slides**.

### Definition

```typescript
import type { TemplateDefinition } from '../types';
import { getComparisonContext, type ComparisonContext } from '../adapters/comparison';
import { buildToolLookup } from '../adapters/toolLookup';
import { renderUseCaseVerdictCarousel } from '@/slides/use-case-verdict-render';
import { USE_CASE_VERDICT_FIXTURES } from './fixtures/useCaseVerdict.fixtures';

export const useCaseVerdictPerToolTemplate: TemplateDefinition<ComparisonContext> = {
  key: 'use-case-verdict-per-tool',
  displayName: 'Use-Case-Verdict pro Tool',
  description: 'Pro Use-Case eine Slide mit Gewinner-Tool und Begründung. Schließt mit Recap-Tally.',
  defaultSlideCount: 7,
  estimatedCostUsd: 0.008,  // billiger als comparison-stunning (kein LLM-Hook, alles Data)
  
  eligibility: (article, discovery) => {
    if (article.collection !== 'comparisons') {
      return { eligible: false, reason: 'Nur für comparisons-Collection' };
    }
    
    const extras = article.frontmatter_extras as { useCaseVerdicts?: UseCaseVerdict[] };
    const verdicts = extras?.useCaseVerdicts ?? [];
    
    if (verdicts.length < 3) {
      return {
        eligible: false,
        reason: 'Benötigt mindestens 3 Use-Case-Verdicts',
        requirements: ['frontmatter.useCaseVerdicts.length >= 3'],
      };
    }
    if (verdicts.length > 8) {
      return {
        eligible: false,
        reason: 'Mehr als 8 Use-Case-Verdicts — wäre zu lang für Carousel',
        requirements: ['frontmatter.useCaseVerdicts.length <= 8'],
      };
    }
    // Validate each verdict has winner + reason
    const incomplete = verdicts.filter(v => !v.winner || !v.reason);
    if (incomplete.length > 0) {
      return {
        eligible: false,
        reason: `${incomplete.length} Verdicts ohne winner/reason`,
      };
    }
    return { eligible: true };
  },
  
  buildInput: async (article, discovery) => {
    const extras = article.frontmatter_extras as { toolSlugs?: string[] };
    const toolLookup = await buildToolLookup(extras.toolSlugs ?? [], article.locale);
    return getComparisonContext(article, toolLookup);
  },
  
  render: async (context) => {
    return renderUseCaseVerdictCarousel({
      tools: context.input.tools,
      verdicts: context.input.useCaseVerdicts,
      locale: context.locale,
      theme: context.theme,
    });
  },
  
  mockFixtures: USE_CASE_VERDICT_FIXTURES,
};
```

### Slide-Components

**UseCaseVerdictCoverSlide.tsx** — Layout reuses Stunning-Cover-Pattern aus Spec 51a-v2.1:
- Eyebrow: "TOOL-VERGLEICH · {YEAR}"
- Hook (3-line phrase-based): "So wählst du / das **richtige** / Tool"
- BigNumber: useCaseVerdicts.length
- Subline: "{useCaseVerdicts.length} Use-Cases im direkten Vergleich"
- Promise-Block: "Jeder Use-Case bekommt einen Gewinner. / Keine Hype-Antworten."
- Tool-Logos top-right
- Footer + Page-Indicator

**UseCaseVerdictSlide.tsx** — Pro Use-Case:
```
┌─────────────────────────────────────────┐
│ EYEBROW: USE-CASE 03/05                 │
│                                         │
│ Logo-Design für                         │
│ Brand-Identität                         │  ← Use-Case-Name, 64px
│                                         │
│ ┌─────────────────────────────────┐    │
│ │ [LOGO] GEWINNT                   │    │
│ │        Recraft                   │    │  ← Winner-Block
│ └─────────────────────────────────┘    │
│                                         │
│ Vektor-Export und Brand-Konsistenz      │
│ sind hier entscheidend — Recraft        │  ← Reason, 28px
│ liefert beide aus der Box.              │
│                                         │
│ FOOTER  3/8 →                           │
└─────────────────────────────────────────┘
```

**UseCaseVerdictRecapSlide.tsx** — Tally:
```
┌─────────────────────────────────────────┐
│ EYEBROW: GESAMT-ERGEBNIS                │
│                                         │
│ Recraft  ████████ 4× Gewinner           │
│ Ideogram ████ 2× Gewinner               │
│                                         │
│ Im Gleichstand: 0                       │
│                                         │
│ {{Winner-Tool}} liefert beim breiteren  │
│ Spektrum, aber {{Other}} dominiert      │  ← computed summary
│ Text-im-Bild deutlich.                  │
│                                         │
│ FOOTER  7/8 →                           │
└─────────────────────────────────────────┘
```

### Render-Function

```typescript
// packages/social/src/slides/use-case-verdict-render.ts

export async function renderUseCaseVerdictCarousel(
  input: {
    tools: ToolReference[];
    verdicts: UseCaseVerdict[];
    locale: 'de' | 'en';
    theme: 'dark' | 'light';
  },
): Promise<RenderResult> {
  // Build cover slide
  const cover = renderCoverSlide(input);
  
  // Build per-verdict slides
  const verdictSlides = input.verdicts.map((v, i) =>
    renderVerdictSlide(v, input.tools, i + 1, input.verdicts.length + 2, input.theme, input.locale)
  );
  
  // Compute tally
  const tally = computeTally(input.verdicts);
  const recap = renderRecapSlide(tally, input.tools, input.theme, input.locale);
  
  // End-slide (reuse existing EndSlide-component from comparison-stunning)
  const end = renderEndSlide({ /* ... */ });
  
  // Render all to PNGs via Remotion
  const slides = await renderSlidesToPngs([cover, ...verdictSlides, recap, end]);
  
  // Caption + hashtags (deterministic, no LLM)
  const caption = buildCaption(input);
  const hashtags = buildHashtags(input);
  
  return {
    slides,
    caption,
    hashtags,
    metadata: {
      estimatedCostUsd: 0.008,
      templateKey: 'use-case-verdict-per-tool',
    },
  };
}

function computeTally(verdicts: UseCaseVerdict[]) {
  const counts = new Map<string, number>();
  verdicts.forEach(v => counts.set(v.winner, (counts.get(v.winner) ?? 0) + 1));
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([slug, count]) => ({ slug, count }));
}

function buildCaption(input: { tools, verdicts, locale }): string {
  const toolNames = input.tools.map(t => t.name).join(' vs. ');
  if (input.locale === 'de') {
    return `${toolNames}: ${input.verdicts.length} Use-Cases, ${input.verdicts.length} ehrliche Empfehlungen. 

Welcher Use-Case interessiert dich am meisten? Schreib's in die Kommentare.

→ Vollständiger Vergleich: toolwiki.ai/${slug}`;
  }
  // EN analog
}
```

**Important — Cost:** NULL LLM-Call. Reine Datenrendering. Bei $0.008/Render kommt das Geld nur aus dem Rendering-Compute (Remotion).

**Acceptance:**
- Unit tests: eligibility für Sample-Articles (recraft-vs-ideogram should pass, chatgpt mono-tool article should fail)
- Integration test: full render für recraft-vs-ideogram in beiden Themes
- PNG-Output für beide Themes als Screenshot im PR
- Tally-Computation deterministic + correct
- Caption + Hashtags reasonable per locale

**Commit message:** `feat(templates): add use-case-verdict-per-tool template with full slide render`

---

## Sub-Section 5: Registry-Bootstrap + Integration

**Estimate:** 30min, 1 commit
**Files:**
- `packages/social/src/templates/bootstrap.ts` (new)
- `packages/api/src/server.ts` (1-line addition to call bootstrap)

```typescript
// packages/social/src/templates/bootstrap.ts
import { templateRegistry } from './registry';
import { comparisonStunningTemplate } from './definitions/comparisonStunning';
import { useCaseVerdictPerToolTemplate } from './definitions/useCaseVerdictPerTool';

let bootstrapped = false;

export function bootstrapTemplates(): void {
  if (bootstrapped) return;
  
  templateRegistry.register(comparisonStunningTemplate);
  templateRegistry.register(useCaseVerdictPerToolTemplate);
  
  // Future templates registered here in subsequent specs:
  // templateRegistry.register(singleToolSpotlightTemplate);  // Spec 54e
  // templateRegistry.register(newsSlideTemplate);            // Spec 54f
  // etc.
  
  bootstrapped = true;
  console.log(`[Templates] Bootstrapped ${templateRegistry.list().length} templates`);
}
```

```typescript
// packages/api/src/server.ts (anpassen)
import { bootstrapTemplates } from '@org/social/templates';

// in startup:
bootstrapTemplates();
```

**Acceptance:**
- Server startup logs "Bootstrapped 2 templates"
- `templateRegistry.list()` returns [comparison-stunning, use-case-verdict-per-tool]
- `templateRegistry.listEligibleFor(recraftVsIdeogramArticle)` returns BEIDE Templates

**Commit message:** `feat(templates): wire template bootstrap into api startup`

---

## Manual Verification After Merge

Render-Test mit `recraft-vs-ideogram-2026` (hat `useCaseVerdicts[]` im Frontmatter):

```bash
# Trigger via API or test-script
bun run scripts/test-template.ts --template=use-case-verdict-per-tool --article=recraft-vs-ideogram-2026 --theme=dark
bun run scripts/test-template.ts --template=use-case-verdict-per-tool --article=recraft-vs-ideogram-2026 --theme=light
```

Expected output:
- 7-8 Slides je nach useCaseVerdicts-count
- Cover ähnlich Stunning-Style (consistent branding)
- Per-Use-Case-Slide klar lesbar, Winner-Logo + Reason
- Recap mit Tally-Bars
- Beide Themes funktional

---

## Commit-Reihenfolge

```
1. §1   Core Types + Registry           1h     commit 1
2. §2   Frontmatter Adapters            1h     commit 2  
3. §3   Comparison-Stunning Registry    30min  commit 3
4. §4   use-case-verdict-per-tool       2.5h   commit 4
5. §5   Bootstrap-Wiring                30min  commit 5
```

**Total: 5.5h disziplinierte Arbeit, 5 review-bare commits.**

---

## Out of Scope (next Specs)

- ⏸️ `single-tool-spotlight` Template (Spec 54e)
- ⏸️ `news-slide` Template (Spec 54f)
- ⏸️ `concept-explainer-deck` Template (Spec 54g)
- ⏸️ Discovery-Backfill für 281 existing Articles (Spec 54b)
- ⏸️ Article-Import-Pipeline Discovery-Hook (Spec 54c)
- ⏸️ Preview-Gallery Admin-UI (Spec 54d)
- ⏸️ User-triggered Multi-Template-Generation UI (Spec 54c §3)

---

## Open Questions Resolved

- **Q1 (End-Slide):** Reused `EndSlideStunning` — same "Speichere diesen Post" CTA pattern.
- **Q2 (Locale strings):** Hardcoded DE/EN per-template. No i18n system needed.
- **Q3 (Output paths):** `/renders/<articleId>/<templateKey>/<locale>-<theme>/slide-NN.png` written by `writeSlides()` helper.

## Deviations from Spec

1. **`buildInput` is async** — the spec showed it as synchronous, but DB lookup for tool references (`buildToolLookup`) requires `await`. All `TemplateDefinition.buildInput` signatures are `async`.

2. **`UseCaseVerdictCarousel` is a first-class Remotion composition** — the spec described a standalone render function in `src/slides/use-case-verdict-render.ts`. The implementation registers `UseCaseVerdictCarousel` as a full `<Composition>` in `src/index.tsx` (1080×1080) and renders via `renderStill()` like every other composition. This is more consistent and required no special-casing.

3. **`render-server.ts` exports `renderUseCaseVerdictCarousel`** — rather than a separate file, the render function lives in `render-server.ts` alongside `renderListCarousel` / `renderListCarouselStunning`.

4. **drizzle-orm operators imported from `@marketing-auto/db`** — `packages/social` has its own drizzle-orm version; direct import caused TS type incompatibilities. Workaround: re-export all operators from `@marketing-auto/db/src/index.ts` and import from there in `toolLookup.ts`. Added tsconfig `paths` override pointing to `packages/db/node_modules/drizzle-orm/*`.

## Discovered During Implementation

- **`rootDir` in tsconfig blocks cross-workspace imports** — even with `noEmit: true`, setting `"rootDir": "."` in `packages/social/tsconfig.json` prevented TS from resolving `@marketing-auto/db`. Fix: remove `rootDir` entirely (it has no effect when noEmit=true).

- **`exactOptionalPropertyTypes` + optional SVG props** — passing `iconSvg: string | undefined` to a prop typed `iconSvg?: string` fails under `exactOptionalPropertyTypes`. Pattern: `{...(tool.iconSvg !== undefined && { iconSvg: tool.iconSvg })}`.

## Open Questions

**Q1:** End-Slide für `use-case-verdict-per-tool` — reuse existing EndSlideStunning oder eigene Variante?

Empfehlung: reuse. Recap-Slide ist schon der Tally, End-Slide kann der bekannte "Speichere diesen Post"-Pattern sein.

**Q2:** Locale-Behandlung in Cover-Hook — hardcoded DE/EN strings oder via i18n?

Empfehlung: hardcoded per-template (passt zur Voice-Konsistenz pro Pattern). i18n-System für Marketing-Tool wäre eigene Spec.

**Q3:** Render-Output-Path — neue Directory pro Template?

Empfehlung: `template_renders.output_files` JSONB hält paths. Filesystem-Layout `/renders/<articleId>/<templateKey>/<locale>-<theme>/slide-01.png`. Konsistent mit existing comparison-stunning.
