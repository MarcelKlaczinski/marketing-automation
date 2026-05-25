/**
 * Spec 65.1 — tool_brand_assets read helpers.
 * Spec 65.2 — extended with project-scoped backfill helpers + brief-generator
 * pre-flight gate (`listToolsWithBrandAssets`).
 */
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
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
 * Batch read for `listToolsWithBrandAssets` callers that need the rows
 * themselves rather than just the split-IDs. Order is non-deterministic; sort
 * client-side if needed.
 */
export async function getBrandAssetsForTools(toolIds: string[]): Promise<ToolBrandAsset[]> {
  if (toolIds.length === 0) return [];
  return await db
    .select()
    .from(toolBrandAssets)
    .where(inArray(toolBrandAssets.toolId, toolIds));
}

/**
 * Find articles with collection='tools' that have NO matching brand_assets row.
 * Drives the 65.2 backfill script. Returns article IDs only; caller fetches
 * full rows as needed.
 *
 * `projectId` is OPTIONAL: omitted = cross-project (legacy 65.1 callers); set
 * = project-scoped (Memory D26 backfill mandate). Brand assets are tool-scoped
 * (Memory D5 multi-tenant exception), so the project filter only narrows the
 * candidate set — it does not affect the stored row.
 *
 * `locale` filters to ONE article-row per logical tool. Toolwiki tools exist
 * as two `articles` rows (DE + EN, same slug) since bilingual Spec 59.2, and
 * `tool_brand_assets.toolId` PKs on `articles.id` (per-locale) — so without
 * the filter the backfill would write the same logo twice per logical tool.
 * Omit `locale` only for cross-locale audits.
 */
export async function listToolsMissingBrandAssets(opts: {
  projectId?: string;
  locale?: string;
  limit?: number;
}): Promise<string[]> {
  const limit = opts.limit ?? 50;
  const conditions = [eq(articles.collection, "tools"), isNull(toolBrandAssets.toolId)];
  if (opts.projectId) conditions.push(eq(articles.projectId, opts.projectId));
  if (opts.locale) conditions.push(eq(articles.locale, opts.locale));

  const rows = await db
    .select({ id: articles.id })
    .from(articles)
    .leftJoin(toolBrandAssets, eq(toolBrandAssets.toolId, articles.id))
    .where(and(...conditions))
    .orderBy(sql`${articles.createdAt} ASC`)
    .limit(limit);
  return rows.map((r) => r.id);
}

/**
 * Count-only sibling of `listToolsMissingBrandAssets`. Drives the backfill
 * dry-run summary so the script doesn't have to walk every page.
 */
export async function countToolsMissingBrandAssets(opts: {
  projectId?: string;
  locale?: string;
}): Promise<number> {
  const conditions = [eq(articles.collection, "tools"), isNull(toolBrandAssets.toolId)];
  if (opts.projectId) conditions.push(eq(articles.projectId, opts.projectId));
  if (opts.locale) conditions.push(eq(articles.locale, opts.locale));

  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(articles)
    .leftJoin(toolBrandAssets, eq(toolBrandAssets.toolId, articles.id))
    .where(and(...conditions));
  return result[0]?.count ?? 0;
}

/**
 * Pre-flight gate for the 65.5 brief-generator. Given a candidate `toolIds`
 * pool (typically oversampled `n + 2`), returns the split:
 *
 * - `toolsWithAssets`: tool IDs that have a `tool_brand_assets` row AND a
 *   non-null `logo_url`. Safe to render in templates.
 * - `toolsMissing`: tool IDs that either have no row at all, or have a row
 *   with `logo_url IS NULL`. Skip these in the brief.
 *
 * The caller filters their candidate list against `toolsWithAssets` and
 * truncates to the target N. See Spec 65.2 §6 for the pattern.
 */
export async function listToolsWithBrandAssets(input: {
  toolIds: string[];
}): Promise<{ toolsWithAssets: string[]; toolsMissing: string[] }> {
  if (input.toolIds.length === 0) {
    return { toolsWithAssets: [], toolsMissing: [] };
  }
  const rows = await db
    .select({ toolId: toolBrandAssets.toolId })
    .from(toolBrandAssets)
    .where(
      and(
        inArray(toolBrandAssets.toolId, input.toolIds),
        isNotNull(toolBrandAssets.logoUrl),
      ),
    );
  const withAssets = new Set(rows.map((r) => r.toolId));
  const toolsWithAssets: string[] = [];
  const toolsMissing: string[] = [];
  for (const id of input.toolIds) {
    if (withAssets.has(id)) toolsWithAssets.push(id);
    else toolsMissing.push(id);
  }
  return { toolsWithAssets, toolsMissing };
}

export async function listBrandAssetsNeedingReview(): Promise<ToolBrandAsset[]> {
  return await db
    .select()
    .from(toolBrandAssets)
    .where(eq(toolBrandAssets.needsReview, true))
    .orderBy(sql`${toolBrandAssets.fetchedAt} ASC`);
}
