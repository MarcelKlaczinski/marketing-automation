import { describe, expect, it } from "bun:test";
import { buildLocaleContext } from "../../src/cold-start/_lib/locale-context.ts";
import { buildNicheContext } from "../../src/cold-start/_lib/niche-context.ts";

/**
 * Verifies the locale-aware prompt string construction logic used inside
 * IdentifyCompetitorsStep.execute without making real DB or Anthropic calls.
 * Mirrors the exact template from the step so regressions are caught.
 */
function buildCompetitorStepInstructions(
  targetLocales: string[],
  targetNiche: string | null = null
): string {
  const localeCtx = buildLocaleContext(targetLocales);
  const nicheCtx = buildNicheContext(targetNiche);

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

  const nicheHint = nicheCtx.niche
    ? `
NICHE CONTEXT:
This project is in the "${nicheCtx.niche}" niche: ${nicheCtx.description}.

Known competitors in this niche (orientation only — pick from these or similar):
- International: ${nicheCtx.exampleCompetitors.international.join(", ") || "(none typical)"}
- DACH: ${nicheCtx.exampleCompetitors.dach.join(", ") || "(none typical)"}

Topical keywords this niche cares about: ${nicheCtx.topicalKeywords.join(", ")}
Content types this niche typically produces: ${nicheCtx.contentTypes.join(", ")}

IMPORTANT INSTRUCTIONS:
- Use the example list as STARTING ORIENTATION, not a copy-paste source
- Consider adjacent niches too (e.g., "AI knowledge sites" for ai-tool-wiki)
- For multi-locale projects, distribute picks across markets
- Prefer sites with proven SEO traffic + content depth over startups
- If a known competitor seems missing from the list, consider including it
`
    : `
NICHE CONTEXT: Generic — no specific niche library entry. Infer the niche
characteristics from the marketing context above. Focus on sites with similar
audience and content category.
`;

  return [nicheHint, audienceLine, searchLine, competitorDistribution].join("\n");
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

describe("IdentifyCompetitorsStep niche prompt", () => {
  it("project with niche=ai-tool-wiki includes toolify.ai in prompt", () => {
    const prompt = buildCompetitorStepInstructions(["de-DE", "en-US"], "ai-tool-wiki");
    expect(prompt).toContain("toolify.ai");
    expect(prompt).toContain("futurepedia.io");
    expect(prompt).toContain("NICHE CONTEXT");
    expect(prompt).toContain("ai-tool-wiki");
  });

  it("project without niche shows Generic fallback text", () => {
    const prompt = buildCompetitorStepInstructions(["de-DE"], null);
    expect(prompt).toContain("Generic");
    expect(prompt).not.toContain("toolify.ai");
  });

  it("IdentifyCompetitorsStep does NOT combine competitor-profiling+ai-seo (skill mismatch guard)", async () => {
    // The old incorrect combination "competitor-profiling" + "ai-seo" confused the LLM
    // because competitor-profiling is designed for URL-input, not discovery.
    // SynthesizeCompetitorReportStep still uses competitor-profiling correctly (URL data).
    const src = await Bun.file(
      new URL("../../src/cold-start/02-competitor-analysis/steps.ts", import.meta.url).pathname
    ).text();
    expect(src).not.toContain('"competitor-profiling", "ai-seo"');
    expect(src).toContain('skills: ["ai-seo"]');
  });
});
