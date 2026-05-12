import { describe, expect, test } from "bun:test";
import { costLogs, db } from "@marketing-auto/db";
import { sql } from "drizzle-orm";

/**
 * Regression guard for the Date-in-sql-template crash.
 *
 * Rule: sql`` template literals do NOT auto-serialize Date objects.
 * Always call .toISOString() before interpolating a Date into sql``.
 * Drizzle typed operators (gte/lte/eq) handle the conversion automatically —
 * this test only covers the sql-template path.
 */
describe("SQL Date-bind regression", () => {
  test("sql template with Date.toISOString() does not crash", async () => {
    const dateStr = new Date().toISOString();
    const result = await db.execute(
      sql`SELECT 1 FROM ${costLogs} WHERE ${costLogs.createdAt} >= ${dateStr} LIMIT 1`
    );
    expect(result).toBeDefined();
  });
});
