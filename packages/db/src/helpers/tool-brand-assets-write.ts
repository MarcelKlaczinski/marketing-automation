/**
 * Spec 65.1 — tool_brand_assets write helpers.
 */
import { eq } from "drizzle-orm";
import { db } from "../client.ts";
import { articles } from "../schema/content.ts";
import {
  type NewToolBrandAsset,
  type ToolBrandAsset,
  toolBrandAssets,
} from "../schema/tool-brand-assets.ts";

/**
 * Spec 65.1 — helper-side guard. tool_id must reference an article with
 * collection='tools'. Throws on mismatch so caller bugs surface immediately
 * rather than as silently-bad joins later. Mirrors
 * `assertArticleCollectionForTool` from content-source-inventory-write.ts.
 */
async function assertArticleIsTool(toolId: string): Promise<void> {
  const rows = await db
    .select({ collection: articles.collection })
    .from(articles)
    .where(eq(articles.id, toolId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(
      `tool_brand_assets: article ${toolId} not found (tool_id must reference an existing tool-article)`
    );
  }
  if (row.collection !== "tools") {
    throw new Error(
      `tool_brand_assets: article ${toolId} has collection='${row.collection}', expected 'tools'`
    );
  }
}

/**
 * UPSERT brand assets by tool_id. PK = tool_id so ON CONFLICT (tool_id) DO
 * UPDATE keeps the row deterministic per tool. Stamps updated_at on every
 * write; fetched_at only changes if the caller explicitly sets it.
 */
export async function upsertBrandAsset(input: NewToolBrandAsset): Promise<ToolBrandAsset> {
  await assertArticleIsTool(input.toolId);

  const rows = await db
    .insert(toolBrandAssets)
    .values(input)
    .onConflictDoUpdate({
      target: toolBrandAssets.toolId,
      set: {
        logoUrl: input.logoUrl ?? null,
        logoDarkUrl: input.logoDarkUrl ?? null,
        primaryColor: input.primaryColor ?? null,
        secondaryColor: input.secondaryColor ?? null,
        brandNameCanonical: input.brandNameCanonical ?? null,
        source: input.source,
        needsReview: input.needsReview ?? false,
        fetchedAt: input.fetchedAt,
        updatedAt: new Date(),
      },
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("upsertBrandAsset: UPSERT returned no row");
  return row;
}

export async function markBrandAssetReviewed(toolId: string): Promise<void> {
  await db
    .update(toolBrandAssets)
    .set({ needsReview: false, updatedAt: new Date() })
    .where(eq(toolBrandAssets.toolId, toolId));
}
