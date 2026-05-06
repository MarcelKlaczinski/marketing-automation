import { z } from "zod";
import { eq } from "drizzle-orm";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { db, articles, projects, clusters } from "@marketing-auto/db";
import { SchemaExtensionError } from "../types.ts";

const InputSchema = z.object({
  articleId: z.string().uuid(),
});

const OutputSchema = z.object({
  article: z.object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    slug: z.string(),
    title: z.string(),
    metaDescription: z.string(),
    bodyMd: z.string(),
    schemaJsonLd: z.array(z.record(z.unknown())),
    heroImagePublicUrl: z.string().url(),
  }),
  project: z.object({
    slug: z.string(),
    name: z.string(),
    domain: z.string(),
  }),
  cluster: z.object({
    name: z.string(),
    pillar: z.string(),
  }).nullable(),
});

export class LoadArticleStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "load-article";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0; }

  async execute(input: z.infer<typeof InputSchema>, _ctx: StepContext) {
    const [article] = await db.select().from(articles).where(eq(articles.id, input.articleId)).limit(1);
    if (!article) throw new SchemaExtensionError(`Article ${input.articleId} not found`, "load");

    if (article.status !== "schema_extending" && article.status !== "final_review") {
      throw new SchemaExtensionError(
        `Article status "${article.status}", expected "schema_extending" or "final_review"`,
        "load",
      );
    }

    const [project] = await db.select().from(projects).where(eq(projects.id, article.projectId)).limit(1);
    if (!project) throw new SchemaExtensionError("Project not found", "load");

    let cluster: { name: string; pillar: string } | null = null;
    if (article.clusterId) {
      const [c] = await db.select().from(clusters).where(eq(clusters.id, article.clusterId)).limit(1);
      if (c) cluster = { name: c.name, pillar: c.pillar ?? "general" };
    }

    return {
      article: {
        id: article.id,
        projectId: article.projectId,
        slug: article.slug,
        title: article.title!,
        metaDescription: article.metaDescription ?? "",
        bodyMd: article.bodyMd!,
        schemaJsonLd: (article.schemaJsonLd as Array<Record<string, unknown>>) ?? [],
        heroImagePublicUrl: article.heroImagePublicUrl!,
      },
      project: {
        slug: project.slug,
        name: project.name,
        domain: project.domain ?? `${project.slug}.example.com`,
      },
      cluster,
    };
  }
}
