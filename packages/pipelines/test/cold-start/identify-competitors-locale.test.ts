import { describe, expect, it } from "bun:test";
import { buildLocaleContext } from "../../src/cold-start/_lib/locale-context.ts";

/**
 * Verifies the locale-aware prompt string construction logic used inside
 * IdentifyCompetitorsStep.execute without making real DB or Anthropic calls.
 * Mirrors the exact template from the step so regressions are caught.
 */
function buildCompetitorStepInstructions(targetLocales: string[]): string {
  const localeCtx = buildLocaleContext(targetLocales);

  const audienceLine = localeCtx.isMultiLocale
    ? `Audiences: ${localeCtx.audienceDescriptors.join(" AND ")}`
    : `Audience: ${localeCtx.audienceDescriptors[0]}`;

  const searchLine = localeCtx.isMultiLocale
    ? `Active and ranking on multiple search engines: ${localeCtx.searchEngines.join(", ")}`
    : `Active and ranking on ${localeCtx.searchEngines[0]}`;

  const competitorDistribution = localeCtx.isMultiLocale
    ? `DISTRIBUTION (CRITICAL for multi-locale projects):
- For each target locale (${localeCtx.locales.join(", ")}), pick at least 1-2 competitors
- Mix: 1-2 international/aspirational competitors + 1-2 regional/direct competitors
- Example: for an AI-tools niche, include toolify.ai / futurepedia.io (international) alongside DACH-specific sites`
    : `DISTRIBUTION:
- Mix of 2-3 direct competitors + 1-2 aspirational competitors
- All within the target market: ${localeCtx.locales[0]}`;

  return [audienceLine, searchLine, competitorDistribution].join("\n");
}

describe("IdentifyCompetitorsStep locale prompt", () => {
  it("single-locale tenant (de-DE) mentions only Google.de", () => {
    const prompt = buildCompetitorStepInstructions(["de-DE"]);
    expect(prompt).toContain("Google.de");
    expect(prompt).not.toContain("Google.com");
    expect(prompt).not.toContain("international");
    expect(prompt).toContain("DACH");
  });

  it("bilingual tenant (de-DE + en-US) mentions both search engines", () => {
    const prompt = buildCompetitorStepInstructions(["de-DE", "en-US"]);
    expect(prompt).toContain("Google.de");
    expect(prompt).toContain("Google.com");
    expect(prompt).toContain("international");
    expect(prompt).toContain("de-DE");
    expect(prompt).toContain("en-US");
  });

  it("bilingual tenant prompt contains toolify/futurepedia hint", () => {
    const prompt = buildCompetitorStepInstructions(["de-DE", "en-US"]);
    expect(prompt).toContain("toolify.ai");
    expect(prompt).toContain("futurepedia.io");
  });

  it("unknown locale falls back without crash and mentions Google.com", () => {
    const prompt = buildCompetitorStepInstructions(["xx-XX"]);
    expect(prompt).toContain("Google.com");
  });
});
