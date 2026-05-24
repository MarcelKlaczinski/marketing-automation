import { articles, db, eq, projects, sql } from "@marketing-auto/db";
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { createLogger } from "@marketing-auto/shared";
import { z } from "zod";
import { heroRefreshWhitelistUpdateSet } from "./mirror-backfill-heroes.ts";
import type { HeroFields } from "./mirror-hero-images.ts";

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
      // Spec 000 — Hero-Image-Mirror. `mirror-hero-images` step stamps
      // either a `HeroFields` object or `null` on every parsed entry.
      // Null means the entry was skipped (collection without hero / failed
      // mirror) — we do NOT touch the hero columns in that case.
      const hero = (p.hero as HeroFields | null | undefined) ?? null;

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

      // Spec 000 — Hero-Image-Mirror.
      // INSERT path: write all hero columns unconditionally — a new row has
      // nothing to preserve.
      // UPDATE path: hash-equality refresh whitelist. Each hero column is
      // wrapped in `CASE WHEN existing hash IS DISTINCT FROM new hash THEN
      // new ELSE existing END`. When the file in the repo hasn't changed
      // (same hash), the DB columns are left untouched — preserves any
      // manual UI edit to `heroImageAltText`. When the file changes, all
      // hero columns flip atomically to the new values.
      const heroInsertCols = hero
        ? {
            heroImageR2Key: hero.heroImageR2Key,
            heroImagePublicUrl: hero.heroImagePublicUrl,
            heroImageOriginalR2Key: hero.heroImageOriginalR2Key,
            heroImageSourceSha256: hero.heroImageSourceSha256,
            heroImageAltText: hero.heroImageAltText,
          }
        : {};
      // Spec 005 IR2: hash-equality refresh whitelist shared with the new
      // MirrorBackfillHeroesStep. Both sites use the same SQL fragments to
      // preserve UI-edited heroImageAltText on unchanged-content Re-Imports.
      const heroUpdateCols = hero ? heroRefreshWhitelistUpdateSet(hero) : {};

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
            ...heroInsertCols,
          })
          .onConflictDoUpdate({
            target: [
              articles.projectId,
              articles.source,
              articles.collection,
              articles.locale,
              articles.slug,
            ],
            // Spec 005 IR1: targetWhere must mirror the partial unique index
            // predicate from `articles_project_source_coll_locale_slug_active_unique`
            // (migration 0103). Without this, Postgres reports "no unique or
            // exclusion constraint matching the ON CONFLICT specification".
            targetWhere: sql`status != 'superseded'`,
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
              ...heroUpdateCols,
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
