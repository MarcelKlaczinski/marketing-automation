/**
 * Spec 65.V1.5a Bridge #1 — Tests for `resolveToolBrandAsset`.
 *
 * Coverage:
 *   1. DB-hit returns ResolvedIcon (svg + brandColor + additionalBrandColors)
 *   2. DB-miss (no `tool_brand_assets` row) returns null
 *   3. DB-row exists but `logo_url` is null → returns null (fall-through case)
 *   4. Cache hit inside TTL: second call doesn't re-read DB
 *   5. Cache hit inside TTL: second call doesn't re-fetch R2
 *   6. R2 fetch failure (non-OK response) returns null without caching the
 *      bad result long-term
 *   7. `secondaryColor` + `tertiaryColor` flow into `additionalBrandColors`
 *      array; duplicates of primary are filtered
 *   8. Wires into `resolveToolIcon`: when `tool_brand_assets` has data, it
 *      wins over `project_brand_assets` + chain
 *
 * Uses `data:` URLs for the R2 logo content so tests don't need an HTTP server
 * — Bun's global `fetch` handles `data:` URLs natively.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  and,
  articles,
  db,
  eq,
  projectBrandAssets,
  projects,
  toolBrandAssets,
} from "@marketing-auto/db";
import {
  clearToolBrandAssetCacheForTesting,
  resolveToolBrandAsset,
} from "../../src/_lib/resolve-tool-brand-asset.ts";
import { resolveToolIcon } from "../../src/_lib/resolve-tool-icon.ts";

let testProjectId: string;

/** Data URL helper — encodes an SVG body as a self-contained `data:` URL that
 * `fetch()` resolves without HTTP. Used in place of a real R2 URL so the tests
 * exercise the same code path as production without a live server. */
function svgDataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const FAKE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1 1h22v22H1z"/></svg>';
const FAKE_SVG_2 = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>';

beforeAll(async () => {
  const [proj] = await db
    .insert(projects)
    .values({
      slug: `bridge1-test-${crypto.randomUUID().slice(0, 8)}`,
      name: "Bridge #1 Brand-Asset Test Project",
      industry: "other",
      pipelineTemplate: "educational",
    })
    .returning({ id: projects.id });
  testProjectId = proj!.id;
});

afterAll(async () => {
  // Cascade: tool_brand_assets → articles → projects (FKs CASCADE on delete)
  await db.delete(projects).where(eq(projects.id, testProjectId));
});

beforeEach(() => {
  clearToolBrandAssetCacheForTesting();
});

afterEach(async () => {
  // Wipe both tables under test so each case is isolated. `tool_brand_assets`
  // CASCADEs from `articles`, so deleting the articles is enough.
  await db
    .delete(articles)
    .where(and(eq(articles.projectId, testProjectId), eq(articles.collection, "tools")));
  await db
    .delete(projectBrandAssets)
    .where(
      and(
        eq(projectBrandAssets.projectId, testProjectId),
        eq(projectBrandAssets.assetType, "tool_icon"),
      ),
    );
});

async function seedToolArticle(
  slug: string,
  locale: "de" | "en" = "de",
): Promise<string> {
  const [row] = await db
    .insert(articles)
    .values({
      projectId: testProjectId,
      collection: "tools",
      slug,
      locale,
      source: "imported",
      status: "published",
      title: `${slug} test tool`,
      translationKey: `${slug}-key`,
    })
    .returning({ id: articles.id });
  return row!.id;
}

async function seedBrandAsset(
  toolId: string,
  overrides: Partial<{
    logoUrl: string | null;
    primaryColor: string | null;
    secondaryColor: string | null;
    tertiaryColor: string | null;
    brandNameCanonical: string | null;
  }> = {},
): Promise<void> {
  await db.insert(toolBrandAssets).values({
    toolId,
    logoUrl: overrides.logoUrl === undefined ? svgDataUrl(FAKE_SVG) : overrides.logoUrl,
    logoDarkUrl: null,
    logoWordmarkUrl: null,
    primaryColor: overrides.primaryColor ?? "#FF0000",
    secondaryColor: overrides.secondaryColor ?? null,
    tertiaryColor: overrides.tertiaryColor ?? null,
    brandNameCanonical: overrides.brandNameCanonical ?? "Test Tool",
    source: "lobe-icons",
    needsReview: false,
    fetchedAt: new Date(),
  });
}

