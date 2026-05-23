/**
 * Spec multi-domain-evolution S3.3 — CategoryValidator unit tests.
 * Uses the in-memory lookup factory so the tests stay pure (no DB).
 */
import { describe, expect, it } from "bun:test";
import {
  type CategoryLookup,
  createCategoryValidator,
  createInMemoryCategoryLookup,
} from "../src/validators/index.ts";

const TOOLWIKI = "00000000-0000-0000-0000-000000000001";

const lookup = createInMemoryCategoryLookup([
  { projectId: TOOLWIKI, scope: "tool", slug: "audio-music" },
  { projectId: TOOLWIKI, scope: "tool", slug: "business-productivity" },
  { projectId: TOOLWIKI, scope: "blog", slug: "guides-und-tutorials" },
  { projectId: TOOLWIKI, scope: "knowledge", slug: "grundlagen" },
]);

const validator = createCategoryValidator(lookup);

describe("createCategoryValidator", () => {
  it("accepts a known tool category", async () => {
    const r = await validator.isValidReference("audio-music", "tool", TOOLWIKI);
    expect(r.ok).toBe(true);
  });

  it("accepts a known blog category", async () => {
    const r = await validator.isValidReference("guides-und-tutorials", "blog", TOOLWIKI);
    expect(r.ok).toBe(true);
  });

  it("accepts a known knowledge category", async () => {
    const r = await validator.isValidReference("grundlagen", "knowledge", TOOLWIKI);
    expect(r.ok).toBe(true);
  });

  it("rejects an unknown slug with a structured `missing` payload", async () => {
    const r = await validator.isValidReference("hallucinated-slug", "tool", TOOLWIKI);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("missing");
      expect(r.slug).toBe("hallucinated-slug");
      expect(r.scope).toBe("tool");
    }
  });

  it("rejects same slug when scope mismatches (cross-scope contamination)", async () => {
    // 'audio-music' exists in scope=tool but not scope=blog
    const r = await validator.isValidReference("audio-music", "blog", TOOLWIKI);
    expect(r.ok).toBe(false);
  });

  it("rejects same slug when project mismatches (cross-tenant contamination)", async () => {
    const r = await validator.isValidReference(
      "audio-music",
      "tool",
      "00000000-0000-0000-0000-000000000099",
    );
    expect(r.ok).toBe(false);
  });

  it("treats empty/blank slug as 'no category set' and returns ok", async () => {
    // category is an OPTIONAL field on every collection per Phase-1 §1.
    // The validator must accept absent values without hitting the lookup.
    expect((await validator.isValidReference("", "tool", TOOLWIKI)).ok).toBe(true);
    expect((await validator.isValidReference("   ", "tool", TOOLWIKI)).ok).toBe(true);
  });

  it("trims input before lookup (defensive against accidental whitespace)", async () => {
    const r = await validator.isValidReference("  audio-music  ", "tool", TOOLWIKI);
    expect(r.ok).toBe(true);
  });
});

describe("CategoryLookup DI seam (production wiring contract)", () => {
  it("contract: implementations receive {projectId, scope, slug} and return boolean", async () => {
    // This is the test-against-the-interface that production wiring in
    // apps/api/src/lib/category-validator.ts must satisfy. A failure here
    // signals a contract drift between content-schema and its consumer.
    const calls: Array<{ projectId: string; scope: string; slug: string }> = [];
    const recordingLookup: CategoryLookup = {
      async exists(args) {
        calls.push(args);
        return args.slug === "known";
      },
    };
    const v = createCategoryValidator(recordingLookup);
    await v.isValidReference("known", "tool", "p1");
    await v.isValidReference("unknown", "blog", "p2");
    expect(calls).toEqual([
      { projectId: "p1", scope: "tool", slug: "known" },
      { projectId: "p2", scope: "blog", slug: "unknown" },
    ]);
  });
});
