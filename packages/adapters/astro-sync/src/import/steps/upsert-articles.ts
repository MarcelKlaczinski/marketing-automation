import { articles, db, eq, projects } from "@marketing-auto/db";
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { createLogger } from "@marketing-auto/shared";
import { z } from "zod";

// Spec multi-domain-evolution S4.1: tool_* promoted columns on `articles`
// are Toolwiki-domain-specific (Phase-2 Bucket-C). Only the Toolwiki tenant
// (industry='ai_education') populates them; non-Toolwiki projects leave
// them NULL. Future per-domain promotions follow the same guard pattern
// (e.g. `product_*` columns gated on industry='renewable_affiliate'). The
// header comment on `articles.tool_*` columns in packages/db/src/schema/
// content.ts is the source of truth for which columns are tenant-locked.
const TOOLWIKI_INDUSTRY = "ai_education";

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

    // Spec multi-domain-evolution S4.1: load the project's industry once
    // (not per-row) so the tool_* promotion gate doesn't add N+1 queries
    // on imports of ~250 articles.
    const [project] = await db
      .select({ industry: projects.industry })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    const isToolwikiDomain = project?.industry === TOOLWIKI_INDUSTRY;

    for (const p of input.parsed) {
      const typed = p.typed as Record<string, unknown>;
      const slug = typed.slug as string;
      const locale = (typed.locale as string | null) ?? "de";
      const collection = (p.collection as string) ?? "unknown";
      const extras = (p.extras as Record<string, unknown>) ?? {};

      // Spec 54.8: fallback title to name (for authors collection)
      const title = (typed.title as string | null) ?? (typed.name as string | null) ?? null;

      // Spec 54.8: fallback publishedAt to date (for blog collection)
      const publishedAt =
        (typed.publishedAt as Date | null) ?? (typed.date as Date | null) ?? null;

      // Spec 54.8: fallback frontmatterUpdatedAt to updated (for blog collection)
      const frontmatterUpdatedAt =
        (typed.updatedAt as Date | null) ?? (typed.updated as Date | null) ?? null;

      // Spec 54.8: collection-aware intentType default
      const intentType =
        (typed.intentType as string | null) ?? (collection === "tools" ? "review" : null);

      // Spec 54.8 + multi-domain-evolution S4.1: tool-specific column promotion
      // gated on BOTH collection='tools' (write-time scope) AND project industry
      // (tenant scope). Non-Toolwiki tenants leave the columns NULL even when
      // they happen to have a `tools` collection in their Astro repo.
      const toolColumns =
        isToolwikiDomain && collection === "tools" ? buildToolColumns(extras) : {};

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
            title,
            metaDescription: (typed.description as string | null) ?? null,
            translationKey: (typed.translationKey as string | null) ?? null,
            filePath: p.filePath as string,
            gitSha: p.gitSha as string,
            publishedAt,
            frontmatterUpdatedAt,
            author: (typed.author as string | null) ?? null,
            category: (typed.category as string | null) ?? null,
            subcategory: (typed.subcategory as string | null) ?? null,
            tags: (typed.tags as string[] | null) ?? [],
            noindex: (typed.noindex as boolean | null) ?? false,
            // Spec 49a: cluster metadata
            clusterKey: (typed.clusterKey as string | null) ?? null,
            clusterRole: (typed.clusterRole as "hub" | "spoke" | null) ?? null,
            intentType,
            bodyMd: p.body as string,
            domainExtras: extras,
            importMetadata: p.metadata as Record<string, unknown>,
            importedAt: now,
            lastImportedAt: now,
            status: "published",
            ...toolColumns,
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
              title,
              metaDescription: (typed.description as string | null) ?? null,
              translationKey: (typed.translationKey as string | null) ?? null,
              filePath: p.filePath as string,
              gitSha: p.gitSha as string,
              publishedAt,
              frontmatterUpdatedAt,
              author: (typed.author as string | null) ?? null,
              category: (typed.category as string | null) ?? null,
              subcategory: (typed.subcategory as string | null) ?? null,
              tags: (typed.tags as string[] | null) ?? [],
              noindex: (typed.noindex as boolean | null) ?? false,
              // Spec 49a: cluster metadata
              clusterKey: (typed.clusterKey as string | null) ?? null,
              clusterRole: (typed.clusterRole as "hub" | "spoke" | null) ?? null,
              intentType,
              bodyMd: p.body as string,
              domainExtras: extras,
              importMetadata: p.metadata as Record<string, unknown>,
              lastImportedAt: now,
              updatedAt: now,
              ...toolColumns,
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

function buildToolColumns(extras: Record<string, unknown>): {
  toolPricing: string | null;
  toolPriceFrom: string | null;
  toolRating: string | null;
  toolVotes: number | null;
  toolAffiliateSlug: string | null;
  toolWebsite: string | null;
} {
  return {
    toolPricing: typeof extras.pricing === "string" ? extras.pricing : null,
    toolPriceFrom: coerceToNumericString(extras.priceFrom),
    toolRating: coerceToNumericString(extras.rating),
    toolVotes: coerceToInteger(extras.votes),
    toolAffiliateSlug: typeof extras.affiliateSlug === "string" ? extras.affiliateSlug : null,
    toolWebsite: typeof extras.website === "string" ? extras.website : null,
  };
}

function coerceToNumericString(value: unknown): string | null {
  if (value == null) return null;
  const n = parseFloat(String(value));
  return Number.isFinite(n) ? String(n) : null;
}

function coerceToInteger(value: unknown): number | null {
  if (value == null) return null;
  const n = parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}
