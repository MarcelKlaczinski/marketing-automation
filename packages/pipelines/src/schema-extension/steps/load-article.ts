import { articles, clusters, db, projects } from "@marketing-auto/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { SchemaExtensionError } from "../types.ts";

const InputSchema = z.object({
  articleId: z.string().uuid(),
});

const OutputSchema = z.object({
  article: z.object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    slug: z.string(),
    locale: z.string().nullable(),
    title: z.string(),
    metaDescription: z.string(),
    bodyMd: z.string(),
    schemaJsonLd: z.array(z.record(z.unknown())),
    heroImagePublicUrl: z.string().nullable(), // not validated as URL — localhost URLs are valid in dev
    heroImageR2Key: z.string().nullable(),
    intentType: z.string().nullable(),
    frontmatterExtras: z.record(z.unknown()).nullable(),
    author: z.string().nullable(),
  }),
  project: z.object({
    slug: z.string(),
    name: z.string(),
    domain: z.string(),
  }),
  cluster: z
    .object({
      name: z.string(),
      pillar: z.string(),
    })
    .nullable(),
});

export class LoadArticleStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "load-article";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number {
    return 0;
  }

  async execute(input: z.infer<typeof InputSchema>, _ctx: StepContext): Promise<z.infer<typeof OutputSchema>> {
    const [article] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, input.articleId))
      .limit(1);
    if (!article) throw new SchemaExtensionError(`Article ${input.articleId} not found`, "load");

    if (article.status !== "schema_extending" && article.status !== "final_review") {
      throw new SchemaExtensionError(
        `Article status "${article.status}", expected "schema_extending" or "final_review"`,
        "load"
      );
    }

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, article.projectId))
      .limit(1);
    if (!project) throw new SchemaExtensionError("Project not found", "load");

    let cluster: { name: string; pillar: string } | null = null;
    if (article.clusterId) {
      const [c] = await db
        .select()
        .from(clusters)
        .where(eq(clusters.id, article.clusterId))
        .limit(1);
      if (c) cluster = { name: c.name, pillar: c.pillar ?? "general" };
    }

    return {
      article: {
        id: article.id,
        projectId: article.projectId,
        slug: article.slug,
        locale: article.locale ?? null,
        title: article.title!,
        metaDescription: article.metaDescription ?? "",
        bodyMd: article.bodyMd!,
        schemaJsonLd: (article.schemaJsonLd as Array<Record<string, unknown>>) ?? [],
        heroImagePublicUrl: article.heroImagePublicUrl || null, // || coerces empty string to null
        heroImageR2Key: article.heroImageR2Key || null,
        intentType: article.intentType ?? null,
        frontmatterExtras: (article.frontmatterExtras as Record<string, unknown> | null) ?? null,
        author: article.author ?? null,
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
