import { articles, db } from "@marketing-auto/db";
import { eq } from "drizzle-orm";
import { enqueuePipeline } from "../engine/queue.ts";

/**
 * Discriminated union — callers that already used the `.jobId` access on
 * the previous shape (always-enqueue) keep compiling; only paths that
 * pass-through to `RenderMdxStep` need to handle the new `skipped` branch
 * (which today is the HTTP route + the admin CLI). Internal afterComplete
 * callers (BlogPipeline, RefreshPipeline, TranslationPipeline) only ever
 * run on `source='generated'` rows, so they hit the `jobId` arm in
 * practice; the new arm is defense-in-depth in case a future generated-
 * workflow pipeline starts touching imported rows.
 *
 * Spec 004 / F3, 2026-05-24.
 */
export type EnqueueSchemaExtensionResult =
  | { jobId: string }
  | { skipped: "imported-article" };

export async function enqueueSchemaExtension(input: {
  articleId: string;
  projectId: string;
}): Promise<EnqueueSchemaExtensionResult> {
  const [article] = await db
    .select()
    .from(articles)
    .where(eq(articles.id, input.articleId))
    .limit(1);
  if (!article) throw new Error(`Article ${input.articleId} not found`);

  if (article.status !== "final_review" && article.status !== "schema_extending") {
    throw new Error(
      `Article status "${article.status}", expected "final_review" or "schema_extending"`
    );
  }

  // Spec 004 / F3: imported articles do not go through SchemaExtensionPipeline.
  // Rich-type schemas for imported rows come from the Astro source MDX itself
  // (Branch-B design: per-field `howTo:` / `faqs:` frontmatter, not pre-baked
  // JSON-LD). Writing `schema_json_ld` against an imported row would arm the
  // BD2 footgun on the sync path (see schemaJsonLd doc-comment in
  // packages/db/src/schema/content.ts).
  if (article.source === "imported") {
    return { skipped: "imported-article" };
  }

  await db
    .update(articles)
    .set({
      status: "schema_extending",
      updatedAt: new Date(),
    })
    .where(eq(articles.id, input.articleId));

  const { jobId } = await enqueuePipeline({
    pipelineName: "article:schema-extension",
    projectId: input.projectId,
    input: { articleId: input.articleId, projectId: input.projectId },
    jobOptions: { jobId: `schema-extension-${input.articleId}` },
  });

  return { jobId };
}
