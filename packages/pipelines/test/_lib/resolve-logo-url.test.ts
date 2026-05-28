/**
 * Spec 65.15 — Tests for `resolveLogoUrl`.
 *
 * Coverage:
 *   1. No `project_brand_assets` row → returns null
 *   2. Theme-variant: `main-dark` row matched when theme=dark
 *   3. Fallback: `main` row matched when no `main-dark` exists
 *   4. Source `r2` → returns `https://pub.toolwiki.ai/<sourceRef>`
 *   5. Source `inline-svg` → returns `data:image/svg+xml;base64,…`
 *   6. Source `wordmark` → returns null (not appropriate as watermark)
 *   7. Source `lobe-icons` → returns null (mono icon, not project logo)
 *   8. Theme-variant priority: dark variant wins over base when both exist
 *   9. Project not found → returns null
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { and, db, eq, projectBrandAssets, projects } from "@marketing-auto/db";
import { resolveLogoUrl } from "../../src/_lib/resolve-logo-url.ts";

let testProjectId: string;

const FAKE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1 1h22v22H1z"/></svg>';

beforeAll(async () => {
  const [proj] = await db
    .insert(projects)
    .values({
      slug: `logo-test-${crypto.randomUUID().slice(0, 8)}`,
      name: "Logo Resolver Test Project",
      industry: "other",
      pipelineTemplate: "educational",
    })
    .returning({ id: projects.id });
  testProjectId = proj!.id;
});

afterAll(async () => {
  await db.delete(projects).where(eq(projects.id, testProjectId));
});

afterEach(async () => {
  await db
    .delete(projectBrandAssets)
    .where(
      and(
        eq(projectBrandAssets.projectId, testProjectId),
        eq(projectBrandAssets.assetType, "logo"),
      ),
    );
});

describe("resolveLogoUrl", () => {
  it("returns null when no logo asset exists", async () => {
    const url = await resolveLogoUrl(testProjectId, "dark");
    expect(url).toBeNull();
  });

  it("returns null for non-existent project", async () => {
    const url = await resolveLogoUrl(crypto.randomUUID(), "dark");
    expect(url).toBeNull();
  });

  it("matches `main-dark` variant when theme=dark", async () => {
    await db.insert(projectBrandAssets).values({
      projectId: testProjectId,
      assetType: "logo",
      assetKey: "main-dark",
      source: "r2",
      sourceRef: "toolwiki/logos/main-dark.png",
    });

    const url = await resolveLogoUrl(testProjectId, "dark");
    expect(url).toBe("https://pub.toolwiki.ai/toolwiki/logos/main-dark.png");
  });

  it("matches `main-light` variant when theme=light", async () => {
    await db.insert(projectBrandAssets).values({
      projectId: testProjectId,
      assetType: "logo",
      assetKey: "main-light",
      source: "r2",
      sourceRef: "toolwiki/logos/main-light.png",
    });

    const url = await resolveLogoUrl(testProjectId, "light");
    expect(url).toBe("https://pub.toolwiki.ai/toolwiki/logos/main-light.png");
  });

  it("falls back to base `main` when no theme-variant exists", async () => {
    await db.insert(projectBrandAssets).values({
      projectId: testProjectId,
      assetType: "logo",
      assetKey: "main",
      source: "r2",
      sourceRef: "toolwiki/logos/main.png",
    });

    const url = await resolveLogoUrl(testProjectId, "dark");
    expect(url).toBe("https://pub.toolwiki.ai/toolwiki/logos/main.png");
  });

  it("returns data URL for inline-svg source", async () => {
    await db.insert(projectBrandAssets).values({
      projectId: testProjectId,
      assetType: "logo",
      assetKey: "main",
      source: "inline-svg",
      inlineSvg: FAKE_SVG,
    });

    const url = await resolveLogoUrl(testProjectId, "dark");
    expect(url).not.toBeNull();
    expect(url?.startsWith("data:image/svg+xml;base64,")).toBe(true);
    // Decode the base64 to verify roundtrip
    const base64 = url!.replace("data:image/svg+xml;base64,", "");
    const decoded = Buffer.from(base64, "base64").toString("utf-8");
    expect(decoded).toBe(FAKE_SVG);
  });

  it("returns null for wordmark source (not appropriate as watermark)", async () => {
    await db.insert(projectBrandAssets).values({
      projectId: testProjectId,
      assetType: "logo",
      assetKey: "main",
      source: "wordmark",
      sourceRef: "toolwiki.ai",
    });

    const url = await resolveLogoUrl(testProjectId, "dark");
    expect(url).toBeNull();
  });

  it("returns null for lobe-icons source (mono icon, not project logo)", async () => {
    await db.insert(projectBrandAssets).values({
      projectId: testProjectId,
      assetType: "logo",
      assetKey: "main",
      source: "lobe-icons",
      sourceRef: "openai-color",
    });

    const url = await resolveLogoUrl(testProjectId, "dark");
    expect(url).toBeNull();
  });

  it("theme-variant wins over base when both exist", async () => {
    await db.insert(projectBrandAssets).values([
      {
        projectId: testProjectId,
        assetType: "logo",
        assetKey: "main",
        source: "r2",
        sourceRef: "toolwiki/logos/main-base.png",
      },
      {
        projectId: testProjectId,
        assetType: "logo",
        assetKey: "main-dark",
        source: "r2",
        sourceRef: "toolwiki/logos/main-dark.png",
      },
    ]);

    const url = await resolveLogoUrl(testProjectId, "dark");
    expect(url).toBe("https://pub.toolwiki.ai/toolwiki/logos/main-dark.png");
  });

  it("falls back to opposite-theme variant when only one variant exists (Marcel Q2)", async () => {
    // Only `main-dark` uploaded; light-theme request should still find it.
    await db.insert(projectBrandAssets).values({
      projectId: testProjectId,
      assetType: "logo",
      assetKey: "main-dark",
      source: "r2",
      sourceRef: "toolwiki/logos/main-dark.png",
    });

    const url = await resolveLogoUrl(testProjectId, "light");
    expect(url).toBe("https://pub.toolwiki.ai/toolwiki/logos/main-dark.png");
  });

  it("returns null when row exists but source has no usable URL data", async () => {
    await db.insert(projectBrandAssets).values({
      projectId: testProjectId,
      assetType: "logo",
      assetKey: "main",
      source: "r2",
      sourceRef: null, // explicitly missing — no URL can be built
    });

    const url = await resolveLogoUrl(testProjectId, "dark");
    expect(url).toBeNull();
  });
});
