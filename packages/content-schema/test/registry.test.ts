/**
 * Spec multi-domain-evolution S5.2 — Domain-Registry tests.
 * Uses the in-memory builders so the suite stays pure (no DB).
 */
import { describe, expect, it } from "bun:test";
import {
  type DomainSpec,
  type ProjectLookup,
  createDbBackedRegistry,
  forNicheStatic,
} from "../src/registry/index.ts";
import { z } from "zod";
import { toolwikiDomain } from "../src/domains/toolwiki/spec.ts";

const BK_DOMAIN: DomainSpec = {
  niche: "balkon-kraft-werk",
  domain: "balkon-kraft-werk.de",
  locales: ["de"] as const,
  collections: [
    {
      name: "blog",
      extrasSchema: z.object({
        intentType: z
          .enum(["installation", "wirtschaftlichkeit", "vergleich", "troubleshooting"])
          .optional(),
        primaryProduct: z.string().min(1).max(80).optional(),
      }),
    },
  ],
  intentTaxonomy: ["installation", "wirtschaftlichkeit", "vergleich", "troubleshooting"],
};

const TOOLWIKI_PROJECT_ID = "00000000-0000-0000-0000-00000000aaaa";
const BK_PROJECT_ID = "00000000-0000-0000-0000-00000000bbbb";
const UNKNOWN_PROJECT_ID = "00000000-0000-0000-0000-00000000cccc";

function makeStaticLookup(): ProjectLookup {
  return {
    async resolve(projectId) {
      if (projectId === TOOLWIKI_PROJECT_ID) {
        return {
          niche: "ai-tool-wiki",
          domain: "toolwiki.ai",
          locales: ["de", "en"] as const,
        };
      }
      if (projectId === BK_PROJECT_ID) {
        return {
          niche: "balkon-kraft-werk",
          domain: "balkon-kraft-werk.de",
          locales: ["de"] as const,
        };
      }
      return null;
    },
  };
}

describe("forNicheStatic (sync test helper)", () => {
  it("returns the Toolwiki context with the 5 canonical collections", () => {
    const ctx = forNicheStatic([toolwikiDomain], "ai-tool-wiki", "toolwiki.ai");
    expect(ctx).not.toBeNull();
    expect(ctx?.niche).toBe("ai-tool-wiki");
    expect(ctx?.domain).toBe("toolwiki.ai");
    expect([...(ctx?.getAllowedCollections() ?? [])].sort()).toEqual([
      "blog",
      "comparison",
      "ki-wissen",
      "tools",
      "usecases",
    ]);
  });

  it("returns null for an unknown niche", () => {
    const ctx = forNicheStatic([toolwikiDomain], "unknown-niche", "example.com");
    expect(ctx).toBeNull();
  });

  it("Toolwiki intent taxonomy matches TOOLWIKI_BLOG_INTENT_TYPES (9 values)", () => {
    const ctx = forNicheStatic([toolwikiDomain], "ai-tool-wiki", "toolwiki.ai");
    expect(ctx?.getIntentTaxonomy()).toEqual([
      "overview",
      "pricing",
      "features",
      "use-cases",
      "comparison",
      "tutorial",
      "review",
      "ethics",
      "general",
    ]);
  });
});

describe("CollectionContext.validate (Toolwiki blog)", () => {
  const ctx = forNicheStatic([toolwikiDomain], "ai-tool-wiki", "toolwiki.ai");
  const blog = ctx?.forCollection("blog");

  it("accepts a minimal Toolwiki blog frontmatter", () => {
    expect(blog).not.toBeNull();
    const result = blog!.validate({
      title: "Test article",
      locale: "de",
      intentType: "review",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a Toolwiki blog frontmatter with BK intentType", () => {
    const result = blog!.validate({
      title: "Test",
      locale: "de",
      intentType: "wirtschaftlichkeit", // not in Toolwiki blog enum
    });
    expect(result.ok).toBe(false);
  });

  it("returns null for an unknown collection", () => {
    expect(ctx?.forCollection("guides")).toBeNull();
  });
});

describe("createDbBackedRegistry — projectId → DomainContext", () => {
  const registry = createDbBackedRegistry([toolwikiDomain, BK_DOMAIN], makeStaticLookup());

  it("Toolwiki projectId resolves to ai-tool-wiki context with the right domain", async () => {
    const ctx = await registry.forProject(TOOLWIKI_PROJECT_ID);
    expect(ctx).not.toBeNull();
    expect(ctx?.niche).toBe("ai-tool-wiki");
    expect(ctx?.domain).toBe("toolwiki.ai");
  });

  it("BK projectId resolves to balkon-kraft-werk context (multi-domain proof)", async () => {
    const ctx = await registry.forProject(BK_PROJECT_ID);
    expect(ctx).not.toBeNull();
    expect(ctx?.niche).toBe("balkon-kraft-werk");
    expect(ctx?.domain).toBe("balkon-kraft-werk.de");
    expect(ctx?.getIntentTaxonomy()).toContain("wirtschaftlichkeit");
    expect(ctx?.getIntentTaxonomy()).not.toContain("overview"); // not in BK enum
    expect([...(ctx?.getAllowedCollections() ?? [])]).toEqual(["blog"]); // BK has only blog
  });

  it("unknown projectId resolves to null", async () => {
    const ctx = await registry.forProject(UNKNOWN_PROJECT_ID);
    expect(ctx).toBeNull();
  });

  it("multi-domain isolation: BK projectId does NOT see Toolwiki intents", async () => {
    const ctx = await registry.forProject(BK_PROJECT_ID);
    const blog = ctx?.forCollection("blog");
    // BK blog accepts "installation"
    expect(blog?.validate({ title: "Sample", locale: "de", intentType: "installation" }).ok).toBe(true);
    // BK blog rejects Toolwiki's "review"
    expect(blog?.validate({ title: "Sample", locale: "de", intentType: "review" }).ok).toBe(false);
  });
});

describe("CollectionContext.getCoreSchema / getExtrasSchema accessors", () => {
  const ctx = forNicheStatic([toolwikiDomain], "ai-tool-wiki", "toolwiki.ai");
  const blog = ctx?.forCollection("blog");

  it("exposes the Core schema alone (Layer 1)", () => {
    const core = blog!.getCoreSchema();
    // Core has its own min-length rule on title (min 2) — verifies we got
    // the actual Core schema, not just any pass-through.
    const tooShort = core.safeParse({ title: "x", locale: "de" });
    expect(tooShort.success).toBe(false);
    // Valid Core payload passes
    const ok = core.safeParse({ title: "Sample", locale: "de" });
    expect(ok.success).toBe(true);
  });

  it("exposes the Extras schema alone (Layer 2)", () => {
    const extras = blog!.getExtrasSchema();
    const result = extras.safeParse({ intentType: "review" });
    expect(result.success).toBe(true);
  });
});
