import { describe, expect, it } from "bun:test";
import {
  type CloserToolContext,
  buildCloserHeadline,
  selectCloserPattern,
} from "../../src/article/social-image/closerEngine.ts";

const RECRAFT: CloserToolContext = { name: "Recraft", endSlideToken: "Logos", identityVerb: "designst Logos" };
const IDEOGRAM: CloserToolContext = { name: "Ideogram", endSlideToken: "Poster", identityVerb: "machst Poster" };

describe("selectCloserPattern", () => {
  it("maps comparison → verdict_recap when 2 tools with endSlideToken", () => {
    expect(selectCloserPattern("comparison", [RECRAFT, IDEOGRAM])).toBe("verdict_recap");
  });

  it("maps review → verdict_recap when 2 tools with endSlideToken", () => {
    expect(selectCloserPattern("review", [RECRAFT, IDEOGRAM])).toBe("verdict_recap");
  });

  it("maps list → action_frame", () => {
    expect(selectCloserPattern("list", [RECRAFT, IDEOGRAM, { name: "Flux" }])).toBe("action_frame");
  });

  it("maps guide → action_frame", () => {
    expect(selectCloserPattern("guide", [RECRAFT, IDEOGRAM])).toBe("action_frame");
  });

  it("maps howto → identity_mirror when 2 tools with identityVerb", () => {
    expect(selectCloserPattern("howto", [RECRAFT, IDEOGRAM])).toBe("identity_mirror");
  });

  it("falls back to action_frame when verdict_recap has wrong tool count", () => {
    expect(selectCloserPattern("comparison", [RECRAFT])).toBe("action_frame");
    expect(selectCloserPattern("comparison", [RECRAFT, IDEOGRAM, { name: "Flux" }])).toBe("action_frame");
  });

  it("falls back to action_frame when verdict_recap tool is missing endSlideToken", () => {
    const broken: CloserToolContext = { name: "Recraft" };
    expect(selectCloserPattern("comparison", [broken, IDEOGRAM])).toBe("action_frame");
  });

  it("falls back to action_frame when identity_mirror is missing identityVerb", () => {
    const broken: CloserToolContext = { name: "Recraft", endSlideToken: "Logos" };
    expect(selectCloserPattern("howto", [broken, IDEOGRAM])).toBe("action_frame");
  });
});

describe("buildCloserHeadline — verdict_recap", () => {
  it("constructs Recraft/Ideogram verdict from 2 tools", () => {
    const closer = buildCloserHeadline("comparison", [RECRAFT, IDEOGRAM]);
    expect(closer.pattern).toBe("verdict_recap");
    expect(closer.line1).toEqual({ leadText: "Recraft für", highlightText: "Logos", trailText: "." });
    expect(closer.line2).toEqual({ leadText: "Ideogram für", highlightText: "Poster", trailText: "." });
    expect(closer.fullText).toBe("Recraft für Logos. Ideogram für Poster.");
  });

  it("never produces a fragment without a separating space", () => {
    const closer = buildCloserHeadline("comparison", [RECRAFT, IDEOGRAM]);
    // both lines: leadText must end with space-friendly trailing char (no last-char merge with highlight)
    expect(closer.line1.leadText.endsWith(" ")).toBe(false);
    expect(closer.line1.leadText.endsWith("für")).toBe(true);
    expect(closer.line2.leadText.endsWith("für")).toBe(true);
  });
});

describe("buildCloserHeadline — action_frame", () => {
  it("uses tool count for line1 highlight", () => {
    const closer = buildCloserHeadline("list", [RECRAFT, IDEOGRAM, { name: "Flux" }, { name: "Midjourney" }, { name: "Imagen" }]);
    expect(closer.pattern).toBe("action_frame");
    expect(closer.line1).toEqual({ leadText: "5 Tools", highlightText: "getestet", trailText: "." });
    expect(closer.line2).toEqual({ leadText: "Speichere für", highlightText: "später", trailText: "." });
    expect(closer.fullText).toBe("5 Tools getestet. Speichere für später.");
  });
});

describe("buildCloserHeadline — identity_mirror", () => {
  it("produces du-form lines anchored to each tool", () => {
    const closer = buildCloserHeadline("howto", [RECRAFT, IDEOGRAM]);
    expect(closer.pattern).toBe("identity_mirror");
    expect(closer.line1).toEqual({ leadText: "Du designst Logos?", highlightText: "Recraft", trailText: "." });
    expect(closer.line2).toEqual({ leadText: "Du machst Poster?", highlightText: "Ideogram", trailText: "." });
    expect(closer.fullText).toBe("Du designst Logos? Recraft. Du machst Poster? Ideogram.");
  });
});

describe("buildCloserHeadline — fallback paths", () => {
  it("falls back to action_frame for comparison with 1 tool", () => {
    const closer = buildCloserHeadline("comparison", [RECRAFT]);
    expect(closer.pattern).toBe("action_frame");
    expect(closer.line1.leadText).toBe("1 Tools");
  });

  it("falls back to action_frame for howto missing identityVerb", () => {
    const broken: CloserToolContext = { name: "Recraft" };
    const closer = buildCloserHeadline("howto", [broken, IDEOGRAM]);
    expect(closer.pattern).toBe("action_frame");
  });
});
