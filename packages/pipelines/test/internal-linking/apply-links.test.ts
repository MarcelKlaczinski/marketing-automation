import { describe, it, expect } from "bun:test";
import { createLogger } from "@marketing-auto/shared";
import { ApplyLinksStep, findValidAnchorPositions, isValidAnchorPosition } from "../../src/internal-linking/steps/apply-links.ts";
import type { StepContext } from "../../src/engine/step.ts";

const mockCtx = (): StepContext => ({
  projectId: crypto.randomUUID(),
  pipelineRunId: crypto.randomUUID(),
  stepRunId: crypto.randomUUID(),
  pipelineName: "test",
  log: createLogger("test"),
  reportProgress: async () => {},
  getStepOutput: () => undefined,
});

const step = new ApplyLinksStep();

// --- findValidAnchorPositions ---

describe("findValidAnchorPositions", () => {
  it("finds plain prose anchor", () => {
    const body = "Wir verwenden das Claude API für alle Anfragen.";
    const positions = findValidAnchorPositions(body, "Claude API");
    expect(positions).toEqual([body.indexOf("Claude API")]);
  });

  it("returns empty when anchor is inside existing markdown link", () => {
    const body = "Lies unseren Artikel [Claude API](/blog/claude-api) für Details.";
    const positions = findValidAnchorPositions(body, "Claude API");
    expect(positions).toHaveLength(0);
  });

  it("returns empty when anchor is on a heading line", () => {
    const body = "## Claude API Grundlagen\n\nHier erklären wir die Grundlagen.";
    const positions = findValidAnchorPositions(body, "Claude API Grundlagen");
    expect(positions).toHaveLength(0);
  });

  it("returns empty when anchor is inside fenced code block", () => {
    const body = "Hier ein Beispiel:\n\n```python\nClaude API example\n```\n\nFertig.";
    const positions = findValidAnchorPositions(body, "Claude API example");
    expect(positions).toHaveLength(0);
  });

  it("returns empty when anchor is on indented code block line", () => {
    const body = "Beispiel:\n\n    Claude API setup\n\nFertig.";
    const positions = findValidAnchorPositions(body, "Claude API setup");
    expect(positions).toHaveLength(0);
  });

  it("returns multiple occurrences when multiple are valid", () => {
    const body = "Claude API ist gut. Nutze Claude API täglich.";
    const positions = findValidAnchorPositions(body, "Claude API");
    expect(positions).toHaveLength(2);
  });

  it("finds anchor that appears after a closing code block", () => {
    const body = "```python\ncode here\n```\n\nDas Claude API ist einfach zu nutzen.";
    const positions = findValidAnchorPositions(body, "Claude API");
    expect(positions).toHaveLength(1);
  });
});

// --- isValidAnchorPosition ---

describe("isValidAnchorPosition", () => {
  it("returns false for text between [ and ](...) of an existing link", () => {
    const body = "Schau dir [lokale LLMs](/blog/lokale-llms) an.";
    const idx = body.indexOf("lokale LLMs");
    expect(isValidAnchorPosition(body, idx, "lokale LLMs".length)).toBe(false);
  });

  it("returns true for anchor that follows a complete link", () => {
    const body = "Schau dir [andere Seite](/blog/andere-seite) an. Dann: lokale LLMs testen.";
    const idx = body.lastIndexOf("lokale LLMs");
    expect(isValidAnchorPosition(body, idx, "lokale LLMs".length)).toBe(true);
  });

  it("returns false for H3 heading", () => {
    const body = "### Claude Tools testen\n\nText hier.";
    const idx = body.indexOf("Claude Tools testen");
    expect(isValidAnchorPosition(body, idx, "Claude Tools testen".length)).toBe(false);
  });
});

// --- ApplyLinksStep ---

