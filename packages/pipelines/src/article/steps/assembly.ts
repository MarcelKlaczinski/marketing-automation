import { articles, db, projects } from "@marketing-auto/db";
import { and, eq } from "@marketing-auto/db";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { buildCanonicalUrl } from "../lib/canonical-url.ts";
import { bcp47Tag, type Locale } from "../translation/lib/locale-strings.ts";
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

  override estimatedCostEur(): number {
    return 0;
  }

  async execute(input: z.infer<typeof InputSchema>, _ctx: StepContext) {
    const [article] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, input.articleId))
      .limit(1);
    if (!article?.outline) throw new ArticlePipelineError("Article missing outline", "assembly");

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    if (!project) throw new ArticlePipelineError("Project missing", "assembly");

    const outline = ArticleOutlineSchema.parse(article.outline);
    const now = new Date().toISOString();

    // Spec 64.3 — collection-aware canonical URL via shared helper.
    // Locale defaults to "de" when the article has no locale set yet (pre-translation stub).
    const articleLocale = (article.locale ?? "de") as Locale;
    const articleUrl = buildCanonicalUrl({
      projectDomain: project.domain ?? `${project.slug}.example.com`,
      locale: articleLocale,
      collection: article.collection,
      slug: outline.slug,
    });

    // Resolve author schema — prefer Person (named author) over Organization
    let authorSchema: Record<string, unknown>;
    if (article.author) {
      const [authorArticle] = await db
        .select({ title: articles.title })
        .from(articles)
        .where(and(
          eq(articles.projectId, input.projectId),
          eq(articles.collection, "authors"),
          eq(articles.slug, article.author),
        ))
        .limit(1);
      authorSchema = { "@type": "Person", name: authorArticle?.title ?? article.author };
    } else {
      authorSchema = { "@type": "Organization", name: project.name };
    }

    // schema.org Article JSON-LD — Spec 21 (Astro adapter) injects this into <head>
    const schemaJsonLd: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: outline.title,
      description: outline.metaDescription,
      image: article.heroImagePublicUrl ?? undefined,
      // Spec 64.3 — explicit BCP-47 locale tag for SEO signal-quality.
      inLanguage: bcp47Tag(articleLocale),
      datePublished: now,
      dateModified: now,
      author: authorSchema,
      publisher: {
        "@type": "Organization",
        name: project.name,
      },
      mainEntityOfPage: {
        "@type": "WebPage",
        "@id": articleUrl,
      },
    };

    return { schemaJsonLd };
  }
}
