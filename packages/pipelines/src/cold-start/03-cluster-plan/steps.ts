import { anthropic } from "@marketing-auto/adapter-anthropic";
import { type RelatedKeywordItem, dataforseo } from "@marketing-auto/adapter-dataforseo";
import { COST_OPS } from "@marketing-auto/core/cost";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { buildSystemPrompt } from "../../prompts/builder.ts";

// ─── Shared schemas ───────────────────────────────────────────────────────────

export const ClusterCandidateSchema = z.object({
  name: z.string(),
  pillar: z.string(),
  cornerstone_keyword: z.string(),
  reasoning: z.string(),
});

export type ClusterCandidate = z.infer<typeof ClusterCandidateSchema>;

export const ValidatedClusterSchema = z.object({
  name: z.string(),
  pillar: z.string(),
  cornerstone_keyword: z.string(),
  reasoning: z.string(),
  search_volume: z.number().nullable(),
  keyword_difficulty: z.number().nullable(),
});

export type ValidatedCluster = z.infer<typeof ValidatedClusterSchema>;

export const SatelliteKeywordSchema = z.object({
  keyword: z.string(),
  search_volume: z.number().nullable(),
  difficulty: z.number().nullable(),
});

export const ExpandedClusterSchema = z.object({
  name: z.string(),
  pillar: z.string(),
  cornerstone_keyword: z.string(),
  search_volume: z.number().nullable(),
  keyword_difficulty: z.number().nullable(),
  satellite_keywords: z.array(SatelliteKeywordSchema),
});

export type ExpandedCluster = z.infer<typeof ExpandedClusterSchema>;

export const FinalClusterSchema = z.object({
  name: z.string(),
  pillar: z.string(),
  status: z.literal("proposed"),
  cornerstone_keyword: z.string(),
  cornerstone_search_volume: z.number().nullable(),
  cornerstone_difficulty: z.number().nullable(),
  satellite_keywords: z.array(SatelliteKeywordSchema),
});

export type FinalCluster = z.infer<typeof FinalClusterSchema>;

// ConfirmedClusterSchema: what Marcel edits after propose phase (no satellites yet)
export const ConfirmedClusterSchema = z.object({
  name: z.string(),
  pillar: z.string(),
  cornerstone_keyword: z.string(),
  search_volume: z.number().nullable(),
  keyword_difficulty: z.number().nullable(),
});

export type ConfirmedCluster = z.infer<typeof ConfirmedClusterSchema>;

// ─── Step 1: Generate cluster candidates (Anthropic) ─────────────────────────

const CandidatesOutputSchema = z.object({
  candidates: z.array(ClusterCandidateSchema).min(20).max(50),
});

const GenerateCandidatesInputSchema = z.object({
  projectSlug: z.string(),
  contentGaps: z.array(z.string()),
  topicsToAvoid: z.array(z.string()),
});

export class GenerateClusterCandidatesStep extends BaseStep<
  z.infer<typeof GenerateCandidatesInputSchema>,
  z.infer<typeof CandidatesOutputSchema>
> {
  readonly name = "generate-cluster-candidates";
  readonly inputSchema = GenerateCandidatesInputSchema;
  readonly outputSchema = CandidatesOutputSchema;

  override estimatedCostEur(_input: z.infer<typeof GenerateCandidatesInputSchema>): number {
    return 0.15;
  }

  async execute(
    input: z.infer<typeof GenerateCandidatesInputSchema>,
    ctx: StepContext
  ): Promise<z.infer<typeof CandidatesOutputSchema>> {
    const prompt = await buildSystemPrompt({
      skills: ["ai-seo", "content-strategy"],
      projectIdOrSlug: input.projectSlug,
      stepInstructions: `
Generate 20-50 content cluster candidates for the project.

A cluster = one cornerstone article targeting a head keyword + multiple satellite articles
targeting closely related, longer-tail variations of that keyword group.

Rules for candidates:
- Each cluster must have ONE tight cornerstone keyword (2-4 words, in the audience's language)
- cornerstone_keyword must be a real search query people type — not a topic label
- name: short human label for the cluster (e.g. "Claude für Marketing")
- pillar: which marketing pillar this cluster supports (match pillars from the marketing context)
- reasoning: 1 sentence explaining WHY this cluster fits the content strategy
- Prioritize clusters that fill the content gaps identified in competitor analysis
- Avoid topics in the topicsToAvoid list
- Each cluster must be meaningfully distinct — do NOT generate keyword variations as separate clusters
- Target clusters that likely have search volume > 50/month on Google.de

Content gaps to prioritize:
${input.contentGaps.map((g) => `- ${g}`).join("\n")}

Topics to avoid:
${input.topicsToAvoid.map((t) => `- ${t}`).join("\n")}

Output strict JSON: { "candidates": [{ "name", "pillar", "cornerstone_keyword", "reasoning" }] }`,
    });

    const result = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: COST_OPS.COLD_START_CLUSTER_CANDIDATES,
      model: "claude-sonnet-4-6",
      systemPrefix: prompt.cacheablePrefix,
      systemSuffix: prompt.variableSuffix,
      userMessage: "Generate the cluster candidates per the rules above.",
      maxTokens: 6000,
      jsonMode: true,
      estimatedCostEur: this.estimatedCostEur(input),
    });

    return CandidatesOutputSchema.parse(result.json);
  }
}

