import { anthropic } from "@marketing-auto/adapter-anthropic";
import { type RankedKeywordItem, dataforseo } from "@marketing-auto/adapter-dataforseo";
import { COST_OPS } from "@marketing-auto/core/cost";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { buildSystemPrompt } from "../../prompts/builder.ts";

// ─── Shared schemas ───────────────────────────────────────────────────────────

export const CompetitorSchema = z.object({
  domain: z.string(),
  why_relevant: z.string(),
  expected_strengths: z.array(z.string()),
});

export type Competitor = z.infer<typeof CompetitorSchema>;

// ─── Step 1: Identify competitors (questions phase) ───────────────────────────

const CompetitorListSchema = z.object({
  competitors: z.array(CompetitorSchema).min(3).max(5),
  review_questions: z
    .array(
      z.object({
        id: z.string(),
        question: z.string(),
        why_it_matters: z.string(),
      })
    )
    .min(2)
    .max(6),
});

export type CompetitorListOutput = z.infer<typeof CompetitorListSchema>;

const IdentifyCompetitorsInputSchema = z.object({
  projectSlug: z.string(),
});

export class IdentifyCompetitorsStep extends BaseStep<
  z.infer<typeof IdentifyCompetitorsInputSchema>,
  CompetitorListOutput
> {
  readonly name = "identify-competitors";
  readonly inputSchema = IdentifyCompetitorsInputSchema;
  readonly outputSchema = CompetitorListSchema;

  override estimatedCostEur(_input: z.infer<typeof IdentifyCompetitorsInputSchema>): number {
    return 0.05;
  }

  async execute(
    input: z.infer<typeof IdentifyCompetitorsInputSchema>,
    ctx: StepContext
  ): Promise<CompetitorListOutput> {
    const prompt = await buildSystemPrompt({
      skills: ["competitor-profiling", "ai-seo"],
      projectIdOrSlug: input.projectSlug,
      stepInstructions: `
Identify 3-5 competitors of the project, based on the marketing-context.md.

Selection criteria:
- Same audience (German-speaking, similar persona)
- Same content category (educational, affiliate, local, etc.)
- Active and ranking on Google.de (skip dormant sites)
- Mix of direct competitors AND aspirational competitors (1-2 of each)

For each competitor:
- domain: bare domain (e.g., "ki-tools.de", no protocol or path)
- why_relevant: 1 sentence why they matter to this project
- expected_strengths: 2-4 areas where they likely outrank or out-cover us

Additionally, produce 2-6 short review questions to help Marcel decide whether this
list is correct before spending DataForSEO budget. Focus on things you could not know
from the marketing context alone — e.g. regional nuances, niche sub-communities, or
sites Marcel may personally know are important.

Output strict JSON:
{
  "competitors": [...],
  "review_questions": [{ "id": "rq1", "question": "...", "why_it_matters": "..." }]
}`,
    });

    const result = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: COST_OPS.COLD_START_COMPETITOR_IDENTIFICATION,
      model: "claude-sonnet-4-6",
      systemPrefix: prompt.cacheablePrefix,
      systemSuffix: prompt.variableSuffix,
      userMessage: "Identify the competitors and produce the review questions.",
      maxTokens: 2000,
      jsonMode: true,
      estimatedCostEur: this.estimatedCostEur(input),
    });

    return CompetitorListSchema.parse(result.json);
  }
}

// ─── Step 2: Fetch ranked keywords per competitor (DataForSEO) ────────────────

const CompetitorKeywordsSchema = z.object({
  competitorData: z.array(
    z.object({
      domain: z.string(),
      totalRankedKeywords: z.number(),
      topKeywords: z.array(
        z.object({
          keyword: z.string(),
          position: z.number(),
          url: z.string(),
          searchVolume: z.number().nullable(),
          etv: z.number().nullable(),
        })
      ),
    })
  ),
});

export type CompetitorKeywordsOutput = z.infer<typeof CompetitorKeywordsSchema>;

const FetchCompetitorKeywordsInputSchema = z.object({
  competitors: z
    .array(z.object({ domain: z.string() }))
    .min(1)
    .max(5),
});

