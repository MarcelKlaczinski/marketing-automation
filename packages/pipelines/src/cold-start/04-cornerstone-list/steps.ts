import { anthropic } from "@marketing-auto/adapter-anthropic";
import { COST_OPS } from "@marketing-auto/core/cost";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { buildSystemPrompt } from "../../prompts/builder.ts";
import { resolvePrompt } from "../../engine/prompt-resolver.ts";
import { generateTranslationKey } from "../shared/translation-key.ts";

// ─── Shared schemas ───────────────────────────────────────────────────────────

export const ApprovedClusterSchema = z.object({
  name: z.string(),
  pillar: z.string(),
  status: z.enum(["proposed", "approved", "rejected"]),
  cornerstone_keyword: z.string(),
  cornerstone_search_volume: z.number().nullable(),
  cornerstone_difficulty: z.number().nullable(),
  satellite_keywords: z.array(
    z.object({
      keyword: z.string(),
      search_volume: z.number().nullable(),
      difficulty: z.number().nullable(),
    })
  ),
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

// Extended schema used in the multi-locale pipeline output
export const LocaleAwareCornerstoneSpecSchema = CornerstoneSpecSchema.extend({
  locale: z.enum(["de", "en"]),
  cluster_id: z.string(),
  translation_key: z.string(),
});

export type LocaleAwareCornerstoneSpec = z.infer<typeof LocaleAwareCornerstoneSpecSchema>;

// ─── Step: Generate cornerstone specs (DE+EN parallel) ───────────────────────

const GenerateCornerstoneSpecsOutputSchema = z.object({
  specs: z.array(LocaleAwareCornerstoneSpecSchema).min(1),
});

type GenerateCornerstoneSpecsOutput = z.infer<typeof GenerateCornerstoneSpecsOutputSchema>;

export class GenerateCornerstoneSpecsStep extends BaseStep<
  { projectSlug: string; approvedClusters: ApprovedCluster[]; locales: ("de" | "en")[] },
  GenerateCornerstoneSpecsOutput
> {
  readonly name = "generate-cornerstone-specs";
  readonly inputSchema = z.object({
    projectSlug: z.string(),
    approvedClusters: z.array(ApprovedClusterSchema).min(1),
    locales: z.array(z.enum(["de", "en"])).min(1),
  });
  readonly outputSchema = GenerateCornerstoneSpecsOutputSchema;

  override estimatedCostEur(input: {
    approvedClusters: ApprovedCluster[];
    locales: ("de" | "en")[];
  }): number {
    return input.approvedClusters.length * input.locales.length * 0.08;
  }

  async execute(
    input: { projectSlug: string; approvedClusters: ApprovedCluster[]; locales: ("de" | "en")[] },
    ctx: StepContext
  ): Promise<GenerateCornerstoneSpecsOutput> {
    const allSpecs: LocaleAwareCornerstoneSpec[] = [];

    for (const cluster of input.approvedClusters) {
      // Generate one spec per locale in parallel for this cluster
      const localeResults = await Promise.all(
        input.locales.map((locale) =>
          this.generateForLocale(input.projectSlug, cluster, locale, ctx)
        )
      );

      // translationKey is shared across all locales for the same cluster.
      // cluster_id is a placeholder ("tmp") when the cluster UUID isn't yet known;
      // afterComplete resolves it from the DB using the cornerstone_keyword.
      const translationKey = generateTranslationKey({
        clusterId: "tmp",
        cornerstoneKeyword: cluster.cornerstone_keyword,
      });

      for (const r of localeResults) {
        allSpecs.push({
          ...r.spec,
          locale: r.locale,
          cluster_id: "tmp",
          translation_key: translationKey,
        });
      }
    }

    return { specs: allSpecs };
  }

  private async generateForLocale(
    projectSlug: string,
    cluster: ApprovedCluster,
    locale: "de" | "en",
    ctx: StepContext
  ): Promise<{ locale: "de" | "en"; spec: CornerstoneSpec }> {
    const localeInstructions =
      locale === "de"
        ? `Output is for the **German market (de-DE)**. Title, meta, slug, and outline must be in German. Use German SEO keyword conventions (compound nouns, longer phrases). German umlauts → ae/oe/ue/ss in slugs.`
        : `Output is for the **global English market (en-US)**. Title, meta, slug, and outline must be in English. Use English SEO keyword conventions (shorter, more direct).`;

    const prompt = await buildSystemPrompt({
      skills: ["copywriting", "content-strategy", "ai-seo"],
      projectIdOrSlug: projectSlug,
      stepInstructions: `
You are producing a cornerstone article specification for ONE cluster, in ONE locale.

${localeInstructions}

Cluster:
- Name: ${cluster.name}
- Pillar: ${cluster.pillar}
- Cornerstone keyword: ${cluster.cornerstone_keyword}
- Search volume: ${cluster.cornerstone_search_volume ?? "unknown"}
- Difficulty: ${cluster.cornerstone_difficulty ?? "unknown"}
- Satellite keywords: ${cluster.satellite_keywords.map((s) => s.keyword).join(", ")}

Produce ONE locale-native spec — not a translation of another locale, but written fresh for the target market.

Rules:
- proposed_title: Compelling, keyword-rich H1. Max 65 characters.
- proposed_slug: URL-safe, lowercase, hyphens only, no umlauts (ü→ue, ä→ae, ö→oe, ß→ss).
- meta_description: 120-155 characters, includes the cornerstone keyword naturally.
- estimated_word_count: 1500-5000 — generous for competitive keywords.
- h2_outline: 3-12 H2 headings forming a logical, comprehensive article outline. Each specific and informative.
- cluster: Use the cluster name exactly as given above.
- cornerstone_keyword: Use the locale-native keyword form (e.g. DE: "KI-Bildgenerierung", EN: "AI image generation").
- status: always "proposed".

Output strict JSON matching: { cluster, cornerstone_keyword, proposed_title, proposed_slug, meta_description, estimated_word_count, h2_outline, status }
      `.trim(),
    });

    // Spec 62.0a Section 4.4: edit-prompt resume override replaces variableSuffix.
    const systemSuffix = await resolvePrompt(ctx, this.name, () => prompt.variableSuffix);
    const result = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: COST_OPS.COLD_START_CORNERSTONE_SPECS,
      model: "claude-sonnet-4-6",
      systemPrefix: prompt.cacheablePrefix,
      systemSuffix,
      userMessage: `Produce a ${locale.toUpperCase()} cornerstone spec for cluster "${cluster.name}" with cornerstone keyword "${cluster.cornerstone_keyword}".`,
      maxTokens: 2000,
      jsonMode: true,
      estimatedCostEur: 0.08,
    });

    const spec = CornerstoneSpecSchema.parse(result.json);
    return { locale, spec };
  }
}