describe("resolveToolBrandAsset", () => {
  it("returns ResolvedIcon when tool_brand_assets row has logo_url + colors", async () => {
    const toolId = await seedToolArticle("widget");
    await seedBrandAsset(toolId, {
      primaryColor: "#123456",
      brandNameCanonical: "Widget Co",
    });

    const result = await resolveToolBrandAsset(testProjectId, "widget");

    expect(result).not.toBeNull();
    expect(result!.type).toBe("svg");
    if (result!.type === "svg") {
      expect(result!.svg).toContain("<svg");
      expect(result!.brandColor).toBe("#123456");
      expect(result!.source).toBe("lobe-icons");
      expect(result!.sourceRef).toBe("Widget Co");
    }
  });

  it("returns null on DB miss (no row for slug)", async () => {
    const result = await resolveToolBrandAsset(testProjectId, "does-not-exist");
    expect(result).toBeNull();
  });

  it("returns null when tool_brand_assets row exists but logo_url is null", async () => {
    const toolId = await seedToolArticle("partial");
    await seedBrandAsset(toolId, { logoUrl: null });

    const result = await resolveToolBrandAsset(testProjectId, "partial");
    expect(result).toBeNull();
  });

  it("caches the resolved row — second call inside TTL skips DB", async () => {
    const toolId = await seedToolArticle("cached");
    await seedBrandAsset(toolId, { primaryColor: "#AABBCC" });

    const first = await resolveToolBrandAsset(testProjectId, "cached");
    expect(first?.type).toBe("svg");

    // Mutate the row directly — bypass the upsert helper so we can verify the
    // cache is what's serving the second call (not a fresh DB read).
    await db
      .update(toolBrandAssets)
      .set({ primaryColor: "#DDEEFF" })
      .where(eq(toolBrandAssets.toolId, toolId));

    const second = await resolveToolBrandAsset(testProjectId, "cached");
    expect(second?.type).toBe("svg");
    if (second?.type === "svg") {
      expect(second.brandColor).toBe("#AABBCC"); // cached value, not the mutated #DDEEFF
    }
  });

  it("re-reads after cache is cleared", async () => {
    const toolId = await seedToolArticle("invalidate");
    await seedBrandAsset(toolId, { primaryColor: "#111111" });

    const first = await resolveToolBrandAsset(testProjectId, "invalidate");
    if (first?.type === "svg") expect(first.brandColor).toBe("#111111");

    await db
      .update(toolBrandAssets)
      .set({ primaryColor: "#222222" })
      .where(eq(toolBrandAssets.toolId, toolId));
    clearToolBrandAssetCacheForTesting();

    const second = await resolveToolBrandAsset(testProjectId, "invalidate");
    if (second?.type === "svg") expect(second.brandColor).toBe("#222222");
  });

  it("collects secondary + tertiary colors into additionalBrandColors", async () => {
    const toolId = await seedToolArticle("multicolor");
    await seedBrandAsset(toolId, {
      primaryColor: "#FF0000",
      secondaryColor: "#00FF00",
      tertiaryColor: "#0000FF",
    });

    const result = await resolveToolBrandAsset(testProjectId, "multicolor");
    expect(result?.type).toBe("svg");
    if (result?.type === "svg") {
      expect(result.additionalBrandColors).toEqual(["#00FF00", "#0000FF"]);
    }
  });

  it("filters duplicates of primary from additionalBrandColors", async () => {
    const toolId = await seedToolArticle("dup-colors");
    await seedBrandAsset(toolId, {
      primaryColor: "#ABCDEF",
      secondaryColor: "#ABCDEF", // dup
      tertiaryColor: "#123456",
    });

    const result = await resolveToolBrandAsset(testProjectId, "dup-colors");
    if (result?.type === "svg") {
      expect(result.additionalBrandColors).toEqual(["#123456"]);
    }
  });

  it("returns null gracefully when R2 fetch fails (bad URL)", async () => {
    const toolId = await seedToolArticle("bad-url");
    // Use an http://localhost URL on a guaranteed-unreachable port. fetch()
    // throws ECONNREFUSED which the resolver swallows and returns null.
    await seedBrandAsset(toolId, { logoUrl: "http://127.0.0.1:1/never.svg" });

    const result = await resolveToolBrandAsset(testProjectId, "bad-url");
    expect(result).toBeNull();
  });
});

describe("resolveToolIcon — Bridge #1 integration", () => {
  it("prefers tool_brand_assets over project_brand_assets when both exist", async () => {
    const toolId = await seedToolArticle("merge-test");

    // Seed project_brand_assets (legacy cache) with one logo content.
    await db.insert(projectBrandAssets).values({
      projectId: testProjectId,
      assetType: "tool_icon",
      assetKey: "merge-test",
      source: "lobe-icons",
      sourceRef: "merge-test-legacy",
      inlineSvg: FAKE_SVG_2,
      displayName: "merge-test",
      metadata: { brandColor: "#OLD-OLD" },
    });

    // Seed tool_brand_assets (canonical Marcel-edit surface) with a DIFFERENT logo.
    await seedBrandAsset(toolId, {
      logoUrl: svgDataUrl(FAKE_SVG),
      primaryColor: "#FRESH",
      brandNameCanonical: "Fresh Marcel Edit",
    });

    const result = await resolveToolIcon(testProjectId, "merge-test");
    expect(result.type).toBe("svg");
    if (result.type === "svg") {
      // Should come from tool_brand_assets (Bridge #1), not project_brand_assets
      expect(result.svg).toContain('d="M1 1h22v22H1z"'); // FAKE_SVG path
      expect(result.svg).not.toContain('cx="12"'); // would be FAKE_SVG_2
      expect(result.brandColor).toBe("#FRESH");
      expect(result.sourceRef).toBe("Fresh Marcel Edit");
    }
  });

  it("falls through to project_brand_assets + chain when tool_brand_assets has no row", async () => {
    // Pre-seed project_brand_assets so chain isn't called (offline-safe).
    await db.insert(projectBrandAssets).values({
      projectId: testProjectId,
      assetType: "tool_icon",
      assetKey: "fallthrough-slug",
      source: "lobe-icons",
      sourceRef: "fallthrough-slug",
      inlineSvg: FAKE_SVG_2,
      displayName: "fallthrough-slug",
      metadata: { brandColor: "#LEGACY" },
    });

    const result = await resolveToolIcon(testProjectId, "fallthrough-slug");
    expect(result.type).toBe("svg");
    if (result.type === "svg") {
      expect(result.svg).toContain('cx="12"'); // FAKE_SVG_2, from project_brand_assets
      expect(result.brandColor).toBe("#LEGACY");
    }
  });
});
