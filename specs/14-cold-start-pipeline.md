# Spec 14: Cold-Start (Tenant Onboarding)

**Phase:** 2 (Cold-Start for KI-Wissensraum)
**Estimated Effort:** 2-3 days
**Dependencies:** Spec 05 (pipeline engine), Spec 10 (project marketing context), Spec 11 (anthropic), Spec 12 (replicate), Spec 13 (dataforseo)
**Status:** Ready for implementation
**Recommended Model:** Opus 4.7 (architectural integration spec — gets the most leverage from careful design)

---

## Goal

Build the **Tenant Cold-Start workflow**: a series of CLI commands that take a freshly-created project from "exists in DB with rough marketing-context.md" to "ready to publish" by interactively building Voice, Audience, Pillars, Cluster Plan, and a Cornerstone Article List.

Each command:
1. Reads existing state from `project-contexts/<slug>/` (markdown files Marcel can edit between runs)
2. Calls Phase-2 adapters (Anthropic for synthesis, DataForSEO for SERP/keyword data)
3. Writes structured Markdown back to `project-contexts/<slug>/cold-start/`
4. Marcel reviews, edits in his editor, commits to git
5. Next command in the sequence reads Marcel's edits as ground truth

This is **the first orchestration spec** that combines all Phase-2 adapters. After this spec, KI-Wissensraum has everything needed to start the Article Pipeline (Phase 3).

## What this is NOT

- Not BullMQ-orchestrated — synchronous CLI execution, ~30-90 seconds per command
- Not a Web-App workflow — Markdown files are the UI for now (Phase 3+ adds Web UI on top)
- Not for batch tenant onboarding — runs once per project
- Not auto-committing — Marcel commits manually, controls the pace
- Not regenerating finished output — re-running a command warns if output exists, requires `--force`

## The Five Phases

```
1. voice-refinement    →  cold-start/01-voice-refinement.md
2. competitor-analysis →  cold-start/02-competitor-analysis.md
3. cluster-plan        →  cold-start/03-cluster-plan.md
4. cornerstone-list    →  cold-start/04-cornerstone-list.md
5. go-live-checklist   →  cold-start/05-go-live-checklist.md
```

Each phase has:
- One CLI command: `bun --filter @marketing-auto/api cold-start:<phase> <slug>`
- One output Markdown file with a strict structure (so the next phase can parse it)
- Reads from previous phases' files (after Marcel's edits) plus `marketing-context.md`
- Writes a `pipeline_runs` row for audit (uses `runPipeline()` from Spec 05)

After all five phases run successfully, the project is **ready for Article Pipeline**. Spec 14 doesn't build the Article Pipeline — that's a separate Phase 3 spec.

## Architecture

### Command structure

Each phase is implemented as a `Pipeline` class (from Spec 05) with one or more `BaseStep`s. The CLI script:
1. Loads the project from DB
2. Reads existing cold-start markdown files (if any)
3. Constructs the pipeline input from project context + previous phases' markdown
4. Runs `runPipeline()` synchronously
5. Writes the resulting markdown to disk
6. Prints a brief summary to stdout

So we get the benefits of Spec 05's Pipeline framework (cost tracking, audit, error handling) without BullMQ scheduling overhead.

### File coordination protocol

**Critical principle**: Each phase writes a structured markdown file with **explicit machine-readable sections** (delimited by HTML comments like `<!-- DATA:cluster-list -->`) that the next phase parses, plus **freeform prose sections** that are for human review only.

This way:
- Marcel can edit the prose freely
- Marcel can add/remove items in the data sections
- Next phase reads the data sections as JSON-like structured input
- If Marcel breaks the structured section format, the next command warns clearly

Example: in `03-cluster-plan.md`:

```markdown
# Cluster Plan: KI-Wissensraum

## Overview
<freeform prose Marcel may edit>

<!-- DATA:clusters BEGIN -->
- name: "Claude für Marketing"
  pillar: "Tools praktisch"
  status: approved
  cornerstone_keyword: "claude marketing"
  satellite_keywords:
    - "claude prompts marketing"
    - "claude vs chatgpt marketing"
- name: "Lokale LLM Setup"
  pillar: "Workflows automatisieren"
  status: approved
  cornerstone_keyword: "lokale llm"
  satellite_keywords:
    - "ollama setup"
    - "lm studio installation"
<!-- DATA:clusters END -->

## Notes from Marcel
<freeform>
```

The next command (`cornerstone-list`) reads the YAML-like structured block, ignores the freeform prose. We use YAML-inside-markdown because it's natural to edit, parser-friendly, and survives manual edits.

### Implementation Order Across Phases

Each phase's command is self-contained but depends on previous phases' output files. Marcel's expected workflow:

```
Day 1: voice-refinement   →   review + edit MD  →  commit
Day 2: competitor-analysis →   review + edit MD  →  commit
Day 3: cluster-plan        →   review + edit MD  →  commit
Day 4: cornerstone-list    →   review + edit MD  →  commit
Day 5: go-live-checklist   →   review + ✓ off    →  commit
```

Each day is ~30-90 minutes of compute + ~30-60 minutes of Marcel's review.

## Detailed Implementation

### Package Structure

We add cold-start logic to `packages/pipelines/src/cold-start/` (a new sub-folder under the pipelines package). CLI scripts go in `apps/api/src/scripts/cold-start/`.

```
packages/pipelines/src/cold-start/
├── index.ts                            # exports the 5 pipeline classes
├── shared/
│   ├── markdown-io.ts                  # read/write structured markdown files
│   ├── data-block-parser.ts            # parse <!-- DATA:name --> YAML blocks
│   └── paths.ts                        # path helpers for cold-start/<slug>/
├── 01-voice-refinement/
│   ├── pipeline.ts                     # VoiceRefinementPipeline (extends Pipeline)
│   └── steps.ts                        # GenerateQuestionsStep, etc.
├── 02-competitor-analysis/
│   ├── pipeline.ts
│   └── steps.ts
├── 03-cluster-plan/
│   ├── pipeline.ts
│   └── steps.ts
├── 04-cornerstone-list/
│   ├── pipeline.ts
│   └── steps.ts
└── 05-go-live-checklist/
    ├── pipeline.ts
    └── steps.ts

apps/api/src/scripts/cold-start/
├── 01-voice-refinement.ts              # CLI entry point per phase
├── 02-competitor-analysis.ts
├── 03-cluster-plan.ts
├── 04-cornerstone-list.ts
└── 05-go-live-checklist.ts
```

