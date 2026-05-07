import { articles, db, projects } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { Pipeline } from "../../engine/pipeline.ts";
import {
  ApprovedClusterSchema,
  CornerstoneSpecSchema,
  GenerateCornerstoneSpecsStep,
} from "./steps.ts";

const log = createLogger("pipelines:cornerstone-list");

const InputSchema = z.object({
  projectSlug: z.string(),
  approvedClusters: z.array(ApprovedClusterSchema).min(1),
  projectId: z.string().optional(),
});

const OutputSchema = z.object({
  cornerstones: z.array(CornerstoneSpecSchema).min(1),
});

export class CornerstoneListPipeline extends Pipeline<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "cold-start:cornerstone-list";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;
  readonly steps = [new GenerateCornerstoneSpecsStep()] as const;

  override async afterComplete(
    output: z.infer<typeof OutputSchema>,
    input: z.infer<typeof InputSchema>
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
      log.warn({ projectSlug: input.projectSlug }, "Project not found — skipping article writes");
      return;
    }

    for (const cs of output.cornerstones) {
      try {
        await db
          .insert(articles)
          .values({
            projectId,
            slug: cs.proposed_slug,
            cornerstoneKeyword: cs.cornerstone_keyword,
            title: cs.proposed_title,
            metaDescription: cs.meta_description,
            status: "proposed",
          })
          .onConflictDoNothing();
      } catch (err) {
        log.warn(
          { err, slug: cs.proposed_slug },
          "Failed to insert cornerstone article — may already exist"
        );
      }
    }

    log.info(
      { projectSlug: input.projectSlug, count: output.cornerstones.length },
      "Cornerstone articles written"
    );
  }
}

export { ApprovedClusterSchema, CornerstoneSpecSchema };
