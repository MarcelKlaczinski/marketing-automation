import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { anthropic } from "@marketing-auto/adapter-anthropic";
import { buildSystemPrompt } from "../../prompts/builder.ts";

// ─── Shared schemas ───────────────────────────────────────────────────────────

export const ApprovedClusterSchema = z.object({
  name: z.string(),
  pillar: z.string(),
  status: z.enum(["proposed", "approved", "rejected"]),
  cornerstone_keyword: z.string(),
  cornerstone_search_volume: z.number().nullable(),
  cornerstone_difficulty: z.number().nullable(),
  satellite_keywords: z.array(z.object({
    keyword: z.string(),
    search_volume: z.number().nullable(),
    difficulty: z.number().nullable(),
  })),
});

export type ApprovedCluster = z.infer<typeof ApprovedClusterSchema>;

export const CornerstoneSpecSchema = z.object({
  cluster: z.string(),
  cornerstone_keyword: z.string(),
  proposed_title: z.string(),
  proposed_slug: z.string(),
  meta_description: z.string().max(160),
  estimated_word_count: z.number().int().min(500),
  h2_outline: z.array(z.string()).min(3).max(12),
  status: z.literal("proposed"),
});

export type CornerstoneSpec = z.infer<typeof CornerstoneSpecSchema>;

// ─── Step: Generate cornerstone specs (Anthropic) ────────────────────────────

const GenerateCornerstoneSpecsOutputSchema = z.object({
  cornerstones: z.array(CornerstoneSpecSchema).min(1),
});

type GenerateCornerstoneSpecsOutput = z.infer<typeof GenerateCornerstoneSpecsOutputSchema>;

export class GenerateCornerstoneSpecsStep extends BaseStep<
  { projectSlug: string; approvedClusters: ApprovedCluster[] },
  GenerateCornerstoneSpecsOutput
> {
  readonly name = "generate-cornerstone-specs";
  readonly inputSchema = z.object({
    projectSlug: z.string(),
    approvedClusters: z.array(ApprovedClusterSchema).min(1),
  });
  readonly outputSchema = GenerateCornerstoneSpecsOutputSchema;

  override estimatedCostEur(input: { approvedClusters: ApprovedCluster[] }): number {
    // ~0.08 EUR per cluster for Sonnet with cached prefix
    return input.approvedClusters.length * 0.08;
  }

  async execute(
    input: { projectSlug: string; approvedClusters: ApprovedCluster[] },
    ctx: StepContext,
  ): Promise<GenerateCornerstoneSpecsOutput> {
    const prompt = await buildSystemPrompt({
      skills: ["copywriting", "content-strategy", "ai-seo"],
      projectIdOrSlug: input.projectSlug,
      stepInstructions: `
You are producing cornerstone article specifications for a content site during tenant onboarding.

For EACH cluster provided, produce one cornerstone article spec with:
- proposed_title: A compelling, keyword-rich H1 title in the site's language (German for KI-Wissensraum). Max 65 characters.
- proposed_slug: URL-safe slug derived from the title. Lowercase, hyphens only, no umlauts (ü→ue, ä→ae, ö→oe, ß→ss).
- meta_description: SEO meta description, 120-155 characters, includes the cornerstone keyword naturally.
- estimated_word_count: Realistic target word count for a best-in-class article on this topic (1500-5000).
- h2_outline: 3-12 H2 section headings that form a logical, comprehensive article outline. Each heading should
  be specific and informative (not generic like "Introduction" or "Conclusion").
- status: always "proposed"

Rules:
- The title must target the cornerstone_keyword from the cluster
- Titles and headings must match the project's language and brand voice
- Outlines should reflect topical authority: cover the topic end-to-end, not just surface level
- Word counts should be generous for competitive keywords (high volume → longer article)
- Slugs must be clean ASCII: no spaces, no special chars, no trailing hyphens

Output strict JSON: { cornerstones: [...] }
Each element: { cluster, cornerstone_keyword, proposed_title, proposed_slug, meta_description, estimated_word_count, h2_outline, status }
`,
    });

    const clustersSummary = input.approvedClusters
      .map((c, i) => [
        `## Cluster ${i + 1}: ${c.name}`,
        `- cornerstone_keyword: "${c.cornerstone_keyword}"`,
        `- pillar: "${c.pillar}"`,
        `- cornerstone_search_volume: ${c.cornerstone_search_volume ?? "unknown"}`,
        `- cornerstone_difficulty: ${c.cornerstone_difficulty ?? "unknown"}`,
        `- satellite_keywords: ${c.satellite_keywords.map((s) => `"${s.keyword}"`).join(", ")}`,
      ].join("\n"))
      .join("\n\n");

    const result = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: "cornerstone-specs-generation",
      model: "claude-sonnet-4-6",
      systemPrefix: prompt.cacheablePrefix,
      systemSuffix: prompt.variableSuffix,
      userMessage: `Produce cornerstone specs for the following ${input.approvedClusters.length} approved cluster(s):\n\n${clustersSummary}`,
      maxTokens: 8000,
      jsonMode: true,
      estimatedCostEur: this.estimatedCostEur(input),
    });

    return GenerateCornerstoneSpecsOutputSchema.parse(result.json);
  }
}