### Shared Markdown I/O

`packages/pipelines/src/cold-start/shared/paths.ts`:

```typescript
import { resolve, join } from "node:path";

const PROJECT_CONTEXTS_ROOT = resolve(import.meta.dir, "../../../../../project-contexts");

export function projectContextDir(slug: string): string {
  return join(PROJECT_CONTEXTS_ROOT, slug);
}

export function coldStartDir(slug: string): string {
  return join(projectContextDir(slug), "cold-start");
}

export function coldStartFile(slug: string, filename: string): string {
  return join(coldStartDir(slug), filename);
}

export const COLD_START_FILES = {
  voiceRefinement:    "01-voice-refinement.md",
  competitorAnalysis: "02-competitor-analysis.md",
  clusterPlan:        "03-cluster-plan.md",
  cornerstoneList:    "04-cornerstone-list.md",
  goLiveChecklist:    "05-go-live-checklist.md",
} as const;
```

`packages/pipelines/src/cold-start/shared/markdown-io.ts`:

```typescript
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { dirname } from "node:path";

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readMarkdownIfExists(path: string): Promise<string | null> {
  if (!(await fileExists(path))) return null;
  return readFile(path, "utf-8");
}

export async function writeMarkdownAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // Write to .tmp, then rename — guarantees no partial writes if interrupted
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, content, "utf-8");
  await Bun.file(tmpPath).text();  // ensure flush
  await Bun.write(path, content);
  // Cleanup tmp (best-effort)
  try { await Bun.file(tmpPath).unlink?.(); } catch {}
}
```

`packages/pipelines/src/cold-start/shared/data-block-parser.ts`:

```typescript
import yaml from "yaml";

const BLOCK_BEGIN = /<!--\s*DATA:([\w-]+)\s+BEGIN\s*-->/;
const BLOCK_END = /<!--\s*DATA:([\w-]+)\s+END\s*-->/;

export class DataBlockParseError extends Error {
  constructor(message: string, public readonly blockName?: string) {
    super(message);
    this.name = "DataBlockParseError";
  }
}

/**
 * Extracts a named DATA block from markdown content and parses its YAML body.
 * Throws DataBlockParseError if the block is missing or malformed.
 *
 * @example
 * const clusters = parseDataBlock(md, "clusters", clustersSchema);
 */
export function parseDataBlock<T>(
  markdown: string,
  blockName: string,
  schema: { parse: (input: unknown) => T },
): T {
  const lines = markdown.split("\n");
  let inBlock = false;
  let foundName: string | null = null;
  const yamlLines: string[] = [];

  for (const line of lines) {
    if (!inBlock) {
      const m = line.match(BLOCK_BEGIN);
      if (m && m[1] === blockName) {
        inBlock = true;
        foundName = m[1];
      }
    } else {
      const m = line.match(BLOCK_END);
      if (m) {
        if (m[1] !== blockName) {
          throw new DataBlockParseError(
            `DATA block "${blockName}" not closed properly. Found END for "${m[1]}" instead.`,
            blockName,
          );
        }
        // Done collecting
        const yamlText = yamlLines.join("\n").trim();
        let parsed: unknown;
        try {
          parsed = yaml.parse(yamlText);
        } catch (e) {
          throw new DataBlockParseError(
            `DATA block "${blockName}" YAML parse failed: ${e instanceof Error ? e.message : String(e)}`,
            blockName,
          );
        }
        return schema.parse(parsed);
      }
      yamlLines.push(line);
    }
  }

  if (foundName) {
    throw new DataBlockParseError(`DATA block "${blockName}" missing END marker.`, blockName);
  }
  throw new DataBlockParseError(`DATA block "${blockName}" not found in markdown.`, blockName);
}

/**
 * Renders a DATA block in markdown format.
 */
export function renderDataBlock(name: string, data: unknown): string {
  const yamlText = yaml.stringify(data).trimEnd();
  return [
    `<!-- DATA:${name} BEGIN -->`,
    yamlText,
    `<!-- DATA:${name} END -->`,
  ].join("\n");
}
```

Add `yaml: ^2.6.0` to `packages/pipelines/package.json`.

### Phase 1: Voice Refinement

**Goal**: take the partially-filled `marketing-context.md` and produce 10-15 questions that, once answered, fully define the brand voice. Marcel answers in the markdown file. Re-running this phase synthesizes the answers back into an updated `marketing-context.md` (writes a backup first).

`packages/pipelines/src/cold-start/01-voice-refinement/steps.ts`:

```typescript
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { anthropic } from "@marketing-auto/adapter-anthropic";
import { buildSystemPrompt } from "../../prompts/builder.ts";

const VoiceQuestionsOutputSchema = z.object({
  questions: z.array(z.object({
    id: z.string(),
    category: z.enum(["voice", "audience", "pillar", "tone", "differentiation", "monetization"]),
    question: z.string(),
    why_it_matters: z.string(),
    suggested_starter: z.string(),
  })).min(8).max(15),
});

type VoiceQuestionsOutput = z.infer<typeof VoiceQuestionsOutputSchema>;

export class GenerateVoiceQuestionsStep extends BaseStep<
  { projectSlug: string; existingContextMd: string },
  VoiceQuestionsOutput
> {
  readonly name = "generate-voice-questions";
  readonly inputSchema = z.object({
    projectSlug: z.string(),
    existingContextMd: z.string(),
  });
  readonly outputSchema = VoiceQuestionsOutputSchema;

  override estimatedCostEur(): number {
    return 0.10; // ~one Sonnet call with cached prefix
  }

  async execute(input: { projectSlug: string; existingContextMd: string }, ctx: StepContext) {
    const prompt = await buildSystemPrompt({
      skills: ["copywriting", "brand-positioning"],
      projectIdOrSlug: input.projectSlug,
      stepInstructions: `
You are helping Marcel refine the brand voice for a content site during cold-start onboarding.

