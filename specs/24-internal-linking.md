# Spec 24: Internal Linking Pipeline

**Phase:** 3 (Volume Production for KI-Wissensraum)
**Estimated Effort:** 1.5-2 days (2-3 sessions)
**Dependencies:** Spec 11 (anthropic), Spec 20 (article pipeline — produces articles), Spec 21 (astro-sync — re-syncs after links updated), Spec 23 (schema-extension)
**Status:** Ready for implementation
**Recommended Model:** Sonnet 4.6 (LLM-orchestration; logic is straightforward)

---

## Goal

Build the **Internal Linking Pipeline**: rebuilds internal cross-links across all published articles in a cluster, using LLM analysis to choose link targets and anchor texts that read naturally. Triggered after each new article is synced (Spec 21), or manually via CLI.

This is the **only spec** that touches MULTIPLE articles in one run. Everything else (Spec 20 generation, Spec 21 sync, Spec 22 validation, Spec 23 schema) operates per-article. Internal linking inherently requires cross-article context.

**Why this is a separate spec, not part of Spec 20**: When a cluster is empty, the first article has nothing to link to. When article #5 is added, articles 1-4 should ideally link TO article #5 if relevant, and article #5 should link to 1-4 if relevant. This **forward-and-backward update** can only happen at cluster level — per-article generation can't see the future.

**Important architectural note**: Spec 24 doesn't generate links inside `bodyMd` directly via regex search-and-replace. Instead, it uses the LLM to suggest natural placements, then applies them as deterministic markdown edits. This avoids breaking sentences mid-flow.

## Lifecycle

### When the pipeline runs

**Auto-trigger** (chosen): At the END of Spec 21's `ArticleSyncPipeline.afterComplete`, the pipeline queues Spec 24 for the entire cluster. This way every new article triggers a cluster-wide rebuild.

**Manual trigger**: `bun ... cluster:rebuild-links <cluster-name>` for re-running on demand (e.g., after manually editing article copy outside the system).

### What the pipeline does to each article in the cluster

```
Per article in cluster (in dependency order):
1. Load article body + metadata
2. LoadCandidatesStep — gather all OTHER articles in the cluster as link candidates
3. AnalyzeLinkOpportunitiesStep — LLM picks 3-7 link placements per article
4. ApplyLinksStep — modify bodyMd to insert markdown links
5. PersistArticleStep — save updated bodyMd to DB
6. RequestResyncStep — enqueue Spec 21 sync if changes were made
```

After ALL articles processed, the pipeline finishes and articles re-sync independently.

## Cost Model

For a cluster with N published articles, each rebuild does:
- 1 LLM call per article × N articles
- Each call costs ~€0.30 (Sonnet, ~5-8k token input with all candidates + article body, ~2k token output for link suggestions)

**Total per cluster rebuild**: N × €0.30. For a 10-article cluster: €3.

**This adds up** if rebuilds happen on every new article. After 30 articles in a cluster, you've spent €30 on incremental rebuilds — but that's the cost of correct internal linking. Cheaper than not having internal links (Google rewards them) and cheaper than paying a human to do it.

**Budget guard**: We add `projects.linkRebuildBudgetMonthly` (default €30/month). The pipeline checks this before running and aborts if exceeded. Marcel sees the abort in the audit table and decides whether to raise the cap.

## Non-Goals

- **No external links**: Pipeline only adds links to other articles in the SAME project's clusters. Outbound links to authoritative sources are a Spec 20 / draft concern.
- **No anchor-text optimization for SEO**: We don't prioritize keyword-rich anchors over natural language. Natural-reading anchors win (Google's AI is sophisticated about this — keyword-stuffed anchors are an anti-pattern).
- **No automatic outbound link injection**: This is a separate concern (Spec 25+ if useful).
- **No link removal**: If an article is unpublished or its slug changes, broken links happen. Spec 24 doesn't auto-detect or fix this. Marcel manages it via re-running the pipeline after slug changes.
- **No anchor placement validation**: We trust the LLM to put links in sensible spots. We don't post-verify with another LLM call (would double the cost).
- **No multi-link policies**: We don't enforce "each article must link to at least 2 others" — natural placement is what we optimize for. Some articles legitimately have 0 internal links if they're standalone topics.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│           ClusterLinkRebuildPipeline (BullMQ)                    │
│                                                                  │
│  ┌──────────────────────┐                                        │
│  │ LoadClusterStep      │                                        │
│  │ (all published       │                                        │
│  │  articles in cluster)│                                        │
│  └──────────────────────┘                                        │
│            ↓                                                     │
│  ┌──────────────────────┐                                        │
│  │ CheckBudgetStep      │                                        │
│  │ (project monthly cap)│                                        │
│  └──────────────────────┘                                        │
│            ↓ (per article in cluster, sequentially)              │
│  ┌──────────────────────┐                                        │
│  │ AnalyzeLinks         │   LLM call: pick 3-7 link placements   │
│  └──────────────────────┘                                        │
│            ↓                                                     │
│  ┌──────────────────────┐                                        │
│  │ ApplyLinks           │   Deterministic markdown edits         │
│  └──────────────────────┘                                        │
│            ↓                                                     │
│  ┌──────────────────────┐                                        │
│  │ PersistAndQueueResync│   DB update + enqueue Spec 21 if changes│
│  └──────────────────────┘                                        │
└──────────────────────────────────────────────────────────────────┘
```

The per-article inner-loop is implemented as an internal sub-pipeline call, NOT as a step that internally loops. Each article gets its own pipeline run for proper cost tracking and audit.

## Detailed Implementation

### Schema additions

**Add to `articleStatusEnum`**:
```typescript
"linking",  // NEW: Spec 24 in progress, modifying bodyMd
```

**Add to `articles`**:
```typescript
internalLinksUpdatedAt: timestamp("internal_links_updated_at"),
internalLinksAdded: integer("internal_links_added").default(0),  // count, for audit
internalLinkTargets: jsonb("internal_link_targets").$type<string[]>().default([]),
// e.g. ["claude-fuer-marketing", "lokale-llm-setup"]
// — slugs of articles linked TO from this article
```

**Add to `projects`**:
```typescript
linkRebuildBudgetMonthly: numeric("link_rebuild_budget_monthly", { precision: 10, scale: 2 })
  .$type<string>().default("30.00"),  // EUR/month
