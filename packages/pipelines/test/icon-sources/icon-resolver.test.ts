/**
 * Integration tests for the icon resolution chain.
 * Requires a running PostgreSQL instance (uses the shared test DB).
 */
import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { db, projectBrandAssets, projects } from "@marketing-auto/db";
import { resolveToolIcon } from "../../src/_lib/resolve-tool-icon.ts";

// ─── Test project setup ───────────────────────────────────────────────────────

let testProjectId: string;

beforeAll(async () => {
  // Insert a minimal project for asset scoping
  const [proj] = await db
    .insert(projects)
    .values({
      slug: `icon-test-${crypto.randomUUID().slice(0, 8)}`,
      name: "Icon Resolver Test Project",
      industry: "other",
      pipelineTemplate: "educational",
    })
    .returning({ id: projects.id });
  testProjectId = proj!.id;
});

afterEach(async () => {
  // Clean up cached entries between tests to ensure isolation
  await db
    .delete(projectBrandAssets)
    .where(and(
      eq(projectBrandAssets.projectId, testProjectId),
      eq(projectBrandAssets.assetType, "tool_icon"),
    ));
});

// ─── Cleanup after all tests ──────────────────────────────────────────────────

import { afterAll } from "bun:test";

afterAll(async () => {
  await db.delete(projects).where(eq(projects.id, testProjectId));
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("resolveToolIcon — resolution chain", () => {
  it("resolves midjourney via iconify (not in simple-icons v16)", async () => {
    const result = await resolveToolIcon(testProjectId, "midjourney");
    expect(result.type).toBe("svg");
    if (result.type === "svg") {
      expect(result.svg).toContain("<svg");
      expect(result.source).toBe("iconify");
    }
  });

  it("resolves claude via simple-icons", async () => {
    const result = await resolveToolIcon(testProjectId, "claude");
    expect(result.type).toBe("svg");
    if (result.type === "svg") {
      expect(result.source).toBe("simple-icons");
      expect(result.brandColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("resolves recraft via lobe-icons (not in simple-icons or iconify)", async () => {
    const result = await resolveToolIcon(testProjectId, "recraft");
    expect(result.type).toBe("svg");
    if (result.type === "svg") {
      expect(result.source).toBe("lobe-icons");
      expect(result.svg).toContain("<svg");
    }
  });

  it("resolves ideogram via lobe-icons", async () => {
    const result = await resolveToolIcon(testProjectId, "ideogram");
    expect(result.type).toBe("svg");
    if (result.type === "svg") {
      expect(result.source).toBe("lobe-icons");
    }
  });

  it("falls back to deterministic avatar for unknown tool — never emoji", async () => {
    const result = await resolveToolIcon(testProjectId, "zzz-unknown-tool-xyz-52a");
    expect(result.type).toBe("avatar");
    if (result.type === "avatar") {
      expect(result.initials).toBe("ZZ");
      expect(typeof result.hue).toBe("number");
      expect(result.hue).toBeGreaterThanOrEqual(0);
      expect(result.hue).toBeLessThan(360);
      // Critically: no emoji in the result
      expect(result).not.toHaveProperty("emoji");
    }
  });

  it("result NEVER contains emoji string", async () => {
    for (const slug of ["recraft", "ideogram", "flux-pro", "zzz-unknown-xyz"]) {
      const result = await resolveToolIcon(testProjectId, slug);
      expect(result).not.toHaveProperty("emoji");
      if (result.type === "svg") {
        // SVG may contain text but should not have emoji
        expect(result.svg).not.toMatch(/[\u{1F300}-\u{1FFFF}]/u);
      }
    }
  });
});

describe("resolveToolIcon — DB cache behaviour", () => {
  it("writes to DB on first resolution", async () => {
    await resolveToolIcon(testProjectId, "midjourney");

    const cached = await db.query.projectBrandAssets.findFirst({
      where: and(
        eq(projectBrandAssets.projectId, testProjectId),
        eq(projectBrandAssets.assetType, "tool_icon"),
        eq(projectBrandAssets.assetKey, "midjourney"),
      ),
    });

    expect(cached).not.toBeNull();
    expect(cached!.inlineSvg).toContain("<svg");
    expect(cached!.source).toBe("iconify");
  });

  it("returns cached SVG on second call without re-resolving", async () => {
    // First call — writes cache
    const first = await resolveToolIcon(testProjectId, "claude");
    expect(first.type).toBe("svg");

    // Second call — should hit cache
    const second = await resolveToolIcon(testProjectId, "claude");
    expect(second.type).toBe("svg");
    if (first.type === "svg" && second.type === "svg") {
      expect(second.svg).toBe(first.svg);
      expect(second.source).toBe(first.source);
    }
  });

  it("skips re-resolving when source is deterministic-avatar in cache", async () => {
    const unknown = "zzz-avatar-cached-test";
    await resolveToolIcon(testProjectId, unknown);

    // Verify avatar was cached
    const cached = await db.query.projectBrandAssets.findFirst({
      where: and(
        eq(projectBrandAssets.projectId, testProjectId),
        eq(projectBrandAssets.assetType, "tool_icon"),
        eq(projectBrandAssets.assetKey, unknown),
      ),
    });
    expect(cached!.source).toBe("deterministic-avatar");

    // Second call returns avatar without touching adapters
    const result = await resolveToolIcon(testProjectId, unknown);
    expect(result.type).toBe("avatar");
  });

  it("re-resolves when cached source is stale/unknown", async () => {
    // Seed a bad cache entry (simulating pre-52a broken lobe-icons entry)
    await db.insert(projectBrandAssets).values({
      projectId: testProjectId,
      assetType: "tool_icon",
      assetKey: "midjourney",
      source: "broken-old-source",
      displayName: "midjourney",
      metadata: {},
    });

    // Should ignore the stale entry and re-resolve
    const result = await resolveToolIcon(testProjectId, "midjourney");
    expect(result.type).toBe("svg");
    if (result.type === "svg") {
      // Should have been re-resolved via iconify, overwriting the bad cache
      expect(result.source).toBe("iconify");
    }
  });
});
