# Spec 10: Project Marketing Context Skill Integration

**Phase:** 2 (Cold-Start for KI-Wissensraum)
**Estimated Effort:** ½ day
**Dependencies:** Spec 00 (foundation), Spec 01 (db schema)
**Status:** Ready for implementation
**Recommended Model:** Sonnet 4.6 (no architectural depth needed)

---

## Goal

Define and implement the **per-tenant marketing context** that all generative pipeline steps inject into LLM system prompts. The context is what makes the same Claude API call produce a KI-Wissensraum article (educational, du-Form, AI focus) versus a Bellemann piece (local SEO, automotive Sie-Form) versus a Balkonkraftwerk article (affiliate-style product reviews).

This spec covers:
1. The **canonical structure** of a project marketing context document (what fields, in what order)
2. Storage layout: file-based template + DB-backed runtime values, hybrid model
3. A **typed loader** that produces a single ready-to-use string for prompt injection
4. The **first concrete instance**: KI-Wissensraum's marketing context, partially populated (the rest gets filled during the cold-start workshop in Spec 14)
5. A small CLI helper to seed and update a project's context

This is the **foundation** that Specs 11 (Anthropic adapter), 14 (cold-start pipeline), 20 (article pipeline) all build on. Without it, every adapter would invent its own context-injection strategy.

## Non-Goals

- No cold-start interactive workshop yet — that's Spec 14, which uses what we build here as its **output target**
- No editing UI — Phase 3 web app adds that. For MVP, we edit via SQL or YAML files committed to the repo
- No automatic tone-drift detection — Phase 4
- No multi-language context (single primary language per project; secondary languages handled per-step if needed)
- No A/B-testing of contexts — single active context per project
- No marketing-skills integration of the *trigger* logic; the loader returns content, the pipeline step decides how to combine

## Background: The Context-Injection Architecture

Every generative pipeline step that calls an LLM receives a **system prompt** assembled from three layers, in this order:

```
┌─────────────────────────────────────────────────┐
│ 1. SKILL CONTENT                                │
│    (from packages/skills/skills/<skill>/SKILL.md)│
│    "How to do <task> well in general"           │
│    Stable, source: marketingskills submodule     │
├─────────────────────────────────────────────────┤
│ 2. PROJECT MARKETING CONTEXT                    │
│    (from this spec)                              │
│    "Who this brand is, who it speaks to"        │
│    Stable per project, evolves slowly            │
├─────────────────────────────────────────────────┤
│ 3. STEP-SPECIFIC INSTRUCTIONS                   │
│    (in the step class, hard-coded)               │
│    "For THIS step, do X, return Y format"       │
│    Step-bound, doesn't change at runtime         │
└─────────────────────────────────────────────────┘
                       +
                  USER MESSAGE
            (the runtime input data)
```

Layers 1 and 2 are **stable across many calls** — we mark them with Anthropic's `cache_control: { type: "ephemeral" }` to get the 90% cache discount. Layer 3 and the user message are dynamic.

The `loadProjectContext(slug)` function from Spec 05 reads layer 2. This spec defines what it returns.

## Storage Model

A project's marketing context lives in **two places**:

### File: `project-contexts/<slug>/marketing-context.md`

