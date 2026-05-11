import { z } from "zod";

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export function paginated<T>(
  items: T[],
  countRows: Array<{ count: number }>,
  q: PaginationQuery
): PaginatedResponse<T> {
  return {
    items,
    total: countRows[0]?.count ?? 0,
    limit: q.limit,
    offset: q.offset,
  };
}