// ─── Step 2: Validate cornerstone keyword volumes (DataForSEO) ────────────────

const MIN_SEARCH_VOLUME = 50;

const ValidateKeywordsOutputSchema = z.object({
  validated: z.array(ValidatedClusterSchema),
  filteredCount: z.number(),
});

const ValidateKeywordsInputSchema = z.object({
  candidates: z.array(ClusterCandidateSchema).min(1),
});

export class ValidateKeywordsStep extends BaseStep<
  z.infer<typeof ValidateKeywordsInputSchema>,
  z.infer<typeof ValidateKeywordsOutputSchema>
> {
  readonly name = "validate-cluster-keywords";
  readonly inputSchema = ValidateKeywordsInputSchema;
  readonly outputSchema = ValidateKeywordsOutputSchema;

  override estimatedCostEur(input: z.infer<typeof ValidateKeywordsInputSchema>): number {
    // keywordOverview: €0.018 per 700 keywords
    return Math.max(0.002, Math.ceil(input.candidates.length / 700) * 0.018);
  }

  async execute(
    input: z.infer<typeof ValidateKeywordsInputSchema>,
    ctx: StepContext
  ): Promise<z.infer<typeof ValidateKeywordsOutputSchema>> {
    const keywords = input.candidates.map((c) => c.cornerstone_keyword);

    const overviewResult = await dataforseo.keywordOverview({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: COST_OPS.COLD_START_CLUSTER_KEYWORD_OVERVIEW,
      keywords,
      estimatedCostEur: this.estimatedCostEur(input),
    });

    const volumeMap = new Map<
      string,
      { searchVolume: number | null; keywordDifficulty: number | null }
    >();
    for (const item of overviewResult.items) {
      volumeMap.set(item.keyword.toLowerCase(), {
        searchVolume: item.searchVolume,
        keywordDifficulty: item.keywordDifficulty,
      });
    }

    const validated: ValidatedCluster[] = [];
    let filteredCount = 0;

    for (const candidate of input.candidates) {
      const data = volumeMap.get(candidate.cornerstone_keyword.toLowerCase());
      const vol = data?.searchVolume ?? null;

      // Filter out keywords with confirmed low volume; keep unknowns (null)
      if (vol !== null && vol < MIN_SEARCH_VOLUME) {
        filteredCount++;
        continue;
      }

      validated.push({
        name: candidate.name,
        pillar: candidate.pillar,
        cornerstone_keyword: candidate.cornerstone_keyword,
        reasoning: candidate.reasoning,
        search_volume: vol,
        keyword_difficulty: data?.keywordDifficulty ?? null,
      });
    }

    return { validated, filteredCount };
  }
}

// ─── Step 3: Expand each cluster with satellite keywords (DataForSEO) ─────────

const ExpandWithSatellitesOutputSchema = z.object({
  expandedClusters: z.array(ExpandedClusterSchema),
});

const ExpandWithSatellitesInputSchema = z.object({
  confirmedClusters: z.array(ConfirmedClusterSchema).min(1),
});

export class ExpandWithSatellitesStep extends BaseStep<
  z.infer<typeof ExpandWithSatellitesInputSchema>,
  z.infer<typeof ExpandWithSatellitesOutputSchema>
> {
  readonly name = "expand-with-satellites";
  readonly inputSchema = ExpandWithSatellitesInputSchema;
  readonly outputSchema = ExpandWithSatellitesOutputSchema;

  override estimatedCostEur(input: z.infer<typeof ExpandWithSatellitesInputSchema>): number {
    // relatedKeywords: ~€0.011 per cluster
    return input.confirmedClusters.length * 0.011;
  }

  async execute(
    input: z.infer<typeof ExpandWithSatellitesInputSchema>,
    ctx: StepContext
  ): Promise<z.infer<typeof ExpandWithSatellitesOutputSchema>> {
    const expandedClusters = await Promise.all(
      input.confirmedClusters.map(async (cluster) => {
        const operationKey = cluster.cornerstone_keyword
          .replace(/\s+/g, "-")
          .replace(/[^a-zA-Z0-9-]/g, "");
        const result = await dataforseo.relatedKeywords({
          projectId: ctx.projectId,
          pipelineRunId: ctx.pipelineRunId,
          operation: `related-kw-${operationKey}`,
          seed: cluster.cornerstone_keyword,
          limit: 50,
          minSearchVolume: 30,
          estimatedCostEur: 0.011,
        });

        const satelliteKeywords = result.items
          .filter(
            (k: RelatedKeywordItem) =>
              k.keyword.toLowerCase() !== cluster.cornerstone_keyword.toLowerCase()
          )
          .slice(0, 10)
          .map((k: RelatedKeywordItem) => ({
            keyword: k.keyword,
            search_volume: k.searchVolume,
            difficulty: null as number | null,
          }));

        return {
          name: cluster.name,
          pillar: cluster.pillar,
          cornerstone_keyword: cluster.cornerstone_keyword,
          search_volume: cluster.search_volume,
          keyword_difficulty: cluster.keyword_difficulty,
          satellite_keywords: satelliteKeywords,
        };
      })
    );

    return { expandedClusters };
  }
}

