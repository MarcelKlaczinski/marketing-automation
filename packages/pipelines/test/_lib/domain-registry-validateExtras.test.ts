/**
 * Spec multi-domain-evolution Domain-Registry follow-up — Phase 3 regression.
 *
 * Locks in byte-equivalence between the legacy direct-import validators
 * (`validateComparisonExtras` / `validateKiWissenExtras`) and the new
 * registry-routed path (`collectionCtx.validateExtras(...)`) that
 * `DraftStep` now uses for Toolwiki projects. If a future spec rewrites
 * one path and forgets the other, these tests fail loudly.
 */
import { describe, expect, it } from "bun:test";
import { toolwikiDomain } from "@marketing-auto/content-schema/domains/toolwiki";
import {
  createDbBackedRegistry,
  type ProjectLookup,
} from "@marketing-auto/content-schema/registry";
import { validateComparisonExtras } from "../../src/article/frontmatter/comparison.ts";
import { validateKiWissenExtras } from "../../src/article/frontmatter/ki-wissen.ts";

const TOOLWIKI_ID = "55555555-5555-5555-5555-555555555555";

const stubLookup: ProjectLookup = {
  async resolve(projectId) {
    if (projectId === TOOLWIKI_ID) {
      return {
        niche: "ai-tool-wiki",
        domain: "toolwiki.ai",
        locales: ["de", "en"] as const,
      };
    }
    return null;
  },
};

const registry = createDbBackedRegistry([toolwikiDomain], stubLookup);

describe("registry.validateExtras vs legacy direct-import — comparison", () => {
  const baseValid = {
    toolSlugs: ["chatgpt", "claude"],
    winner: "tool-a" as const,
    verdict:
      "Both models are excellent generalists. ChatGPT edges out for coding; Claude for long-context.",
    comparedAt: "2026-05-19",
    testMethodology: "Tested across 12 real coding tasks during May 2026.",
  };

  it("accepts the same minimal valid comparison frontmatter as the legacy validator", async () => {
    const ctx = await registry.forProject(TOOLWIKI_ID);
    const collectionCtx = ctx?.forCollection("comparison");
    expect(collectionCtx).not.toBeNull();
    const legacy = validateComparisonExtras(baseValid);
    const registryResult = collectionCtx!.validateExtras(baseValid);
    expect(legacy.ok).toBe(true);
    expect(registryResult.ok).toBe(true);
  });

  it("rejects winner='depends' without useCaseVerdicts via BOTH paths", async () => {
    const ctx = await registry.forProject(TOOLWIKI_ID);
    const collectionCtx = ctx?.forCollection("comparison");
    const invalid = { ...baseValid, winner: "depends" };
    const legacy = validateComparisonExtras(invalid);
    const registryResult = collectionCtx!.validateExtras(invalid);
    expect(legacy.ok).toBe(false);
    expect(registryResult.ok).toBe(false);
    // Both must surface the cross-field rule, not a bare schema error.
    if (!legacy.ok) expect(legacy.error).toContain("depends");
    if (!registryResult.ok) expect(registryResult.error).toContain("depends");
  });

  it("rejects toolSlugs of length 1 via BOTH paths", async () => {
    const ctx = await registry.forProject(TOOLWIKI_ID);
    const collectionCtx = ctx?.forCollection("comparison");
    const invalid = { ...baseValid, toolSlugs: ["only-one"] };
    expect(validateComparisonExtras(invalid).ok).toBe(false);
    expect(collectionCtx!.validateExtras(invalid).ok).toBe(false);
  });
});

describe("registry.validateExtras vs legacy direct-import — ki-wissen", () => {
  const baseValid = {
    category: "Grundlagen",
    level: "Einsteiger",
    icon: "Brain",
    facts: ["Fact one is meaningful.", "Fact two adds nuance.", "Fact three closes the trio."],
    next: ["Was ist ein Transformer?", "Was sind Embeddings?"],
  };

  it("accepts the same minimal valid ki-wissen extras as the legacy validator", async () => {
    const ctx = await registry.forProject(TOOLWIKI_ID);
    const collectionCtx = ctx?.forCollection("ki-wissen");
    expect(collectionCtx).not.toBeNull();
    const legacy = validateKiWissenExtras(baseValid);
    const registryResult = collectionCtx!.validateExtras(baseValid);
    expect(legacy.ok).toBe(true);
    expect(registryResult.ok).toBe(true);
  });

  it("Pattern 116: rejects adsenseSlots / hasAffiliateLinks via BOTH paths", async () => {
    const ctx = await registry.forProject(TOOLWIKI_ID);
    const collectionCtx = ctx?.forCollection("ki-wissen");
    const withMonetization = { ...baseValid, adsenseSlots: ["a-slot"] };
    expect(validateKiWissenExtras(withMonetization).ok).toBe(false);
    expect(collectionCtx!.validateExtras(withMonetization).ok).toBe(false);
  });
});

describe("registry returns null for unknown projects", () => {
  it("falls through to null so DraftStep can route to the legacy direct import", async () => {
    const ctx = await registry.forProject("99999999-9999-9999-9999-999999999999");
    expect(ctx).toBeNull();
  });
});
