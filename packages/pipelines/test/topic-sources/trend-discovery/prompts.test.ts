// Spec 64.14 Phase B: regression-guard tests for the trend-synthesis prompt.
//
// The 22 trend_discovery briefs Toolwiki produced before 64.14 had ZERO
// intent_type='knowledge' even though the prompt rule existed. Hypothesis from
// Discovery: the LLM had too few negative examples to confidently classify
// against news/comparison/tutorial pulls. Phase B adds explicit counter +
// positive example blocks. These tests assert those blocks survive future
// prompt refactors — without them, a silent edit could regress the synthesizer
// back to the pre-64.14 zero-knowledge state.
//
// Live classifier accuracy tests (5 LLM cases against gold-standard fixtures)
// are deferred per spec §11 Phase B-optional — they require a separate
// RUN_LIVE_TREND_SYNTHESIZER=1 flag and ~€0.025/run cost. The prompt-text
// regression here catches the cheap failure mode (someone deletes the block).

import { describe, expect, it } from "bun:test";
import type { TopicScope } from "@marketing-auto/db";
import { buildTrendSynthesisDefaultPrompt } from "../../../src/topic-sources/trend-discovery/prompts.ts";

const emptyScope: TopicScope = {
  languages: ["de", "en"],
  primary_themes: [],
  relevance_keywords: [],
  exclusions: [],
  min_trend_score: 25,
  min_signal_thresholds: {
    hackernews: 3,
    producthunt: 0,
    vendor_rss: 0,
  },
};

describe("buildTrendSynthesisDefaultPrompt (Spec 64.14)", () => {
  it("includes the news-vs-knowledge counter-example block", () => {
    const prompt = buildTrendSynthesisDefaultPrompt(emptyScope);
    // The personal-event / corporate-event examples are the specific cases
    // that produced ki_wissen noise pre-64.14 ("I've joined Anthropic").
    expect(prompt).toContain("I've joined Anthropic");
    expect(prompt).toContain("OpenAI releases GPT-5");
  });

  it("includes the tool-tutorial counter-example", () => {
    const prompt = buildTrendSynthesisDefaultPrompt(emptyScope);
    expect(prompt).toContain("How to use Cursor with Python");
  });

  it("includes positive knowledge examples (German concept questions)", () => {
    const prompt = buildTrendSynthesisDefaultPrompt(emptyScope);
    expect(prompt).toContain("Was ist Retrieval-Augmented Generation");
    expect(prompt).toContain("Wie funktionieren Transformer-Modelle");
  });

  it("calls out the comparison-vs-knowledge distinction explicitly", () => {
    const prompt = buildTrendSynthesisDefaultPrompt(emptyScope);
    expect(prompt).toContain("Claude vs ChatGPT");
  });

  it("keeps the original knowledge-rule preamble (no accidental clobber)", () => {
    const prompt = buildTrendSynthesisDefaultPrompt(emptyScope);
    expect(prompt).toContain("knowledge");
    expect(prompt).toContain("theme-centric explainers WITHOUT a tool focus");
    // Sharp distinctions block — unchanged from pre-64.14.
    expect(prompt).toContain("knowledge vs tutorial");
    expect(prompt).toContain("knowledge vs news");
  });
});
