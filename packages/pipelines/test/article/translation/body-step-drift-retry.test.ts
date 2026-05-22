// Spec 64.5 — verifies the word-drift retry mechanism in TranslationBodyStep,
// plus the combined FAQ + word-drift cumulative retry path.
//
// Strategy mirrors body-step-faq-retry.test.ts (Spec 64.4): mock
// @marketing-auto/adapter-anthropic so anthropic.messages() returns canned
// raw strings without hitting the DB or Anthropic API. Tests exercise the
// LITERAL path only (DB-free); the retry helper is shared, so behaviour
// generalises to the adaptive path.
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

type AnthropicCallArgs = {
  userMessage: string;
  operation: string;
  [k: string]: unknown;
};

const calls: AnthropicCallArgs[] = [];
let responses: string[] = [];

await mock.module("@marketing-auto/adapter-anthropic", () => ({
  anthropic: {
    messages: async (args: AnthropicCallArgs) => {
      calls.push(args);
      const idx = calls.length - 1;
      const raw = responses[idx] ?? "";
      return {
        raw,
        json: null,
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        stopReason: "end_turn",
        model: "claude-sonnet-4-6",
        costEur: 0.001,
      };
    },
  },
}));

await mock.module("../../../src/engine/prompt-resolver.ts", () => ({
  resolvePrompt: async (
    _ctx: unknown,
    _stepName: string,
    buildDefault: () => string,
  ) => buildDefault(),
}));

const { TranslationBodyStep } = await import("../../../src/article/translation/body-step.ts");
const { makeMockCtx } = await import("../../fixtures/mock-ctx.ts");

// Long DE source body (~360 words including headings + paragraphs) without FAQ.
// Sized so the +25% cap (~450 words) dwarfs the ~22-word overhead of the
// <TITLE>/<META>/<TAGS> blocks that the validator counts as part of raw output.
function makeSourceBodyNoFaq(): string {
  const sentence = [
    "Diese Einleitung erläutert das Thema des Artikels in kompakter Form.",
    "Wir betrachten die wichtigsten Aspekte und ordnen sie für unsere Leser ein.",
    "Die folgenden Abschnitte vertiefen einzelne Punkte mit konkreten Beispielen.",
    "Dabei legen wir Wert auf Klarheit und Lesbarkeit ohne unnötige Verkomplizierung.",
    "Ziel ist eine pragmatische Übersicht ohne Werbesprache oder leere Versprechungen.",
    "Wer den Text liest, sollte am Ende konkrete Schritte ableiten können und Sicherheit gewinnen.",
    "Wir verzichten dabei auf Marketing-Floskeln und konzentrieren uns auf belastbare Aussagen.",
    "Im weiteren Verlauf folgen Beispiele aus dem Alltag erfahrener Anwenderinnen und Anwender.",
  ].join(" ");
  const paragraph = `${sentence} ${sentence} ${sentence}`;
  return `# Artikel\n\n## Einleitung\n${paragraph}\n\n## Vertiefung\n${paragraph}\n`;
}

// Source body WITH a 3-item FAQ — used for combined FAQ + drift retry test.
// Same size class as makeSourceBodyNoFaq so cap math is comparable.
const SOURCE_WITH_FAQ = (() => {
  const sentence = [
    "Diese Einleitung erläutert das Thema des Artikels in kompakter Form.",
    "Wir betrachten die wichtigsten Aspekte und ordnen sie für unsere Leser ein.",
    "Die folgenden Abschnitte vertiefen einzelne Punkte mit konkreten Beispielen.",
    "Dabei legen wir Wert auf Klarheit und Lesbarkeit ohne unnötige Verkomplizierung.",
    "Ziel ist eine pragmatische Übersicht ohne Werbesprache oder leere Versprechungen.",
    "Wer den Text liest, sollte am Ende konkrete Schritte ableiten können und Sicherheit gewinnen.",
    "Wir verzichten dabei auf Marketing-Floskeln und konzentrieren uns auf belastbare Aussagen.",
    "Im weiteren Verlauf folgen Beispiele aus dem Alltag erfahrener Anwenderinnen und Anwender.",
  ].join(" ");
  const paragraph = `${sentence} ${sentence} ${sentence}`;
  return `# Artikel

## Einleitung
${paragraph}

## Vertiefung
${paragraph}

## Häufige Fragen
### Frage 1?
Antwort eins zur ersten Frage.
### Frage 2?
Antwort zwei zur zweiten Frage.
### Frage 3?
Antwort drei zur dritten Frage.
`;
})();

