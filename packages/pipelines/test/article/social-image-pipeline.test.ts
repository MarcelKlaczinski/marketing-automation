import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";

// ─── Mock @marketing-auto/adapter-anthropic BEFORE any step import ────────────
// Bun's module mock must be hoisted above the imports that consume it.

const mockMessages = mock(async (_opts: unknown) => ({
  raw: JSON.stringify({
    coverEyebrow: "KI-TOOLS 2026",
    coverHeadlineLead: "Die 5 besten",
    coverHeadlineHighlight: "KI-Bild-Generatoren",
    coverHeadlineTrail: "im Vergleich",
    coverSubhead: "Tools für kreative KI-Bilder",
    endHeadline: "Mehr Reviews,",
    endHeadlineHighlight: "ehrlich getestet.",
    tools: [
      {
        rank: 1,
        name: "Midjourney",
        slug: "midjourney",
        domain: "midjourney.com",
        tagline: "Der bekannteste KI-Bildgenerator mit beeindruckenden Ergebnissen.",
        bestFor: "Kreative Kunst",

        strengths: ["Bildqualität", "Stile", "Community"],
        pricing: { tier: "paid", label: "ab 10$/Monat" },
      },
      {
        rank: 2,
        name: "DALL-E 3",
        slug: "dall-e",
        domain: "openai.com",
        tagline: "OpenAIs Bildgenerator mit starker Prompt-Treue.",
        bestFor: "Promptgenaue Bilder",

        strengths: ["Prompt-Treue", "Integration", "API"],
        pricing: { tier: "freemium", label: "ab 0$/Monat" },
      },
      {
        rank: 3,
        name: "Stable Diffusion",
        slug: "stable-diffusion",
        domain: "stability.ai",
        tagline: "Open-Source-Modell mit maximaler Kontrolle.",
        bestFor: "Open Source",

        strengths: ["Open Source", "Anpassbar", "Lokal"],
        pricing: { tier: "free", label: "kostenlos" },
      },
      {
        rank: 4,
        name: "Adobe Firefly",
        slug: "adobe-firefly",
        domain: "adobe.com",
        tagline: "Kommerzielle Sicherheit dank lizenzfreier Trainingsdaten.",
        bestFor: "Kommerzielle Nutzung",

        strengths: ["Lizenzfrei", "Adobe-Integration", "Sicherheit"],
        pricing: { tier: "freemium", label: "ab 0$/Monat" },
      },
      {
        rank: 5,
        name: "Ideogram",
        slug: "ideogram",
        domain: "ideogram.ai",
        tagline: "Stärker bei Text in Bildern als andere Generatoren.",
        bestFor: "Text in Bildern",

        strengths: ["Textrendering", "Qualität", "Preisleistung"],
        pricing: { tier: "freemium", label: "ab 0$/Monat" },
      },
    ],
  }),
  cost: { totalEur: 0.001 },
}));

mock.module("@marketing-auto/adapter-anthropic", () => ({
  anthropic: {
    messages: mockMessages,
  },
}));

// ─── Remaining imports (after mock registration) ─────────────────────────────

import { articles, db, projects, socialPosts } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { eq } from "drizzle-orm";
import type { StepContext } from "../../src/engine/step.ts";
import {
  ExtractToolsStep,
  GenerateCaptionStep,
  LoadArticleStep,
  ResolveAssetsStep,
} from "../../src/article/social-image/steps.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const mockCtx = (projectId: string): StepContext => ({
  projectId,
  pipelineRunId: crypto.randomUUID(),
  stepRunId: crypto.randomUUID(),
  pipelineName: "test",
  llmMode: "sync",
  runMode: "production",
  log: createLogger("test"),
  reportProgress: async () => {},
  getStepOutput: () => undefined,
});

/** Minimal valid input matching LoadArticleOutputSchema */
const makeBaseInput = (overrides: Partial<{
  articleId: string;
  projectId: string;
  articleTitle: string;
  coverHeadlineLead: string;
}> = {}) => ({
  articleId: overrides.articleId ?? crypto.randomUUID(),
  projectId: overrides.projectId ?? crypto.randomUUID(),
  projectSlug: "test-slug",
  theme: "dark" as const,
  variant: "stunning" as const,
  locales: ["de-DE"],
  articleTitle: overrides.articleTitle ?? "Die 5 besten KI-Tools",
  articleSlug: "ki-tools-test",
  intentType: null as string | null,
  bodyMd: "# Test\n\nArticle body with AI tools.",
  articleUrl: "https://example.com/ki-tools",
  brandTokens: {},
});