You have access to the existing marketing-context.md (rough draft, partially filled).
Your job: produce 8-15 sharp, specific questions whose answers will let us fully populate the
final marketing-context.md.

Rules:
- Don't ask questions where the existing context already gives a clear answer
- Focus on what's vague, contradictory, or missing
- Each question should be SPECIFIC. Bad: "What's your tone?" Good: "When a reader makes a
  technical mistake in a comment, do you correct them gently, ignore, or call it out
  publicly to make a point?"
- Group questions by category (voice / audience / pillar / tone / differentiation / monetization)
- Each question must have a "why_it_matters" (1 sentence) and a "suggested_starter"
  (a possible answer phrase Marcel can build on or reject)
- Output strict JSON matching: { questions: [{ id, category, question, why_it_matters, suggested_starter }] }
`,
    });

    const result = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: "voice-questions-generation",
      model: "claude-sonnet-4-6",
      systemPrefix: prompt.cacheablePrefix,
      systemSuffix: prompt.variableSuffix,
      userMessage: `Here is the current marketing-context.md:\n\n${input.existingContextMd}\n\nProduce the questions.`,
      maxTokens: 4000,
      jsonMode: true,
      estimatedCostEur: this.estimatedCostEur(),
    });

    return VoiceQuestionsOutputSchema.parse(result.json);
  }
}

const VoiceSynthesisOutputSchema = z.object({
  updatedMarketingContextMd: z.string().min(500),
  changesSummary: z.array(z.string()).min(1),
});

type VoiceSynthesisOutput = z.infer<typeof VoiceSynthesisOutputSchema>;

/**
 * Re-synthesizes marketing-context.md from Marcel's answered questions.
 * Run after Marcel fills in answers in 01-voice-refinement.md.
 */
export class SynthesizeVoiceContextStep extends BaseStep<
  { projectSlug: string; existingContextMd: string; answeredQuestionsMd: string },
  VoiceSynthesisOutput
> {
  readonly name = "synthesize-voice-context";
  readonly inputSchema = z.object({
    projectSlug: z.string(),
    existingContextMd: z.string(),
    answeredQuestionsMd: z.string(),
  });
  readonly outputSchema = VoiceSynthesisOutputSchema;

  override estimatedCostEur(): number {
    return 0.30; // larger output, may need Opus for nuance
  }

  async execute(
    input: { projectSlug: string; existingContextMd: string; answeredQuestionsMd: string },
    ctx: StepContext,
  ) {
    const prompt = await buildSystemPrompt({
      skills: ["copywriting", "brand-positioning"],
      projectIdOrSlug: input.projectSlug,
      stepInstructions: `
Given the original marketing-context.md and Marcel's answers to refinement questions,
produce an UPDATED marketing-context.md that:

1. Preserves the document structure (frontmatter + 8 numbered sections per Spec 10's template)
2. Incorporates Marcel's answers into the relevant sections
3. Tightens prose where Marcel was specific
4. Removes content the answers contradict
5. Keeps Marcel's exact wording where he was emphatic ("never use this phrase" stays verbatim)

Output strict JSON: { updatedMarketingContextMd, changesSummary }
- updatedMarketingContextMd: full file content including frontmatter
- changesSummary: 3-7 bullet points describing what changed
`,
    });

    const result = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: "voice-synthesis",
      model: "claude-opus-4-7",  // brand voice is high-leverage; spend the tokens
      systemPrefix: prompt.cacheablePrefix,
      systemSuffix: prompt.variableSuffix,
      userMessage: `# Original marketing-context.md\n${input.existingContextMd}\n\n---\n\n# Marcel's answers\n${input.answeredQuestionsMd}\n\nNow produce the updated marketing-context.md.`,
      maxTokens: 8000,
      jsonMode: true,
      estimatedCostEur: this.estimatedCostEur(),
    });

    return VoiceSynthesisOutputSchema.parse(result.json);
  }
}
```

`packages/pipelines/src/cold-start/01-voice-refinement/pipeline.ts`:

```typescript
import { z } from "zod";
import { Pipeline } from "../../engine/pipeline.ts";
import { GenerateVoiceQuestionsStep } from "./steps.ts";

const InputSchema = z.object({
  projectSlug: z.string(),
  existingContextMd: z.string(),
});

const OutputSchema = z.object({
  questions: z.array(z.object({
    id: z.string(),
    category: z.string(),
    question: z.string(),
    why_it_matters: z.string(),
    suggested_starter: z.string(),
  })),
});

export class VoiceRefinementQuestionsPipeline extends Pipeline<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "cold-start:voice-refinement-questions";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;
  readonly steps = [new GenerateVoiceQuestionsStep()] as const;
}

// Synthesis pipeline (run after Marcel answers)
const SynthInputSchema = z.object({
  projectSlug: z.string(),
  existingContextMd: z.string(),
  answeredQuestionsMd: z.string(),
});

const SynthOutputSchema = z.object({
  updatedMarketingContextMd: z.string(),
  changesSummary: z.array(z.string()),
});

import { SynthesizeVoiceContextStep } from "./steps.ts";

export class VoiceSynthesisPipeline extends Pipeline<
  z.infer<typeof SynthInputSchema>,
  z.infer<typeof SynthOutputSchema>
> {
  readonly name = "cold-start:voice-synthesis";
  readonly inputSchema = SynthInputSchema;
  readonly outputSchema = SynthOutputSchema;
  readonly steps = [new SynthesizeVoiceContextStep()] as const;
}
```

`apps/api/src/scripts/cold-start/01-voice-refinement.ts`:

```typescript
#!/usr/bin/env bun
import { eq } from "drizzle-orm";
import { db, projects } from "@marketing-auto/db";
import { runPipeline } from "@marketing-auto/pipelines";
import {
  VoiceRefinementQuestionsPipeline,
  VoiceSynthesisPipeline,
} from "@marketing-auto/pipelines/cold-start";
import {
  coldStartFile,
  COLD_START_FILES,
  readMarkdownIfExists,
  writeMarkdownAtomic,
} from "@marketing-auto/pipelines/cold-start/shared";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("cold-start:voice");

const slug = process.argv[2];
const mode = process.argv[3] ?? "questions"; // "questions" | "synthesize"
const force = process.argv.includes("--force");