```

**New table** `link_rebuild_runs`:

```typescript
export const linkRebuildRuns = pgTable("link_rebuild_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  clusterId: uuid("cluster_id"),
  pipelineRunId: uuid("pipeline_run_id"),

  status: text("status").$type<"pending" | "succeeded" | "failed" | "budget_exceeded">().notNull(),
  triggerType: text("trigger_type").$type<"auto_after_sync" | "manual_cli" | "manual_http">().notNull(),

  articlesProcessed: integer("articles_processed").default(0),
  articlesModified: integer("articles_modified").default(0),
  totalLinksAdded: integer("total_links_added").default(0),
  totalCostEur: numeric("total_cost_eur", { precision: 10, scale: 4 }).$type<string>().default("0"),

  errorMessage: text("error_message"),
  errorStage: text("error_stage").$type<"load" | "budget" | "analyze" | "apply" | "persist" | null>(),

  triggeringArticleId: uuid("triggering_article_id"),  // null for manual

  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
}, (table) => ({
  clusterIdx: index("link_rebuild_runs_cluster_idx").on(table.clusterId),
  projectStatusIdx: index("link_rebuild_runs_project_status_idx").on(table.projectId, table.status),
}));
```

### Package Setup

Goes into existing `pipelines` package: `packages/pipelines/src/internal-linking/`.

```
├── index.ts
├── pipeline.ts              # ClusterLinkRebuildPipeline (outer)
├── article-pipeline.ts      # ArticleLinkUpdatePipeline (inner, per-article)
├── trigger.ts
├── types.ts
└── steps/
    ├── load-cluster.ts
    ├── check-budget.ts
    ├── load-candidates.ts
    ├── analyze-links.ts
    ├── apply-links.ts
    └── persist-and-resync.ts
```

### Types

`packages/pipelines/src/internal-linking/types.ts`:

```typescript
import { z } from "zod";

export const LinkSuggestionSchema = z.object({
  /** Slug of the article to link TO. */
  targetSlug: z.string().regex(/^[a-z0-9-]+$/),
  /** The exact substring in the source article's bodyMd where this link should be inserted. */
  anchorText: z.string().min(3).max(150),
  /** Section name (H2 heading text) where this anchor appears, for verification. */
  sectionHint: z.string().max(200),
  /** LLM's reason for the link. Audit trail; not used for filtering. */
  reasoning: z.string().max(300),
});
export type LinkSuggestion = z.infer<typeof LinkSuggestionSchema>;

export const AnalyzeLinksOutputSchema = z.object({
  suggestions: z.array(LinkSuggestionSchema).max(10),
  /** Brief overall reasoning, helpful when debugging. */
  overallNotes: z.string().max(500),
});
export type AnalyzeLinksOutput = z.infer<typeof AnalyzeLinksOutputSchema>;

export class InternalLinkingError extends Error {
  constructor(
    message: string,
    public readonly stage: "load" | "budget" | "analyze" | "apply" | "persist",
    public readonly originalCause?: unknown,
  ) {
    super(message);
    this.name = "InternalLinkingError";
  }
}
```

### Inner Pipeline: per-article link updates

#### LoadCandidatesStep

`packages/pipelines/src/internal-linking/steps/load-candidates.ts`:

```typescript
import { z } from "zod";
import { eq, and, ne, inArray } from "drizzle-orm";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { db, articles } from "@marketing-auto/db";
import { InternalLinkingError } from "../types.ts";

const InputSchema = z.object({
  articleId: z.string().uuid(),
  clusterId: z.string().uuid(),
});

const CandidateSchema = z.object({
  slug: z.string(),
  title: z.string(),
  cornerstoneKeyword: z.string(),
  metaDescription: z.string(),
});

const OutputSchema = z.object({
  article: z.object({
    id: z.string().uuid(),
    slug: z.string(),
    title: z.string(),
    cornerstoneKeyword: z.string(),
    bodyMd: z.string(),
    projectSlug: z.string(),
  }),
  candidates: z.array(CandidateSchema),
  existingLinkSlugs: z.array(z.string()),
});