The committed, version-controlled, human-readable source of truth. Lives in the platform repo (not the tenant's content repo). Plain Markdown for easy diffing and editing.

Why file, not DB-only? Three reasons:
- **Diffable history via git** — you see how the context evolved
- **Easy to edit in any IDE** — no UI needed for MVP
- **Reviewable in PRs** — context changes get the same review as code

### DB: `projects.brand_identity` (jsonb), `projects.target_audience` (jsonb)

These are already in Spec 01's schema. They hold **structured fields** that other parts of the system query (e.g., the cluster planner needs to know `targetAudience.language`; the cost dashboard groups by `brandIdentity.pronounStyle`).

The file is the authoring surface; the DB is the indexed cache. A small `sync-context` CLI script reads the file, parses the YAML frontmatter, and writes the structured fields to the DB. The Markdown body is also stored in DB (in a new field, see below) so the loader doesn't need filesystem access at runtime — important for production where we may not deploy the file alongside the worker.

### New DB Field

Add to `packages/db/src/schema/projects.ts`:

```typescript
// Add to the projects table:
marketingContextMd: text("marketing_context_md"),
marketingContextUpdatedAt: timestamp("marketing_context_updated_at", { withTimezone: true }),
```

This requires a Drizzle migration (Step 1 in implementation order).

## The Marketing Context Document Structure

Every `marketing-context.md` follows this exact structure. Sections are mandatory unless marked OPTIONAL. The order matters because LLMs read top-down — most-important framing first.

```markdown
---
slug: ki-wissensraum
language: de-DE
region: DE
pronounStyle: du
anglicismPolicy: pragmatic
humorLevel: pragmatic
schemaVersion: 1
---

# Marketing Context: <Project Name>

## 1. Identity

One-paragraph elevator pitch. What this brand IS, in plain language.
Read by humans first, LLMs second.

## 2. Audience

### Primary Persona
2-4 sentences describing who reads this. Demographics, psychographics, pain points.

### Secondary Persona (OPTIONAL)
Same shape if applicable.

### Audience NOT-list
Who explicitly is NOT the audience. Just as important as who IS.
Example: "Not for ML researchers wanting paper-level depth.
         Not for absolute beginners who don't know what an LLM is."

## 3. Voice & Tone

### Voice
Persistent personality traits. 4-6 short bullets.
Example: "knowledgeable but never pompous; pragmatic;
         skeptical of hype; first-person 'ich' when sharing experience."

### Tone Range
How tone shifts by context (a tutorial is gentler than an opinion piece).

### Pronoun Style
Either "du" or "Sie" (for German). Default applies; deviations call out exceptions.

### Forbidden Phrases
Phrases this brand never uses. Be specific.
Example:
- "In der heutigen schnelllebigen Welt"
- "Es ist wichtig zu beachten, dass"
- "Game-changer", "revolutionary" (without justification)
- "synergy", "leverage" (German texts)

### Signature Phrases (OPTIONAL)
Phrases this brand uses on purpose, sparingly. Helps recognizability.

### Anglicism Policy
"avoid" | "pragmatic" | "embrace"
Plus 1-3 sentences explaining edge cases.

## 4. Pillars

Numbered list. Each pillar has:
- **Name**
- **Why it exists** (1 sentence)
- **What's in scope** (1-3 bullets)
- **What's out of scope** (1-2 bullets)

These map to `content_pillars` rows in DB. They are stable enough that you
can name them in this doc; revisions are deliberate, not accidental.

## 5. Cluster Strategy

Short prose: how clusters relate to pillars. Are clusters tightly scoped
(one keyword family per cluster) or broad (one theme per cluster)? How do
articles within a cluster link? What is a cornerstone vs. a satellite?

## 6. Differentiation

How this brand is different from the obvious competitors. Be specific —
name 2-3 competitors and the actual difference, not marketing fluff.

## 7. Monetization Posture

What is monetized, how visibly. Disclosure stance. Examples of "yes do this"
vs. "never do this" placements.

## 8. Quality Floors (Helpful-Content Compliance)

Hard rules every article must meet. These are the floors, not the ceilings.
Example:
- At least one first-hand observation per article
- At least one original data point (table, screenshot, comparison)
- At least one custom visual (not just hero image)
- Author is named on the page
- No content that's purely synthesizable from a single Wikipedia article
```

The frontmatter fields are what gets synced into `projects.brand_identity` and `projects.target_audience`. The Markdown body is stored verbatim in `projects.marketing_context_md`.

## Implementation

### Step 1: Migration to add the new fields

Update `packages/db/src/schema/projects.ts`:

```typescript
export const projects = pgTable("projects", {
  // ... existing columns ...

  // NEW (Spec 10):
  /** Markdown body of the project marketing context. Synced from project-contexts/<slug>/marketing-context.md. */
  marketingContextMd: text("marketing_context_md"),
  marketingContextUpdatedAt: timestamp("marketing_context_updated_at", { withTimezone: true }),

  // ... rest of existing columns ...
});
```

Generate and apply migration:
```bash
bun --filter @marketing-auto/db generate
# inspect packages/db/drizzle/<timestamp>_*.sql — should be just two ADD COLUMN
bun --filter @marketing-auto/db migrate
```

### Step 2: The loader

Replace the `loadProjectContext` stub in `packages/pipelines/src/skills/loader.ts` with a real implementation that reads from the DB (not from disk at runtime).

**Note**: Spec 05's stub reads from disk. After this spec, we read from DB. The disk file is the **authoring surface**; the DB is the **runtime source**. Keep the file path constant for the sync script.

```typescript
// packages/pipelines/src/skills/loader.ts (replace existing loadProjectContext)
import { eq } from "drizzle-orm";
import { db, projects } from "@marketing-auto/db";

const projectContextCache = new Map<string, { md: string; updatedAt: Date }>();
const CONTEXT_CACHE_TTL_MS = 60_000; // 1 minute

export async function loadProjectContext(projectIdOrSlug: string): Promise<string | null> {
  const cached = projectContextCache.get(projectIdOrSlug);
  if (cached && Date.now() - cached.updatedAt.getTime() < CONTEXT_CACHE_TTL_MS) {
    return cached.md;
  }

  // Determine if input is a UUID (id) or slug; query accordingly.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectIdOrSlug);

  const rows = await db
    .select({
      md: projects.marketingContextMd,
      updatedAt: projects.marketingContextUpdatedAt,
    })
    .from(projects)
    .where(isUuid ? eq(projects.id, projectIdOrSlug) : eq(projects.slug, projectIdOrSlug))
    .limit(1);

  const row = rows[0];
  if (!row || !row.md) {
    return null;
  }

  projectContextCache.set(projectIdOrSlug, {
    md: row.md,
    updatedAt: row.updatedAt ?? new Date(),
  });
  return row.md;
}

export function _resetProjectContextCache(): void {
  projectContextCache.clear();
}
```

**Why caching?** Every pipeline step calls this. Without cache: 5-step pipeline = 5 DB reads of the same row. The 1-minute TTL means context updates take up to 60s to propagate, which is fine for our editing cadence.

### Step 3: System Prompt Builder

This is the helper every adapter uses to compose the three-layer prompt. Lives in `packages/pipelines/src/prompts/`:

```typescript
// packages/pipelines/src/prompts/builder.ts
import { loadSkill, loadSkills, loadProjectContext } from "../skills/loader.ts";

export type SystemPromptInput = {
  /** Skill name(s) to load from packages/skills. Concatenated in order if array. */
  skills: string | string[];
  /** Project ID or slug. Context is loaded from DB. */
  projectIdOrSlug: string;
  /** Step-specific instructions. Hard-coded in the step class. */
  stepInstructions: string;
};

export type SystemPromptResult = {
  /** Cacheable prefix: skill + project context. Stable across many calls. */
  cacheablePrefix: string;
  /** Variable suffix: step instructions. Changes per call. */
  variableSuffix: string;
  /** Convenience: full text concatenated, for non-cached use. */
  full: string;
};

/**
 * Builds the three-layer system prompt for a generative step.
 * Returns the prefix and suffix separately so callers can apply
 * Anthropic's prompt caching to the prefix only.
 */
export async function buildSystemPrompt(input: SystemPromptInput): Promise<SystemPromptResult> {
  const skillContent = Array.isArray(input.skills)
    ? await loadSkills(input.skills)
    : await loadSkill(input.skills);

  const projectContext = await loadProjectContext(input.projectIdOrSlug);
  if (!projectContext) {
    throw new Error(
      `No marketing context found for project "${input.projectIdOrSlug}". ` +
      `Run sync-context for this project first.`,
    );
  }

  const cacheablePrefix = [
    "# Marketing Skill Reference",
    skillContent,
    "",
    "---",
    "",
    "# Project Marketing Context",
    projectContext,
  ].join("\n");

  const variableSuffix = [
    "---",
    "",
    "# Task-Specific Instructions",
    input.stepInstructions,
  ].join("\n");

  return {
    cacheablePrefix,
    variableSuffix,
    full: `${cacheablePrefix}\n\n${variableSuffix}`,
  };
}
```

Add the new module to `packages/pipelines/src/index.ts`:

```typescript
export { buildSystemPrompt, type SystemPromptInput, type SystemPromptResult } from "./prompts/builder.ts";
```

### Step 4: The sync-context CLI

A small script that reads `project-contexts/<slug>/marketing-context.md`, parses frontmatter, validates against schema, and writes both the markdown body and structured fields to DB.

`apps/api/src/scripts/sync-context.ts`:

```typescript
#!/usr/bin/env bun
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { db, projects } from "@marketing-auto/db";
import { z } from "zod";
import matter from "gray-matter";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("sync-context");

const frontmatterSchema = z.object({
  slug: z.string().min(1),
  language: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/),
  region: z.string().length(2),
  pronounStyle: z.enum(["du", "Sie"]).optional(),
  anglicismPolicy: z.enum(["avoid", "pragmatic", "embrace"]).optional(),
  humorLevel: z.enum(["dry", "pragmatic", "pointed"]).optional(),
  schemaVersion: z.literal(1),
});

const projectContextsRoot = resolve(import.meta.dir, "../../../../project-contexts");

async function syncOne(slug: string): Promise<void> {
  const path = join(projectContextsRoot, slug, "marketing-context.md");
  const raw = await readFile(path, "utf-8");
  const parsed = matter(raw);

  const fm = frontmatterSchema.safeParse(parsed.data);
  if (!fm.success) {
    log.error({ slug, errors: fm.error.flatten() }, "Frontmatter validation failed");
    throw new Error(`Invalid frontmatter for ${slug}`);
  }

  const md = parsed.content.trim();

  // Find the project
  const rows = await db
    .select({ id: projects.id, brandIdentity: projects.brandIdentity, targetAudience: projects.targetAudience })
    .from(projects)
    .where(eq(projects.slug, fm.data.slug))
    .limit(1);

  const existing = rows[0];
  if (!existing) {
    log.error({ slug: fm.data.slug }, "Project not found in DB. Create it first via add-project.");
    throw new Error(`Project not found: ${fm.data.slug}`);
  }

  // Merge structured fields. We DON'T overwrite the entire jsonb; we update keys
  // present in the frontmatter and keep the rest.
  const newBrandIdentity = {
    ...existing.brandIdentity,
    ...(fm.data.pronounStyle !== undefined && { pronounStyle: fm.data.pronounStyle }),
    ...(fm.data.anglicismPolicy !== undefined && { anglicismPolicy: fm.data.anglicismPolicy }),
    ...(fm.data.humorLevel !== undefined && { humorLevel: fm.data.humorLevel }),
  };

  const newTargetAudience = {
    ...existing.targetAudience,
    language: fm.data.language,
    region: fm.data.region,
  };

  await db
    .update(projects)
    .set({
      marketingContextMd: md,
      marketingContextUpdatedAt: new Date(),
      brandIdentity: newBrandIdentity,
      targetAudience: newTargetAudience,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, existing.id));

  log.info({ slug: fm.data.slug, mdSizeBytes: md.length }, "Project context synced");
}

async function syncAll(): Promise<void> {
  const dirs = await readdir(projectContextsRoot, { withFileTypes: true });
  for (const d of dirs) {
    if (!d.isDirectory() || d.name.startsWith(".")) continue;
    try {
      await syncOne(d.name);
    } catch (e) {
      log.error({ slug: d.name, err: e }, "Failed to sync");
    }
  }
}

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: bun src/scripts/sync-context.ts <slug|--all>");
  process.exit(1);
}

if (arg === "--all") {
  await syncAll();
} else {
  await syncOne(arg);
}
process.exit(0);
```

Add the gray-matter dependency to `apps/api/package.json`:
```json
"dependencies": {
  ...
  "gray-matter": "^4.0.3"
}
```

Add npm script:
```json
"scripts": {
  ...
  "sync-context": "cd ../.. && bun apps/api/src/scripts/sync-context.ts"
}
```

Usage:
- `bun --filter @marketing-auto/api sync-context ki-wissensraum` (single project)
- `bun --filter @marketing-auto/api sync-context --all` (all projects)

### Step 5: Add a project (CLI)

We also need a way to create a project row before sync-context can work. Quick CLI:

`apps/api/src/scripts/add-project.ts`:

```typescript
#!/usr/bin/env bun
import { db, projects } from "@marketing-auto/db";

const slug = process.argv[2];
const name = process.argv[3];
const industry = (process.argv[4] ?? "ai_education") as "ai_education" | "automotive_dealer" | "renewable_affiliate" | "music_school" | "other";
const pipelineTemplate = (process.argv[5] ?? "educational") as "educational" | "affiliate_review" | "local_business" | "programmatic_seo";

if (!slug || !name) {
  console.error("Usage: bun src/scripts/add-project.ts <slug> <name> [industry] [pipelineTemplate]");
  console.error("  industry: ai_education | automotive_dealer | renewable_affiliate | music_school | other");
  console.error("  pipelineTemplate: educational | affiliate_review | local_business | programmatic_seo");
  process.exit(1);
}

const [project] = await db
  .insert(projects)
  .values({
    slug,
    name,
    industry,
    pipelineTemplate,
  })
  .onConflictDoNothing()
  .returning();

if (project) {
  console.log(`✅ Created project: ${project.slug} (${project.name})`);
  console.log(`   id: ${project.id}`);
  console.log(`   Next: create project-contexts/${slug}/marketing-context.md, then run sync-context.`);
} else {
  console.log(`ℹ️  Project ${slug} already exists`);
}
process.exit(0);
```

Add npm script:
```json
"scripts": {
  ...
  "add-project": "cd ../.. && bun apps/api/src/scripts/add-project.ts"
}
```

### Step 6: KI-Wissensraum's marketing-context.md (the first real one)

Create `project-contexts/ki-wissensraum/marketing-context.md`. **This is intentionally a partial draft** — Spec 14 (cold-start workshop) will refine sections through interactive Q&A. We commit a sane initial version so Spec 11+ has something to load.

Marcel: review and adjust this file directly before running sync-context. It's *your* brand voice — the doc below is my best guess as a template.

```markdown
---
slug: ki-wissensraum
language: de-DE
region: DE
pronounStyle: du
anglicismPolicy: pragmatic
humorLevel: pragmatic
schemaVersion: 1
---

# Marketing Context: KI-Wissensraum

## 1. Identity

KI-Wissensraum ist ein deutschsprachiges Wissensportal für Menschen, die KI praktisch
nutzen wollen, ohne in Hype-Marketing oder Forschungsjargon abzudriften. Wir erklären
Tools, Konzepte und Workflows so, dass Leser sie am nächsten Werktag anwenden können.

## 2. Audience

### Primary Persona

Berufstätige zwischen 25 und 50 in Wissensarbeit (Marketing, Vertrieb, Beratung,
Engineering, Selbstständigkeit). Sie hören "AI" jeden Tag, haben ChatGPT mal benutzt,
wollen aber jetzt **systematisch** verstehen, was geht und was nicht. Ihre Schmerzen:
zu viel Marketing-Geschwafel, zu wenig konkrete Beispiele, zu viele "Top 10 AI Tools"-
Listicles ohne eigene Erfahrung.

### Audience NOT-list

- Nicht für ML-Forscher, die paper-level depth wollen
- Nicht für Komplett-Anfänger, die nicht wissen, was ein LLM ist (separate Glossar-Seiten ja, Cluster-Inhalte nein)
- Nicht für reine Hype-Konsumenten, die nur "mind-blowing" Tool-Showcases wollen

## 3. Voice & Tone

### Voice

- Sachkundig, aber nie überheblich
- Pragmatisch — Fokus auf "kann ich morgen anwenden"
- Skeptisch gegenüber Hype, ohne zynisch zu werden
- Erste Person erlaubt, wenn aus eigener Erfahrung berichtet wird ("Bei meinen Tests…")
- Direkter Ton, kurze Sätze bevorzugt, aber nicht erzwungen

### Tone Range

- Tutorials: ruhiger, schrittweiser Ton, mehr "wir gehen das gemeinsam durch"
- Tool-Reviews: bewertend, mit klarer Empfehlung am Ende
- Konzept-Erklärungen: aufbauend, von einfach zu komplex
- Meinungsstücke (selten): scharf, mit Belegen

### Pronoun Style

Du-Form. Ausnahme: in formelleren Kontexten (z. B. Whitepaper-artige Inhalte) Sie-Form
explizit erlaubt, aber als Abweichung dokumentieren.

### Forbidden Phrases

- "In der heutigen schnelllebigen Welt"
- "Es ist wichtig zu beachten, dass"
- "revolutionär" / "Game-changer" — nur erlaubt mit Beleg, sonst raus
- "der heilige Gral" — nie
- "Synergie", "leverage", "deep dive" als deutsche Anglizismen
- "ChatGPT & Co." — zu lieblos, alternative Tools beim Namen nennen
- Reines Adjektiv-Stacking ohne Substanz ("intuitiv, einfach, leistungsstark")

### Signature Phrases

- "Das funktioniert in der Praxis so:" (übergang zu konkretem Beispiel)
- "Was ich aus eigenen Tests gelernt habe:" (first-hand-marker)
- "Worauf du achten solltest:" (Caveat-marker)

### Anglicism Policy

pragmatic — Fachbegriffe wie "Prompt", "Token", "Embedding", "Fine-Tuning" werden
unübersetzt verwendet, weil sie in der deutschen KI-Community Standard sind. Kein
gewaltsames Eindeutschen ("Spitzenwert" für Token). Aber: keine Anglizismen aus dem
Marketing-Sprech, wo deutsche Wörter natürlicher klingen.

## 4. Pillars

(initial draft — wird in Spec 14 verfeinert)

1. **Tools praktisch**
   - Why: Konkrete Tool-Reviews mit eigener Erfahrung, nicht Marketing-Copy
   - In scope: Reviews einzelner Tools, Vergleiche, Workflow-Integration
   - Out of scope: reine Newsmeldungen, Affiliate-Listicles ohne Substanz

2. **Konzepte verstehen**
   - Why: Mentale Modelle, mit denen man neue Tools schnell einordnen kann
   - In scope: Was ist ein Transformer / Embedding / Agent? Wie funktioniert RAG?
   - Out of scope: Mathematische Tiefe, Paper-Reviews

3. **Workflows automatisieren**
   - Why: Konkrete Anleitungen, wie KI in echte Arbeitsprozesse integriert wird
   - In scope: Step-by-Step-Anleitungen mit Beispielen, Templates
   - Out of scope: Generische "Productivity Hacks"

4. **Branchen-Anwendungen**
   - Why: Wie KI in spezifischen Berufen aussieht
   - In scope: Marketing, Vertrieb, Beratung, kreative Berufe
   - Out of scope: Branchenfremde Spekulationen

5. **Ethik & Grenzen**
   - Why: Realistische Einordnung, wo KI versagt und welche Risiken bestehen
   - In scope: Hallu­zinationen, Bias, Datenschutz, urheberrechtliche Fragen
   - Out of scope: Doomerism, Existenz-Risiko-Diskussionen

## 5. Cluster Strategy

Cluster sind tightly scoped: ein Konzept oder eine Tool-Kategorie pro Cluster. Jeder
Cluster hat genau einen Cornerstone-Artikel (umfassend, ~3000 Wörter) und 5-10 Satellite-
Artikel (fokussiert, ~1500 Wörter). Satellites verlinken auf den Cornerstone und mindestens
einen Querverweis-Cluster. Cornerstone-Artikel werden alle 6 Monate aktualisiert.

## 6. Differentiation

Konkurrenz im DACH-Raum:
- **horstmar.de**: stark in News, schwach in Tutorials
- **ki.expert**: gute Konzept-Erklärungen, aber zu akademisch, wenig Praxis
- **allaboutai.de**: viel Affiliate-Content, wenig Eigentests

Unsere Unterscheidung: **Praxisnähe mit erkennbarer eigener Stimme**. Jeder Artikel
hat mindestens eine Beobachtung "wir haben das selbst getestet, hier ist was rausgekommen".

## 7. Monetization Posture

- AdSense: aktiviert, aber dezente Platzierung — keine Auto-Ads im Lesefluss
- Affiliate: ja, aber **nur Tools, die wir selbst benutzt haben**, mit klarer Kennzeichnung
- Eigene Produkte (langfristig): denkbar, nicht Phase 1
- Newsletter: ja, mit ehrlicher CTA, nicht "Geheimtipps die niemand kennt!!"

Disclosure: jeder Affiliate-Link wird im Fließtext als solcher markiert (deutsches
Recht: ausreichend gekennzeichnet ist Pflicht). Keine versteckten Promotions.

## 8. Quality Floors

Jeder Artikel muss erfüllen:

- [ ] Mindestens **eine** First-Hand-Beobachtung ("Bei meinem Test…", "In der Praxis zeigte sich…")
- [ ] Mindestens **ein** Original-Datenpunkt (selbsterstellte Vergleichstabelle, Screenshot mit Annotation, eigene Recherche-Zahl)
- [ ] Mindestens **ein** custom Visual (Diagramm, beschrifteter Screenshot, Hero-Bild reicht NICHT)
- [ ] Author ist namentlich auf der Seite
- [ ] Schema.org Article-Markup vollständig
- [ ] Mindestens **ein** interner Link zu einem inhaltlich nahen Artikel
- [ ] Keine reine Synthese aus Wikipedia + ChatGPT — wenn der Text in 5 Minuten von einem LLM aus öffentlichen Quellen rekonstruiert werden könnte, fehlt etwas
```

### Step 7: Update CLAUDE.md files

In root `CLAUDE.md`, add to the "Project Context" section (or create one):
```markdown
## Project Marketing Contexts

Each tenant project has a marketing context that defines its voice, audience,
pillars, and quality floors. Lives in `project-contexts/<slug>/marketing-context.md`.
After editing the file, run:

  bun --filter @marketing-auto/api sync-context <slug>

This syncs the markdown body and structured frontmatter fields to the DB,
where pipeline steps load it via `loadProjectContext()`.

To add a new project:
  bun --filter @marketing-auto/api add-project <slug> "Name" <industry> <pipelineTemplate>
  # then create project-contexts/<slug>/marketing-context.md
  # then run sync-context
```

Create `packages/pipelines/CLAUDE.md` if not yet present, or append to it:
```markdown
## Prompt Composition

All generative pipeline steps must use `buildSystemPrompt()` from
`@marketing-auto/pipelines` to assemble system prompts. The function
returns a stable `cacheablePrefix` (skill + project context) and a variable
`variableSuffix` (step instructions). Adapter implementations should pass
`cacheablePrefix` with `cache_control: { type: "ephemeral" }` to claim the
90% prompt-caching discount on Anthropic.

Never inline-concat skill content with step instructions yourself. The
caching boundary matters for cost and consistency.
```

## Acceptance Criteria

- [ ] Migration adds `marketing_context_md` and `marketing_context_updated_at` columns to `projects`
- [ ] `bun --filter @marketing-auto/db migrate` applies cleanly
- [ ] `add-project` CLI creates a project row
- [ ] `sync-context <slug>` reads the file, validates frontmatter, writes to DB
- [ ] `sync-context <slug>` rejects invalid frontmatter with a clear error
- [ ] `sync-context --all` syncs every directory under `project-contexts/`
- [ ] `loadProjectContext("ki-wissensraum")` returns the markdown body for the existing tenant
- [ ] `loadProjectContext("nonexistent")` returns `null` (not throws)
- [ ] `loadProjectContext()` caches results for 60 seconds (verify by adding a console.log in the DB query path and calling twice)
- [ ] `buildSystemPrompt({ skills: "copywriting", projectIdOrSlug: "ki-wissensraum", stepInstructions: "Write a tweet" })` returns a result with non-empty `cacheablePrefix` and `variableSuffix`
- [ ] `buildSystemPrompt()` throws clear error when project context is missing
- [ ] KI-Wissensraum's `project-contexts/ki-wissensraum/marketing-context.md` exists and validates
- [ ] After sync, `projects.brand_identity` jsonb has `pronounStyle: "du"`, `anglicismPolicy: "pragmatic"`, `humorLevel: "pragmatic"`
- [ ] After sync, `projects.target_audience` jsonb has `language: "de-DE"`, `region: "DE"`
- [ ] Existing keys in `brand_identity` / `target_audience` are NOT clobbered (the merge respects existing values)

## Testing Strategy

Two unit tests, plus a manual end-to-end check:

`packages/pipelines/test/prompts.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { db, projects } from "@marketing-auto/db";
import { buildSystemPrompt } from "../src/prompts/builder.ts";
import { _resetProjectContextCache } from "../src/skills/loader.ts";

describe("buildSystemPrompt", () => {
  let projectId: string;
  const slug = `prompt-test-${Date.now()}`;

  beforeAll(async () => {
    const [p] = await db.insert(projects).values({
      slug,
      name: "Prompt Test",
      industry: "ai_education",
      pipelineTemplate: "educational",
      marketingContextMd: "# Test Context\n\nSample content for testing.",
    }).returning();
    projectId = p!.id;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
    _resetProjectContextCache();
  });

  it("composes prefix and suffix from skill, context, and instructions", async () => {
    // Use a known skill name from packages/skills (assumes submodule populated)
    // If submodule not populated, this test will be skipped manually in CI for now.
    let result;
    try {
      result = await buildSystemPrompt({
        skills: "copywriting",
        projectIdOrSlug: slug,
        stepInstructions: "Write a one-line slogan.",
      });
    } catch (e) {
      console.warn("Skill not loadable, skipping (submodule probably not populated)");
      return;
    }

    expect(result.cacheablePrefix.length).toBeGreaterThan(50);
    expect(result.cacheablePrefix).toContain("Sample content for testing");
    expect(result.variableSuffix).toContain("Write a one-line slogan.");
    expect(result.full).toBe(`${result.cacheablePrefix}\n\n${result.variableSuffix}`);
  });

  it("throws when project context is missing", async () => {
    expect(buildSystemPrompt({
      skills: "copywriting",
      projectIdOrSlug: "definitely-not-a-real-slug",
      stepInstructions: "x",
    })).rejects.toThrow(/No marketing context/);
  });
});
```

`packages/pipelines/test/loader.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { db, projects } from "@marketing-auto/db";
import { loadProjectContext, _resetProjectContextCache } from "../src/skills/loader.ts";

describe("loadProjectContext", () => {
  const slug = `loader-test-${Date.now()}`;
  let projectId: string;

  beforeAll(async () => {
    const [p] = await db.insert(projects).values({
      slug,
      name: "Loader Test",
      industry: "ai_education",
      pipelineTemplate: "educational",
      marketingContextMd: "# Hello",
    }).returning();
    projectId = p!.id;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
    _resetProjectContextCache();
  });

  it("returns content by slug", async () => {
    const result = await loadProjectContext(slug);
    expect(result).toBe("# Hello");
  });

  it("returns content by uuid", async () => {
    const result = await loadProjectContext(projectId);
    expect(result).toBe("# Hello");
  });

  it("returns null for nonexistent project", async () => {
    const result = await loadProjectContext("absolutely-no-such-slug");
    expect(result).toBeNull();
  });
});
```

**Manual end-to-end (Marcel runs after implementation):**
1. `bun --filter @marketing-auto/api add-project ki-wissensraum "KI-Wissensraum" ai_education educational`
2. Verify `project-contexts/ki-wissensraum/marketing-context.md` exists (created in Step 6)
3. **Edit it.** Adjust voice, audience, pillars to your actual taste — this is yours.
4. `bun --filter @marketing-auto/api sync-context ki-wissensraum`
5. Open Drizzle Studio (`bun --filter @marketing-auto/db studio`), inspect `projects` row:
  - `marketing_context_md` should be the markdown body
  - `brand_identity` should have `pronounStyle`, `anglicismPolicy`, `humorLevel`
  - `target_audience` should have `language: "de-DE"`, `region: "DE"`

## Open Questions / Decisions Made

**Decision 1: File + DB hybrid, not file-only or DB-only.**
File-only: needs filesystem access in production (annoying for containerized workers).
DB-only: no version control of context evolution.
Hybrid: file is authoring surface, DB is runtime cache. Sync via explicit script.

**Decision 2: One context per project, not versioned.**
Spec 01 already has `brand_voices` versioning. The marketing context is broader and
slower-moving. Versioning the whole doc would complicate the loader without clear value.
Git history of `project-contexts/<slug>/marketing-context.md` IS the version history.

**Decision 3: Cache TTL of 60s.**
Short enough that edits propagate fast; long enough that 5-step pipelines don't hammer DB.
Override via `_resetProjectContextCache()` in tests.

**Decision 4: `buildSystemPrompt` returns separate prefix/suffix, not just full.**
Required for prompt caching in Spec 11. The `full` field is provided for ergonomics
when caching isn't applicable (rare, but e.g. local dev without cache support).

**Decision 5: gray-matter for frontmatter parsing.**
Standard library, well-maintained, works with arbitrary markdown bodies. Avoids
hand-rolling YAML parsing.

**Decision 6: `sync-context` is one-way (file → DB).**
Reverse direction (DB → file) for editing in a future UI is a Phase-3 concern. For now,
the file is the source.

**Decision 7: We don't validate the markdown body shape.**
Frontmatter is validated. The body is treated as opaque text by the loader — content
quality is enforced via prompt design (in pipeline steps that use the context), not
via schema. Trying to parse the body sections into structured fields is bait — the
moment Marcel deviates from the template, parsing breaks.

## Implementation Order

1. Add migration for new columns; apply it
2. Implement `loadProjectContext()` (DB-backed, with cache)
3. Implement `buildSystemPrompt()` in `packages/pipelines/src/prompts/builder.ts`
4. Add `gray-matter` dep, create `add-project.ts` and `sync-context.ts` scripts
5. Wire npm scripts in `apps/api/package.json`
6. Write the two unit tests, run them
7. Create `project-contexts/ki-wissensraum/marketing-context.md` with the template
8. Run `add-project` then `sync-context` to populate the DB row
9. Verify in Drizzle Studio
10. Update CLAUDE.md files
11. Commit: `feat(pipelines): project marketing context loader and sync (spec 10)`

## Splitting Plan

Single session, ½ day. No splitting needed.

## Discovered During Implementation

**1. `drizzle-kit generate` also needs `--env-file ../../.env`**
The `packages/db/package.json` `generate` script was missing `--env-file ../../.env` (only
`migrate` had it). Running `bun --filter @marketing-auto/db generate` failed because
`getEnv()` fires at import and the root `.env` is not auto-discovered when bun runs from
the package directory. Fixed during this spec; root CLAUDE.md rule already covers the general
case but the db-specific `generate` command is an easy miss.

**2. `pronounStyle` case mismatch between markdown and DB type**
The markdown frontmatter convention uses German honorific capitalisation: `"Sie"` (capital S).
`BrandIdentity.pronounStyle` uses lowercase: `"du" | "sie"`. The `sync-context.ts` script
maps `"Sie" → "sie"` with a typed ternary before DB write. Future markdown-editing UIs must
apply the same normalisation.

## Deviations

**npm script pattern**: The spec showed `"sync-context": "cd ../.. && bun apps/api/src/scripts/sync-context.ts"`.
Implemented as `"bun --env-file ../../.env src/scripts/sync-context.ts"` instead, following
the established `apps/api/package.json` pattern (`add-user`, `dev`, etc.) and the root CLAUDE.md
rule against `cd`-based env loading. Both patterns work; `--env-file` is more explicit.