if (!slug) {
  console.error("Usage: bun src/scripts/cold-start/01-voice-refinement.ts <slug> [questions|synthesize] [--force]");
  process.exit(1);
}

// Load project from DB
const [project] = await db
  .select()
  .from(projects)
  .where(eq(projects.slug, slug))
  .limit(1);

if (!project) {
  console.error(`❌ Project not found: ${slug}. Create it via 'add-project' first.`);
  process.exit(1);
}
if (!project.marketingContextMd) {
  console.error(`❌ Project ${slug} has no marketingContextMd. Run sync-context first.`);
  process.exit(1);
}

if (mode === "questions") {
  const outputPath = coldStartFile(slug, COLD_START_FILES.voiceRefinement);
  const existing = await readMarkdownIfExists(outputPath);
  if (existing && !force) {
    console.error(
      `❌ ${outputPath} already exists. Use --force to overwrite (your answers will be lost).`,
    );
    process.exit(1);
  }

  console.log(`🚀 Generating voice refinement questions for ${slug}...`);
  const result = await runPipeline(
    new VoiceRefinementQuestionsPipeline(),
    { projectSlug: slug, existingContextMd: project.marketingContextMd },
    { projectId: project.id },
  );

  if (!result.ok) {
    console.error(`❌ Pipeline failed: ${result.error}`);
    process.exit(1);
  }

  // Render the markdown file
  const md = renderQuestionsMarkdown(slug, result.output.questions);
  await writeMarkdownAtomic(outputPath, md);

  console.log(`✅ Written ${result.output.questions.length} questions to:\n   ${outputPath}\n`);
  console.log(`Next:`);
  console.log(`  1. Edit the file — answer each question under its heading`);
  console.log(`  2. Run synthesis: bun --filter @marketing-auto/api cold-start:voice-refinement ${slug} synthesize`);
  console.log(`  3. Review the updated marketing-context.md, then run sync-context`);
  process.exit(0);
}

if (mode === "synthesize") {
  const questionsPath = coldStartFile(slug, COLD_START_FILES.voiceRefinement);
  const answered = await readMarkdownIfExists(questionsPath);
  if (!answered) {
    console.error(`❌ ${questionsPath} not found. Run questions phase first.`);
    process.exit(1);
  }

  console.log(`🚀 Synthesizing updated marketing-context.md for ${slug}...`);
  const result = await runPipeline(
    new VoiceSynthesisPipeline(),
    {
      projectSlug: slug,
      existingContextMd: project.marketingContextMd,
      answeredQuestionsMd: answered,
    },
    { projectId: project.id },
  );

  if (!result.ok) {
    console.error(`❌ Pipeline failed: ${result.error}`);
    process.exit(1);
  }

  // Backup the existing marketing-context.md
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const contextPath = path.join(
    path.dirname(questionsPath), "..", "marketing-context.md",
  );
  const backupPath = `${contextPath}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await fs.copyFile(contextPath, backupPath);

  // Write the updated marketing-context.md
  await writeMarkdownAtomic(contextPath, result.output.updatedMarketingContextMd);

  console.log(`✅ Updated marketing-context.md`);
  console.log(`   Backup at: ${backupPath}`);
  console.log(`\nChanges:`);
  for (const change of result.output.changesSummary) {
    console.log(`   - ${change}`);
  }
  console.log(`\nNext:`);
  console.log(`  1. Review the updated marketing-context.md`);
  console.log(`  2. Run: bun --filter @marketing-auto/api sync-context ${slug}`);
  console.log(`  3. Then start phase 2: cold-start:competitor-analysis`);
  process.exit(0);
}

console.error(`Unknown mode: ${mode}`);
process.exit(1);

// ─────────────────────────────────────

function renderQuestionsMarkdown(slug: string, questions: Array<{
  id: string; category: string; question: string;
  why_it_matters: string; suggested_starter: string;
}>): string {
  const grouped = new Map<string, typeof questions>();
  for (const q of questions) {
    const arr = grouped.get(q.category) ?? [];
    arr.push(q);
    grouped.set(q.category, arr);
  }

  const sections: string[] = [
    `# Voice Refinement: ${slug}`,
    "",
    "Answer each question under its heading. The synthesis phase will integrate your answers",
    "into the updated marketing-context.md.",
    "",
    "**Tips:**",
    "- Be specific. Vague answers produce vague brand voice.",
    "- Disagree with the suggested starter freely — it's just a prompt, not a constraint.",
    "- If a question is irrelevant, write 'skip' below it.",
    "- You can add your own questions in a `## Additional` section at the bottom.",
    "",
    "---",
    "",
  ];

  for (const [category, qs] of grouped) {
    sections.push(`## ${category.charAt(0).toUpperCase() + category.slice(1)}`);
    sections.push("");
    for (const q of qs) {
      sections.push(`### ${q.id}: ${q.question}`);
      sections.push("");
      sections.push(`*Why it matters: ${q.why_it_matters}*`);
      sections.push("");
      sections.push(`*Suggested starter: ${q.suggested_starter}*`);
      sections.push("");
      sections.push(`**Your answer:**`);
      sections.push("");
      sections.push("");
    }
  }

  sections.push("## Additional");
  sections.push("");
  sections.push("(add your own observations, edge cases, or questions here)");
  sections.push("");

  return sections.join("\n");
}
```

Add to `apps/api/package.json`:
```json
"scripts": {
  ...
  "cold-start:voice-refinement": "bun --env-file ../../.env src/scripts/cold-start/01-voice-refinement.ts"
}
```

### Phase 2: Competitor Analysis

**Goal**: identify the top 3-5 competitors in the project's space, run `rankedKeywords` on each, surface the topics they own, and identify content gaps.

`packages/pipelines/src/cold-start/02-competitor-analysis/steps.ts`:

```typescript
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { anthropic } from "@marketing-auto/adapter-anthropic";
import { dataforseo, type RankedKeywordItem } from "@marketing-auto/adapter-dataforseo";
import { buildSystemPrompt } from "../../prompts/builder.ts";

// Step 1: Identify competitors via Anthropic + project context

const CompetitorListSchema = z.object({
  competitors: z.array(z.object({
    domain: z.string(),
    why_relevant: z.string(),
    expected_strengths: z.array(z.string()),
  })).min(3).max(5),
});

