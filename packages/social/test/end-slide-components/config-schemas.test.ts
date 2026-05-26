/**
 * Spec 65.9 — Per-type config schema validation tests.
 *
 * Verifies that each Zod schema accepts canonical seed-row payloads and
 * rejects shape violations. Pipeline-side consumers (brief-generator
 * `select-end-slide.ts`) parse `end_slide_definitions.config` through these
 * before passing to HostSlide — a regression here would surface at render
 * time as "Cannot read properties of undefined".
 */
import { describe, expect, it } from "bun:test";
import {
  END_SLIDE_CONFIG_SCHEMAS,
  END_SLIDE_TYPES,
  commentToGetConfigSchema,
  endSlideDataSchema,
  followCtaConfigSchema,
  linkInBioConfigSchema,
  quoteActionConfigSchema,
  saveShareConfigSchema,
  swipeUpConfigSchema,
  tagFriendConfigSchema,
} from "../../src/end-slide-components/types";

describe("End-slide config schemas", () => {
  describe("follow-cta", () => {
    it("accepts minimal payload", () => {
      const parsed = followCtaConfigSchema.parse({ handle: "@toolwiki.ai" });
      expect(parsed.handle).toBe("@toolwiki.ai");
    });

    it("accepts custom message override", () => {
      const parsed = followCtaConfigSchema.parse({
        handle: "@x",
        customMessage: { de: "Folge für mehr", en: "Follow for more" },
      });
      expect(parsed.customMessage?.de).toBe("Folge für mehr");
      expect(parsed.customMessage?.en).toBe("Follow for more");
    });

    it("rejects empty handle", () => {
      expect(() => followCtaConfigSchema.parse({ handle: "" })).toThrow();
    });

    it("rejects handle over 40 chars", () => {
      expect(() => followCtaConfigSchema.parse({ handle: "@".padEnd(41, "x") })).toThrow();
    });
  });

  describe("comment-to-get", () => {
    it("accepts canonical payload", () => {
      const parsed = commentToGetConfigSchema.parse({
        keyword: "CLAUDE",
        resourceTitle: { de: "Claude Prompts Pack", en: "Claude Prompts Pack" },
      });
      expect(parsed.keyword).toBe("CLAUDE");
      expect(parsed.resourceTitle.de).toBe("Claude Prompts Pack");
    });

    it("rejects keyword under 2 chars", () => {
      expect(() =>
        commentToGetConfigSchema.parse({
          keyword: "A",
          resourceTitle: { de: "XX", en: "XX" },
        }),
      ).toThrow();
    });

    it("rejects keyword over 20 chars (Instagram comment-trigger limit)", () => {
      expect(() =>
        commentToGetConfigSchema.parse({
          keyword: "VERYLONGKEYWORD-OVER-LIMIT",
          resourceTitle: { de: "XX", en: "XX" },
        }),
      ).toThrow();
    });
  });

  describe("link-in-bio", () => {
    it("accepts url-less payload", () => {
      const parsed = linkInBioConfigSchema.parse({
        description: { de: "Vollständiger Vergleich", en: "Full comparison" },
      });
      expect(parsed.url).toBeUndefined();
    });

    it("accepts payload with url", () => {
      const parsed = linkInBioConfigSchema.parse({
        description: { de: "Vollständiger Vergleich", en: "Full comparison" },
        url: "toolwiki.ai",
      });
      expect(parsed.url).toBe("toolwiki.ai");
    });
  });

  describe("tag-friend", () => {
    it("accepts prompt-only", () => {
      const parsed = tagFriendConfigSchema.parse({
        prompt: { de: "Wer braucht das?", en: "Who needs this?" },
      });
      expect(parsed.prompt.de).toBe("Wer braucht das?");
    });

    it("accepts prompt + context", () => {
      const parsed = tagFriendConfigSchema.parse({
        prompt: { de: "Wer braucht das?", en: "Who needs this?" },
        context: {
          de: "Markiere jemanden der gerade KI entdeckt",
          en: "Tag someone discovering AI",
        },
      });
      expect(parsed.context).toBeDefined();
    });
  });

  describe("save-share-cta", () => {
    it("accepts save primaryAction", () => {
      const parsed = saveShareConfigSchema.parse({
        primaryAction: "save",
        message: { de: "Speichern", en: "Save it" },
      });
      expect(parsed.primaryAction).toBe("save");
    });

    it("accepts share primaryAction", () => {
      const parsed = saveShareConfigSchema.parse({
        primaryAction: "share",
        message: { de: "Teilen", en: "Share it" },
      });
      expect(parsed.primaryAction).toBe("share");
    });

    it("rejects unknown primaryAction", () => {
      expect(() =>
        saveShareConfigSchema.parse({
          primaryAction: "tap" as never,
          message: { de: "XX", en: "XX" },
        }),
      ).toThrow();
    });
  });

  describe("swipe-up", () => {
    it("accepts destination-only", () => {
      const parsed = swipeUpConfigSchema.parse({ destination: "toolwiki.ai" });
      expect(parsed.destination).toBe("toolwiki.ai");
    });
  });

  describe("quote-action", () => {
    it("accepts quote-only", () => {
      const parsed = quoteActionConfigSchema.parse({
        quote: {
          de: "Stop scrolling. Test es in 30 Sekunden.",
          en: "Stop scrolling. Test it in 30 seconds.",
        },
      });
      expect(parsed.attribution).toBeUndefined();
    });

    it("accepts quote + attribution", () => {
      const parsed = quoteActionConfigSchema.parse({
        quote: { de: "Stop scrolling.", en: "Stop scrolling." },
        attribution: { de: "Marcel @ Toolwiki", en: "Marcel @ Toolwiki" },
      });
      expect(parsed.attribution?.en).toBe("Marcel @ Toolwiki");
    });

    it("rejects quote under 4 chars", () => {
      expect(() =>
        quoteActionConfigSchema.parse({ quote: { de: "abc", en: "abc" } }),
      ).toThrow();
    });
  });
});

describe("END_SLIDE_TYPES const", () => {
  it("contains exactly the 7 v1 types", () => {
    expect([...END_SLIDE_TYPES].sort()).toEqual(
      [
        "comment-to-get",
        "follow-cta",
        "link-in-bio",
        "quote-action",
        "save-share-cta",
        "swipe-up",
        "tag-friend",
      ].sort(),
    );
  });

  it("END_SLIDE_CONFIG_SCHEMAS has an entry for every type", () => {
    for (const type of END_SLIDE_TYPES) {
      expect(END_SLIDE_CONFIG_SCHEMAS[type]).toBeDefined();
    }
  });
});

describe("endSlideDataSchema discriminated union", () => {
  it("round-trips a follow-cta variant", () => {
    const input = {
      type: "follow-cta" as const,
      config: { handle: "@x" },
    };
    const parsed = endSlideDataSchema.parse(input);
    expect(parsed.type).toBe("follow-cta");
  });

  it("rejects mismatched type ↔ config shape", () => {
    expect(() =>
      endSlideDataSchema.parse({
        type: "follow-cta",
        // Missing required `handle`
        config: { customMessage: "x" },
      }),
    ).toThrow();
  });

  it("rejects unknown discriminator type", () => {
    expect(() =>
      endSlideDataSchema.parse({ type: "unknown-type", config: {} }),
    ).toThrow();
  });
});
