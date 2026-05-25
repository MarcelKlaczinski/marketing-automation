/**
 * Spec 65.1 — tool_brand_assets read helpers.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../client.ts";
import { articles } from "../schema/content.ts";
import { type ToolBrandAsset, toolBrandAssets } from "../schema/tool-brand-assets.ts";

export async function getBrandAssetsForTool(toolId: string): Promise<ToolBrandAsset | null> {
  const rows = await db
    .select()
    .from(toolBrandAssets)
    .where(eq(toolBrandAssets.toolId, toolId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Find articles with collection='tools' that have NO matching brand_assets row.
 * Drives the 65.2 Brand-Asset-Fetcher backlog. Returns article IDs only;
 * caller fetches full rows as needed.
 *
 * NOTE: cross-package surface for the 65.2 worker, kept project-agnostic
 * because brand assets are tool-scoped (Memory D5 multi-tenant exception).
 * Caller may add a per-project filter at the SELECT layer if needed.
 */
export async function listToolsMissingBrandAssets(opts: {
  limit?: number;
}): Promise<string[]> {
  const limit = opts.limit ?? 50;
  const rows = await db
    .select({ id: articles.id })
    .from(articles)
    .leftJoin(toolBrandAssets, eq(toolBrandAssets.toolId, articles.id))
    .where(and(eq(articles.collection, "tools"), isNull(toolBrandAssets.toolId)))
    .orderBy(sql`${articles.createdAt} ASC`)
    .limit(limit);
  return rows.map((r) => r.id);
}

export async function listBrandAssetsNeedingReview(): Promise<ToolBrandAsset[]> {
  return await db
    .select()
    .from(toolBrandAssets)
    .where(eq(toolBrandAssets.needsReview, true))
    .orderBy(sql`${toolBrandAssets.fetchedAt} ASC`);
}