export class IdentifyCompetitorsStep extends BaseStep<
  { projectSlug: string },
  z.infer<typeof CompetitorListSchema>
> {
  readonly name = "identify-competitors";
  readonly inputSchema = z.object({ projectSlug: z.string() });
  readonly outputSchema = CompetitorListSchema;

  override estimatedCostEur(): number { return 0.05; }

  async execute(input: { projectSlug: string }, ctx: StepContext) {
    const prompt = await buildSystemPrompt({
      skills: ["competitor-analysis", "ai-seo"],
      projectIdOrSlug: input.projectSlug,
      stepInstructions: `
Identify 3-5 competitors of the project, based on the marketing-context.md.

Selection criteria:
- Same audience (German-speaking, similar persona)
- Same content category (educational, affiliate, local, etc.)
- Active and ranking on Google.de (skip dormant sites)
- Mix of direct competitors AND aspirational competitors (1-2 of each)

For each competitor:
- domain: bare domain (e.g., "horstmar.de", no protocol or path)
- why_relevant: 1 sentence why they matter
- expected_strengths: 2-4 areas where they likely outrank or out-cover us

Output strict JSON: { competitors: [...] }`,
    });

    const result = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: "competitor-identification",
      model: "claude-sonnet-4-6",
      systemPrefix: prompt.cacheablePrefix,
      systemSuffix: prompt.variableSuffix,
      userMessage: "Identify the competitors per the rules above.",
      maxTokens: 2000,
      jsonMode: true,
      estimatedCostEur: this.estimatedCostEur(),
    });

    return CompetitorListSchema.parse(result.json);
  }
}

// Step 2: Fetch ranked keywords for each competitor (DataForSEO)

const CompetitorKeywordsSchema = z.object({
  competitorData: z.array(z.object({
    domain: z.string(),
    totalRankedKeywords: z.number(),
    topKeywords: z.array(z.object({
      keyword: z.string(),
      position: z.number(),
      url: z.string(),
      searchVolume: z.number().nullable(),
      etv: z.number().nullable(),
    })),
  })),
});

export class FetchCompetitorKeywordsStep extends BaseStep<
  { competitors: Array<{ domain: string }> },
  z.infer<typeof CompetitorKeywordsSchema>
> {
  readonly name = "fetch-competitor-keywords";
  readonly inputSchema = z.object({
    competitors: z.array(z.object({ domain: z.string() })).min(1).max(5),
  });
  readonly outputSchema = CompetitorKeywordsSchema;

  override estimatedCostEur(input: { competitors: Array<{ domain: string }> }): number {
    return input.competitors.length * 0.012;
  }

  async execute(
    input: { competitors: Array<{ domain: string }> },
    ctx: StepContext,
  ) {
    const competitorData = await Promise.all(
      input.competitors.map(async (c) => {
        const result = await dataforseo.rankedKeywords({
          projectId: ctx.projectId,
          pipelineRunId: ctx.pipelineRunId,
          operation: `ranked-keywords-${c.domain}`,
          domain: c.domain,
          limit: 100,
          maxPosition: 30,  // top 30 only — long tail is noise
          estimatedCostEur: 0.012,
        });

        return {
          domain: c.domain,
          totalRankedKeywords: result.totalCount,
          topKeywords: result.items.slice(0, 50).map((k: RankedKeywordItem) => ({
            keyword: k.keyword,
            position: k.position,
            url: k.url,
            searchVolume: k.searchVolume,
            etv: k.estimatedTrafficVolume,
          })),
        };
      }),
    );

    return { competitorData };
  }
}

// Step 3: Synthesize a markdown report from the data

const CompetitorReportSchema = z.object({
  reportMd: z.string().min(500),
  contentGaps: z.array(z.string()).min(3),
  topicsToAvoid: z.array(z.string()),
});

export class SynthesizeCompetitorReportStep extends BaseStep<
  {
    projectSlug: string;
    competitors: Array<{ domain: string; why_relevant: string; expected_strengths: string[] }>;
    competitorData: z.infer<typeof CompetitorKeywordsSchema>["competitorData"];
  },
  z.infer<typeof CompetitorReportSchema>
> {
  readonly name = "synthesize-competitor-report";
  readonly inputSchema = z.object({
    projectSlug: z.string(),
    competitors: z.array(z.object({
      domain: z.string(),
      why_relevant: z.string(),
      expected_strengths: z.array(z.string()),
    })),
    competitorData: CompetitorKeywordsSchema.shape.competitorData,
  });
  readonly outputSchema = CompetitorReportSchema;

  override estimatedCostEur(): number { return 0.20; }

  async execute(input: {
    projectSlug: string;
    competitors: Array<{ domain: string; why_relevant: string; expected_strengths: string[] }>;
    competitorData: z.infer<typeof CompetitorKeywordsSchema>["competitorData"];
  }, ctx: StepContext) {
    const prompt = await buildSystemPrompt({
      skills: ["competitor-analysis", "content-strategy", "ai-seo"],
      projectIdOrSlug: input.projectSlug,
      stepInstructions: `
Produce a competitor analysis report in markdown. Structure:

# Competitor Analysis: <project>

## Overview
<2-3 paragraph synthesis of who the competitors are and where the project sits among them>

## Per-Competitor Breakdown
<for each competitor: 1-2 paragraphs on their strengths, weaknesses, and signature topics>

## Content Gaps (Opportunity Zones)
<5-10 bullet points: topics where competitors rank but content is shallow,
 outdated, or absent — these are our wedge>

## Topics to Avoid (For Now)
<3-5 bullet points: topics so dominated by competitors that fighting for them
 is expensive in the cold-start phase>

## Recommended First Cluster Themes
<3-5 cluster name suggestions, prioritized by gap-vs-competition opportunity>

Output strict JSON: { reportMd, contentGaps, topicsToAvoid }
- reportMd: full markdown content
- contentGaps: extracted bullet list (verbatim from "Content Gaps" section, max 10)
- topicsToAvoid: extracted bullet list (verbatim from "Topics to Avoid", max 5)
`,
    });

    const userMsg = [
      "# Competitors and their ranking data",
      "",
      input.competitors.map((c, i) => {
        const data = input.competitorData.find((d) => d.domain === c.domain);
        return [
          `## ${c.domain}`,
          `- Why relevant: ${c.why_relevant}`,
          `- Expected strengths: ${c.expected_strengths.join(", ")}`,
          `- Total ranked keywords (top 30): ${data?.totalRankedKeywords ?? "?"}`,
          `- Sample top keywords:`,
          ...(data?.topKeywords.slice(0, 30).map((k) =>
            `  - "${k.keyword}" (pos ${k.position}, vol ${k.searchVolume ?? "?"}, ETV ${k.etv ?? "?"})`,
          ) ?? []),
        ].join("\n");
      }).join("\n\n"),
    ].join("\n");

    const result = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: "competitor-report-synthesis",
      model: "claude-sonnet-4-6",
      systemPrefix: prompt.cacheablePrefix,
      systemSuffix: prompt.variableSuffix,
      userMessage: userMsg,
      maxTokens: 6000,
      jsonMode: true,
      estimatedCostEur: this.estimatedCostEur(),
    });

    return CompetitorReportSchema.parse(result.json);
  }
}
```

`packages/pipelines/src/cold-start/02-competitor-analysis/pipeline.ts`:

```typescript
import { z } from "zod";
import { Pipeline } from "../../engine/pipeline.ts";
import {
  IdentifyCompetitorsStep,
  FetchCompetitorKeywordsStep,
  SynthesizeCompetitorReportStep,
} from "./steps.ts";