export class LoadCandidatesStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "load-candidates";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0; }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    // Load the article we're working on
    const [article] = await db.select().from(articles).where(eq(articles.id, input.articleId)).limit(1);
    if (!article) throw new InternalLinkingError(`Article ${input.articleId} not found`, "load");
    if (!article.bodyMd) throw new InternalLinkingError(`Article has no body`, "load");

    // Load all OTHER published articles in the same cluster
    const others = await db
      .select({
        slug: articles.slug,
        title: articles.title,
        cornerstoneKeyword: articles.cornerstoneKeyword,
        metaDescription: articles.metaDescription,
      })
      .from(articles)
      .where(and(
        eq(articles.clusterId, input.clusterId),
        ne(articles.id, input.articleId),
        // Only published or ready_to_publish articles can be linked TO
        inArray(articles.status, ["published", "ready_to_publish"] as const),
      ));

    // Detect existing internal links in the article body
    // Format: [anchor text](/blog/<slug>)
    const linkRegex = /\]\(\/blog\/([a-z0-9-]+)(?:[#?][^)]*)?\)/g;
    const existingLinkSlugs: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = linkRegex.exec(article.bodyMd)) !== null) {
      if (m[1]) existingLinkSlugs.push(m[1]);
    }

    // Get project slug for prompt context
    const { projects } = await import("@marketing-auto/db");
    const [proj] = await db.select({ slug: projects.slug })
      .from(projects).where(eq(projects.id, article.projectId)).limit(1);

    return {
      article: {
        id: article.id,
        slug: article.slug,
        title: article.title!,
        cornerstoneKeyword: article.cornerstoneKeyword,
        bodyMd: article.bodyMd,
        projectSlug: proj?.slug ?? "unknown",
      },
      candidates: others.map((o) => ({
        slug: o.slug,
        title: o.title ?? "",
        cornerstoneKeyword: o.cornerstoneKeyword,
        metaDescription: o.metaDescription ?? "",
      })),
      existingLinkSlugs: [...new Set(existingLinkSlugs)],
    };
  }
}
```

#### AnalyzeLinksStep

`packages/pipelines/src/internal-linking/steps/analyze-links.ts`:

```typescript
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { anthropic } from "@marketing-auto/adapter-anthropic";
import { buildSystemPrompt } from "../../prompts/builder.ts";
import { AnalyzeLinksOutputSchema } from "../types.ts";

const InputSchema = z.object({
  article: z.object({
    slug: z.string(),
    title: z.string(),
    cornerstoneKeyword: z.string(),
    bodyMd: z.string(),
    projectSlug: z.string(),
  }),
  candidates: z.array(z.object({
    slug: z.string(),
    title: z.string(),
    cornerstoneKeyword: z.string(),
    metaDescription: z.string(),
  })),
  existingLinkSlugs: z.array(z.string()),
});

export class AnalyzeLinksStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof AnalyzeLinksOutputSchema>
> {
  readonly name = "analyze-links";
  readonly inputSchema = InputSchema;
  readonly outputSchema = AnalyzeLinksOutputSchema as z.ZodType<z.infer<typeof AnalyzeLinksOutputSchema>>;
  // ZodType cast per Spec 21 lesson #6 (.default arrays in nested schema)

  override estimatedCostEur(): number { return 0.30; }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    if (input.candidates.length === 0) {
      // Solo article in cluster — nothing to link to
      return { suggestions: [], overallNotes: "No candidates available (solo cluster article)" };
    }

    const prompt = await buildSystemPrompt({
      skills: ["copywriting", "ai-seo", "content-strategy"],
      projectIdOrSlug: input.article.projectSlug,
      stepInstructions: `
You are choosing internal link placements for an article. Internal links pass topical
authority between related articles and help users navigate. Your job: pick 3-7 link
placements that read naturally.

Hard rules:

1. **Anchor text MUST be a verbatim substring of the source article's bodyMd.**
   Do NOT paraphrase or invent. Find a phrase that already exists in the article and use it.

2. **Anchor text should be a NOUN PHRASE related to the target's topic** — not generic
   ("click here", "this guide"). Good: "Claude API einrichten" linking to claude-api-setup.
   Bad: "diese Anleitung".

3. **No more than 1 link per H2 section** — internal links shouldn't cluster.

4. **No duplicate links to the same target slug** — if an article should be linked, link
   it once.

5. **Skip if it doesn't fit naturally.** Some articles have 0 sensible links to others.
   Returning fewer suggestions is better than forcing them in.

6. **Avoid linking from headings** — anchor text must be in body prose, not H1/H2/H3.

7. **Existing links in the article**: ${input.existingLinkSlugs.length > 0
        ? `These slugs are ALREADY linked: ${input.existingLinkSlugs.join(", ")}. ` +
          `Do NOT add duplicate links to them. You may suggest replacing existing anchor text only if you have a clearly better placement.`
        : `No existing internal links in this article.`}

Output JSON matching:
{
  "suggestions": [
    {
      "targetSlug": "<slug from candidates>",
      "anchorText": "<verbatim substring from article body>",
      "sectionHint": "<the H2 heading text where this anchor appears>",
      "reasoning": "<1 sentence why this link makes sense>"
    },
    ...
  ],
  "overallNotes": "<2-3 sentence summary of your placement strategy>"
}

Constraint: max 10 suggestions. Aim for 3-7. Quality > quantity.
      `,
    });

    const candidatesList = input.candidates
      .map((c) => `- /${c.slug} — "${c.title}" (cornerstone: "${c.cornerstoneKeyword}"; ${c.metaDescription})`)
      .join("\n");

    const userMsg = [
      `# Source article (we're choosing links FOR this article)`,
      `Slug: ${input.article.slug}`,
      `Title: ${input.article.title}`,
      `Cornerstone keyword: ${input.article.cornerstoneKeyword}`,
      ``,
      `# Body`,
      input.article.bodyMd,
      ``,
      `# Available link targets in this cluster`,
      candidatesList,
      ``,
      `Now produce link suggestions per the rules.`,
    ].join("\n");

    const result = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: `internal-link-analysis-${input.article.slug.slice(0, 30)}`,
      model: "claude-sonnet-4-6",
      systemPrefix: prompt.cacheablePrefix,
      systemSuffix: prompt.variableSuffix,
      userMessage: userMsg,
      maxTokens: 3000,
      jsonMode: true,
      estimatedCostEur: this.estimatedCostEur(),
    });

    return AnalyzeLinksOutputSchema.parse(result.json);
  }
}
```

#### ApplyLinksStep

This is deterministic — no LLM. We take the suggestions and modify the bodyMd. The trick: we must apply edits in **reverse order by position** so earlier substring offsets aren't invalidated by later edits.

`packages/pipelines/src/internal-linking/steps/apply-links.ts`:

```typescript
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { LinkSuggestionSchema, InternalLinkingError } from "../types.ts";