// ─── ExtractToolsStep — unit tests (no real LLM) ─────────────────────────────

describe("ExtractToolsStep", () => {
  it("happy path: mock returns valid JSON → output has extractedTools and headlines", async () => {
    const step = new ExtractToolsStep();
    const input = makeBaseInput();
    const out = await step.execute(input, mockCtx(input.projectId));

    expect(out.extractedTools).toBeArray();
    expect(out.extractedTools.length).toBe(5);
    expect(out.extractedTools[0]!.name).toBe("Midjourney");
    expect(out.coverEyebrow).toBe("KI-TOOLS 2026");
    expect(out.coverHeadlineLead).toBe("Die 5 besten");
    expect(out.coverHeadlineHighlight).toBe("KI-Bild-Generatoren");
    expect(out.endHeadline).toBe("Mehr Reviews,");
    expect(out.endHeadlineHighlight).toBe("ehrlich getestet.");
    // passthrough fields must be preserved
    expect(out.articleId).toBe(input.articleId);
    expect(out.projectId).toBe(input.projectId);
    expect(out.theme).toBe("dark");
  });

  it("markdown-fenced JSON: step strips fences and parses correctly", async () => {
    // Override the mock to return markdown-fenced JSON for this test only
    mockMessages.mockImplementationOnce(async () => ({
      raw: "```json\n" + JSON.stringify({
        coverEyebrow: "KI-TOOLS 2026",
        coverHeadlineLead: "Die 3 besten",
        coverHeadlineHighlight: "KI-Schreibtools",
        endHeadline: "Mehr erfahren",
        endHeadlineHighlight: "ehrlich getestet.",
        tools: [
          {
            rank: 1,
            name: "ChatGPT",
            slug: "chatgpt",
            domain: "chat.openai.com",
            tagline: "Der bekannteste KI-Schreibassistent.",
            strengths: ["Vielseitigkeit", "Qualität"],
            pricing: { tier: "freemium", label: "ab 0$/Monat" },
          },
          {
            rank: 2,
            name: "Claude",
            slug: "claude-ai",
            domain: "claude.ai",
            tagline: "Anthropics sicherer KI-Assistent.",
            strengths: ["Sicherheit", "Länge"],
            pricing: { tier: "freemium", label: "ab 0$/Monat" },
          },
          {
            rank: 3,
            name: "Gemini",
            slug: "gemini-ai",
            domain: "gemini.google.com",
            tagline: "Googles multimodaler KI-Assistent.",
            strengths: ["Multimodal", "Google-Integration"],
            pricing: { tier: "freemium", label: "ab 0$/Monat" },
          },
        ],
      }) + "\n```",
      cost: { totalEur: 0.001 },
    }));

    const step = new ExtractToolsStep();
    const input = makeBaseInput({ articleTitle: "Die 3 besten KI-Schreibtools" });
    const out = await step.execute(input, mockCtx(input.projectId));

    expect(out.extractedTools.length).toBe(3);
    expect(out.coverHeadlineLead).toBe("Die 3 besten");
    expect(out.coverHeadlineHighlight).toBe("KI-Schreibtools");
  });

  it('"vs." detection: overrides coverHeadlineLead with count-based headline', async () => {
    mockMessages.mockImplementationOnce(async () => ({
      raw: JSON.stringify({
        coverEyebrow: "KI-VERGLEICH 2026",
        coverHeadlineLead: "Recraft vs. Ideogram",
        coverHeadlineHighlight: "im direkten Duell",
        endHeadline: "Unser Fazit",
        endHeadlineHighlight: "ehrlich getestet.",
        tools: [
          {
            rank: 1,
            name: "Recraft",
            slug: "recraft",
            domain: "recraft.ai",
            tagline: "Vektorgrafiken mit KI erstellen.",
            strengths: ["Vektoren", "SVG", "Design"],
            pricing: { tier: "freemium", label: "ab 0$/Monat" },
          },
          {
            rank: 2,
            name: "Ideogram",
            slug: "ideogram",
            domain: "ideogram.ai",
            tagline: "Stärker bei Text in Bildern.",
            strengths: ["Textrendering", "Qualität"],
            pricing: { tier: "freemium", label: "ab 0$/Monat" },
          },
          {
            rank: 3,
            name: "Midjourney",
            slug: "midjourney",
            domain: "midjourney.com",
            tagline: "Kreative Bildgenerierung auf höchstem Niveau.",
            strengths: ["Qualität", "Stile"],
            pricing: { tier: "paid", label: "ab 10$/Monat" },
          },
          {
            rank: 4,
            name: "DALL-E 3",
            slug: "dall-e",
            domain: "openai.com",
            tagline: "Starke Prompt-Treue durch OpenAI.",
            strengths: ["Prompt-Treue", "API"],
            pricing: { tier: "freemium", label: "ab 0$/Monat" },
          },
          {
            rank: 5,
            name: "Adobe Firefly",
            slug: "adobe-firefly",
            domain: "adobe.com",
            tagline: "Sicherer KI-Bildgenerator für Profis.",
            strengths: ["Lizenzfrei", "Adobe-Integration"],
            pricing: { tier: "freemium", label: "ab 0$/Monat" },
          },
        ],
      }),
      cost: { totalEur: 0.001 },
    }));

    const step = new ExtractToolsStep();
    const input = makeBaseInput({ articleTitle: "Recraft vs. Ideogram" });
    const out = await step.execute(input, mockCtx(input.projectId));

    // Must override "vs." headline with count-based alternative
    expect(out.coverHeadlineLead).toBe("Die 5 besten");
    // "vs." in highlight should be replaced with " & "
    expect(out.coverHeadlineHighlight).not.toMatch(/\bvs\.?\b/i);
    expect(out.extractedTools.length).toBe(5);
  });
});

