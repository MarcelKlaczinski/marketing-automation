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
  llmMode: "sync",
  log: createLogger("test"),
  reportProgress: async () => {},
  getStepOutput: () => undefined,
});

const resolvedTools = [
  { slug: "cursor", rank: 1, name: "Cursor", domain: "cursor.sh", eyebrow: "01 · CURSOR", tagline: "KI-first Code-Editor.", strengths: ["Autocomplete", "Chat"], pricing: { tier: "freemium" as const, label: "ab 0$/Monat" } },
  { slug: "windsurf", rank: 2, name: "Windsurf", domain: "codeium.com", eyebrow: "02 · WINDSURF", tagline: "Agentic IDE.", strengths: ["Flows", "Speed"], pricing: { tier: "freemium" as const, label: "ab 0$/Monat" } },
  { slug: "copilot", rank: 3, name: "GitHub Copilot", domain: "github.com", eyebrow: "03 · COPILOT", tagline: "Microsoft KI im Editor.", strengths: ["Integration", "Quality"], pricing: { tier: "paid" as const, label: "ab 10$/Monat" } },
];

const BASE_INPUT = {
  projectSlug: "toolwiki",
  theme: "dark" as const,
  variant: "stunning" as const,
  locales: ["de-DE"],
  extractedTools: [] as never[],
  coverEyebrow: "KI-CODE-EDITOREN",
  coverHeadlineLead: "Die 5 besten",
  coverHeadlineHighlight: "KI-Code-Editoren",
  endHeadline: "Mehr Reviews,",
  endHeadlineHighlight: "ehrlich getestet.",
};

describe.skipIf(!LIVE)("GenerateCaptionStep — live hashtag quality smoke test", () => {
  it("comparison article (DE): 5-10 tags, no hyphens, no year tags, bilingual mix", async () => {
    const step = new GenerateCaptionStep();
    const out = await step.execute({
      ...BASE_INPUT,
      articleId: crypto.randomUUID(),
      projectId: liveProjectId,
      articleTitle: "Die 5 besten KI-Code-Editoren 2026: Cursor, Windsurf und Copilot im Vergleich",
      articleSlug: "ki-code-editoren-vergleich",
      intentType: "comparison",
      bodyMd: "## Vergleich der besten KI-Code-Editoren",
      articleUrl: "https://toolwiki.ai/de/ki-code-editoren-vergleich",
      brandTokens: { voice: { signaturePhrases: ["redaktionell verifiziert"], addressForm: "du" } },
      resolvedTools,
    }, mockCtx());

    const locale = out.perLocaleOutputs[0]!;
    console.log("[comparison/DE] Caption:", locale.caption);
    console.log("[comparison/DE] Hashtags:", locale.hashtags);

    expect(locale.warnings, "fallback fired — check LLM response").toBeUndefined();
    expect(locale.hashtags.length).toBeGreaterThanOrEqual(5);
    expect(locale.hashtags.length).toBeLessThanOrEqual(10);
    expect(locale.hashtags.filter((h: string) => h.includes("-"))).toEqual([]);
    expect(locale.hashtags.filter((h: string) => /\d{4}/.test(h))).toEqual([]);
    expect(locale.hashtags.filter((h: string) => !h.startsWith("#"))).toEqual([]);
    expect(locale.caption.length).toBeGreaterThan(20);
  }, 60_000);

  it("review article (DE): anchor tags include #KIFürBusiness not #KIVergleich", async () => {
    const step = new GenerateCaptionStep();
    const out = await step.execute({
      ...BASE_INPUT,
      articleId: crypto.randomUUID(),
      projectId: liveProjectId,
      articleTitle: "Cursor Review 2026: Der beste KI-Code-Editor?",
      articleSlug: "cursor-review",
      intentType: "review",
      bodyMd: "## Cursor im Test",
      articleUrl: "https://toolwiki.ai/de/cursor-review",
      brandTokens: {},
      coverEyebrow: "CURSOR REVIEW",
      coverHeadlineLead: "Review:",
      coverHeadlineHighlight: "Cursor",
      resolvedTools: [resolvedTools[0]!],
    }, mockCtx());

    const locale = out.perLocaleOutputs[0]!;
    console.log("[review/DE] Caption:", locale.caption);
    console.log("[review/DE] Hashtags:", locale.hashtags);

    expect(locale.warnings, "fallback fired — check LLM response").toBeUndefined();
    expect(locale.hashtags.filter((h: string) => h.includes("-"))).toEqual([]);
    expect(locale.hashtags.filter((h: string) => /\d{4}/.test(h))).toEqual([]);
  }, 60_000);

  it("general article (DE): uses #KIFürBusiness anchors, not #KIVergleich", async () => {
    const step = new GenerateCaptionStep();
    const out = await step.execute({
      ...BASE_INPUT,
      articleId: crypto.randomUUID(),
      projectId: liveProjectId,
      articleTitle: "Wie KI-Tools deinen Arbeitsalltag verändern: Ein Überblick",
      articleSlug: "ki-tools-arbeitsalltag",
      intentType: "general",
      bodyMd: "## KI im Alltag",
      articleUrl: "https://toolwiki.ai/de/ki-tools-arbeitsalltag",
      brandTokens: {},
      coverEyebrow: "KI IM ALLTAG",
      coverHeadlineLead: "So verändert",
      coverHeadlineHighlight: "KI deinen Job",
      resolvedTools,
    }, mockCtx());

    const locale = out.perLocaleOutputs[0]!;
    console.log("[general/DE] Caption:", locale.caption);
    console.log("[general/DE] Hashtags:", locale.hashtags);

    expect(locale.warnings, "fallback fired — check LLM response").toBeUndefined();
    expect(locale.hashtags.length).toBeGreaterThanOrEqual(5);
    expect(locale.hashtags.length).toBeLessThanOrEqual(10);
    expect(locale.hashtags.filter((h: string) => h.includes("-"))).toEqual([]);
    expect(locale.hashtags.filter((h: string) => /\d{4}/.test(h))).toEqual([]);
    expect(locale.hashtags.filter((h: string) => !h.startsWith("#"))).toEqual([]);
    // general intentType must NOT use comparison anchors
    expect(locale.hashtags).not.toContain("#KIVergleich");
    expect(locale.hashtags).not.toContain("#AIComparison");
  }, 60_000);
});