describe("ApplyLinksStep", () => {
  const BODY = [
    "# Einführung",
    "",
    "## Claude für Anfänger",
    "",
    "Das Claude API ist einfach zu nutzen. Viele Entwickler setzen auf Claude für ihre Projekte.",
    "",
    "## Lokale Modelle",
    "",
    "Lokale LLMs bieten mehr Datenschutz. Man kann lokale LLMs auf eigener Hardware betreiben.",
    "",
    "## Zusammenfassung",
    "",
    "Generative KI verändert die Entwicklung.",
  ].join("\n");

  it("applies a single suggestion", async () => {
    const input = {
      bodyMd: BODY,
      suggestions: [{
        targetSlug: "claude-api-guide",
        anchorText: "Claude API",
        sectionHint: "Claude für Anfänger",
        reasoning: "Direkter Verweis auf den Leitfaden",
      }],
      existingLinkSlugs: [],
    };
    const result = await step.execute(input, mockCtx());
    expect(result.linksAdded).toBe(1);
    expect(result.newBodyMd).toContain("[Claude API](/blog/claude-api-guide)");
    expect(result.appliedSuggestions).toHaveLength(1);
    expect(result.rejectedSuggestions).toHaveLength(0);
  });

  it("rejects suggestion for already-linked target slug", async () => {
    const input = {
      bodyMd: BODY,
      suggestions: [{
        targetSlug: "claude-api-guide",
        anchorText: "Claude API",
        sectionHint: "Claude für Anfänger",
        reasoning: "Test",
      }],
      existingLinkSlugs: ["claude-api-guide"],
    };
    const result = await step.execute(input, mockCtx());
    expect(result.linksAdded).toBe(0);
    expect(result.rejectedSuggestions).toHaveLength(1);
    expect(result.rejectedSuggestions[0]!.reason).toContain("already linked");
  });

  it("rejects suggestion when anchor text not found in body", async () => {
    const input = {
      bodyMd: BODY,
      suggestions: [{
        targetSlug: "nonexistent",
        anchorText: "Phrase die nicht existiert",
        sectionHint: "Irgendwo",
        reasoning: "Test",
      }],
      existingLinkSlugs: [],
    };
    const result = await step.execute(input, mockCtx());
    expect(result.linksAdded).toBe(0);
    expect(result.rejectedSuggestions[0]!.reason).toContain("not found");
  });

  it("rejects second suggestion targeting the same slug within one rebuild", async () => {
    const input = {
      bodyMd: BODY,
      suggestions: [
        {
          targetSlug: "claude-api-guide",
          anchorText: "Claude API",
          sectionHint: "Claude für Anfänger",
          reasoning: "First occurrence",
        },
        {
          targetSlug: "claude-api-guide",
          anchorText: "Claude für ihre Projekte",
          sectionHint: "Claude für Anfänger",
          reasoning: "Duplicate target",
        },
      ],
      existingLinkSlugs: [],
    };
    const result = await step.execute(input, mockCtx());
    expect(result.linksAdded).toBe(1);
    expect(result.rejectedSuggestions).toHaveLength(1);
    expect(result.rejectedSuggestions[0]!.reason).toContain("already linked");
  });

  it("rejects overlapping suggestions", async () => {
    const input = {
      bodyMd: BODY,
      suggestions: [
        {
          targetSlug: "claude-api-guide",
          anchorText: "Claude API ist einfach",
          sectionHint: "Claude für Anfänger",
          reasoning: "Longer anchor",
        },
        {
          targetSlug: "another-guide",
          anchorText: "Claude API",
          sectionHint: "Claude für Anfänger",
          reasoning: "Shorter overlapping anchor",
        },
      ],
      existingLinkSlugs: [],
    };
    const result = await step.execute(input, mockCtx());
    expect(result.linksAdded).toBe(1);
    expect(result.rejectedSuggestions).toHaveLength(1);
    expect(result.rejectedSuggestions[0]!.reason).toContain("Overlaps");
  });

  it("does not link inside headings", async () => {
    const bodyWithAnchorInHeading = "## Lokale LLMs verstehen\n\nLokale LLMs sind sicher.";
    const input = {
      bodyMd: bodyWithAnchorInHeading,
      suggestions: [{
        targetSlug: "lokale-llms",
        anchorText: "Lokale LLMs verstehen",
        sectionHint: "Lokale LLMs",
        reasoning: "Heading anchor — should be rejected",
      }],
      existingLinkSlugs: [],
    };
    const result = await step.execute(input, mockCtx());
    // The heading occurrence is invalid; body occurrence (different text) would need to match
    expect(result.linksAdded).toBe(0);
    expect(result.rejectedSuggestions[0]!.reason).toContain("not found");
  });

  it("applies multiple suggestions and preserves body integrity", async () => {
    const input = {
      bodyMd: BODY,
      suggestions: [
        {
          targetSlug: "claude-api-guide",
          anchorText: "Claude API",
          sectionHint: "Claude für Anfänger",
          reasoning: "Link 1",
        },
        {
          targetSlug: "lokale-llm-guide",
          anchorText: "Lokale LLMs",
          sectionHint: "Lokale Modelle",
          reasoning: "Link 2",
        },
      ],
      existingLinkSlugs: [],
    };
    const result = await step.execute(input, mockCtx());
    expect(result.linksAdded).toBe(2);
    expect(result.newBodyMd).toContain("[Claude API](/blog/claude-api-guide)");
    expect(result.newBodyMd).toContain("[Lokale LLMs](/blog/lokale-llm-guide)");
    // Body should still contain all original headings
    expect(result.newBodyMd).toContain("## Claude für Anfänger");
    expect(result.newBodyMd).toContain("## Lokale Modelle");
  });

  it("does not modify body when no suggestions provided", async () => {
    const input = {
      bodyMd: BODY,
      suggestions: [],
      existingLinkSlugs: [],
    };
    const result = await step.execute(input, mockCtx());
    expect(result.linksAdded).toBe(0);
    expect(result.newBodyMd).toBe(BODY);
  });

  it("does not double-link an anchor already wrapped in a markdown link", async () => {
    const bodyWithLink = BODY.replace(
      "Claude API ist einfach zu nutzen",
      "[Claude API](/blog/existing) ist einfach zu nutzen",
    );
    const input = {
      bodyMd: bodyWithLink,
      suggestions: [{
        targetSlug: "new-guide",
        anchorText: "Claude API",
        sectionHint: "Claude für Anfänger",
        reasoning: "Should be rejected — already inside a link",
      }],
      existingLinkSlugs: [],
    };
    const result = await step.execute(input, mockCtx());
    expect(result.linksAdded).toBe(0);
    expect(result.rejectedSuggestions[0]!.reason).toContain("not found");
  });
});
