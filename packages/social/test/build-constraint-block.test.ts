/**
 * Spec 60.1 Session 3 — buildConstraintBlock unit + snapshot tests.
 */

import { describe, expect, it } from "bun:test";
import { buildConstraintBlock } from "../src/templates/lib/buildConstraintBlock";
import { singleToolSpotlightBounds, coverBounds } from "../src/templates/definitions/singleToolSpotlight";

describe("buildConstraintBlock — spotlight body bounds", () => {
  it("formats DE correctly (snapshot)", () => {
    expect(buildConstraintBlock(singleToolSpotlightBounds, "de")).toMatchSnapshot();
  });

  it("formats EN correctly (snapshot)", () => {
    expect(buildConstraintBlock(singleToolSpotlightBounds, "en")).toMatchSnapshot();
  });

  it("respects fields option — subset only", () => {
    const block = buildConstraintBlock(singleToolSpotlightBounds, "de", {
      fields: ["strengths", "weaknesses"],
    });
    expect(block).toContain("strengths");
    expect(block).toContain("weaknesses");
    expect(block).not.toContain("verdictQuote");
    expect(block).not.toContain("captionBody");
  });

  it("respects fields option — single field", () => {
    const block = buildConstraintBlock(singleToolSpotlightBounds, "de", {
      fields: ["verdictQuote"],
    });
    expect(block).toContain("verdictQuote");
    expect(block).toContain("40–120");
  });

  it("uses custom header when provided", () => {
    const block = buildConstraintBlock(singleToolSpotlightBounds, "de", {
      header: "MEINE LIMITS:",
      fields: ["verdictQuote"],
    });
    expect(block.startsWith("MEINE LIMITS:")).toBe(true);
  });
});

describe("buildConstraintBlock — cover bounds", () => {
  it("formats cover DE correctly (snapshot)", () => {
    expect(buildConstraintBlock(coverBounds, "de")).toMatchSnapshot();
  });

  it("formats cover EN correctly (snapshot)", () => {
    expect(buildConstraintBlock(coverBounds, "en")).toMatchSnapshot();
  });
});

describe("buildConstraintBlock — format rules", () => {
  it("FieldBound renders as 'min–max Zeichen' in DE", () => {
    const block = buildConstraintBlock(singleToolSpotlightBounds, "de", {
      fields: ["verdictQuote"],
    });
    expect(block).toContain("40–120 Zeichen");
  });

  it("FieldBound renders as 'min–max chars' in EN", () => {
    const block = buildConstraintBlock(singleToolSpotlightBounds, "en", {
      fields: ["verdictQuote"],
    });
    expect(block).toContain("40–120 chars");
  });

  it("list with countMin/countMax/each renders correctly in DE", () => {
    const block = buildConstraintBlock(singleToolSpotlightBounds, "de", {
      fields: ["strengths"],
    });
    expect(block).toContain("3–4 Einträge");
    expect(block).toContain("30–70 Zeichen");
  });

  it("list with countMin/countMax/each renders correctly in EN", () => {
    const block = buildConstraintBlock(singleToolSpotlightBounds, "en", {
      fields: ["strengths"],
    });
    expect(block).toContain("3–4 items");
    expect(block).toContain("30–70 chars");
  });

  it("exact numeric count renders as 'exakt N' in DE", () => {
    const block = buildConstraintBlock(singleToolSpotlightBounds, "de", {
      fields: ["facts"],
    });
    expect(block).toContain("exakt 4");
  });

  it("exact numeric count renders as 'exactly N' in EN", () => {
    const block = buildConstraintBlock(singleToolSpotlightBounds, "en", {
      fields: ["facts"],
    });
    expect(block).toContain("exactly 4");
  });

  it("nested group renders with indented children", () => {
    const block = buildConstraintBlock(singleToolSpotlightBounds, "de", {
      fields: ["tool"],
    });
    expect(block).toContain("- tool:");
    expect(block).toContain("  - name:");
    expect(block).toContain("  - version:");
  });

  it("nested footer group renders correctly", () => {
    const block = buildConstraintBlock(singleToolSpotlightBounds, "de", {
      fields: ["footer"],
    });
    expect(block).toContain("- footer:");
    expect(block).toContain("  - ctaLine:");
    expect(block).toContain("  - url:");
  });

  it("DE header default", () => {
    const block = buildConstraintBlock(singleToolSpotlightBounds, "de", {
      fields: ["verdictQuote"],
    });
    expect(block.startsWith("ZEICHENLIMITS (strikt einhalten):")).toBe(true);
  });

  it("EN header default", () => {
    const block = buildConstraintBlock(singleToolSpotlightBounds, "en", {
      fields: ["verdictQuote"],
    });
    expect(block.startsWith("CHARACTER LIMITS (must be respected):")).toBe(true);
  });

  it("skips unknown field keys silently", () => {
    expect(() =>
      buildConstraintBlock(singleToolSpotlightBounds, "de", {
        fields: ["nonExistentField"],
      }),
    ).not.toThrow();
  });
});
