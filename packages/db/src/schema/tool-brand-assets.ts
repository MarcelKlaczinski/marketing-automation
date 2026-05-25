import { sql } from "drizzle-orm";
/**
 * Spec 65.1 — Tool Brand Assets
 *
 * Logos + brand colors per tool. PK = tool_id so each tool has at most one
 * canonical row. Tool-scoped (no project_id) — same Claude logo serves every
 * project that mentions Claude. Avoids duplicate fetch-cost across tenants.
 * (Memory D5 multi-tenant exception.)
 *
 * `tool_id` references articles(id) where collection='tools'. Spec narrative
 * referenced a non-existent `tools` table; tools live as articles with
 * collection='tools'. Write-side helper enforces the collection guard.
 *
 * Sources (text, not enum — new providers may appear): 'brandfetch' |
 * 'clearbit' | 'favicon' | 'manual'. Tested via constants in 65.2.
 */
import { boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { articles } from "./content.ts";

export type BrandAssetSource = "brandfetch" | "clearbit" | "favicon" | "manual";

export const toolBrandAssets = pgTable(
  "tool_brand_assets",
  {
    /**
     * PK = tool_id (=articles.id where collection='tools'). On delete cascade
     * so removing a tool-article drops its brand assets in the same transaction.
     */
    toolId: uuid("tool_id")
      .primaryKey()
      .references(() => articles.id, { onDelete: "cascade" }),

    /** R2 storage key (or absolute URL). NULL until first fetch lands. */
    logoUrl: text("logo_url"),
    /** Variant designed for dark backgrounds. NULL when the tool only ships one variant. */
    logoDarkUrl: text("logo_dark_url"),

    /** Hex #RRGGBB. Renderer validates the format at consume-time. */
    primaryColor: text("primary_color"),
    secondaryColor: text("secondary_color"),

    /** Canonical brand-name (may differ from article.title; e.g. "Anthropic Claude" vs "Claude"). */
    brandNameCanonical: text("brand_name_canonical"),

    source: text("source").notNull().$type<BrandAssetSource>(),
    /** Set TRUE when auto-fetched data is low-confidence and needs Marcel review. */
    needsReview: boolean("needs_review").notNull().default(false),

    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /**
     * Partial index for the review-queue UI — only the small set of rows
     * needing attention is indexed.
     */
    needsReviewIdx: index("idx_brand_assets_needs_review")
      .on(t.needsReview)
      .where(sql`${t.needsReview} = TRUE`),
    sourceIdx: index("idx_brand_assets_source").on(t.source),
  })
);

export type ToolBrandAsset = typeof toolBrandAssets.$inferSelect;
export type NewToolBrandAsset = typeof toolBrandAssets.$inferInsert;
