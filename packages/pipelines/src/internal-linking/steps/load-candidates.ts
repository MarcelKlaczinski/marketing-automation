import { z } from "zod";
import { eq, and, ne, inArray } from "drizzle-orm";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { db, articles, projects } from "@marketing-auto/db";
import { InternalLinkingError } from "../types.ts";

const InputSchema = z.object({
  articleId: z.string().uuid(),
  clusterId: z.string().uuid(),
});

const CandidateSchema = z.object({
  slug: z.string(),
  title: z.string(),
  cornerstoneKeyword: z.string(),
  metaDescription: z.string(),
});

const OutputSchema = z.object({
  article: z.object({
    id: z.string().uuid(),
    slug: z.string(),
    title: z.string(),
    cornerstoneKeyword: z.string(),
    bodyMd: z.string(),
    projectSlug: z.string(),
  }),
  candidates: z.array(CandidateSchema),
  existingLinkSlugs: z.array(z.string()),
});

export class LoadCandidatesStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "load-candidates";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0; }

  async execute(input: z.infer<typeof InputSchema>, _ctx: StepContext) {
    const [article] = await db.select().from(articles).where(eq(articles.id, input.articleId)).limit(1);
    if (!article) throw new InternalLinkingError(`Article ${input.articleId} not found`, "load");
    if (!article.bodyMd) throw new InternalLinkingError(`Article has no body`, "load");

    const publishedStatuses: Array<"published" | "ready_to_publish"> = ["published", "ready_to_publish"];
    const others = await db
      .select({
        slug: articles.slug,
        title: articles.title,
        cornerstoneKeyword: articles.cornerstoneKeyword,
        metaDescription: articles.metaDescription,
      })
      .from(articles)
      .where(and(
        eq(articles.clusterId, input.clusterId),
        ne(articles.id, input.articleId),
        inArray(articles.status, publishedStatuses),
      ));

    // Detect existing internal links: [anchor text](/blog/<slug>)
    const linkRegex = /\]\(\/blog\/([a-z0-9-]+)(?:[#?][^)]*)?\)/g;
    const existingLinkSlugs: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = linkRegex.exec(article.bodyMd)) !== null) {
      if (m[1]) existingLinkSlugs.push(m[1]);
    }

    const [proj] = await db.select({ slug: projects.slug })
      .from(projects).where(eq(projects.id, article.projectId)).limit(1);

    return {
      article: {
        id: article.id,
        slug: article.slug,
        title: article.title ?? "",
        cornerstoneKeyword: article.cornerstoneKeyword,
        bodyMd: article.bodyMd,
        projectSlug: proj?.slug ?? "unknown",
      },
      candidates: others.map((o) => ({
        slug: o.slug,
        title: o.title ?? "",
        cornerstoneKeyword: o.cornerstoneKeyword,
        metaDescription: o.metaDescription ?? "",
      })),
      existingLinkSlugs: [...new Set(existingLinkSlugs)],
    };
  }
}
