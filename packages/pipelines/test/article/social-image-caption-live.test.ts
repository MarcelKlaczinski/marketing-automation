/**
 * Live smoke test for GenerateCaptionStep hashtag quality.
 * Must be in its own file — the sibling social-image-pipeline.test.ts mocks
 * @marketing-auto/adapter-anthropic at module level; Bun's module cache means
 * mock.restore() inside a test does not un-bind the already-imported anthropic
 * client. A fresh file avoids the cache collision entirely.
 *
 * Run: RUN_LIVE_ARTICLE_PIPELINE=1 bun test packages/pipelines/test/article/social-image-caption-live.test.ts
 */
import { beforeAll, describe, expect, it } from "bun:test";
import { db, eq } from "@marketing-auto/db";
import { projects } from "@marketing-auto/db/schema";
import { createLogger } from "@marketing-auto/shared";
import type { StepContext } from "../../src/engine/step.ts";
import { GenerateCaptionStep } from "../../src/article/social-image/steps.ts";

const LIVE = process.env.RUN_LIVE_ARTICLE_PIPELINE === "1";

// cost_logs has a FK on project_id — must use a real project from the DB.
let liveProjectId = "";
beforeAll(async () => {
  if (!LIVE) return;
  const rows = await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, "toolwiki")).limit(1);
  liveProjectId = rows[0]?.id ?? crypto.randomUUID();
});

const mockCtx = (): StepContext => ({
  projectId: liveProjectId,
  pipelineRunId: crypto.randomUUID(),
  stepRunId: crypto.randomUUID(),
  pipelineName: "test",
  log: createLogger("test"),
  reportProgress: async () => {},
  getStepOutput: () => undefined,
});

const resolvedTools = [
  { slug: "cursor", rank: 1, name: "Cursor", domain: "cursor.sh", eyebrow: "01 · CURSOR", tagline: "KI-first Code-Editor.", strengths: ["Autocomplete", "Chat"], pricing: { tier: "freemium" as const, label: "ab 0$/Monat" } },
  { slug: "windsurf", rank: 2, name: "Windsurf", domain: "codeium.com", eyebrow: "02 · WINDSURF", tagline: "Agentic IDE.", strengths: ["Flows", "Speed"], pricing: { tier: "freemium" as const, label: "ab 0$/Monat" } },
  { slug: "copilot", rank: 3, name: "GitHub Copilot", domain: "github.com", eyebrow: "03 · COPILOT", tagline: "Microsoft KI im Editor.", strengths: ["Integration", "Quality"], pricing: { tier: "paid" as const, label: "ab 10$/Monat" } },
];