export class FetchCompetitorKeywordsStep extends BaseStep<
  z.infer<typeof FetchCompetitorKeywordsInputSchema>,
  CompetitorKeywordsOutput
> {
  readonly name = "fetch-competitor-keywords";
  readonly inputSchema = FetchCompetitorKeywordsInputSchema;
  readonly outputSchema = CompetitorKeywordsSchema;

  override estimatedCostEur(input: z.infer<typeof FetchCompetitorKeywordsInputSchema>): number {
    return input.competitors.length * 0.012;
  }

  async execute(
    input: z.infer<typeof FetchCompetitorKeywordsInputSchema>,
    ctx: StepContext
  ): Promise<CompetitorKeywordsOutput> {
    const competitorData = await Promise.all(
      input.competitors.map(async (c) => {
        const result = await dataforseo.rankedKeywords({
          projectId: ctx.projectId,
          pipelineRunId: ctx.pipelineRunId,
          operation: `ranked-keywords-${c.domain}`,
          domain: c.domain,
          limit: 100,
          maxPosition: 30,
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
      })
    );

    return { competitorData };
  }
}

// ─── Step 3: Synthesize report ────────────────────────────────────────────────

const CompetitorReportSchema = z.object({
  reportMd: z.string().min(500),
  contentGaps: z.array(z.string()).min(3),
  topicsToAvoid: z.array(z.string()),
});

export type CompetitorReportOutput = z.infer<typeof CompetitorReportSchema>;

const SynthesizeCompetitorReportInputSchema = z.object({
  projectSlug: z.string(),
  competitors: z.array(CompetitorSchema),
  competitorData: CompetitorKeywordsSchema.shape.competitorData,
});

export class SynthesizeCompetitorReportStep extends BaseStep<
  z.infer<typeof SynthesizeCompetitorReportInputSchema>,
  CompetitorReportOutput
> {
  readonly name = "synthesize-competitor-report";
  readonly inputSchema = SynthesizeCompetitorReportInputSchema;
  readonly outputSchema = CompetitorReportSchema;

  override estimatedCostEur(_input: z.infer<typeof SynthesizeCompetitorReportInputSchema>): number {
    return 0.2;
  }

  async execute(
    input: z.infer<typeof SynthesizeCompetitorReportInputSchema>,
    ctx: StepContext
  ): Promise<CompetitorReportOutput> {
    const prompt = await buildSystemPrompt({
      skills: ["competitor-profiling", "content-strategy", "ai-seo"],
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

Output strict JSON: { "reportMd": "...", "contentGaps": [...], "topicsToAvoid": [...] }
- reportMd: full markdown content above
- contentGaps: extracted bullet list (verbatim from "Content Gaps" section, max 10)
- topicsToAvoid: extracted bullet list (verbatim from "Topics to Avoid", max 5)`,
    });

    const userMsg = [
      "# Competitors and their ranking data",
      "",
      ...input.competitors.map((c) => {
        const data = input.competitorData.find((d) => d.domain === c.domain);
        return [
          `## ${c.domain}`,
          `- Why relevant: ${c.why_relevant}`,
          `- Expected strengths: ${c.expected_strengths.join(", ")}`,
          `- Total ranked keywords (top 30): ${data?.totalRankedKeywords ?? "?"}`,
          "- Sample top keywords:",
          ...(data?.topKeywords
            .slice(0, 30)
            .map(
              (k) =>
                `  - "${k.keyword}" (pos ${k.position}, vol ${k.searchVolume ?? "?"}, ETV ${k.etv ?? "?"})`
            ) ?? []),
          "",
        ].join("\n");
      }),
    ].join("\n");

    const result = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: COST_OPS.COLD_START_COMPETITOR_ANALYSIS,
      model: "claude-sonnet-4-6",
      systemPrefix: prompt.cacheablePrefix,
      systemSuffix: prompt.variableSuffix,
      userMessage: userMsg,
      maxTokens: 6000,
      jsonMode: true,
      estimatedCostEur: this.estimatedCostEur(input),
    });

    return CompetitorReportSchema.parse(result.json);
  }
}
