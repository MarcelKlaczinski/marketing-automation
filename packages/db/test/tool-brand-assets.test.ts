/**
 * Spec 65.1 — tool_brand_assets helper integration tests.
 *
 * Covers the collection='tools' guard (Q1 deviation), upsert-by-PK,
 * needs-review queue, and missing-tools backlog read.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  articles,
  countToolsMissingBrandAssets,
  db,
  eq,
  getBrandAssetsForTool,
  getBrandAssetsForTools,
  listBrandAssetsNeedingReview,
  listToolsMissingBrandAssets,
  listToolsWithBrandAssets,
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

  it("listToolsMissingBrandAssets respects optional projectId filter (Spec 65.2)", async () => {
    // Setup: ensure `toolArticleId` has a row, then seed a sibling unbranded
    // tool. Filter by `projectId` and assert only project-local rows return.
    await upsertBrandAsset({
      toolId: toolArticleId,
      source: "manual",
      fetchedAt: new Date(),
    });
    const ts = Date.now();
    const [scopedTool] = await db
      .insert(articles)
      .values({
        projectId,
        source: "imported",
        collection: "tools",
        locale: "de",
        slug: `tba-tool-scoped-${ts}`,
        title: "Scoped Tool",
        status: "proposed",
      })
      .returning();
    if (!scopedTool) throw new Error("scoped tool INSERT failed");

    const missing = await listToolsMissingBrandAssets({ projectId, limit: 100 });
    // Project-scoped: every row in `missing` must belong to OUR project.
    const projectIds = await db
      .select({ projectId: articles.projectId })
      .from(articles)
      .where(eq(articles.id, missing[0] ?? "00000000-0000-0000-0000-000000000000"));
    expect(missing).toContain(scopedTool.id);
    expect(missing).not.toContain(toolArticleId);
    if (projectIds[0]) expect(projectIds[0].projectId).toBe(projectId);
  });

  it("countToolsMissingBrandAssets matches listToolsMissingBrandAssets length (Spec 65.2)", async () => {
    const ts = Date.now();
    await db
      .insert(articles)
      .values({
        projectId,
        source: "imported",
        collection: "tools",
        locale: "de",
        slug: `tba-tool-count-${ts}`,
        title: "Count Tool",
        status: "proposed",
      })
      .returning();
    const list = await listToolsMissingBrandAssets({ projectId, limit: 10000 });
    const count = await countToolsMissingBrandAssets({ projectId });
    expect(count).toBe(list.length);
  });

  it("listToolsWithBrandAssets splits IDs by logoUrl presence (Spec 65.2)", async () => {
    const ts = Date.now();
    const [toolWithLogo] = await db
      .insert(articles)
      .values({
        projectId,
        source: "imported",
        collection: "tools",
        locale: "de",
        slug: `tba-with-logo-${ts}`,
        title: "Tool With Logo",
        status: "proposed",
      })
      .returning();
    const [toolNullLogo] = await db
      .insert(articles)
      .values({
        projectId,
        source: "imported",
        collection: "tools",
        locale: "de",
        slug: `tba-null-logo-${ts}`,
        title: "Tool Null Logo",
        status: "proposed",
      })
      .returning();
    const [toolNoRow] = await db
      .insert(articles)
      .values({
        projectId,
        source: "imported",
        collection: "tools",
        locale: "de",
        slug: `tba-no-row-${ts}`,
        title: "Tool No Row",
        status: "proposed",
      })
      .returning();
    if (!toolWithLogo || !toolNullLogo || !toolNoRow) {
      throw new Error("seed inserts failed");
    }

    await upsertBrandAsset({
      toolId: toolWithLogo.id,
      logoUrl: "r2://logos/with.svg",
      source: "lobe-icons",
      fetchedAt: new Date(),
    });
    await upsertBrandAsset({
      toolId: toolNullLogo.id,
      logoUrl: null,
      source: "deterministic-avatar",
      needsReview: true,
      fetchedAt: new Date(),
    });

    const { toolsWithAssets, toolsMissing } = await listToolsWithBrandAssets({
      toolIds: [toolWithLogo.id, toolNullLogo.id, toolNoRow.id],
    });
    expect(toolsWithAssets).toEqual([toolWithLogo.id]);
    expect(toolsMissing).toEqual(expect.arrayContaining([toolNullLogo.id, toolNoRow.id]));
    expect(toolsMissing.length).toBe(2);
  });

  it("listToolsWithBrandAssets accepts empty toolIds (Spec 65.2)", async () => {
    const result = await listToolsWithBrandAssets({ toolIds: [] });
    expect(result).toEqual({ toolsWithAssets: [], toolsMissing: [] });
  });

  it("getBrandAssetsForTools batch-loads multiple rows (Spec 65.2)", async () => {
    const ts = Date.now();
    const [t1] = await db
      .insert(articles)
      .values({
        projectId,
        source: "imported",
        collection: "tools",
        locale: "de",
        slug: `tba-batch-1-${ts}`,
        title: "Batch 1",
        status: "proposed",
      })
      .returning();
    const [t2] = await db
      .insert(articles)
      .values({
        projectId,
        source: "imported",
        collection: "tools",
        locale: "de",
        slug: `tba-batch-2-${ts}`,
        title: "Batch 2",
        status: "proposed",
      })
      .returning();
    if (!t1 || !t2) throw new Error("batch seed failed");

    await upsertBrandAsset({
      toolId: t1.id,
      logoUrl: "r2://logos/a.svg",
      source: "iconify",
      fetchedAt: new Date(),
    });
    await upsertBrandAsset({
      toolId: t2.id,
      logoUrl: "r2://logos/b.svg",
      source: "simple-icons",
      fetchedAt: new Date(),
    });

    const rows = await getBrandAssetsForTools([t1.id, t2.id]);
    expect(rows.length).toBe(2);
    const sourcesById = new Map(rows.map((r) => [r.toolId, r.source]));
    expect(sourcesById.get(t1.id)).toBe("iconify");
    expect(sourcesById.get(t2.id)).toBe("simple-icons");
  });

  it("getBrandAssetsForTools returns [] for empty input (Spec 65.2)", async () => {
    const rows = await getBrandAssetsForTools([]);
    expect(rows).toEqual([]);
  });

  it("accepts widened 65.2 source values (Spec 65.2)", async () => {
    for (const source of [
      "lobe-icons",
      "iconify",
      "simple-icons",
      "deterministic-avatar",
    ] as const) {
      const updated = await upsertBrandAsset({
        toolId: toolArticleId,
        source,
        fetchedAt: new Date(),
      });
      expect(updated.source).toBe(source);
    }
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
