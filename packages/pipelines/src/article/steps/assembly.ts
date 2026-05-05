import { z } from "zod";
import { eq } from "drizzle-orm";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { db, articles, projects } from "@marketing-auto/db";
import { ArticleOutlineSchema, ArticlePipelineError } from "../types.ts";

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
});

const OutputSchema = z.object({
  schemaJsonLd: z.record(z.unknown()),
});

export class AssemblyStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "assembly";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0; }

  async execute(input: z.infer<typeof InputSchema>, _ctx: StepContext) {
    const [article] = await db.select().from(articles).where(eq(articles.id, input.articleId)).limit(1);
    if (!article?.outline) throw new ArticlePipelineError(`Article missing outline`, "assembly");

    const [project] = await db.select().from(projects).where(eq(projects.id, input.projectId)).limit(1);
    if (!project) throw new ArticlePipelineError(`Project missing`, "assembly");

    const outline = ArticleOutlineSchema.parse(article.outline);
    const now = new Date().toISOString();

    // schema.org Article JSON-LD — Spec 21 (Astro adapter) injects this into <head>
    const schemaJsonLd: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": "Article",
      "headline": outline.title,
      "description": outline.metaDescription,
      "image": article.heroImagePublicUrl ?? undefined,
      "datePublished": now,
      "dateModified": now,
      "author": {
        "@type": "Organization",
        "name": project.name,
      },
      "publisher": {
        "@type": "Organization",
        "name": project.name,
      },
      "mainEntityOfPage": {
        "@type": "WebPage",
        // Spec 21 substitutes the real domain
        "@id": `https://${project.slug}.example.com/${outline.slug}`,
      },
    };

    return { schemaJsonLd };
  }
}