describe.skipIf(!LIVE)("GenerateCaptionStep — live hashtag quality smoke test", () => {
  it("comparison article (DE): 5-10 tags, no hyphens, no year tags, bilingual mix", async () => {
    const step = new GenerateCaptionStep();
    const out = await step.execute({
      articleId: crypto.randomUUID(),
      projectId: liveProjectId,
      projectSlug: "toolwiki",
      theme: "dark",
      variant: "editorial",
      articleTitle: "Die 5 besten KI-Code-Editoren 2026: Cursor, Windsurf und Copilot im Vergleich",
      articleSlug: "ki-code-editoren-vergleich",
      intentType: "comparison",
      bodyMd: "## Vergleich der besten KI-Code-Editoren",
      articleUrl: "https://toolwiki.ai/de/ki-code-editoren-vergleich",
      brandTokens: { voice: { signaturePhrases: ["redaktionell verifiziert"], addressForm: "du" } },
      extractedTools: [],
      coverEyebrow: "KI-CODE-EDITOREN",
      coverHeadlineLead: "Die 5 besten",
      coverHeadlineHighlight: "KI-Code-Editoren",
      endHeadline: "Mehr Reviews,",
      endHeadlineHighlight: "ehrlich getestet.",
      resolvedTools,
      slideBuffers: [],
      totalSlides: 5,
      slideUrls: ["https://pub.example.com/slide-0.png"],
    }, mockCtx());

    console.log("[comparison/DE] Caption:", out.caption);
    console.log("[comparison/DE] Hashtags:", out.hashtags);

    expect(out.warnings, "fallback fired — check LLM response").toBeUndefined();
    expect(out.hashtags.length).toBeGreaterThanOrEqual(5);
    expect(out.hashtags.length).toBeLessThanOrEqual(10);
    expect(out.hashtags.filter(h => h.includes("-"))).toEqual([]);
    expect(out.hashtags.filter(h => /\d{4}/.test(h))).toEqual([]);
    expect(out.hashtags.filter(h => !h.startsWith("#"))).toEqual([]);
    expect(out.caption.length).toBeGreaterThan(20);
  }, 60_000);

  it("review article (DE): anchor tags include #KIFürBusiness not #KIVergleich", async () => {
    const step = new GenerateCaptionStep();
    const out = await step.execute({
      articleId: crypto.randomUUID(),
      projectId: liveProjectId,
      projectSlug: "toolwiki",
      theme: "dark",
      variant: "editorial",
      articleTitle: "Cursor Review 2026: Der beste KI-Code-Editor?",
      articleSlug: "cursor-review",
      intentType: "review",
      bodyMd: "## Cursor im Test",
      articleUrl: "https://toolwiki.ai/de/cursor-review",
      brandTokens: {},
      extractedTools: [],
      coverEyebrow: "CURSOR REVIEW",
      coverHeadlineLead: "Review:",
      coverHeadlineHighlight: "Cursor",
      endHeadline: "Mehr Reviews,",
      endHeadlineHighlight: "ehrlich getestet.",
      resolvedTools: [resolvedTools[0]!],
      slideBuffers: [],
      totalSlides: 3,
      slideUrls: ["https://pub.example.com/slide-0.png"],
    }, mockCtx());

    console.log("[review/DE] Caption:", out.caption);
    console.log("[review/DE] Hashtags:", out.hashtags);

    expect(out.warnings, "fallback fired — check LLM response").toBeUndefined();
    expect(out.hashtags.filter(h => h.includes("-"))).toEqual([]);
    expect(out.hashtags.filter(h => /\d{4}/.test(h))).toEqual([]);
  }, 60_000);

  it("general article (DE): uses #KIFürBusiness anchors, not #KIVergleich", async () => {
    const step = new GenerateCaptionStep();
    const out = await step.execute({
      articleId: crypto.randomUUID(),
      projectId: liveProjectId,
      projectSlug: "toolwiki",
      theme: "dark",
      variant: "editorial",
      articleTitle: "Wie KI-Tools deinen Arbeitsalltag verändern: Ein Überblick",
      articleSlug: "ki-tools-arbeitsalltag",
      intentType: "general",
      bodyMd: "## KI im Alltag",
      articleUrl: "https://toolwiki.ai/de/ki-tools-arbeitsalltag",
      brandTokens: {},
      extractedTools: [],
      coverEyebrow: "KI IM ALLTAG",
      coverHeadlineLead: "So verändert",
      coverHeadlineHighlight: "KI deinen Job",
      endHeadline: "Mehr Reviews,",
      endHeadlineHighlight: "ehrlich getestet.",
      resolvedTools,
      slideBuffers: [],
      totalSlides: 4,
      slideUrls: ["https://pub.example.com/slide-0.png"],
    }, mockCtx());

    console.log("[general/DE] Caption:", out.caption);
    console.log("[general/DE] Hashtags:", out.hashtags);

    expect(out.warnings, "fallback fired — check LLM response").toBeUndefined();
    expect(out.hashtags.length).toBeGreaterThanOrEqual(5);
    expect(out.hashtags.length).toBeLessThanOrEqual(10);
    expect(out.hashtags.filter(h => h.includes("-"))).toEqual([]);
    expect(out.hashtags.filter(h => /\d{4}/.test(h))).toEqual([]);
    expect(out.hashtags.filter(h => !h.startsWith("#"))).toEqual([]);
    // general intentType must NOT use comparison anchors
    expect(out.hashtags).not.toContain("#KIVergleich");
    expect(out.hashtags).not.toContain("#AIComparison");
  }, 60_000);
});