// ─── Shared DB fixtures ───────────────────────────────────────────────────────

let sharedProjectId: string;
let sharedProjectSlug: string;
let sharedArticleId: string;

beforeAll(async () => {
  const [p] = await db
    .insert(projects)
    .values({
      slug: `social-image-test-${Date.now()}`,
      name: "Social Image Test Project",
      industry: "ai_education",
      pipelineTemplate: "educational",
    })
    .returning();
  sharedProjectId = p!.id;
  sharedProjectSlug = p!.slug;

  const [a] = await db
    .insert(articles)
    .values({
      projectId: sharedProjectId,
      slug: "ki-tools-social-test",
      title: "Die 5 besten KI-Bildgeneratoren 2026",
      bodyMd: "# Intro\n\nDieser Artikel stellt die besten KI-Bildgeneratoren vor.",
      status: "generating",
      approvalMode: "manual",
    })
    .returning();
  sharedArticleId = a!.id;
});

afterAll(async () => {
  // Delete in dependency order: social posts → articles → projects
  await db.delete(socialPosts).where(eq(socialPosts.projectId, sharedProjectId));
  await db.delete(articles).where(eq(articles.projectId, sharedProjectId));
  await db.delete(projects).where(eq(projects.id, sharedProjectId));
});

// ─── LoadArticleStep — DB test ────────────────────────────────────────────────

describe("LoadArticleStep", () => {
  it("loads article and project from DB, returns correct output shape", async () => {
    const step = new LoadArticleStep();
    const out = await step.execute(
      { articleId: sharedArticleId, projectId: sharedProjectId, theme: "dark", variant: "stunning" as const, locales: ["de-DE"] },
      mockCtx(sharedProjectId),
    );

    expect(out.articleId).toBe(sharedArticleId);
    expect(out.projectId).toBe(sharedProjectId);
    expect(out.projectSlug).toBe(sharedProjectSlug);
    expect(out.theme).toBe("dark");
    expect(out.articleTitle).toBe("Die 5 besten KI-Bildgeneratoren 2026");
    expect(out.articleSlug).toBe("ki-tools-social-test");
    expect(out.bodyMd).toContain("besten KI-Bildgeneratoren");
    expect(typeof out.articleUrl).toBe("string");
    expect(out.articleUrl).toContain("ki-tools-social-test");
    expect(out.brandTokens).toBeTypeOf("object");
  });

  it("throws when article does not exist", async () => {
    const step = new LoadArticleStep();
    await expect(
      step.execute(
        { articleId: crypto.randomUUID(), projectId: sharedProjectId, theme: "dark", variant: "stunning" as const, locales: ["de-DE"] },
        mockCtx(sharedProjectId),
      ),
    ).rejects.toThrow(/not found/i);
  });

  it("respects theme=light in output", async () => {
    const step = new LoadArticleStep();
    const out = await step.execute(
      { articleId: sharedArticleId, projectId: sharedProjectId, theme: "light", variant: "stunning" as const, locales: ["de-DE"] },
      mockCtx(sharedProjectId),
    );
    expect(out.theme).toBe("light");
  });
});