// ─── Step 4: Synthesize cluster plan markdown (Anthropic) ─────────────────────

const SynthesizeClusterPlanOutputSchema = z.object({
  reportMd: z.string().min(500),
  clusters: z.array(FinalClusterSchema),
});

const SynthesizeClusterPlanInputSchema = z.object({
  projectSlug: z.string(),
  expandedClusters: z.array(ExpandedClusterSchema),
  contentGaps: z.array(z.string()),
  topicsToAvoid: z.array(z.string()),
});

export class SynthesizeClusterPlanStep extends BaseStep<
  z.infer<typeof SynthesizeClusterPlanInputSchema>,
  z.infer<typeof SynthesizeClusterPlanOutputSchema>
> {
  readonly name = "synthesize-cluster-plan";
  readonly inputSchema = SynthesizeClusterPlanInputSchema;
  readonly outputSchema = SynthesizeClusterPlanOutputSchema;

  override estimatedCostEur(_input: z.infer<typeof SynthesizeClusterPlanInputSchema>): number {
    return 0.25;
  }

  async execute(
    input: z.infer<typeof SynthesizeClusterPlanInputSchema>,
    ctx: StepContext
  ): Promise<z.infer<typeof SynthesizeClusterPlanOutputSchema>> {
    const prompt = await buildSystemPrompt({
      skills: ["ai-seo", "content-strategy"],
      projectIdOrSlug: input.projectSlug,
      stepInstructions: `
Produce a final cluster plan report for a content site.

The clusters have been validated with real DataForSEO search volume data and expanded with
satellite keywords. Your job: write a strategy report AND structure the final cluster data.

Report structure (use as reportMd):

# Cluster Plan: <project name from context>

## Overview
<3-4 sentences: how many clusters, which pillars are covered, overall content opportunity>

## Recommended Clusters
For each cluster write:
### Cluster N: <name>
<2-3 sentences: why this cluster is a strong first mover, what gap it fills, expected difficulty>

## Priority Order
<Rank top 5 clusters by opportunity: high search volume × low difficulty × strong gap fit>

## Content Strategy Notes
<2-3 observations about cross-cluster synergies, pillar balance, or coverage gaps worth noting>

Also produce the structured clusters array — machine-readable output Marcel edits.
Each cluster entry:
- status: always "proposed" (Marcel changes to "approved" or "rejected" before phase 4)
- cornerstone_search_volume: from validated DataForSEO data (null if unknown)
- cornerstone_difficulty: from validated DataForSEO data (null if unknown)
- satellite_keywords: up to 10, from relatedKeywords expansion

Output strict JSON:
{
  "reportMd": "...",
  "clusters": [{
    "name": "...",
    "pillar": "...",
    "status": "proposed",
    "cornerstone_keyword": "...",
    "cornerstone_search_volume": 480,
    "cornerstone_difficulty": 32,
    "satellite_keywords": [{ "keyword": "...", "search_volume": 110, "difficulty": null }]
  }]
}`,
    });

    const clusterSummary = input.expandedClusters
      .map((c) =>
        [
          `Cluster: ${c.name} (pillar: ${c.pillar})`,
          `  Cornerstone keyword: "${c.cornerstone_keyword}"`,
          `  Search volume: ${c.search_volume ?? "unknown"}`,
          `  Keyword difficulty: ${c.keyword_difficulty ?? "unknown"}`,
          `  Satellites (${c.satellite_keywords.length}):`,
          ...c.satellite_keywords.map(
            (s) => `    - "${s.keyword}" (vol: ${s.search_volume ?? "?"})`
          ),
        ].join("\n")
      )
      .join("\n\n");

    const userMsg = [
      "# Validated Clusters with Satellite Keywords",
      "",
      clusterSummary,
      "",
      "---",
      "",
      "Content gaps to address:",
      ...input.contentGaps.map((g) => `- ${g}`),
      "",
      "Topics to avoid:",
      ...input.topicsToAvoid.map((t) => `- ${t}`),
    ].join("\n");

    const result = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: COST_OPS.COLD_START_CLUSTER_SYNTHESIS,
      model: "claude-sonnet-4-6",
      systemPrefix: prompt.cacheablePrefix,
      systemSuffix: prompt.variableSuffix,
      userMessage: userMsg,
      maxTokens: 8000,
      jsonMode: true,
      estimatedCostEur: this.estimatedCostEur(input),
    });

    return SynthesizeClusterPlanOutputSchema.parse(result.json);
  }
}
