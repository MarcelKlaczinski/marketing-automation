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
  LoadArticleStep,
  PersistSocialPostStep,
  ResolveAssetsStep,
} from "../../src/article/social-image/steps.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const mockCtx = (projectId: string): StepContext => ({
  projectId,
  pipelineRunId: crypto.randomUUID(),
  stepRunId: crypto.randomUUID(),
  pipelineName: "test",
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
  articleTitle: overrides.articleTitle ?? "Die 5 besten KI-Tools",
  articleSlug: "ki-tools-test",
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
      { articleId: sharedArticleId, projectId: sharedProjectId, theme: "dark" },
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
        { articleId: crypto.randomUUID(), projectId: sharedProjectId, theme: "dark" },
        mockCtx(sharedProjectId),
      ),
    ).rejects.toThrow(/not found/i);
  });

  it("respects theme=light in output", async () => {
    const step = new LoadArticleStep();
    const out = await step.execute(
      { articleId: sharedArticleId, projectId: sharedProjectId, theme: "light" },
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
      articleTitle: "Die 5 besten KI-Tools",
      articleSlug: "ki-tools-social-test",
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

// ─── PersistSocialPostStep — DB test ─────────────────────────────────────────

describe("PersistSocialPostStep", () => {
  const slideUrls = [
    "https://pub.example.com/slide-0.png",
    "https://pub.example.com/slide-1.png",
    "https://pub.example.com/slide-2.png",
  ];
  const caption = "Schau dir die 5 besten KI-Tools an! 🎨 Link in Bio → https://example.com";
  const hashtags = ["#KITools", "#ArtificialIntelligence", "#KI"];

  /** Full PersistInputSchema-compatible input. Only a subset of fields is used by the step. */
  function makePersistInput() {
    return {
      articleId: sharedArticleId,
      projectId: sharedProjectId,
      projectSlug: sharedProjectSlug,
      theme: "dark" as const,
      articleTitle: "Die 5 besten KI-Bildgeneratoren 2026",
      articleSlug: "ki-tools-social-test",
      bodyMd: "# Test",
      articleUrl: "https://example.com/ki-tools",
      brandTokens: {},
      extractedTools: [],
      coverEyebrow: "KI-TOOLS 2026",
      coverHeadlineLead: "Die 5 besten",
      coverHeadlineHighlight: "KI-Tools",
      endHeadline: "Mehr Reviews,",
      endHeadlineHighlight: "ehrlich getestet.",
      resolvedTools: [],
      slideBuffers: [Buffer.alloc(0), Buffer.alloc(0), Buffer.alloc(0)],
      totalSlides: 3,
      slideUrls,
      caption,
      hashtags,
    };
  }

  it("inserts a social post row and returns correct output shape", async () => {
    const step = new PersistSocialPostStep();
    const out = await step.execute(makePersistInput(), mockCtx(sharedProjectId));

    expect(out.socialPostId).toBeString();
    // Must be a UUID
    expect(out.socialPostId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(out.slideUrls).toEqual(slideUrls);
    expect(out.caption).toBe(caption);
    expect(out.hashtags).toEqual(hashtags);
    expect(out.totalSlides).toBe(3);
  });

  it("DB row has correct theme, totalSlides, and carousel content", async () => {
    const step = new PersistSocialPostStep();
    const out = await step.execute(makePersistInput(), mockCtx(sharedProjectId));

    const [row] = await db
      .select()
      .from(socialPosts)
      .where(eq(socialPosts.id, out.socialPostId))
      .limit(1);

    expect(row).toBeDefined();
    expect(row!.theme).toBe("dark");
    expect(row!.totalSlides).toBe(3);
    expect(row!.platform).toBe("instagram");
    expect(row!.format).toBe("carousel");
    expect(row!.status).toBe("draft");

    const content = row!.content as { kind: string; slides: Array<{ imageUrl: string }>; caption: string; hashtags: string[] };
    expect(content.kind).toBe("carousel");
    expect(content.slides.length).toBe(3);
    expect(content.slides[0]!.imageUrl).toBe(slideUrls[0]!);
    expect(content.caption).toBe(caption);
    expect(content.hashtags).toEqual(hashtags);
  });

  it("links the social post to the correct articleId", async () => {
    const step = new PersistSocialPostStep();
    const out = await step.execute(makePersistInput(), mockCtx(sharedProjectId));

    const [row] = await db
      .select()
      .from(socialPosts)
      .where(eq(socialPosts.id, out.socialPostId))
      .limit(1);

    expect(row!.articleId).toBe(sharedArticleId);
    expect(row!.projectId).toBe(sharedProjectId);
  });
});

// ─── Live-gated integration tests ────────────────────────────────────────────

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
      articleTitle: "Die 5 besten KI-Bildgeneratoren 2026",
      articleSlug: "ki-tools-social-test",
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