// ─── ResolveAssetsStep — DB test ──────────────────────────────────────────────

describe("ResolveAssetsStep", () => {
  /** Builds a full ResolveAssetsInputSchema-compatible input */
  function makeResolveInput(toolOverrides: Array<{
    rank: number;
    name: string;
    slug: string;
    domain: string;
    tagline: string;
    strengths: string[];
    pricing: { tier: "free" | "freemium" | "paid"; label: string };
  }>) {
    return {
      articleId: sharedArticleId,
      projectId: sharedProjectId,
      projectSlug: sharedProjectSlug,
      theme: "dark" as const,
      variant: "stunning" as const,
      locales: ["de-DE"],
      articleTitle: "Die 5 besten KI-Tools",
      articleSlug: "ki-tools-social-test",
      intentType: null as string | null,
      bodyMd: "# Test",
      articleUrl: "https://example.com/ki-tools",
      brandTokens: {},
      extractedTools: toolOverrides,
      coverEyebrow: "KI-TOOLS 2026",
      coverHeadlineLead: "Die 5 besten",
      coverHeadlineHighlight: "KI-Tools",
      endHeadline: "Mehr Reviews,",
      endHeadlineHighlight: "ehrlich getestet.",
    };
  }

  it("unknown slug falls back to avatar (iconInitials + iconHue)", async () => {
    const step = new ResolveAssetsStep();
    const input = makeResolveInput([
      {
        rank: 1,
        name: "totally-unknown-tool-xyz",
        slug: "totally-unknown-tool-xyz",
        domain: "unknown-xyz.example.com",
        tagline: "An unknown tool with no icon.",
        strengths: ["strength 1"],
        pricing: { tier: "free", label: "kostenlos" },
      },
    ]);

    const out = await step.execute(input, mockCtx(sharedProjectId));

    expect(out.resolvedTools).toBeArray();
    expect(out.resolvedTools.length).toBe(1);

    const tool = out.resolvedTools[0]!;
    // Unknown slug must always fall back to avatar
    expect(tool.iconInitials).toBeString();
    expect(tool.iconInitials!.length).toBeGreaterThan(0);
    expect(typeof tool.iconHue).toBe("number");
    expect(tool.iconHue).toBeGreaterThanOrEqual(0);
    expect(tool.iconHue).toBeLessThan(360);
    // eyebrow should be derived from rank + name
    expect(tool.eyebrow).toContain("01");
  });

  it("slug chatgpt resolves to path (lobe-icons) OR avatar fallback — both are valid", async () => {
    const step = new ResolveAssetsStep();
    const input = makeResolveInput([
      {
        rank: 1,
        name: "ChatGPT",
        slug: "chatgpt",
        domain: "chat.openai.com",
        tagline: "OpenAIs flagship chat assistant.",
        strengths: ["versatility", "quality"],
        pricing: { tier: "freemium", label: "ab 0$/Monat" },
      },
    ]);

    const out = await step.execute(input, mockCtx(sharedProjectId));
    const tool = out.resolvedTools[0]!;

    // Either an inline SVG (any source) or deterministic avatar is acceptable
    const hasSvg = typeof tool.iconSvg === "string";
    const hasAvatar =
      typeof tool.iconInitials === "string" && typeof tool.iconHue === "number";

    expect(hasSvg || hasAvatar).toBe(true);
  });

  it("passthrough fields are preserved in output", async () => {
    const step = new ResolveAssetsStep();
    const input = makeResolveInput([
      {
        rank: 1,
        name: "TestTool",
        slug: "test-tool-xyz-no-icon",
        domain: "test-tool.example",
        tagline: "Test.",
        strengths: ["s1"],
        pricing: { tier: "free", label: "free" },
      },
    ]);

    const out = await step.execute(input, mockCtx(sharedProjectId));
    expect(out.coverEyebrow).toBe("KI-TOOLS 2026");
    expect(out.endHeadline).toBe("Mehr Reviews,");
    expect(out.articleId).toBe(sharedArticleId);
  });
});