const InputSchema = z.object({
  bodyMd: z.string(),
  suggestions: z.array(LinkSuggestionSchema),
  /** Slugs already linked TO from this article. We skip suggestions that duplicate them. */
  existingLinkSlugs: z.array(z.string()),
});

const OutputSchema = z.object({
  newBodyMd: z.string(),
  appliedSuggestions: z.array(LinkSuggestionSchema),
  /** Suggestions we couldn't apply (anchor text not found, duplicate target, etc.) */
  rejectedSuggestions: z.array(z.object({
    suggestion: LinkSuggestionSchema,
    reason: z.string(),
  })),
  linksAdded: z.number().int().min(0),
});

export class ApplyLinksStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "apply-links";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0; }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    type Edit = {
      start: number;
      end: number;
      replacement: string;
      suggestion: z.infer<typeof LinkSuggestionSchema>;
    };

    const edits: Edit[] = [];
    const rejectedSuggestions: Array<{
      suggestion: z.infer<typeof LinkSuggestionSchema>;
      reason: string;
    }> = [];
    const targetsAlreadyApplied = new Set(input.existingLinkSlugs);

    for (const suggestion of input.suggestions) {
      // Skip if we already linked to this target (avoid duplicates within a single rebuild)
      if (targetsAlreadyApplied.has(suggestion.targetSlug)) {
        rejectedSuggestions.push({
          suggestion,
          reason: `Target slug "${suggestion.targetSlug}" already linked from this article`,
        });
        continue;
      }

      // Find the anchor text in the body
      // We need to find it OUTSIDE of any existing markdown link or heading
      const anchorIndices = findValidAnchorPositions(input.bodyMd, suggestion.anchorText);
      if (anchorIndices.length === 0) {
        rejectedSuggestions.push({
          suggestion,
          reason: `Anchor text "${suggestion.anchorText}" not found in body (or only in invalid positions)`,
        });
        continue;
      }

      // Use the first valid occurrence
      const start = anchorIndices[0]!;
      const end = start + suggestion.anchorText.length;

      // Ensure we're not overlapping with another edit
      const overlapping = edits.find((e) => 
        (start >= e.start && start < e.end) || (end > e.start && end <= e.end)
      );
      if (overlapping) {
        rejectedSuggestions.push({
          suggestion,
          reason: `Overlaps with another link placement`,
        });
        continue;
      }

      const replacement = `[${suggestion.anchorText}](/blog/${suggestion.targetSlug})`;
      edits.push({ start, end, replacement, suggestion });
      targetsAlreadyApplied.add(suggestion.targetSlug);
    }

    // Apply edits in REVERSE order (so earlier offsets aren't invalidated)
    edits.sort((a, b) => b.start - a.start);

    let newBody = input.bodyMd;
    for (const edit of edits) {
      newBody = newBody.slice(0, edit.start) + edit.replacement + newBody.slice(edit.end);
    }

    return {
      newBodyMd: newBody,
      appliedSuggestions: edits.map((e) => e.suggestion).reverse(),  // chronological order
      rejectedSuggestions,
      linksAdded: edits.length,
    };
  }
}

/**
 * Find positions where the anchor text appears as plain prose, not inside:
 * - Existing markdown links: [...](...)
 * - Headings: lines starting with #
 * - Code blocks (triple-backtick or indented 4+ spaces)
 */
function findValidAnchorPositions(body: string, anchor: string): number[] {
  const positions: number[] = [];
  let from = 0;
  while (true) {
    const idx = body.indexOf(anchor, from);
    if (idx === -1) break;

    if (isValidAnchorPosition(body, idx, anchor.length)) {
      positions.push(idx);
    }
    from = idx + 1;
  }
  return positions;
}

