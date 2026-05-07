import { enqueueArticleSync } from "@marketing-auto/adapter-astro-sync";
import { articles, db } from "@marketing-auto/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  newBodyMd: z.string(),
  linksAdded: z.number(),
  appliedTargets: z.array(z.string()),
  triggerResync: z.boolean(),
});

const OutputSchema = z.object({
  articleId: z.string().uuid(),
  linksAdded: z.number(),
  resyncJobId: z.string().nullable(),
});

export class PersistAndQueueResyncStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "persist-and-resync";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number {
    return 0;
  }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const now = new Date();

    if (input.linksAdded === 0) {
      await db
        .update(articles)
        .set({
          internalLinksUpdatedAt: now,
        })
        .where(eq(articles.id, input.articleId));
      return { articleId: input.articleId, linksAdded: 0, resyncJobId: null };
    }

    await db
      .update(articles)
      .set({
        bodyMd: input.newBodyMd,
        internalLinksUpdatedAt: now,
        internalLinksAdded: input.linksAdded,
        internalLinkTargets: input.appliedTargets,
        updatedAt: now,
      })
      .where(eq(articles.id, input.articleId));

    let resyncJobId: string | null = null;
    if (input.triggerResync) {
      try {
        const [a] = await db
          .select({ status: articles.status })
          .from(articles)
          .where(eq(articles.id, input.articleId))
          .limit(1);
        if (a && (a.status === "ready_to_publish" || a.status === "published")) {
          await db
            .update(articles)
            .set({ status: "ready_to_publish" })
            .where(eq(articles.id, input.articleId));
          const result = await enqueueArticleSync({
            articleId: input.articleId,
            projectId: input.projectId,
          });
          resyncJobId = result.jobId;
        }
      } catch (e) {
        // Re-sync failure must not fail the link update
        ctx.log.error(
          { articleId: input.articleId, err: e },
          "Failed to enqueue re-sync after link update"
        );
      }
    }

    return {
      articleId: input.articleId,
      linksAdded: input.linksAdded,
      resyncJobId,
    };
  }
}
