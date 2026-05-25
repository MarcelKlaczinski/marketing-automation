// Spec 65.0 Day 1-2 — bootstrap-sync integration.
//
// Covers the kebab→camel helper plus an end-to-end run that walks the real
// in-memory registry, hashes the real definition files on disk, and lands the
// rows in the templates table. Real Postgres + real filesystem.
import { afterAll, describe, expect, it } from "bun:test";
import {
  db,
  eq,
  listActiveGlobalTemplates,
  templates,
} from "@marketing-auto/db";
import {
  bootstrapAndSyncTemplates,
  buildSpecsFromInMemoryRegistry,
  kebabToCamelKey,
  relativeDefinitionPath,
} from "../../src/lib/template-registry-sync.ts";

describe("kebabToCamelKey", () => {
  it("camelCases kebab-segments after the first", () => {
    expect(kebabToCamelKey("single-tool-spotlight")).toBe("singleToolSpotlight");
    expect(kebabToCamelKey("verdict-per-use-case")).toBe("verdictPerUseCase");
    expect(kebabToCamelKey("pro-con-verdict")).toBe("proConVerdict");
  });

  it("leaves digit-only trailing segments intact", () => {
    expect(kebabToCamelKey("comparison-grid-4")).toBe("comparisonGrid4");
    expect(kebabToCamelKey("comparison-grid-3")).toBe("comparisonGrid3");
  });

  it("handles a single-segment key as identity", () => {
    expect(kebabToCamelKey("solo")).toBe("solo");
  });
});

describe("relativeDefinitionPath", () => {
  it("renders the path under the flat definitions/ layout", () => {
    expect(relativeDefinitionPath("comparison-grid-4")).toBe(
      "packages/social/src/templates/definitions/comparisonGrid4.ts",
    );
  });
});

describe("buildSpecsFromInMemoryRegistry", () => {
  it("hashes the real definition files for every registered template", async () => {
    // Bootstrap the in-memory registry first so we can introspect.
    await bootstrapAndSyncTemplates();
    const specs = await buildSpecsFromInMemoryRegistry();
    expect(specs.length).toBeGreaterThan(0);
    for (const s of specs) {
      expect(s.fileHash.startsWith("hash:")).toBe(true);
      expect(s.fileHash.length).toBeGreaterThan(10);
      expect(s.filePath.startsWith("packages/social/")).toBe(true);
      expect(s.formatTypes.length).toBe(1);
      expect(["carousel", "reel", "story"]).toContain(s.outputFormat);
      expect(s.estimatedCostUsd).toBeGreaterThan(0);
      expect(s.defaultSlideCount).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("bootstrapAndSyncTemplates", () => {
  afterAll(async () => {
    // Don't touch global rows — leave them for the running API to use.
  });

  it("idempotently lands all registered templates as global rows", async () => {
    await bootstrapAndSyncTemplates(); // first call

    const before = await listActiveGlobalTemplates();
    expect(before.length).toBeGreaterThan(0);
    const initialKeys = before.map((r) => r.templateKey).sort();

    await bootstrapAndSyncTemplates(); // second call — should be all unchanged
    const after = await listActiveGlobalTemplates();
    const afterKeys = after.map((r) => r.templateKey).sort();
    expect(afterKeys).toEqual(initialKeys);

    // Verify the expected canonical 5 are present (Spec 60.5 template inventory).
    const expected = [
      "comparison-grid-3",
      "comparison-grid-4",
      "pro-con-verdict",
      "single-tool-spotlight",
      "verdict-per-use-case",
    ];
    for (const key of expected) {
      expect(afterKeys).toContain(key);
    }
  });

  it("populates lastSeenAt / lastSeenAt-update on a re-touch", async () => {
    await bootstrapAndSyncTemplates();
    const [first] = await db
      .select()
      .from(templates)
      .where(eq(templates.templateKey, "comparison-grid-4"))
      .limit(1);
    expect(first).toBeDefined();
    if (!first) throw new Error("unreachable");
    const firstSeen = first.lastSeenAt;

    await new Promise((r) => setTimeout(r, 50));
    await bootstrapAndSyncTemplates();
    const [second] = await db
      .select()
      .from(templates)
      .where(eq(templates.templateKey, "comparison-grid-4"))
      .limit(1);
    expect(second).toBeDefined();
    if (!second) throw new Error("unreachable");
    expect(second.lastSeenAt.getTime()).toBeGreaterThan(firstSeen.getTime());
  });
});
