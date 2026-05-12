import { cornerstoneSpecs, db, projects, clusters } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { Pipeline } from "../../engine/pipeline.ts";
import { generateTranslationKey } from "../shared/translation-key.ts";
import {
  ApprovedClusterSchema,
  CornerstoneSpecSchema,
  GenerateCornerstoneSpecsStep,
  LocaleAwareCornerstoneSpecSchema,
} from "./steps.ts";

export { LocaleAwareCornerstoneSpecSchema };

const log = createLogger("pipelines:cornerstone-list");

type PipelineInput = {
  projectSlug: string;
  approvedClusters: z.infer<typeof ApprovedClusterSchema>[];
  projectId?: string;
  locales: ("de" | "en")[];
};

// Cast needed: .default() makes _input's locales `("de"|"en")[]|undefined` but we
// always provide a default at call-site, so the output type is always `("de"|"en")[]`.
const InputSchema = z.object({
  projectSlug: z.string(),
  approvedClusters: z.array(ApprovedClusterSchema).min(1),
  projectId: z.string().optional(),
  locales: z.array(z.enum(["de", "en"])).default(["de", "en"]),
}) as z.ZodType<PipelineInput>;

const OutputSchema = z.object({
  specs: z.array(LocaleAwareCornerstoneSpecSchema).min(1),
});

export class CornerstoneListPipeline extends Pipeline<
  PipelineInput,
  z.infer<typeof OutputSchema>
> {
  readonly name = "cold-start:cornerstone-list";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;
  readonly steps = [new GenerateCornerstoneSpecsStep()] as const;

  override bridge(
    _fromStep: { name: string },
    _toStep: { name: string },
    _output: unknown,
    pipelineInput: PipelineInput
  ): unknown {
    // Single step — bridge maps pipeline input to step input
    return {
      projectSlug: pipelineInput.projectSlug,
      approvedClusters: pipelineInput.approvedClusters,
      locales: pipelineInput.locales,
    };
  }

  override async afterComplete(
    output: z.infer<typeof OutputSchema>,
    input: PipelineInput
  ): Promise<void> {
    let projectId = input.projectId;
    if (!projectId) {
      const [proj] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.slug, input.projectSlug))
        .limit(1);
      projectId = proj?.id;
    }
    if (!projectId) {
      log.warn({ projectSlug: input.projectSlug }, "Project not found — skipping cornerstone_specs writes");
      return;
    }

    // Load all clusters for the project once, then match by cornerstoneKeywords array in JS.
    // The DB column is `cornerstone_keywords: jsonb string[]`; we avoid JSONB SQL by loading
    // all clusters (cold-start projects have <100 clusters) and matching in application code.
    const allClusters = await db
      .select({ id: clusters.id, cornerstoneKeywords: clusters.cornerstoneKeywords })
      .from(clusters)
      .where(eq(clusters.projectId, projectId));

    // Build keyword → cluster mapping from the loaded clusters
    const keywordToCluster = new Map<string, { id: string }>();
    for (const cluster of allClusters) {
      const keywords = (cluster.cornerstoneKeywords as string[]) ?? [];
      for (const kw of keywords) {
        keywordToCluster.set(kw, { id: cluster.id });
      }
    }

    let inserted = 0;

    // Group specs by cornerstone_keyword so we can compute one translationKey per cluster
    const specsByKeyword = new Map<string, typeof output.specs>();
    for (const spec of output.specs) {
      const arr = specsByKeyword.get(spec.cornerstone_keyword) ?? [];
      arr.push(spec);
      specsByKeyword.set(spec.cornerstone_keyword, arr);
    }

    for (const [keyword, specsForKeyword] of specsByKeyword) {
      const cluster = keywordToCluster.get(keyword);
      if (!cluster) {
        log.warn(
          { keyword, projectId },
          "No cluster found matching cornerstone_keyword — skipping"
        );
        continue;
      }

      // Compute the real translationKey using the actual cluster UUID
      const translationKey = generateTranslationKey({
        clusterId: cluster.id,
        cornerstoneKeyword: keyword,
      });

      for (const spec of specsForKeyword) {
        try {
          await db
            .insert(cornerstoneSpecs)
            .values({
              projectId,
              clusterId: cluster.id,
              locale: spec.locale,
              translationKey,
              cornerstoneKeyword: spec.cornerstone_keyword,
              proposedTitle: spec.proposed_title,
              proposedSlug: spec.proposed_slug,
              metaDescription: spec.meta_description,
              estimatedWordCount: spec.estimated_word_count,
              h2Outline: spec.h2_outline,
              status: "proposed",
            })
            .onConflictDoNothing(); // (clusterId, locale) unique — idempotent on retry
          inserted++;
        } catch (err) {
          log.warn(
            { err, slug: spec.proposed_slug, locale: spec.locale, keyword },
            "Failed to insert cornerstone spec"
          );
        }
      }
    }

    log.info(
      { projectSlug: input.projectSlug, inserted, total: output.specs.length },
      "Cornerstone specs written to DB"
    );
  }
}

export { ApprovedClusterSchema, CornerstoneSpecSchema };
