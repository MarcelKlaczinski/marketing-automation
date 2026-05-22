// Spec 64.4 — verifies the FAQ retry mechanism in TranslationBodyStep.
//
// Strategy: mock @marketing-auto/adapter-anthropic so anthropic.messages()
// returns canned raw strings without hitting the DB or Anthropic API. The
// `mock.module(...)` call runs before the dynamic import of the step so Bun's
// module cache picks up the stub.
//
// Both tests exercise the LITERAL path (decision: "literal"), which is
// DB-free. The adaptive path makes a DB query for targetArticle.intentType
// and is not exercised here — the retry helper itself is shared, so the
// behaviour generalises.
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

// Stub the prompt resolver so we never touch the DB for promptVersions lookup.
await mock.module("../../../src/engine/prompt-resolver.ts", () => ({
  resolvePrompt: async (
    _ctx: unknown,
    _stepName: string,
    buildDefault: () => string,
  ) => buildDefault(),
}));

// Imports AFTER the mocks so the bindings pick up our stubs.
const { TranslationBodyStep } = await import("../../../src/article/translation/body-step.ts");
const { makeMockCtx } = await import("../../fixtures/mock-ctx.ts");

const SOURCE_BODY_DE = `# Article

## Intro
Some intro paragraph that's long enough to exceed the 200-char minimum required by the body-step output schema. Padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding.

## Häufige Fragen
### Frage 1?
A.
### Frage 2?
B.
### Frage 3?
C.
`;

// Produces a tagged-block-wrapped EN body with N FAQ items. Always exceeds 200 chars.
function makeEnBody(faqCount: number): string {
  const pad = "Some intro paragraph that's long enough to exceed the 200-char minimum required by the body-step output schema. Padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding padding.";
  const faqHeader = "## FAQ\n";
  const faqItems = Array.from({ length: faqCount }, (_, i) =>
    `### Question ${i + 1}?\nAnswer ${i + 1}.\n`,
  ).join("");
  const body = `# Article\n\n## Intro\n${pad}\n\n${faqCount > 0 ? faqHeader + faqItems : ""}`;
  return `${body}\n<TITLE>Translated Title</TITLE>\n<META_DESCRIPTION>An English meta description used to verify the parse path is intact.</META_DESCRIPTION>\n<TAGS>tag-one,tag-two</TAGS>`;
}

describe("TranslationBodyStep — FAQ retry mechanism (Spec 64.4)", () => {
  beforeEach(() => {
    calls.length = 0;
    responses = [];
  });

  afterEach(() => {
    calls.length = 0;
    responses = [];
  });

  it("retries once with STRONGER_FAQ_GUIDANCE when first attempt loses FAQ items", async () => {
    responses = [
      makeEnBody(1), // first attempt: 1 FAQ item (source has 3) — invalid
      makeEnBody(3), // retry: 3 FAQ items — valid
    ];

    const step = new TranslationBodyStep();
    const result = await step.execute(
      {
        articleId:          "11111111-1111-1111-1111-111111111111",
        projectId:          "22222222-2222-2222-2222-222222222222",
        decision:           "literal",
        sourceBodyMd:       SOURCE_BODY_DE,
        sourceTitle:        "Test",
        primaryKeyword:     "ai",
        cornerstoneKeyword: "ai",
        voiceReferences:    [],
        projectSlug:        "test",
        sourceLocale:       "de",
        targetLocale:       "en",
      },
      makeMockCtx({ projectId: "22222222-2222-2222-2222-222222222222" }),
    );

    expect(calls.length).toBe(2);
    expect(calls[0]!.userMessage).not.toMatch(/CRITICAL RETRY/);
    expect(calls[1]!.userMessage).toMatch(/CRITICAL RETRY/);
    expect(calls[1]!.userMessage).toMatch(/exactly 3 FAQ items/);
    expect(result.faqValidation).toBeDefined();
    expect(result.faqValidation!.valid).toBe(true);
    expect(result.faqValidation!.sourceCount).toBe(3);
    expect(result.faqValidation!.targetCount).toBe(3);
  });

  it("returns body with invalid validation when retry also fails (does NOT throw)", async () => {
    responses = [
      makeEnBody(1), // first: 1 FAQ item — invalid
      makeEnBody(1), // retry: still 1 FAQ item — invalid
    ];

    const step = new TranslationBodyStep();
    const result = await step.execute(
      {
        articleId:          "11111111-1111-1111-1111-111111111112",
        projectId:          "22222222-2222-2222-2222-222222222223",
        decision:           "literal",
        sourceBodyMd:       SOURCE_BODY_DE,
        sourceTitle:        "Test",
        primaryKeyword:     "ai",
        cornerstoneKeyword: "ai",
        voiceReferences:    [],
        projectSlug:        "test",
        sourceLocale:       "de",
        targetLocale:       "en",
      },
      makeMockCtx({ projectId: "22222222-2222-2222-2222-222222222223" }),
    );

    expect(calls.length).toBe(2);
    expect(result.bodyMd).toBeDefined();
    expect(result.bodyMd.length).toBeGreaterThanOrEqual(200);
    expect(result.faqValidation).toBeDefined();
    expect(result.faqValidation!.valid).toBe(false);
    expect(result.faqValidation!.delta).toBe(2); // lost 2 of 3
    expect(result.faqValidation!.sourceCount).toBe(3);
    expect(result.faqValidation!.targetCount).toBe(1);
  });

  it("does NOT retry when first attempt preserves all FAQ items", async () => {
    responses = [makeEnBody(3)]; // first attempt is valid

    const step = new TranslationBodyStep();
    const result = await step.execute(
      {
        articleId:          "11111111-1111-1111-1111-111111111113",
        projectId:          "22222222-2222-2222-2222-222222222224",
        decision:           "literal",
        sourceBodyMd:       SOURCE_BODY_DE,
        sourceTitle:        "Test",
        primaryKeyword:     "ai",
        cornerstoneKeyword: "ai",
        voiceReferences:    [],
        projectSlug:        "test",
        sourceLocale:       "de",
        targetLocale:       "en",
      },
      makeMockCtx({ projectId: "22222222-2222-2222-2222-222222222224" }),
    );

    expect(calls.length).toBe(1);
    expect(calls[0]!.userMessage).toMatch(/FAQ Translation Requirement/);
    expect(result.faqValidation).toBeDefined();
    expect(result.faqValidation!.valid).toBe(true);
  });
});
