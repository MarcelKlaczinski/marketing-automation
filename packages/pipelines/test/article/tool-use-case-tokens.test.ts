import { describe, expect, it } from "bun:test";
import {
  fallbackTokensForTool,
  validateUseCaseTokens,
} from "../../src/article/social-image/enrichment/toolUseCaseTokens.ts";

describe("validateUseCaseTokens", () => {
  it("accepts well-formed Alltagssprache tokens", () => {
    expect(validateUseCaseTokens({ endSlideToken: "Logos", identityVerb: "designst Logos" }).valid).toBe(true);
    expect(validateUseCaseTokens({ endSlideToken: "Code", identityVerb: "schreibst Code" }).valid).toBe(true);
    expect(validateUseCaseTokens({ endSlideToken: "Videos", identityVerb: "machst Videos" }).valid).toBe(true);
  });

  it("rejects tech jargon in endSlideToken", () => {
    const res = validateUseCaseTokens({ endSlideToken: "Vektor-Export", identityVerb: "machst Logos" });
    expect(res.valid).toBe(false);
    expect(res.violations.some((v) => v.includes("tech jargon"))).toBe(true);
  });

  it("rejects identityVerb without a du-form verb", () => {
    const res = validateUseCaseTokens({ endSlideToken: "Logos", identityVerb: "Logos produzieren" });
    expect(res.valid).toBe(false);
    expect(res.violations.some((v) => v.includes("verb in du-form"))).toBe(true);
  });

  it("rejects identityVerb shorter than 2 words", () => {
    const res = validateUseCaseTokens({ endSlideToken: "Logos", identityVerb: "designst" });
    expect(res.valid).toBe(false);
  });

  it("rejects identityVerb longer than 4 words", () => {
    const res = validateUseCaseTokens({ endSlideToken: "Logos", identityVerb: "designst echte schöne starke Logos" });
    expect(res.valid).toBe(false);
  });

  it("rejects endSlideToken with 3+ words", () => {
    const res = validateUseCaseTokens({ endSlideToken: "Logos und Poster", identityVerb: "designst Logos" });
    expect(res.valid).toBe(false);
  });
});

describe("fallbackTokensForTool", () => {
  it("maps logo keyword to logo tokens", () => {
    const t = fallbackTokensForTool({ slug: "recraft", name: "Recraft", tagline: "AI logo generator" });
    expect(t.endSlideToken).toBe("Logos");
    expect(t.identityVerb).toBe("designst Logos");
  });

  it("maps text/copy keyword to text tokens", () => {
    const t = fallbackTokensForTool({ slug: "x", name: "X", tagline: "copy writer", bestFor: "writing" });
    expect(t.endSlideToken).toBe("Texte");
  });

  it("falls back to Content/Content when nothing matches", () => {
    const t = fallbackTokensForTool({ slug: "x", name: "X", tagline: "general purpose tool" });
    expect(t.endSlideToken).toBe("Content");
    expect(t.identityVerb).toBe("erstellst Content");
  });

  it("fallback tokens always validate cleanly", () => {
    const samples = [
      { slug: "x", name: "X", tagline: "logo maker" },
      { slug: "x", name: "X", tagline: "poster designer" },
      { slug: "x", name: "X", tagline: "code generator" },
      { slug: "x", name: "X", tagline: "general purpose tool" },
    ];
    for (const t of samples) {
      const tokens = fallbackTokensForTool(t);
      expect(validateUseCaseTokens(tokens).valid).toBe(true);
    }
  });
});