const InputSchema = z.object({ projectSlug: z.string() });

const OutputSchema = z.object({
  reportMd: z.string(),
  contentGaps: z.array(z.string()),
  topicsToAvoid: z.array(z.string()),
});

export class CompetitorAnalysisPipeline extends Pipeline<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "cold-start:competitor-analysis";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;
  readonly steps = [
    new IdentifyCompetitorsStep(),
    new FetchCompetitorKeywordsStep(),
    new SynthesizeCompetitorReportStep(),
  ] as const;

  /**
   * Bridge from IdentifyCompetitors → FetchCompetitorKeywords:
   * pass through the competitors list.
   * Bridge from FetchCompetitorKeywords → SynthesizeCompetitorReport:
   * combine the keyword data with the original competitor list.
   */
  override bridge(
    fromStep: { name: string },
    toStep: { name: string },
    output: unknown,
    pipelineInput: z.infer<typeof InputSchema>,
    getStepOutput: <T = unknown>(name: string) => T | undefined,
  ): unknown {
    if (fromStep.name === "identify-competitors" && toStep.name === "fetch-competitor-keywords") {
      const out = output as { competitors: Array<{ domain: string }> };
      return { competitors: out.competitors };
    }
    if (fromStep.name === "fetch-competitor-keywords" && toStep.name === "synthesize-competitor-report") {
      const idOutput = getStepOutput<{ competitors: Array<{ domain: string; why_relevant: string; expected_strengths: string[] }> }>(
        "identify-competitors",
      )!;
      const fkOutput = output as { competitorData: Array<unknown> };
      return {
        projectSlug: pipelineInput.projectSlug,
        competitors: idOutput.competitors,
        competitorData: fkOutput.competitorData,
      };
    }
    return output;
  }
}
```

CLI script `apps/api/src/scripts/cold-start/02-competitor-analysis.ts`: same structure as Phase 1 — load project, run pipeline, write markdown to `cold-start/02-competitor-analysis.md`. The body of the markdown is `result.output.reportMd`. Plus a structured DATA block at the end:

```typescript
const fullMd = [
  result.output.reportMd,
  "",
  renderDataBlock("content-gaps", result.output.contentGaps),
  "",
  renderDataBlock("topics-to-avoid", result.output.topicsToAvoid),
].join("\n");
```

The next phase (cluster-plan) reads `content-gaps` and `topics-to-avoid` from the DATA blocks.

### Phase 3: Cluster Plan

**Goal**: produce a list of 15-30 candidate content clusters, with cornerstone keyword + 5-10 satellite keywords per cluster, validated against DataForSEO search volume.

Implementation pattern same as Phase 2 (multi-step pipeline). High-level flow:

1. **GenerateClusterCandidatesStep**: Anthropic generates 30-50 cluster name + cornerstone-keyword candidates from the marketing context + content gaps from Phase 2.
2. **ValidateKeywordsStep**: DataForSEO `keywordOverview` for the cornerstone keywords, filter out low-volume (e.g., < 50/month).
3. **ExpandWithSatellitesStep**: For each surviving cluster, DataForSEO `relatedKeywords` to find 5-10 satellites.
4. **SynthesizeClusterPlanStep**: Anthropic produces the final markdown report with reasoning per cluster, ranked by opportunity score (volume × low competition × pillar fit).

Output file structure:

```markdown
# Cluster Plan: <slug>

## Overview
<prose synthesis>

## Recommended Clusters

### Cluster 1: <name>
<reasoning, why this cluster, what success looks like>

### Cluster 2: ...

<!-- DATA:clusters BEGIN -->
- name: "Claude für Marketing"
  pillar: "Tools praktisch"
  status: proposed   # change to "approved" or "rejected"
  cornerstone_keyword: "claude marketing"
  cornerstone_search_volume: 480
  cornerstone_difficulty: 32
  satellite_keywords:
    - keyword: "claude prompts marketing"
      search_volume: 110
      difficulty: 28
    - keyword: "claude vs chatgpt marketing"
      search_volume: 90
      difficulty: 35
- name: "..."
  ...
<!-- DATA:clusters END -->

