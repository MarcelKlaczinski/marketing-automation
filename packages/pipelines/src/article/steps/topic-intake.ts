import { articles, clusters, db, projects } from "@marketing-auto/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { ArticlePipelineError } from "../types.ts";

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
});

const OutputSchema = z.object({
  cornerstoneKeyword: z.string(),
  clusterName: z.string(),
  clusterPillar: z.string(),
  satelliteKeywords: z.array(z.string()),
  projectSlug: z.string(),
  approvalMode: z.enum(["manual", "auto"]),
  locale: z.enum(["de", "en"]),
  translationKey: z.string().nullable(),
});

export class TopicIntakeStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "topic-intake";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number {
    return 0;
  }

  async execute(input: z.infer<typeof InputSchema>, _ctx: StepContext) {
    const [article] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, input.articleId))
      .limit(1);
    if (!article)
      throw new ArticlePipelineError(`Article ${input.articleId} not found`, "topic_intake");

    if (!article.clusterId) {
      throw new ArticlePipelineError(
        "Article has no clusterId — cannot proceed without cluster context",
        "topic_intake"
      );
    }

    const [cluster] = await db
      .select()
      .from(clusters)
      .where(eq(clusters.id, article.clusterId))
      .limit(1);
    if (!cluster)
      throw new ArticlePipelineError(`Cluster ${article.clusterId} not found`, "topic_intake");

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    if (!project)
      throw new ArticlePipelineError(`Project ${input.projectId} not found`, "topic_intake");

    const clusterData = cluster.satelliteKeywords ?? [];
    const matchingEntry = clusterData.find(
      (e) => e.cornerstoneKeyword === article.cornerstoneKeyword
    );
    const satelliteKeywords = matchingEntry?.keywords.map((k) => k.keyword) ?? [];

    if (!article.cornerstoneKeyword)
      throw new ArticlePipelineError(
        `Article ${input.articleId} has no cornerstoneKeyword — cannot run pipeline`,
        "topic_intake"
      );

    // locale defaults to "de" for articles created before multi-language was introduced
    const locale = (article.locale as "de" | "en") ?? "de";

    return {
      cornerstoneKeyword: article.cornerstoneKeyword,
      clusterName: cluster.name,
      clusterPillar: cluster.pillar ?? "general",
      satelliteKeywords,
      projectSlug: project.slug,
      approvalMode: (article.approvalMode ?? "manual") as "manual" | "auto",
      locale,
      translationKey: article.translationKey ?? null,
    };
  }
}
