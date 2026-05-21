// Spec 62.4-followup Theme-62 Task-2: regression for the SQL crash in
// `pickFromSuggestionPool`. Pre-fix the empty-exclude branch produced a
// stray `and )` in the WHERE clause and Postgres rejected the query with
// `42601 syntax error at or near ")"`. Both shapes must round-trip cleanly
// against a real DB.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { articles, db, eq, projects } from "@marketing-auto/db";
import { pickFromSuggestionPool } from "../src/index.ts";

let projectId: string;

async function freshProject(): Promise<string> {
  const [row] = await db
    .insert(projects)
    .values({
      slug: `social-source-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: "social-source-test",
      industry: "other",
      pipelineTemplate: "educational",
      marketingContextMd: "",
    })
    .returning();
  return row!.id;
}

beforeEach(async () => {
  projectId = await freshProject();
});

afterEach(async () => {
  await db.delete(articles).where(eq(articles.projectId, projectId));
  await db.delete(projects).where(eq(projects.id, projectId));
});

describe("pickFromSuggestionPool — exclude-list edge cases", () => {
  it("runs cleanly with no excludeArticleIds (regression for syntax error at or near ')')", async () => {
    // Before the fix this call crashed at the postgres bind step with
    // PostgresError 42601 because Drizzle's `and(...)` rendered the empty
    // `sql\`\`` slot as a trailing `and `.
    const rows = await pickFromSuggestionPool({ projectId, limit: 5 });
    expect(Array.isArray(rows)).toBe(true);
  });

  it("runs cleanly with an empty excludeArticleIds array", async () => {
    const rows = await pickFromSuggestionPool({
      projectId,
      limit: 5,
      excludeArticleIds: [],
    });
    expect(Array.isArray(rows)).toBe(true);
  });

  it("honours a non-empty exclude list", async () => {
    // Insert two published DE articles. Exclude one — only the other should
    // come back.
    const inserted = await db
      .insert(articles)
      .values([
        {
          projectId,
          slug: "kept",
          title: "Kept article",
          locale: "de",
          status: "published",
          publishedAt: new Date(),
        },
        {
          projectId,
          slug: "excluded",
          title: "Excluded article",
          locale: "de",
          status: "published",
          publishedAt: new Date(),
        },
      ])
      .returning({ id: articles.id, slug: articles.slug });
    const excludedId = inserted.find((r) => r.slug === "excluded")!.id;

    const rows = await pickFromSuggestionPool({
      projectId,
      limit: 10,
      excludeArticleIds: [excludedId],
    });
    const ids = rows.map((r) => r.articleId);
    expect(ids).not.toContain(excludedId);
    expect(ids.length).toBeGreaterThanOrEqual(1);
  });
});