// Builds a tagged-block-wrapped EN body with approximate word count and N FAQ items.
function makeEnBody(approxWords: number, faqCount: number): string {
  const lineWords = 10;
  const lines = Math.max(1, Math.floor(approxWords / lineWords));
  const intro = Array.from({ length: lines }, () =>
    "one two three four five six seven eight nine ten",
  ).join(" ");
  const faqHeader = "## FAQ\n";
  const faqItems = Array.from({ length: faqCount }, (_, i) =>
    `### Question ${i + 1}?\nAnswer ${i + 1}.\n`,
  ).join("");
  const body = `# Article\n\n## Intro\n${intro}\n\n${faqCount > 0 ? faqHeader + faqItems : ""}`;
  return `${body}\n<TITLE>Translated Title</TITLE>\n<META_DESCRIPTION>An English meta description used to verify the parse path is intact in the test fixture.</META_DESCRIPTION>\n<TAGS>tag-one,tag-two</TAGS>`;
}

describe("TranslationBodyStep — word-drift retry mechanism (Spec 64.5)", () => {
  beforeEach(() => {
    calls.length = 0;
    responses = [];
  });

  afterEach(() => {
    calls.length = 0;
    responses = [];
  });

  it("injects WORD_COUNT_CONSTRAINT with source word count + cap into the first attempt prompt", async () => {
    const source = makeSourceBodyNoFaq();
    responses = [makeEnBody(300, 0)]; // valid: well under cap, no FAQ to lose

    const step = new TranslationBodyStep();
    await step.execute(
      {
        articleId:          "11111111-1111-1111-1111-111111111114",
        projectId:          "22222222-2222-2222-2222-222222222225",
        decision:           "literal",
        sourceBodyMd:       source,
        sourceTitle:        "Test",
        primaryKeyword:     "ai",
        cornerstoneKeyword: "ai",
        voiceReferences:    [],
        projectSlug:        "test",
        sourceLocale:       "de",
        targetLocale:       "en",
      },
      makeMockCtx({ projectId: "22222222-2222-2222-2222-222222222225" }),
    );

    const firstCall = calls[0]!;
    expect(firstCall.userMessage).toMatch(/Word-Count Constraint/);
    expect(firstCall.userMessage).toMatch(/Source word count: \d+/);
    expect(firstCall.userMessage).toMatch(/Target word count must be ≤ \d+/);
    expect(firstCall.userMessage).not.toMatch(/CRITICAL RETRY/);
  });

  it("retries once with STRONGER_DRIFT_GUIDANCE when target exceeds the +25% cap", async () => {
    const source = makeSourceBodyNoFaq();
    responses = [
      makeEnBody(800, 0), // first: ~800 words vs source ~360 → +120% drift (cap 25%)
      makeEnBody(330, 0), // retry: ~330 words → within +25% cap
    ];

    const step = new TranslationBodyStep();
    const result = await step.execute(
      {
        articleId:          "11111111-1111-1111-1111-111111111115",
        projectId:          "22222222-2222-2222-2222-222222222226",
        decision:           "literal",
        sourceBodyMd:       source,
        sourceTitle:        "Test",
        primaryKeyword:     "ai",
        cornerstoneKeyword: "ai",
        voiceReferences:    [],
        projectSlug:        "test",
        sourceLocale:       "de",
        targetLocale:       "en",
      },
      makeMockCtx({ projectId: "22222222-2222-2222-2222-222222222226" }),
    );

    expect(calls.length).toBe(2);
    expect(calls[0]!.userMessage).not.toMatch(/CRITICAL RETRY/);
    expect(calls[1]!.userMessage).toMatch(/CRITICAL RETRY: Previous translation exceeded the word-count cap/);
    expect(calls[1]!.userMessage).toMatch(/Source has \d+ words/);
    expect(calls[1]!.userMessage).toMatch(/Previous attempt produced \d+ words/);
    expect(result.wordDriftValidation).toBeDefined();
    expect(result.wordDriftValidation!.valid).toBe(true);
  });

  it("returns body with invalid drift validation when retry also exceeds cap (does NOT throw)", async () => {
    const source = makeSourceBodyNoFaq();
    responses = [
      makeEnBody(800, 0), // first: too long
      makeEnBody(900, 0), // retry: still too long
    ];

    const step = new TranslationBodyStep();
    const result = await step.execute(
      {
        articleId:          "11111111-1111-1111-1111-111111111116",
        projectId:          "22222222-2222-2222-2222-222222222227",
        decision:           "literal",
        sourceBodyMd:       source,
        sourceTitle:        "Test",
        primaryKeyword:     "ai",
        cornerstoneKeyword: "ai",
        voiceReferences:    [],
        projectSlug:        "test",
        sourceLocale:       "de",
        targetLocale:       "en",
      },
      makeMockCtx({ projectId: "22222222-2222-2222-2222-222222222227" }),
    );

    expect(calls.length).toBe(2);
    expect(result.bodyMd.length).toBeGreaterThanOrEqual(200);
    expect(result.wordDriftValidation).toBeDefined();
    expect(result.wordDriftValidation!.valid).toBe(false);
    expect(result.wordDriftValidation!.driftPct).toBeGreaterThan(25);
  });

  it("combines FAQ + word-drift guidance in one retry when both validators fail", async () => {
    responses = [
      makeEnBody(900, 1), // first: too long AND missing FAQ items (1 of 3)
      makeEnBody(330, 3), // retry: within cap AND all 3 FAQ items
    ];

    const step = new TranslationBodyStep();
    const result = await step.execute(
      {
        articleId:          "11111111-1111-1111-1111-111111111117",
        projectId:          "22222222-2222-2222-2222-222222222228",
        decision:           "literal",
        sourceBodyMd:       SOURCE_WITH_FAQ,
        sourceTitle:        "Test",
        primaryKeyword:     "ai",
        cornerstoneKeyword: "ai",
        voiceReferences:    [],
        projectSlug:        "test",
        sourceLocale:       "de",
        targetLocale:       "en",
      },
      makeMockCtx({ projectId: "22222222-2222-2222-2222-222222222228" }),
    );

    expect(calls.length).toBe(2);
    // Retry prompt contains BOTH guidances — cumulative single retry per Spec 64.5 §3.3
    const retryMsg = calls[1]!.userMessage;
    expect(retryMsg).toMatch(/CRITICAL RETRY: Previous translation lost FAQ items/);
    expect(retryMsg).toMatch(/CRITICAL RETRY: Previous translation exceeded the word-count cap/);
    expect(retryMsg).toMatch(/exactly 3 FAQ items/);
    expect(result.faqValidation).toBeDefined();
    expect(result.faqValidation!.valid).toBe(true);
    expect(result.wordDriftValidation).toBeDefined();
    expect(result.wordDriftValidation!.valid).toBe(true);
  });

  it("does NOT retry when both validators pass on first attempt", async () => {
    const source = makeSourceBodyNoFaq();
    responses = [makeEnBody(320, 0)]; // within cap, no FAQ to compare

    const step = new TranslationBodyStep();
    const result = await step.execute(
      {
        articleId:          "11111111-1111-1111-1111-111111111118",
        projectId:          "22222222-2222-2222-2222-222222222229",
        decision:           "literal",
        sourceBodyMd:       source,
        sourceTitle:        "Test",
        primaryKeyword:     "ai",
        cornerstoneKeyword: "ai",
        voiceReferences:    [],
        projectSlug:        "test",
        sourceLocale:       "de",
        targetLocale:       "en",
      },
      makeMockCtx({ projectId: "22222222-2222-2222-2222-222222222229" }),
    );

    expect(calls.length).toBe(1);
    expect(result.wordDriftValidation).toBeDefined();
    expect(result.wordDriftValidation!.valid).toBe(true);
    expect(result.faqValidation).toBeDefined();
    expect(result.faqValidation!.valid).toBe(true);
  });
});
