/**
 * Spec 65.1 — tool_brand_assets helper integration tests.
 *
 * Covers the collection='tools' guard (Q1 deviation), upsert-by-PK,
 * needs-review queue, and missing-tools backlog read.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  articles,
  db,
  eq,
  getBrandAssetsForTool,
  listBrandAssetsNeedingReview,
  listToolsMissingBrandAssets,
  markBrandAssetReviewed,
  projects,
  upsertBrandAsset,
} from "../src/index.ts";

describe("tool_brand_assets helpers (Spec 65.1)", () => {
  let projectId: string;
  let toolArticleId: string;
  let blogArticleId: string;

  beforeAll(async () => {
    const ts = Date.now();
    const [project] = await db
      .insert(projects)
      .values({
        slug: `tba-test-${ts}`,
        name: "TBA Test Project",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!project) throw new Error("project INSERT failed");
    projectId = project.id;

    const [tool] = await db
      .insert(articles)
      .values({
        projectId,
        source: "imported",
        collection: "tools",
        locale: "de",
        slug: `tba-tool-${ts}`,
        title: "TBA Test Tool",
        status: "proposed",
      })
      .returning();
    const [blog] = await db
      .insert(articles)
      .values({
        projectId,
        source: "imported",
        collection: "blog",
        locale: "de",
        slug: `tba-blog-${ts}`,
        title: "TBA Test Blog",
        status: "proposed",
      })
      .returning();
    if (!tool || !blog) throw new Error("article INSERT failed");
    toolArticleId = tool.id;
    blogArticleId = blog.id;
  });

  afterAll(async () => {
    // CASCADE removes brand_assets via articles.id → tool_brand_assets.tool_id FK.
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("upserts a row by tool_id and reads it back", async () => {
    const row = await upsertBrandAsset({
      toolId: toolArticleId,
      logoUrl: "r2://logos/test.svg",
      primaryColor: "#7B61FF",
      source: "manual",
      fetchedAt: new Date(),
    });
    expect(row.toolId).toBe(toolArticleId);
    expect(row.logoUrl).toBe("r2://logos/test.svg");
    expect(row.source).toBe("manual");
    expect(row.needsReview).toBe(false);

    const fetched = await getBrandAssetsForTool(toolArticleId);
    expect(fetched?.primaryColor).toBe("#7B61FF");
  });

  it("ON CONFLICT (tool_id) DO UPDATE — re-upsert replaces existing fields", async () => {
    await upsertBrandAsset({
      toolId: toolArticleId,
      logoUrl: "initial",
      primaryColor: "#000000",
      source: "manual",
      fetchedAt: new Date(),
    });
    const updated = await upsertBrandAsset({
      toolId: toolArticleId,
      logoUrl: "new",
      primaryColor: "#FFFFFF",
      source: "brandfetch",
      needsReview: true,
      fetchedAt: new Date(),
    });
    expect(updated.logoUrl).toBe("new");
    expect(updated.source).toBe("brandfetch");
    expect(updated.needsReview).toBe(true);
  });

  it("rejects insert against a non-tool article (collection guard)", async () => {
    await expect(
      upsertBrandAsset({
        toolId: blogArticleId,
        source: "manual",
        fetchedAt: new Date(),
      }),
    ).rejects.toThrow(/expected 'tools'/);
  });

  it("rejects insert against a non-existent article", async () => {
    await expect(
      upsertBrandAsset({
        toolId: "00000000-0000-0000-0000-000000000000",
        source: "manual",
        fetchedAt: new Date(),
      }),
    ).rejects.toThrow(/not found/);
  });

  it("listToolsMissingBrandAssets returns tool-articles that have no brand_assets row", async () => {
    // Ensure toolArticleId has a brand_asset row (prior tests may have left it
    // with one; re-upsert to be deterministic regardless of order/session state).
    await upsertBrandAsset({
      toolId: toolArticleId,
      source: "manual",
      fetchedAt: new Date(),
    });
    // Insert a second tool with NO brand_asset row.
    const ts = Date.now();
    const [unbrandedTool] = await db
      .insert(articles)
      .values({
        projectId,
        source: "imported",
        collection: "tools",
        locale: "de",
        slug: `tba-tool-unbranded-${ts}`,
        title: "Unbranded Tool",
        status: "proposed",
      })
      .returning();
    if (!unbrandedTool) throw new Error("unbranded tool INSERT failed");

    // Use a high limit + assert against the local project's tools only —
    // the helper is intentionally project-agnostic (brand assets are
    // tool-scoped per Memory D5), so other projects' tool-articles
    // accumulate in the DB across test sessions. Filter to our project for
    // a deterministic assertion.
    const missing = await listToolsMissingBrandAssets({ limit: 10000 });
    const ourMissing = missing.filter((id) =>
      [toolArticleId, unbrandedTool.id].includes(id),
    );
    expect(ourMissing).toContain(unbrandedTool.id);
    expect(ourMissing).not.toContain(toolArticleId);
  });

  it("listBrandAssetsNeedingReview filters to needs_review=true", async () => {
    await upsertBrandAsset({
      toolId: toolArticleId,
      source: "favicon",
      needsReview: true,
      fetchedAt: new Date(),
    });
    const review = await listBrandAssetsNeedingReview();
    expect(review.find((r) => r.toolId === toolArticleId)).toBeDefined();

    await markBrandAssetReviewed(toolArticleId);
    const after = await listBrandAssetsNeedingReview();
    expect(after.find((r) => r.toolId === toolArticleId)).toBeUndefined();
  });
});
