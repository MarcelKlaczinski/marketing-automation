import { articles, db } from "@marketing-auto/db";
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

const InputSchema = z.object({
  projectId: z.string().uuid(),
});

const OutputSchema = z.object({
  totalPairs: z.number(),
  orphans: z.number(),
  unkeyed: z.number(),
});

export class LinkTranslationPairsStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "link-translation-pairs";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number {
    return 0;
  }

  async execute(input: z.infer<typeof InputSchema>, _ctx: StepContext) {
    const rows = await db
      .select({
        translationKey: articles.translationKey,
        count: sql<number>`count(*)::int`,
      })
      .from(articles)
      .where(and(eq(articles.projectId, input.projectId), eq(articles.source, "imported")))
      .groupBy(articles.translationKey);

    let totalPairs = 0;
    let orphans = 0;
    let unkeyed = 0;

    for (const r of rows) {
      if (!r.translationKey) {
        unkeyed += r.count;
      } else if (r.count >= 2) {
        totalPairs++;
      } else {
        orphans++;
      }
    }

    return { totalPairs, orphans, unkeyed };
  }
}
