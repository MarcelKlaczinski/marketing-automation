import { articles, db } from "@marketing-auto/db";
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { createLogger } from "@marketing-auto/shared";
import { z } from "zod";

const log = createLogger("astro-import:upsert");

const InputSchema = z.object({
  projectId: z.string().uuid(),
  parsed: z.array(z.record(z.unknown())),
});

const OutputSchema = z.object({
  inserted: z.number(),
  updated: z.number(),
  failed: z.number(),
});

export class UpsertArticlesStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "upsert-articles";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number {
    return 0;
  }

  async execute(input: z.infer<typeof InputSchema>, _ctx: StepContext) {
    let inserted = 0;
    let updated = 0;
    let failed = 0;
    const now = new Date();

    for (const p of input.parsed) {
      const typed = p.typed as Record<string, unknown>;
      const slug = typed.slug as string;
      const locale = (typed.locale as string | null) ?? "de";
      const collection = (p.collection as string) ?? "unknown";

      try {
        const result = await db
          .insert(articles)
          .values({
            projectId: input.projectId,
            source: "imported",
            collection,
            locale,
            slug,
            cornerstoneKeyword: null,
            title: (typed.title as string | null) ?? null,
            metaDescription: (typed.description as string | null) ?? null,
            translationKey: (typed.translationKey as string | null) ?? null,
            filePath: p.filePath as string,
            gitSha: p.gitSha as string,
            publishedAt: (typed.publishedAt as Date | null) ?? null,
            frontmatterUpdatedAt: (typed.updatedAt as Date | null) ?? null,
            author: (typed.author as string | null) ?? null,
            category: (typed.category as string | null) ?? null,
            subcategory: (typed.subcategory as string | null) ?? null,
            tags: (typed.tags as string[] | null) ?? [],
            noindex: (typed.noindex as boolean | null) ?? false,
            // Spec 49a: cluster metadata
            clusterKey: (typed.clusterKey as string | null) ?? null,
            clusterRole: (typed.clusterRole as "hub" | "spoke" | null) ?? null,
            intentType: (typed.intentType as string | null) ?? null,
            bodyMd: p.body as string,
            frontmatterExtras: p.extras as Record<string, unknown>,
            importMetadata: p.metadata as Record<string, unknown>,
            importedAt: now,
            lastImportedAt: now,
            status: "published",
          })
          .onConflictDoUpdate({
            target: [
              articles.projectId,
              articles.source,
              articles.collection,
              articles.locale,
              articles.slug,
            ],
            set: {
              title: (typed.title as string | null) ?? null,
              metaDescription: (typed.description as string | null) ?? null,
              translationKey: (typed.translationKey as string | null) ?? null,
              filePath: p.filePath as string,
              gitSha: p.gitSha as string,
              publishedAt: (typed.publishedAt as Date | null) ?? null,
              frontmatterUpdatedAt: (typed.updatedAt as Date | null) ?? null,
              author: (typed.author as string | null) ?? null,
              category: (typed.category as string | null) ?? null,
              subcategory: (typed.subcategory as string | null) ?? null,
              tags: (typed.tags as string[] | null) ?? [],
              noindex: (typed.noindex as boolean | null) ?? false,
              // Spec 49a: cluster metadata
              clusterKey: (typed.clusterKey as string | null) ?? null,
              clusterRole: (typed.clusterRole as "hub" | "spoke" | null) ?? null,
              intentType: (typed.intentType as string | null) ?? null,
              bodyMd: p.body as string,
              frontmatterExtras: p.extras as Record<string, unknown>,
              importMetadata: p.metadata as Record<string, unknown>,
              lastImportedAt: now,
              updatedAt: now,
            },
          })
          .returning({ id: articles.id, importedAt: articles.importedAt });

        const row = result[0];
        if (row?.importedAt && Math.abs(row.importedAt.getTime() - now.getTime()) < 1000) {
          inserted++;
        } else {
          updated++;
        }
      } catch (e) {
        failed++;
        log.warn({ error: e, slug, collection }, "Upsert failed");
      }
    }

    return { inserted, updated, failed };
  }
}