// ─── GenerateCaptionStep — unit tests (mocked LLM) ───────────────────────────

describe("GenerateCaptionStep", () => {
  /** Minimal input satisfying ResolveAssetsOutputSchema (caption runs before render now) */
  function makeCaptionInput(overrides: { intentType?: string | null } = {}) {
    return {
      articleId: sharedArticleId,
      projectId: sharedProjectId,
      projectSlug: sharedProjectSlug,
      theme: "dark" as const,
      variant: "stunning" as const,
      locales: ["de-DE"],
      articleTitle: "Die 5 besten KI-Code-Editoren",
      articleSlug: "ki-code-editoren",
      intentType: overrides.intentType ?? null,
      bodyMd: "# Test",
      articleUrl: "https://toolwiki.ai/de/ki-code-editoren",
      brandTokens: {},
      extractedTools: [],
      coverEyebrow: "KI-CODE-EDITOREN",
      coverHeadlineLead: "Die 5 besten",
      coverHeadlineHighlight: "KI-Code-Editoren",
      endHeadline: "Mehr Reviews,",
      endHeadlineHighlight: "ehrlich getestet.",
      resolvedTools: [
        {
          slug: "cursor",
          rank: 1,
          name: "Cursor",
          domain: "cursor.sh",
          eyebrow: "01 · CURSOR",
          tagline: "KI-first Code-Editor.",
          strengths: ["Autocomplete", "Chat"],
          pricing: { tier: "freemium" as const, label: "ab 0$/Monat" },
        },
      ],
    };
  }

  it("happy path: returns perLocaleOutputs with caption + hashtags from LLM", async () => {
    mockMessages.mockImplementationOnce(async () => ({
      raw: JSON.stringify({
        caption: "Cursor ist der schnellste KI-Code-Editor. 🚀 Link in Bio → https://toolwiki.ai/de/ki-code-editoren",
        hashtags: ["#KITools", "#AITools", "#KIFürBusiness", "#AIForBusiness", "#CodingTools", "#DevTools", "#Cursor"],
      }),
      cost: { totalEur: 0.028 },
    }));

    const step = new GenerateCaptionStep();
    const out = await step.execute(makeCaptionInput(), mockCtx(sharedProjectId));

    expect(out.perLocaleOutputs).toBeArray();
    expect(out.perLocaleOutputs.length).toBe(1);
    const loc = out.perLocaleOutputs[0]!;
    expect(loc.locale).toBe("de-DE");
    expect(loc.caption).toContain("Cursor");
    expect(loc.hashtags).toBeArray();
    expect(loc.hashtags.length).toBeGreaterThanOrEqual(5);
    expect(loc.hashtags.length).toBeLessThanOrEqual(10);
    expect(loc.warnings).toBeUndefined();
  });

  it("adapts anchor tags to comparison contentType via deriveContentType", async () => {
    mockMessages.mockImplementationOnce(async () => ({
      raw: JSON.stringify({
        caption: "Cursor vs. Windsurf im Vergleich. 🔥 Link in Bio → https://toolwiki.ai",
        hashtags: ["#KITools", "#AITools", "#KIVergleich", "#AIComparison", "#KIFürBusiness", "#AIForBusiness", "#Cursor"],
      }),
      cost: { totalEur: 0.028 },
    }));

    const step = new GenerateCaptionStep();
    // intentType "comparison" → contentType "comparison" → anchor tags include #KIVergleich
    const out = await step.execute(makeCaptionInput({ intentType: "comparison" }), mockCtx(sharedProjectId));

    const loc = out.perLocaleOutputs[0]!;
    expect(loc.caption).toBeString();
    expect(loc.hashtags).toBeArray();
  });

  it("falls back to safe defaults when LLM returns malformed JSON twice", async () => {
    // Both calls return non-JSON
    mockMessages.mockImplementation(async () => ({
      raw: "NOT JSON AT ALL",
      cost: { totalEur: 0.028 },
    }));

    const step = new GenerateCaptionStep();
    const out = await step.execute(makeCaptionInput(), mockCtx(sharedProjectId));

    const loc = out.perLocaleOutputs[0]!;
    // Caption must be a non-empty string
    expect(loc.caption).toBeString();
    expect(loc.caption.length).toBeGreaterThan(0);
    // Hashtags must be a non-empty array
    expect(loc.hashtags).toBeArray();
    expect(loc.hashtags.length).toBeGreaterThan(0);
    // Fallback must set the warnings flag
    expect(loc.warnings).toContain("hashtag_generation_fallback");

    // Restore default mock for subsequent tests
    mockMessages.mockImplementation(async () => ({
      raw: JSON.stringify({
        coverEyebrow: "KI-TOOLS 2026",
        coverHeadlineLead: "Die 5 besten",
        coverHeadlineHighlight: "KI-Bild-Generatoren",
        coverHeadlineTrail: "im Vergleich",
        endHeadline: "Mehr Reviews,",
        endHeadlineHighlight: "ehrlich getestet.",
        tools: [],
      }),
      cost: { totalEur: 0.001 },
    }));
  });

  it("rejects hashtags with hyphens (schema validation fails → fallback)", async () => {
    // LLM returns a hyphenated hashtag that fails the /^#\w+$/ regex
    mockMessages.mockImplementation(async () => ({
      raw: JSON.stringify({
        caption: "Valid caption text here.",
        hashtags: ["#KI-Tools", "#AITools", "#Produktivität", "#DigitalTools", "#TechReview"],
      }),
      cost: { totalEur: 0.028 },
    }));

    const step = new GenerateCaptionStep();
    const out = await step.execute(makeCaptionInput(), mockCtx(sharedProjectId));

    // Schema rejects #KI-Tools, both retries fail, fallback fires
    expect(out.perLocaleOutputs[0]!.warnings).toContain("hashtag_generation_fallback");

    // Restore default mock
    mockMessages.mockImplementation(async () => ({
      raw: JSON.stringify({
        coverEyebrow: "KI-TOOLS 2026",
        coverHeadlineLead: "Die 5 besten",
        coverHeadlineHighlight: "KI-Bild-Generatoren",
        coverHeadlineTrail: "im Vergleich",
        endHeadline: "Mehr Reviews,",
        endHeadlineHighlight: "ehrlich getestet.",
        tools: [],
      }),
      cost: { totalEur: 0.001 },
    }));
  });
});