## Notes from Marcel
<freeform — Marcel adds reasoning for approve/reject here>
```

Marcel edits the YAML to set `status: approved` for keepers, `rejected` for skips. The next phase only consumes approved.

(Detailed step code follows the Phase 2 pattern — omitted here for brevity. Implementation order at the end of the spec gives the order to write them.)

### Phase 4: Cornerstone List

**Goal**: for each approved cluster, produce a concrete cornerstone-article title + meta-description + outline (H2 headings) + estimated word count.

Steps:
1. **ParseApprovedClustersStep**: read `03-cluster-plan.md`'s DATA block, filter `status: approved`.
2. **GenerateCornerstoneSpecsStep**: for each cluster, one Anthropic call (cached prefix per project) to generate title + meta + outline.
3. **WriteOutputStep**: produce `04-cornerstone-list.md` with a DATA block of all cornerstones.

Output:
```markdown
<!-- DATA:cornerstones BEGIN -->
- cluster: "Claude für Marketing"
  cornerstone_keyword: "claude marketing"
  proposed_title: "Claude für Marketing: Der vollständige Praxis-Guide für 2026"
  proposed_slug: "claude-fuer-marketing-praxis-guide"
  meta_description: "..."
  estimated_word_count: 3200
  h2_outline:
    - "Was Claude im Marketing besser macht als ChatGPT"
    - "Setup: Claude API + dein Marketing-Stack"
    - ...
  status: proposed
<!-- DATA:cornerstones END -->
```

Marcel reviews titles, edits, sets `status: approved` for the ones to actually produce.

### Phase 5: Go-Live Checklist

**Goal**: a comprehensive checklist Marcel works through to confirm the project is launchable. No Anthropic call here — pure templating + project state inspection.

Output:
```markdown
# Go-Live Checklist: <slug>

## Configuration
- [x] marketing-context.md complete and synced
- [x] DB project row created with industry + pipeline-template
- [ ] Brand voice version set as active in `brand_voices` table
- [ ] Cost limits set in projects.cost_limits
- [ ] Environment-specific publishing config (Astro CMS adapter, when ready)

## Cluster Plan
- [x] At least 5 clusters approved
- [x] Each approved cluster has 5+ satellite keywords
- [ ] Cluster pillars match marketing-context.md pillars (no orphans)

## Cornerstone Articles
- [x] At least 5 cornerstone articles approved for production
- [ ] Each cornerstone has: title, slug, outline, target word count

## Technical
- [ ] R2 bucket configured + custom domain
- [ ] Replicate API key validated (test image generated)
- [ ] DataForSEO deposit funded
- [ ] Astro repo connected (Phase 3)

## Author / Brand
- [ ] Author profile published with photo + bio
- [ ] Schema.org organization markup verified
- [ ] Imprint + privacy policy pages live

