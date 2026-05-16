import { z } from "zod";

/**
 * Standard offset-based pagination — use for bounded lists (articles, clusters, briefs).
 * Response envelope: { items, total, limit, offset }
 */
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function paginated<T>(
  items: T[],
  countRows: Array<{ count: number }>,
  q: PaginationQuery
): { items: T[]; total: number; limit: number; offset: number } {
  return {
    items,
    total: countRows[0]?.count ?? 0,
    limit: q.limit,
    offset: q.offset,
  };
}

/**
 * Cursor-based pagination — use for unbounded streams (activity feed, SSE replay).
 * Response envelope: { items, nextCursor, hasMore }
 */
export const cursorQuerySchema = z.object({
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type CursorQuery = z.infer<typeof cursorQuerySchema>;

export function cursorPaginated<T>(
  items: T[],
  getTimestamp: (item: T) => string | null,
  q: CursorQuery
): { items: T[]; nextCursor: string | null; hasMore: boolean } {
  const hasMore = items.length === q.limit;
  const lastItem = items[items.length - 1];
  const nextCursor = hasMore && lastItem ? (getTimestamp(lastItem) ?? null) : null;
  return { items, nextCursor, hasMore };
}