// ─── Live-gated integration tests ────────────────────────────────────────────
// Caption/hashtag live tests live in social-image-caption-live.test.ts (separate
// file without module mocks — Bun's cache prevents mock.restore() from un-binding
// @marketing-auto/adapter-anthropic once imported transitively).

const LIVE = process.env.RUN_LIVE_ARTICLE_PIPELINE === "1";

describe.skipIf(!LIVE)("ExtractToolsStep (live LLM)", () => {
  it("calls real Anthropic API and returns structured tool data", async () => {
    // Restore the real module for live tests
    mock.restore();

    const { ExtractToolsStep: LiveStep } = await import(
      "../../src/article/social-image/steps.ts"
    );

    const step = new LiveStep();
    const input = {
      articleId: sharedArticleId,
      projectId: sharedProjectId,
      projectSlug: sharedProjectSlug,
      theme: "dark" as const,
      variant: "stunning" as const,
      locales: ["de-DE"],
      articleTitle: "Die 5 besten KI-Bildgeneratoren 2026",
      articleSlug: "ki-tools-social-test",
      intentType: null as string | null,
      bodyMd: `# Die 5 besten KI-Bildgeneratoren 2026

Midjourney, DALL-E 3, Stable Diffusion, Adobe Firefly und Ideogram im Vergleich.

## 1. Midjourney
Midjourney ist bekannt für...

## 2. DALL-E 3
DALL-E 3 von OpenAI...`,
      articleUrl: "https://example.com/ki-tools",
      brandTokens: {},
    };

    const out = await step.execute(input, mockCtx(sharedProjectId));

    expect(out.extractedTools.length).toBeGreaterThanOrEqual(1);
    expect(out.coverHeadlineLead).toBeString();
    expect(out.coverHeadlineHighlight).toBeString();
    expect(out.endHeadline).toBeString();
  }, 60_000);
});
