import { and, eq, inArray } from "drizzle-orm";
import { db } from "../client.ts";
import { articles } from "../schema/content.ts";
import {
  ContentSourceInventoryInsertSchema,
  ContentSourceInventoryPatchSchema,
  contentSourceInventory,
  githubInventoryMetadataSchema,
  type ContentSourceInventory,
  type ContentSourceInventoryInsertInput,
  type ContentSourceInventoryPatchInput,
  type GithubInventoryMetadata,
  type InventoryFetchStatus,
} from "../schema/content.ts";

/**
 * Spec 64.20: helper-side guard mirroring the application-layer convention from
 * the table comment — if `objectType='tool'` AND `articleId IS NOT NULL`, the
 * referenced article MUST have `collection='tools'`. Throws on mismatch so a
 * caller's bug surfaces immediately rather than as silently-bad joins later.
 */
async function assertArticleCollectionForTool(
  objectType: "tool" | "skill",
  articleId: string | null | undefined,
): Promise<void> {
  if (objectType !== "tool" || !articleId) return;
  const rows = await db
    .select({ collection: articles.collection })
    .from(articles)
    .where(eq(articles.id, articleId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`assertArticleCollectionForTool: article ${articleId} not found`);
  }
  if (row.collection !== "tools") {
    throw new Error(
      `assertArticleCollectionForTool: article ${articleId} has collection='${row.collection}', expected 'tools' (object_type='tool' link rule)`,
    );
  }
}

/**
 * INSERT a new inventory row. Validates via `ContentSourceInventoryInsertSchema`
 * (Zod parse-on-write — never INSERT raw user input). Enforces the article-link
 * collection convention.
 */
export async function createInventoryRow(
  rawInput: ContentSourceInventoryInsertInput,
): Promise<ContentSourceInventory> {
  const input = ContentSourceInventoryInsertSchema.parse(rawInput);

  await assertArticleCollectionForTool(input.objectType, input.articleId);

  const rows = await db
    .insert(contentSourceInventory)
    .values({
      projectId:            input.projectId,
      source:               input.source,
      objectType:           input.objectType,
      sourceIdentifier:     input.sourceIdentifier,
      displayName:          input.displayName,
      description:          input.description ?? null,
      homepageUrl:          input.homepageUrl ?? null,
      refreshIntervalHours: input.refreshIntervalHours,
      approvedAt:           input.approvedAt ?? null,
      approvedByUserId:     input.approvedByUserId ?? null,
      articleId:            input.articleId ?? null,
    })
    .returning();

  if (!rows[0]) throw new Error("createInventoryRow: INSERT returned no row");
  return rows[0];
}

/**
 * PATCH a subset of editable columns. Validates via `ContentSourceInventoryPatchSchema`.
 * Source taxonomy fields (source/objectType/sourceIdentifier) and lifecycle fields
 * (fetchStatus/lastFetchedAt) are NOT editable here — they flow through `markInventory*`.
 */
export async function patchInventoryRow(
  id: string,
  rawPartial: ContentSourceInventoryPatchInput,
): Promise<ContentSourceInventory | null> {
  const partial = ContentSourceInventoryPatchSchema.parse(rawPartial);

  if (Object.keys(partial).length === 0) {
    return null; // no-op patch
  }

  // Article-link rule needs the current objectType — load + check
  if (partial.articleId !== undefined && partial.articleId !== null) {
    const current = await db
      .select({ objectType: contentSourceInventory.objectType })
      .from(contentSourceInventory)
      .where(eq(contentSourceInventory.id, id))
      .limit(1);
    if (current[0]) {
      await assertArticleCollectionForTool(current[0].objectType, partial.articleId);
    }
  }

  const setFields: Partial<typeof contentSourceInventory.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (partial.displayName !== undefined) setFields.displayName = partial.displayName;
  if (partial.description !== undefined) setFields.description = partial.description;
  if (partial.homepageUrl !== undefined) setFields.homepageUrl = partial.homepageUrl;
  if (partial.refreshIntervalHours !== undefined) setFields.refreshIntervalHours = partial.refreshIntervalHours;
  if (partial.articleId !== undefined) setFields.articleId = partial.articleId;

  const rows = await db
    .update(contentSourceInventory)
    .set(setFields)
    .where(eq(contentSourceInventory.id, id))
    .returning();

  return rows[0] ?? null;
}

/**
 * CAS-claim a row for fetching. Returns true on successful claim, false if the
 * row was concurrently claimed by another worker (or already in a non-claimable
 * state). Mirrors `markInventoryFetching` pattern from Spec 64.7 image-batch.
 *
 * Allowed prior states: 'pending' | 'ok' | 'error'. 'fetching' rows are skipped.
 */
export async function markInventoryFetching(id: string): Promise<boolean> {
  const claimableStatuses: InventoryFetchStatus[] = ["pending", "ok", "error"];
  const rows = await db
    .update(contentSourceInventory)
    .set({
      fetchStatus: "fetching",
      fetchError: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(contentSourceInventory.id, id),
        inArray(contentSourceInventory.fetchStatus, claimableStatuses),
      ),
    )
    .returning({ id: contentSourceInventory.id });
  return rows.length > 0;
}

/**
 * Persist successful fetch result. Zod-parses `metadata` so a malformed
 * adapter response surfaces here (fail-loud) rather than landing in the column
 * and breaking downstream consumers.
 */
export async function markInventoryOk(
  id: string,
  metadata: GithubInventoryMetadata,
): Promise<ContentSourceInventory | null> {
  // Validate the metadata shape before writing.
  const parsed = githubInventoryMetadataSchema.parse(metadata);

  const rows = await db
    .update(contentSourceInventory)
    .set({
      fetchStatus: "ok",
      fetchError: null,
      githubMetadata: parsed,
      lastFetchedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(contentSourceInventory.id, id))
    .returning();
  return rows[0] ?? null;
}

/**
 * Persist failed fetch result. Keeps existing metadata intact so downstream
 * consumers continue to read the last-known-good value.
 */
export async function markInventoryError(
  id: string,
  error: string,
): Promise<ContentSourceInventory | null> {
  const rows = await db
    .update(contentSourceInventory)
    .set({
      fetchStatus: "error",
      fetchError: error.slice(0, 2000),
      updatedAt: new Date(),
    })
    .where(eq(contentSourceInventory.id, id))
    .returning();
  return rows[0] ?? null;
}

/**
 * De-approve a row (V1: useful for Marcel to take a row out of the cron cycle
 * without deleting its history). The partial unique index drops the row from
 * the `approved_at IS NOT NULL` set, so a fresh Marcel-Seed of the same
 * source_identifier can land cleanly.
 */
export async function softDeleteInventoryRow(id: string): Promise<ContentSourceInventory | null> {
  const rows = await db
    .update(contentSourceInventory)
    .set({
      approvedAt: null,
      approvedByUserId: null,
      updatedAt: new Date(),
    })
    .where(eq(contentSourceInventory.id, id))
    .returning();
  return rows[0] ?? null;
}

/** Hard-delete (Marcel-trigger from Settings-UI). Cascade handles dependents (none in V1). */
export async function hardDeleteInventoryRow(id: string): Promise<boolean> {
  const rows = await db
    .delete(contentSourceInventory)
    .where(eq(contentSourceInventory.id, id))
    .returning({ id: contentSourceInventory.id });
  return rows.length > 0;
}
