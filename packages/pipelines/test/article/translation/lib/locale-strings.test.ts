import { describe, expect, it } from "bun:test";
import {
  bcp47Tag,
  buildHeroAltText,
  type Locale,
} from "../../../../src/article/translation/lib/locale-strings.ts";

describe("buildHeroAltText (Spec 64.3)", () => {
  it("produces German suffix for de locale", () => {
    expect(buildHeroAltText("ChatGPT 2026", "de")).toBe("ChatGPT 2026 – Beitragsbild");
  });

  it("produces English suffix for en locale", () => {
    expect(buildHeroAltText("ChatGPT 2026", "en")).toBe("ChatGPT 2026 — Hero Image");
  });

  it("falls back to English suffix for unknown locale", () => {
    expect(buildHeroAltText("Test", "fr" as Locale)).toBe("Test — Hero Image");
  });

  it("never produces German stopwords in non-DE output", () => {
    const result = buildHeroAltText("ChatGPT Atlas 2026", "en");
    expect(result).not.toMatch(/\b(der|die|das|und|für|von|mit|Beitragsbild)\b/);
  });
});

describe("bcp47Tag (Spec 64.3)", () => {
  it("maps de → de-DE", () => {
    expect(bcp47Tag("de")).toBe("de-DE");
  });

  it("maps en → en-US", () => {
    expect(bcp47Tag("en")).toBe("en-US");
  });

  it("falls back to en-US for unknown locale", () => {
    expect(bcp47Tag("fr" as Locale)).toBe("en-US");
  });
});
