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
  // Chain order since Spec 65.2 follow-up: lobe-icons → simple-icons → iconify.
  // The fallback layers below pick slugs that empirically miss lobe-icons
  // (verified against @lobehub/icons-static-svg v1.90.0) so the chain still
  // exercises each adapter's tryResolve.

  it("resolves slack via iconify (not in lobe-icons or simple-icons)", async () => {
    // `slack` is missing from lobe-icons + simple-icons (the latter dropped
    // it in v16); iconify still has it via the logos collection.
    const result = await resolveToolIcon(testProjectId, "slack");
    expect(result.type).toBe("svg");
    if (result.type === "svg") {
      expect(result.svg).toContain("<svg");
      expect(result.source).toBe("iconify");
    }
  });

  it("resolves spotify via simple-icons (not in lobe-icons)", async () => {
    // `spotify` is consumer-product, not in lobe-icons' AI-focused set.
    const result = await resolveToolIcon(testProjectId, "spotify");
    expect(result.type).toBe("svg");
    if (result.type === "svg") {
      expect(result.source).toBe("simple-icons");
      expect(result.brandColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("resolves claude via lobe-icons (lobe-FIRST chain since 65.2)", async () => {
    // Pre-65.2 this resolved via simple-icons; the chain re-order means
    // lobe wins now (richer asset: brand-color + wordmark variant).
    const result = await resolveToolIcon(testProjectId, "claude");
    expect(result.type).toBe("svg");
    if (result.type === "svg") {
      expect(result.source).toBe("lobe-icons");
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
    // `slack` falls through lobe + simple-icons → resolves via iconify.
    // Exercises the cache-write for the iconify branch specifically (the
    // other branches share the same write path, so testing one suffices).
    await resolveToolIcon(testProjectId, "slack");

    const cached = await db.query.projectBrandAssets.findFirst({
      where: and(
        eq(projectBrandAssets.projectId, testProjectId),
        eq(projectBrandAssets.assetType, "tool_icon"),
        eq(projectBrandAssets.assetKey, "slack"),
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
    // Seed a bad cache entry (simulating a stale source value from a
    // pre-52a / pre-65.2 cache row that no longer matches the validSources
    // allow-list inside resolveToolIcon).
    await db.insert(projectBrandAssets).values({
      projectId: testProjectId,
      assetType: "tool_icon",
      assetKey: "slack",
      source: "broken-old-source",
      displayName: "slack",
      metadata: {},
    });

    // Should ignore the stale entry and re-resolve through the chain.
    // `slack` lands on iconify (lobe + simple-icons both miss).
    const result = await resolveToolIcon(testProjectId, "slack");
    expect(result.type).toBe("svg");
    if (result.type === "svg") {
      expect(result.source).toBe("iconify");
    }
  });
});