## Quality Gates
- [ ] First article generated end-to-end via Article Pipeline (Phase 3)
- [ ] First article reviewed and approved
- [ ] First article published to staging environment
- [ ] Lighthouse score > 95 on staging
```

The script generates this file with `[x]` checked for items it can verify automatically (e.g., "marketing-context.md complete" → check the file exists and is non-empty), and `[ ]` for everything else.

## Acceptance Criteria

### Per-phase commands

- [ ] All five commands runnable: `bun --filter @marketing-auto/api cold-start:<phase> <slug>`
- [ ] Each command refuses to overwrite existing output without `--force`
- [ ] Each command writes to the expected file path
- [ ] Each command's output markdown is parseable by the NEXT command (DATA blocks valid YAML, schema-validated)
- [ ] Each command emits a `pipeline_runs` row tagged with the pipeline name
- [ ] Each command writes `cost_logs` rows for every Anthropic / DataForSEO call

### Voice Refinement (Phase 1)
- [ ] Questions phase generates 8-15 questions across 6 categories
- [ ] Synthesis phase produces an updated `marketing-context.md` that preserves frontmatter
- [ ] Synthesis backs up the original `marketing-context.md` to a timestamped file before writing

### Competitor Analysis (Phase 2)
- [ ] Identifies 3-5 plausible competitors (manually verify for KI-Wissensraum)
- [ ] DataForSEO calls succeed for each competitor
- [ ] Output markdown has parseable `content-gaps` and `topics-to-avoid` DATA blocks

### Cluster Plan (Phase 3)
- [ ] Produces 15-30 cluster candidates
- [ ] Each cluster has cornerstone-keyword search volume validated
- [ ] Each cluster has 5-10 satellite keywords
- [ ] Output `clusters` DATA block is valid YAML
- [ ] Each cluster has `status: proposed` initially

### Cornerstone List (Phase 4)
- [ ] Reads only `status: approved` clusters from Phase 3
- [ ] Produces titles, meta, outlines for all approved clusters
- [ ] Refuses to run if no clusters are approved (clear error message)

### Go-Live Checklist (Phase 5)
- [ ] Generates a checklist with auto-checked items based on file/DB state
- [ ] All previous phases' files exist when this runs

## Testing Strategy

### Unit tests for shared utilities

`packages/pipelines/test/cold-start/data-block-parser.test.ts`:
- `parseDataBlock` extracts a valid YAML block
- Throws `DataBlockParseError` if block is missing
- Throws if BEGIN/END names don't match
- Throws if YAML is malformed
- Schema validation works (Zod schema rejects bad data)
- `renderDataBlock` round-trips: parse(render(x)) === x

`packages/pipelines/test/cold-start/markdown-io.test.ts`:
- `fileExists` returns false for non-existent path
- `readMarkdownIfExists` returns null for non-existent path, content for existing
- `writeMarkdownAtomic` writes to disk; partial-write interruption produces no half-file

### Integration tests (gated by `RUN_LIVE_COLD_START=1`)

For each phase, one end-to-end test that:
1. Creates a test project + sample marketing-context.md
2. Runs the pipeline
3. Verifies the output markdown structure
4. Verifies cost_logs were written
5. Cleans up

Total cost for full live test: ~€2-3 (Anthropic Sonnet/Opus + ~10 DataForSEO calls).

## Open Questions / Decisions Made

**Decision 1: Phases share a directory but not state machinery.**
Each phase reads its predecessor's markdown directly. There's no DB "current cold-start phase" column. Why: simpler, fully observable in git, Marcel can re-run phases out of order if needed (re-running phase 3 after phase 4 is fine — just re-run phase 4 too).

**Decision 2: YAML inside markdown DATA blocks.**
Alternatives: JSON (less human-friendly), TOML (less common), pure markdown lists (not parseable reliably). YAML wins on edit-ability + parser availability.

**Decision 3: Phase 1 has TWO sub-pipelines (questions + synthesis).**
Other phases are single. Voice refinement uniquely needs Marcel's input as data, so we split into "ask" and "tell". Other phases generate complete output that Marcel only edits at the YAML level.

**Decision 4: Use Opus 4.7 for voice synthesis, Sonnet 4.6 for everything else.**
Voice synthesis is high-leverage (mistakes propagate to every article). Everything else is template-y enough that Sonnet is fine. ~€0.30/€0.10 cost difference per project — irrelevant.

**Decision 5: No retry on DataForSEO failures within Phase 2.**
If DataForSEO is down, Marcel re-runs the command later. We don't add resume-from-partial-failure logic — it's complexity for a 5-minute re-run cost.

**Decision 6: Backup, not version, marketing-context.md.**
Phase 1 synthesis writes a `.backup-<timestamp>` file before overwriting. Marcel commits both, git takes over from there. We don't add formal versioning to the DB — git is the version control.

**Decision 7: `--force` is required to overwrite.**
Each command checks if its output file exists. With `--force`, overwrites. Without, errors and exits. Why: easy to accidentally re-run a command and lose Marcel's edits. Force-flag protects against that.

**Decision 8: Phases 2-5 don't read `marketing-context.md` directly.**
They go through `loadProjectContext()` → DB. So Marcel's expected workflow after Phase 1 is: review marketing-context.md → `sync-context` to push it to DB → run Phase 2.

**Decision 9: `pipeline_runs` rows for cold-start phases.**
Even though they're synchronous CLI runs, they get pipeline_runs rows like any other pipeline. Useful for "show all KI-Wissensraum activity" queries later.

**Decision 10: No automatic re-rendering of Phase 1 marketing-context after Phase 2.**
Even though competitor analysis might surface insights that update voice (e.g., "we should be more technical"), we don't auto-update marketing-context. Marcel decides whether to re-run Phase 1 manually. Avoids endless cycles.

## Implementation Order

This spec is **larger than typical** (5 commands, multiple pipelines). Strongly recommend splitting into multiple Claude Code sessions. Suggested order:

**Session 1: Shared infrastructure (~3-4 hours)**
1. `packages/pipelines/src/cold-start/shared/paths.ts`
2. `packages/pipelines/src/cold-start/shared/markdown-io.ts`
3. `packages/pipelines/src/cold-start/shared/data-block-parser.ts`
4. Unit tests for parser + markdown-io
5. Add `yaml` dep, ensure `bun --filter @marketing-auto/pipelines test` passes
6. Commit: `feat(cold-start): shared markdown I/O and DATA block parser (spec 14)`

**Session 2: Phase 1 — Voice Refinement (~3-4 hours)**
1. `01-voice-refinement/steps.ts`, `pipeline.ts`
2. CLI script `apps/api/src/scripts/cold-start/01-voice-refinement.ts`
3. Add `cold-start:voice-refinement` script to apps/api/package.json
4. Manual test against KI-Wissensraum: questions phase
5. Marcel edits the markdown, then run synthesis phase
6. Verify backup file exists, marketing-context.md updated
7. `sync-context` to push to DB
8. Commit: `feat(cold-start): voice refinement phase (spec 14)`

**Session 3: Phase 2 — Competitor Analysis (~3-4 hours)**
Same pattern. Manual test consumes ~€0.10 (DataForSEO + Anthropic).

**Session 4: Phase 3 — Cluster Plan (~4-5 hours)**
Largest phase — multi-step with DataForSEO heavy lifting. Manual test ~€0.30.

**Session 5: Phase 4 — Cornerstone List (~2-3 hours)**

**Session 6: Phase 5 — Go-Live Checklist (~1-2 hours)**
Mostly templating, no API calls.

Run `/clear` between sessions. Each session ends with a working commit.

## Splitting Plan

See "Implementation Order" — six sessions. Total: 16-22 hours of compute time + Marcel's review time between phases.

## Discovered During Implementation

**Sessions 1–2:**

- `@marketing-auto/adapter-anthropic` is not in `packages/pipelines/package.json` by default — must add it (and `adapter-dataforseo` for phases 2–3) explicitly. Spec omitted this step.
- The `brand-positioning` skill named in the spec does not exist in `packages/skills/skills/`. Used `content-strategy` instead. Always verify skill names against the actual directory before writing step code.
- `exactOptionalPropertyTypes: true` (workspace tsconfig) rejects `this.blockName = blockName` when `blockName?: string` is declared as an optional class property. Pattern: declare as `readonly blockName: string | undefined` and guard the assignment with `if (blockName !== undefined)`.
- Cold-start CLI scripts use `console.log/console.error` for user-facing terminal output (consistent with `add-project.ts`) and `log.info()` (pino) only for structured progress events. This is not a violation of the no-console-log rule — that rule applies to server/worker code.

**Session 3:**

- The `competitor-analysis` skill named in the spec does not exist in `packages/skills/skills/`. Used `competitor-profiling` instead. (Same "always verify skill names" rule as Session 2.)
- `@marketing-auto/adapter-dataforseo` added to `packages/pipelines/package.json` — required before typechecking passes. Run `bun install` after adding workspace deps.

## Deviations

**`writeMarkdownAtomic` implementation (Session 1):**
The spec's implementation wrote to `.tmp` via `writeFile` then re-wrote the final path via `Bun.write` — two separate writes, not atomic. Changed to `writeFile(tmpPath) + rename(tmpPath, path)` which is the standard atomic-write pattern (rename is atomic on the same filesystem). Behaviour is identical from Marcel's perspective.

**Phase 2 split into two modes: `questions` + `analyze` (Session 3):**
The spec described a single CLI command that runs all three steps end-to-end. In practice, the `IdentifyCompetitorsStep` (Anthropic) produces a competitor list that Marcel should review before spending DataForSEO budget on potentially wrong domains. Implemented two-mode pattern matching Phase 1:
- `questions` mode: runs only `IdentifyCompetitorsStep`, writes `02-competitor-analysis.md` with a `<!-- DATA:competitors BEGIN/END -->` block Marcel can edit plus AI-generated review questions
- `analyze` mode: reads Marcel's confirmed competitor list from the DATA block, runs `FetchCompetitorKeywordsStep` + `SynthesizeCompetitorReportStep`

As a result, `CompetitorAnalysisPipeline` takes `competitors` as direct input (2 steps) and `CompetitorQuestionsPipeline` is a separate 1-step pipeline — not the 3-step single pipeline the spec described.
