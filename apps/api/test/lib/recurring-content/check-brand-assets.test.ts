/**
 * Spec 65.5 — Pre-flight brand-asset gate (DB-integration).
 *
 * Uses real `articles` + `tool_brand_assets` rows so the helper exercises
 * the actual `listToolsWithBrandAssets` JOIN + `logo_url IS NOT NULL` filter.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { articles, db, eq, projects, toolBrandAssets } from "@marketing-auto/db";
import {
  BrandAssetsMissingError,
  ensureBrandAssetsAvailable,
} from "../../../src/lib/recurring-content/brief-generators/shared/check-brand-assets.ts";

describe("ensureBrandAssetsAvailable (Spec 65.5)", () => {
  let projectId: string;
  let toolWithLogo: string;
  let toolWithoutLogo: string;
  let toolNoRow: string;

  beforeAll(async () => {
    const ts = Date.now();
    const [proj] = await db
      .insert(projects)
      .values({
        slug: `brand-asset-gate-${ts}`,
        name: "brand-asset-gate test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!proj) throw new Error("project INSERT failed");
    projectId = proj.id;

    const inserted = await db
      .insert(articles)
      .values([
        {
          projectId,
          slug: `tool-with-logo-${ts}`,
          title: "Tool with logo",
          collection: "tools",
          locale: "de",
          status: "proposed",
          source: "imported",
          metaDescription: "",
        },
        {
          projectId,
          slug: `tool-without-logo-${ts}`,
          title: "Tool without logo",
          collection: "tools",
          locale: "de",
          status: "proposed",
          source: "imported",
          metaDescription: "",
        },
        {
          projectId,
          slug: `tool-no-row-${ts}`,
          title: "Tool with no brand-assets row",
          collection: "tools",
          locale: "de",
          status: "proposed",
          source: "imported",
          metaDescription: "",
        },
      ])
      .returning();
    if (inserted.length !== 3) throw new Error("seed INSERT failed");
    toolWithLogo = inserted[0]!.id;
    toolWithoutLogo = inserted[1]!.id;
    toolNoRow = inserted[2]!.id;

    // tool_brand_assets is tool-scoped (no project_id column) — same Claude
    // logo serves every project that mentions Claude. Spec 65.1 schema header.
    await db.insert(toolBrandAssets).values({
      toolId: toolWithLogo,
      logoUrl: "https://example.com/logo.svg",
      source: "manual",
      fetchedAt: new Date(),
    });
    await db.insert(toolBrandAssets).values({
      toolId: toolWithoutLogo,
      logoUrl: null,
      source: "manual",
      fetchedAt: new Date(),
    });
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("returns silently when all tools have logos", async () => {
    await ensureBrandAssetsAvailable({ toolIds: [toolWithLogo] });
    // No throw — pass.
  });

  it("throws BrandAssetsMissingError when a tool has no row", async () => {
    let caught: unknown = null;
    try {
      await ensureBrandAssetsAvailable({ toolIds: [toolWithLogo, toolNoRow] });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BrandAssetsMissingError);
    expect((caught as BrandAssetsMissingError).missingToolIds).toEqual([toolNoRow]);
  });

  it("throws BrandAssetsMissingError when a tool has logoUrl=NULL", async () => {
    let caught: unknown = null;
    try {
      await ensureBrandAssetsAvailable({ toolIds: [toolWithLogo, toolWithoutLogo] });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BrandAssetsMissingError);
    expect((caught as BrandAssetsMissingError).missingToolIds).toEqual([toolWithoutLogo]);
  });

  it("is a no-op on empty input", async () => {
    await ensureBrandAssetsAvailable({ toolIds: [] });
  });
});