function isValidAnchorPosition(body: string, idx: number, length: number): boolean {
  // 1. Not inside an existing markdown link
  // Check if there's an unmatched `[` to the left and `](...)` somewhere right
  const before = body.slice(Math.max(0, idx - 200), idx);
  const after = body.slice(idx + length, idx + length + 200);
  const lastOpenBracket = before.lastIndexOf("[");
  const lastCloseBracket = before.lastIndexOf("]");
  if (lastOpenBracket > lastCloseBracket && after.match(/^[^\[\]]*\]\(/)) {
    return false;  // we're inside a link's anchor text
  }
  if (after.startsWith("](")) {
    return false;  // we're the literal anchor text and the link is right after — already linked
  }

  // 2. Not on a heading line
  const lineStart = body.lastIndexOf("\n", idx) + 1;
  const lineUpToIdx = body.slice(lineStart, idx);
  if (/^#{1,6}\s/.test(lineUpToIdx)) return false;

  // 3. Not inside a fenced code block
  // Count ``` tokens BEFORE idx; if odd, we're inside a code block
  const fencesBefore = (body.slice(0, idx).match(/```/g) ?? []).length;
  if (fencesBefore % 2 === 1) return false;

  // 4. Not on an indented-code-block line
  if (/^( {4,}|\t)/.test(body.slice(lineStart, lineStart + 10))) return false;

  return true;
}
```

#### PersistAndQueueResyncStep

`packages/pipelines/src/internal-linking/steps/persist-and-resync.ts`:

```typescript
import { z } from "zod";
import { eq } from "drizzle-orm";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { db, articles } from "@marketing-auto/db";
import { enqueueArticleSync } from "@marketing-auto/adapter-astro-sync";

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  newBodyMd: z.string(),
  linksAdded: z.number(),
  appliedTargets: z.array(z.string()),  // slugs linked to
  triggerResync: z.boolean(),
});

const OutputSchema = z.object({
  articleId: z.string().uuid(),
  linksAdded: z.number(),
  resyncJobId: z.string().nullable(),
});

export class PersistAndQueueResyncStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "persist-and-resync";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0; }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const now = new Date();

    if (input.linksAdded === 0) {
      // No changes — just update timestamp
      await db.update(articles).set({
        internalLinksUpdatedAt: now,
      }).where(eq(articles.id, input.articleId));
      return { articleId: input.articleId, linksAdded: 0, resyncJobId: null };
    }

    await db.update(articles).set({
      bodyMd: input.newBodyMd,
      internalLinksUpdatedAt: now,
      internalLinksAdded: input.linksAdded,
      internalLinkTargets: input.appliedTargets,
      updatedAt: now,
    }).where(eq(articles.id, input.articleId));

    // Trigger re-sync if the article was previously synced
    let resyncJobId: string | null = null;
    if (input.triggerResync) {
      try {
        const [a] = await db.select({ status: articles.status }).from(articles).where(eq(articles.id, input.articleId)).limit(1);
        if (a && (a.status === "ready_to_publish" || a.status === "published")) {
          // Set status back to ready_to_publish so sync picks it up
          await db.update(articles).set({ status: "ready_to_publish" }).where(eq(articles.id, input.articleId));
          const result = await enqueueArticleSync({
            articleId: input.articleId,
            projectId: input.projectId,
          });
          resyncJobId = result.jobId;
        }
      } catch (e) {
        // Re-sync failure shouldn't fail the link update — just log
        console.error(`Failed to enqueue re-sync for ${input.articleId}:`, e);
      }
    }

    return {
      articleId: input.articleId,
      linksAdded: input.linksAdded,
      resyncJobId,
    };
  }
}
```

### Inner Pipeline: ArticleLinkUpdate

`packages/pipelines/src/internal-linking/article-pipeline.ts`:

```typescript
import { z } from "zod";
import { Pipeline } from "../engine/pipeline.ts";
import { LoadCandidatesStep } from "./steps/load-candidates.ts";
import { AnalyzeLinksStep } from "./steps/analyze-links.ts";
import { ApplyLinksStep } from "./steps/apply-links.ts";
import { PersistAndQueueResyncStep } from "./steps/persist-and-resync.ts";

const InputSchema = z.object({
  articleId: z.string().uuid(),
  clusterId: z.string().uuid(),
  projectId: z.string().uuid(),
  triggerResync: z.boolean().default(true),
});

const OutputSchema = z.object({
  articleId: z.string().uuid(),
  linksAdded: z.number(),
  resyncJobId: z.string().nullable(),
});

export class ArticleLinkUpdatePipeline extends Pipeline<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "article:link-update";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;
  readonly steps = [
    new LoadCandidatesStep(),
    new AnalyzeLinksStep(),
    new ApplyLinksStep(),
    new PersistAndQueueResyncStep(),
  ] as const;

  override bridge(
    fromStep: { name: string },
    toStep: { name: string },
    output: unknown,
    pipelineInput: z.infer<typeof InputSchema>,
    getStepOutput: <T = unknown>(name: string) => T | undefined,
  ): unknown {
    if (fromStep.name === "load-candidates" && toStep.name === "analyze-links") {
      return output;  // shape already matches
    }
    if (fromStep.name === "analyze-links" && toStep.name === "apply-links") {
      const load = getStepOutput<{ article: { bodyMd: string }; existingLinkSlugs: string[] }>("load-candidates")!;
      const analyze = output as { suggestions: unknown[] };
      return {
        bodyMd: load.article.bodyMd,
        suggestions: analyze.suggestions,
        existingLinkSlugs: load.existingLinkSlugs,
      };
    }
    if (fromStep.name === "apply-links" && toStep.name === "persist-and-resync") {
      const apply = output as {
        newBodyMd: string;
        linksAdded: number;
        appliedSuggestions: Array<{ targetSlug: string }>;
      };
      return {
        articleId: pipelineInput.articleId,
        projectId: pipelineInput.projectId,
        newBodyMd: apply.newBodyMd,
        linksAdded: apply.linksAdded,
        appliedTargets: apply.appliedSuggestions.map((s) => s.targetSlug),
        triggerResync: pipelineInput.triggerResync,
      };
    }
    return output;
  }
}
```

### Outer Pipeline: ClusterLinkRebuild

This pipeline orchestrates the inner per-article pipelines. It runs them sequentially (not in parallel) because:
- Sequential is easier to reason about and audit
- Each article's analysis sees the candidates as they were at the start of the rebuild
- Cost spikes are smoother

`packages/pipelines/src/internal-linking/pipeline.ts`:

```typescript
import { z } from "zod";
import { eq, and, inArray, sum, gte } from "drizzle-orm";
import { Pipeline } from "../engine/pipeline.ts";
import { runPipeline } from "../engine/runner.ts";
import { ArticleLinkUpdatePipeline } from "./article-pipeline.ts";
import { db, articles, projects, clusters, linkRebuildRuns } from "@marketing-auto/db";
import { InternalLinkingError } from "./types.ts";
import { BaseStep, type StepContext } from "../engine/step.ts";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("internal-linking:cluster");

// Outer-pipeline input/output

const ClusterRebuildInputSchema = z.object({
  clusterId: z.string().uuid(),
  projectId: z.string().uuid(),
  triggeringArticleId: z.string().uuid().nullable(),
  triggerType: z.enum(["auto_after_sync", "manual_cli", "manual_http"]),
});

const ClusterRebuildOutputSchema = z.object({
  clusterId: z.string().uuid(),
  articlesProcessed: z.number(),
  articlesModified: z.number(),
  totalLinksAdded: z.number(),
  totalCostEur: z.number(),
});

// One single Step that orchestrates internally — keeps the pipeline-engine semantics simple.
// For audit, we still write a `link_rebuild_runs` row.

class OrchestrateClusterRebuildStep extends BaseStep<
  z.infer<typeof ClusterRebuildInputSchema>,
  z.infer<typeof ClusterRebuildOutputSchema>
> {
  readonly name = "orchestrate-cluster-rebuild";
  readonly inputSchema = ClusterRebuildInputSchema;
  readonly outputSchema = ClusterRebuildOutputSchema;

  override estimatedCostEur(input: z.infer<typeof ClusterRebuildInputSchema>): number {
    // Approximate: assume 8 articles in cluster; refine after first runs
    return 8 * 0.30;
  }

  async execute(input: z.infer<typeof ClusterRebuildInputSchema>, ctx: StepContext) {
    // 1. Budget check
    await this.checkBudget(input.projectId);

    // 2. Load all published articles in cluster
    const clusterArticles = await db
      .select({
        id: articles.id,
        slug: articles.slug,
        title: articles.title,
      })
      .from(articles)
      .where(and(
        eq(articles.clusterId, input.clusterId),
        inArray(articles.status, ["published", "ready_to_publish"] as const),
      ));

    if (clusterArticles.length === 0) {
      log.info({ clusterId: input.clusterId }, "Cluster has no published articles, nothing to do");
      return { clusterId: input.clusterId, articlesProcessed: 0, articlesModified: 0, totalLinksAdded: 0, totalCostEur: 0 };
    }
    if (clusterArticles.length === 1) {
      log.info({ clusterId: input.clusterId }, "Cluster has only 1 article, no candidates for linking");
      return { clusterId: input.clusterId, articlesProcessed: 1, articlesModified: 0, totalLinksAdded: 0, totalCostEur: 0 };
    }

    // 3. Run inner pipeline per article, sequentially
    let articlesModified = 0;
    let totalLinksAdded = 0;
    let totalCostEur = 0;

    for (const article of clusterArticles) {
      try {
        const result = await runPipeline(
          new ArticleLinkUpdatePipeline(),
          {
            articleId: article.id,
            clusterId: input.clusterId,
            projectId: input.projectId,
            triggerResync: true,
          },
          { projectId: input.projectId },
        );

        if (!result.ok) {
          log.error({ articleId: article.id, error: result.error }, "Per-article link update failed; continuing");
          continue;
        }

        if (result.output.linksAdded > 0) {
          articlesModified++;
          totalLinksAdded += result.output.linksAdded;
        }
        totalCostEur += 0.30;  // approximation; could read real cost from costLogs

        log.info({
          articleId: article.id,
          linksAdded: result.output.linksAdded,
        }, "Per-article link update done");
      } catch (e) {
        log.error({ articleId: article.id, error: e }, "Per-article link update crashed; continuing");
      }
    }

    return {
      clusterId: input.clusterId,
      articlesProcessed: clusterArticles.length,
      articlesModified,
      totalLinksAdded,
      totalCostEur,
    };
  }

  /**
   * Aborts if the project's monthly link-rebuild spend would exceed the cap.
   */
  private async checkBudget(projectId: string): Promise<void> {
    const [proj] = await db.select({ cap: projects.linkRebuildBudgetMonthly })
      .from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!proj) throw new InternalLinkingError("Project not found", "budget");

    const cap = parseFloat(proj.cap);

    // Sum costs from link_rebuild_runs in current calendar month
    const monthStart = new Date();
    monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

    const [usage] = await db
      .select({
        total: sum(linkRebuildRuns.totalCostEur),
      })
      .from(linkRebuildRuns)
      .where(and(
        eq(linkRebuildRuns.projectId, projectId),
        gte(linkRebuildRuns.startedAt, monthStart),
      ));

    const used = parseFloat(String(usage?.total ?? "0"));
    if (used >= cap) {
      throw new InternalLinkingError(
        `Monthly link-rebuild budget exceeded: €${used.toFixed(2)} / €${cap.toFixed(2)}. ` +
        `Increase via projects.linkRebuildBudgetMonthly or wait until next month.`,
        "budget",
      );
    }
  }
}

export class ClusterLinkRebuildPipeline extends Pipeline<
  z.infer<typeof ClusterRebuildInputSchema>,
  z.infer<typeof ClusterRebuildOutputSchema>
> {
  readonly name = "cluster:link-rebuild";
  readonly inputSchema = ClusterRebuildInputSchema;
  readonly outputSchema = ClusterRebuildOutputSchema;
  readonly steps = [new OrchestrateClusterRebuildStep()] as const;
}
```

### Service Layer

`packages/pipelines/src/internal-linking/trigger.ts`:

```typescript
import { eq, and } from "drizzle-orm";
import { db, articles, clusters, linkRebuildRuns } from "@marketing-auto/db";
import { enqueuePipeline } from "../engine/runner.ts";

export async function enqueueClusterLinkRebuild(input: {
  clusterId: string;
  projectId: string;
  triggerType: "auto_after_sync" | "manual_cli" | "manual_http";
  triggeringArticleId?: string;
}): Promise<{ jobId: string; runId: string }> {
  const [run] = await db.insert(linkRebuildRuns).values({
    projectId: input.projectId,
    clusterId: input.clusterId,
    triggeringArticleId: input.triggeringArticleId ?? null,
    triggerType: input.triggerType,
    status: "pending",
  }).returning();

  const { jobId } = await enqueuePipeline({
    pipelineName: "cluster:link-rebuild",
    projectId: input.projectId,
    input: {
      clusterId: input.clusterId,
      projectId: input.projectId,
      triggeringArticleId: input.triggeringArticleId ?? null,
      triggerType: input.triggerType,
    },
    jobOptions: { jobId: `link-rebuild-${input.clusterId}` },
  });

  return { jobId, runId: run!.id };
}
```

### Integration with Spec 21

Modify Spec 21's `ArticleSyncPipeline.afterComplete` to enqueue a cluster rebuild:

```typescript
// packages/adapters/astro-sync/src/pipeline.ts (modify existing)

import { enqueueClusterLinkRebuild } from "@marketing-auto/pipelines/internal-linking";

export class ArticleSyncPipeline extends Pipeline<...> {
  override async afterComplete(
    output: z.infer<typeof OutputSchema>,
    pipelineInput: z.infer<typeof InputSchema>,
  ): Promise<void> {
    try {
      const [article] = await db.select({ clusterId: articles.clusterId })
        .from(articles).where(eq(articles.id, pipelineInput.articleId)).limit(1);
      if (article?.clusterId) {
        await enqueueClusterLinkRebuild({
          clusterId: article.clusterId,
          projectId: pipelineInput.projectId,
          triggerType: "auto_after_sync",
          triggeringArticleId: pipelineInput.articleId,
        });
      }
    } catch (e) {
      console.error(`Failed to enqueue link rebuild after sync:`, e);
      // Don't retry the sync — it's done.
    }
  }
}
```

### CLI Script

`apps/api/src/scripts/cluster/rebuild-links.ts`:

```typescript
#!/usr/bin/env bun
import { eq, and } from "drizzle-orm";
import { db, clusters, projects } from "@marketing-auto/db";
import { enqueueClusterLinkRebuild } from "@marketing-auto/pipelines/internal-linking";

const clusterName = process.argv[2];
if (!clusterName) {
  console.error("Usage: bun ... cluster:rebuild-links <cluster-name>");
  process.exit(1);
}

// Find cluster (across all projects)
const all = await db.select().from(clusters).where(eq(clusters.name, clusterName));
if (all.length === 0) {
  console.error(`No cluster named "${clusterName}"`);
  process.exit(1);
}
if (all.length > 1) {
  console.error(`Multiple clusters named "${clusterName}". Specify via --project flag.`);
  process.exit(1);
}
const cluster = all[0]!;

const result = await enqueueClusterLinkRebuild({
  clusterId: cluster.id,
  projectId: cluster.projectId,
  triggerType: "manual_cli",
});

console.log(`✅ Cluster link rebuild enqueued
   Cluster: ${cluster.name}
   Run ID: ${result.runId}
   Job ID: ${result.jobId}

Pipeline runs sequentially across all published articles in the cluster.
Cost: ~€0.30/article × number of articles.
Each modified article is auto-resynced via Spec 21.`);
process.exit(0);
```

Add to `apps/api/package.json`:
```json
"cluster:rebuild-links": "bun --env-file ../../.env src/scripts/cluster/rebuild-links.ts"
```

## Acceptance Criteria

### Schema
- [ ] `articleStatusEnum` includes `linking`
- [ ] `articles` has `internalLinksUpdatedAt`, `internalLinksAdded`, `internalLinkTargets`
- [ ] `projects` has `linkRebuildBudgetMonthly` defaulting to `30.00`
- [ ] `link_rebuild_runs` table exists with FK cascade

### Per-article pipeline
- [ ] LoadCandidatesStep returns 0 candidates for solo-cluster articles
- [ ] LoadCandidatesStep correctly detects existing internal links via regex
- [ ] AnalyzeLinksStep returns 0 suggestions for solo-cluster (no candidates)
- [ ] AnalyzeLinksStep produces ≤10 suggestions
- [ ] ApplyLinksStep rejects suggestions whose anchor text isn't in body
- [ ] ApplyLinksStep rejects suggestions whose target is already linked
- [ ] ApplyLinksStep doesn't break existing markdown links
- [ ] ApplyLinksStep doesn't link inside headings or code blocks
- [ ] ApplyLinksStep applies edits in reverse-position order

### Outer pipeline
- [ ] Budget check fails if monthly cap exceeded (returns clear error)
- [ ] Budget check succeeds when below cap
- [ ] Sequential per-article processing (parallel = wrong)
- [ ] One article failing doesn't crash the whole rebuild

### Integration
- [ ] Spec 21's `afterComplete` triggers a rebuild
- [ ] After rebuild, modified articles re-sync via Spec 21 (causing chain to cascade once)
- [ ] CLI `cluster:rebuild-links` works manually
- [ ] No infinite loop: re-sync triggered by rebuild does NOT trigger another rebuild on the same content (idempotency check)

### Idempotency
- [ ] Running rebuild twice on a stable cluster produces zero changes the second time
- [ ] (Or: produces minimal changes if LLM is non-deterministic — log + accept)

## Testing Strategy

**Unit tests** (always run):
- `findValidAnchorPositions` against various edge cases:
  - Anchor inside existing link
  - Anchor inside heading
  - Anchor inside code block
  - Anchor in plain prose (positive case)
- `ApplyLinksStep` with overlapping suggestions
- `ApplyLinksStep` with already-linked target

**Integration test** (gated by `RUN_LIVE_INTERNAL_LINKING=1`):
1. Create test cluster with 3 articles
2. Run pipeline
3. Verify each article's bodyMd contains 0-3 internal links
4. Verify links are valid markdown
5. Verify Spec 21 re-sync was triggered for modified articles
   Cost: ~€0.90 (3 articles × €0.30).

**Idempotency test** (also live):
1. Run rebuild on the same cluster twice in a row
2. Compare bodyMd — should be identical or near-identical
3. Verify totalLinksAdded ≈ 0 on second run

## Open Questions / Decisions Made

**Decision 1: Sequential per-article processing.**
Could parallelize (BullMQ allows). Rejected because: cost spikes harder to track, "see candidates as they were at start" semantics are cleaner, and LLM rate limits matter.

**Decision 2: Budget check at outer-pipeline level only.**
We don't check inside each per-article run, because: by the time the per-article runs, we've committed to the full cluster rebuild. Aborting halfway through a cluster wastes work.

**Decision 3: Re-sync triggered per modified article, not bulk.**
Each article that gets new links re-syncs via Spec 21 individually. This cascades a flurry of GitHub commits. For 10 modified articles: 10 commits to main. That's acceptable for KI-Wissensraum's volume; Marcel can squash later if needed.

**Decision 4: No infinite-loop prevention via state.**
The check is implicit: re-sync triggers a `cluster:rebuild-links` again, but the budget check + the fact that re-running on stable content produces zero changes prevents runaway. If we did add explicit prevention, it would be: "skip rebuild if last rebuild was <60 minutes ago AND no new articles synced since". Could be added in a future spec.

**Decision 5: Single LLM call per article.**
Could split "candidate selection" from "anchor placement" but doubles the cost. Single call works because the prompt is well-structured.

**Decision 6: Anchor text must be VERBATIM substring.**
LLM must use existing words from the article. We don't paraphrase or reword. Reason: editing the article body for SEO purposes (changing "Claude" to "Claude AI" to fit a link) is risky — it can change meaning.

**Decision 7: Rejection of already-linked targets within a single rebuild run.**
If two suggestions both target the same article, we accept the first and reject the second. This happens at apply-time, not analyze-time.

**Decision 8: Re-sync uses Spec 21's existing pipeline.**
We don't fork. Spec 21 handles git commit + Astro sync the same way as for new articles.

**Decision 9: Budget cap is per project per calendar month.**
Resets on the 1st. Simple and effective.

**Decision 10: One outer pipeline job per cluster, jobId-deduped.**
If sync triggers multiple rebuilds for the same cluster within seconds (e.g., 3 articles synced in parallel), BullMQ's jobId dedup ensures only one rebuild runs. Correct semantics.

**Decision 11: orchestrate-as-step pattern, not pipeline-of-pipelines.**
Rather than expressing the per-article sub-pipelines as separate steps in the outer pipeline, we use ONE outer step that internally calls `runPipeline()` for each article. Simpler, single audit row in `pipeline_runs`, cleaner cost attribution.

**Decision 12: No automatic retry-on-LLM-failure within the outer step.**
If LLM fails for one article, that article is skipped (logged), the rest continue. BullMQ's outer-job retry is conservative (won't restart from scratch).

## Implementation Order

**Recommend 3 sessions.**

**Session 1: Schema + types + per-article inner pipeline (~4-5h)**
1. Migration: enum + articles + projects + link_rebuild_runs
2. types.ts
3. LoadCandidatesStep + AnalyzeLinksStep + ApplyLinksStep + PersistAndQueueResyncStep
4. ArticleLinkUpdatePipeline with bridges
5. Unit tests for ApplyLinksStep edge cases (most critical)
6. Commit: `feat(internal-linking): per-article pipeline (spec 24)`

**Session 2: Outer pipeline + CLI (~3-4h)**
1. ClusterLinkRebuildPipeline with single orchestrator step
2. Budget check logic
3. Trigger function
4. CLI script
5. Manual test: pick a cluster with 3+ published articles, run CLI, verify
6. Commit: `feat(internal-linking): cluster orchestration (spec 24)`

**Session 3: Spec 21 integration + idempotency test (~2-3h)**
1. Modify Spec 21's `afterComplete` to enqueue cluster rebuild
2. End-to-end test: sync new article, verify cluster rebuild auto-runs
3. Idempotency test: run rebuild twice, verify second run produces ~0 changes
4. Verify infinite-loop doesn't happen (rebuild → re-sync → would-rebuild — but jobId dedup catches it)
5. Commit: `feat(internal-linking): spec 21 integration + tests (spec 24)`

Total: 9-12 hours. Cost per cluster rebuild: €0.30 × N (N = articles in cluster).

## Splitting Plan

See "Implementation Order" — 3 sessions with `/clear` between.

## Discovered During Implementation

(empty — fill during/after implementation)

## Deviations

(empty — fill during/after implementation)
