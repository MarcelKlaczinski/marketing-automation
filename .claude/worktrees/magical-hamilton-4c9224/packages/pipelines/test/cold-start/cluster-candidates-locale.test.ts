import { describe, expect, it } from "bun:test";
import { buildLocaleContext } from "../../src/cold-start/_lib/locale-context.ts";
import { buildNicheContext } from "../../src/cold-start/_lib/niche-context.ts";

/**
 * Mirrors the searchVolumeRule template from GenerateClusterCandidatesStep.execute.
 */
function buildClusterSearchVolumeRule(targetLocales: string[]): string {
  const localeCtx = buildLocaleContext(targetLocales);

  return localeCtx.isMultiLocale
    ? `- Cluster keywords should target either:
  * The primary locale (${localeCtx.primaryLocale}) with search volume > ${localeCtx.minSearchVolumePerLocale}/month on ${localeCtx.searchEngines[0]}
  * OR a secondary locale with search volume > 30/month on its respective search engine (${localeCtx.searchEngines.slice(1).join(", ")})
- For each cluster, indicate which locale it primarily targets in the 'reasoning' field (e.g. "targets de-DE" or "targets en-US")`
    : `- Target clusters that likely have search volume > ${localeCtx.minSearchVolumePerLocale}/month on ${localeCtx.searchEngines[0]}`;
}

/**
 * Mirrors the nicheHint template from GenerateClusterCandidatesStep.execute.
 */
function buildClusterNicheHint(targetNiche: string | null): string {
  const nicheCtx = buildNicheContext(targetNiche);
  if (!nicheCtx.niche) return "";

  return `
NICHE: ${nicheCtx.niche}
Description: ${nicheCtx.description}
Topical keywords for orientation: ${nicheCtx.topicalKeywords.join(", ")}
Content types this niche uses: ${nicheCtx.contentTypes.join(", ")}

When proposing clusters:
- Each cluster should be plausible for this niche
- Reference the topical keywords as inspiration (don't copy verbatim)
- Mix content types that fit this niche's audience
`;
}

describe("GenerateClusterCandidatesStep locale prompt", () => {
  it("single-locale (de-DE) uses only Google.de volume rule", () => {
    const rule = buildClusterSearchVolumeRule(["de-DE"]);
    expect(rule).toContain("Google.de");
    expect(rule).not.toContain("Google.com");
    expect(rule).not.toContain("secondary locale");
  });

  it("bilingual (de-DE + en-US) mentions both search engines and locale tags", () => {
    const rule = buildClusterSearchVolumeRule(["de-DE", "en-US"]);
    expect(rule).toContain("Google.de");
    expect(rule).toContain("Google.com");
    expect(rule).toContain("secondary locale");
    expect(rule).toContain("de-DE");
    expect(rule).toContain("en-US");
    expect(rule).toContain("targets de-DE");
    expect(rule).toContain("targets en-US");
  });

  it("single-locale uses minSearchVolumePerLocale (50)", () => {
    const rule = buildClusterSearchVolumeRule(["de-DE"]);
    expect(rule).toContain("50");
  });

  it("unknown locale falls back without crash", () => {
    const rule = buildClusterSearchVolumeRule(["fr-FR"]);
    expect(rule).toContain("Google.com");
    expect(rule).not.toContain("secondary locale");
  });
});

describe("GenerateClusterCandidatesStep niche prompt", () => {
  it("project with niche=ai-tool-wiki includes topical keywords in hint", () => {
    const hint = buildClusterNicheHint("ai-tool-wiki");
    expect(hint).toContain("ai-tool-wiki");
    expect(hint).toContain("AI tools");
    expect(hint).toContain("tool reviews");
    expect(hint).toContain("NICHE");
  });

  it("project with niche=solar-energy includes solar keywords", () => {
    const hint = buildClusterNicheHint("solar-energy");
    expect(hint).toContain("Balkonkraftwerk");
    expect(hint).toContain("product reviews");
  });

  it("project without niche returns empty string (no hint injected)", () => {
    const hint = buildClusterNicheHint(null);
    expect(hint).toBe("");
  });

  it("unknown niche returns empty string without crashing", () => {
    const hint = buildClusterNicheHint("completely-unknown-niche");
    expect(hint).toBe("");
  });
});
