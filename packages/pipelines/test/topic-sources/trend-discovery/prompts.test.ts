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
// Spec multi-domain-evolution S4.5: tests now exercise per-project fixtures.
// The Toolwiki regression guards above are joined by a synthetic BK fixture
// (solar-energy niche) that asserts the prompt picks up per-tenant examples
// without touching code — multi-domain proof.
//
// Live classifier accuracy tests (5 LLM cases against gold-standard fixtures)
// are deferred per spec §11 Phase B-optional — they require a separate
// RUN_LIVE_TREND_SYNTHESIZER=1 flag and ~€0.025/run cost. The prompt-text
// regression here catches the cheap failure mode (someone deletes the block).

import { describe, expect, it } from "bun:test";
import type { ClassifierExamples, TopicScope } from "@marketing-auto/db";
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

// Spec multi-domain-evolution S4.5: synthetic BK (solar-energy) fixture.
// Mock-only — not persisted to DB. Used to verify the prompt picks up
// per-project classifier examples without code changes.
const BK_SOLAR_CLASSIFIER_EXAMPLES: ClassifierExamples = {
  knowledge: {
    counterExamples: [
      { title: "EcoFlow PowerStream review", reasonExcluded: "tool-specific review", correctIntent: "review" },
      { title: "Solar prices crashed in 2026", reasonExcluded: "news event", correctIntent: "news" },
      { title: "How to install Anker SOLIX in 30 minutes", reasonExcluded: "tutorial format", correctIntent: "tutorial" },
    ],
    positiveExamples: [
      { title: "Wie funktioniert ein MPPT-Tracker?", reasonIncluded: "mechanism explainer" },
      { title: "Was ist ein Hybrid-Wechselrichter?", reasonIncluded: "concept question" },
      { title: "Einspeisevergütung 2026 Grundlagen", reasonIncluded: "evergreen practitioner primer" },
    ],
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

describe("trend-synthesis prompt SEO-focus (Spec 64.16)", () => {
  const prompt = buildTrendSynthesisDefaultPrompt(emptyScope);

  it("instructs SEO-optimized headlines instead of compelling/journalistic", () => {
    expect(prompt).toContain("SEO-optimized");
    expect(prompt).toContain("not like a journalist");
    // Anti-pattern: old "compelling" knob should be gone
    expect(prompt).not.toMatch(/compelling article headline/i);
  });

  it("includes English-term preserve-list for AI/tech concepts", () => {
    expect(prompt).toContain("Guardrails");
    expect(prompt).toContain("Prompts");
    expect(prompt).toContain("Embeddings");
    expect(prompt).toContain("RAG");
    expect(prompt).toContain("DO NOT translate these to German");
  });

  it("includes drama-blocklist with concrete examples", () => {
    expect(prompt).toContain("Kampf um");
    expect(prompt).toContain("Schlacht");
    expect(prompt).toContain("Krieg gegen");
    expect(prompt).toContain("DO NOT add dramatic framing");
  });

  it("includes year-tag policy with source-evidence gate", () => {
    expect(prompt).toMatch(/DO NOT add year tags/i);
    expect(prompt).toMatch(/unless the source signals explicitly contain a year/i);
  });

  it("includes topic_title anchor-preserve instruction", () => {
    expect(prompt).toMatch(/Stay close to topic_title/i);
    expect(prompt).toMatch(/preserve its key anchors/i);
    expect(prompt).toMatch(/NOT a creative rewrite/i);
  });
});

describe("buildTrendSynthesisDefaultPrompt — per-tenant classifier examples (Spec multi-domain-evolution S4.5)", () => {
  it("Toolwiki default (null) renders the 12 Spec-64.14 examples byte-identical", () => {
    const prompt = buildTrendSynthesisDefaultPrompt(emptyScope, null);
    // All 6 Toolwiki counter examples
    expect(prompt).toContain(`"I've joined Anthropic" → news (personal/career event; no concept explained).`);
    expect(prompt).toContain(`"OpenAI releases GPT-5" → news (event-driven product launch).`);
    expect(prompt).toContain(`"Claude vs ChatGPT: which is better?" → comparison (tool pair, not a theme).`);
    expect(prompt).toContain(`"How to use Cursor with Python" → tutorial (tool-centric step-by-step).`);
    expect(prompt).toContain(`"5 ways AI changes marketing" → use_case (industry-application enumeration).`);
    expect(prompt).toContain(`"Anthropic raises $500M Series E" → news (corporate event).`);
    // All 6 Toolwiki positive examples
    expect(prompt).toContain(`"Was ist Retrieval-Augmented Generation?" → knowledge (concept question, no tool focus).`);
    expect(prompt).toContain(`"Wie funktionieren Transformer-Modelle?" → knowledge (mechanism explainer).`);
    expect(prompt).toContain(`"Prompt Engineering Grundlagen" → knowledge (evergreen practitioner primer).`);
    expect(prompt).toContain(`"Embeddings einfach erklärt" → knowledge (concept primer).`);
  });

  it("BK fixture (synthetic solar-energy niche) renders BK-specific examples", () => {
    const prompt = buildTrendSynthesisDefaultPrompt(emptyScope, BK_SOLAR_CLASSIFIER_EXAMPLES);
    // BK counter examples appear
    expect(prompt).toContain(`"EcoFlow PowerStream review" → review (tool-specific review).`);
    expect(prompt).toContain(`"Solar prices crashed in 2026" → news (news event).`);
    expect(prompt).toContain(`"How to install Anker SOLIX in 30 minutes" → tutorial (tutorial format).`);
    // BK positive examples appear
    expect(prompt).toContain(`"Wie funktioniert ein MPPT-Tracker?" → knowledge (mechanism explainer).`);
    expect(prompt).toContain(`"Was ist ein Hybrid-Wechselrichter?" → knowledge (concept question).`);
    expect(prompt).toContain(`"Einspeisevergütung 2026 Grundlagen" → knowledge (evergreen practitioner primer).`);
  });

  it("BK fixture does NOT leak any Toolwiki-specific example strings", () => {
    // Multi-domain proof: with BK examples threaded in, none of the Toolwiki-
    // specific phrases survive into the prompt. Catches a future regression
    // where the fallback path silently re-injects Toolwiki defaults.
    const prompt = buildTrendSynthesisDefaultPrompt(emptyScope, BK_SOLAR_CLASSIFIER_EXAMPLES);
    expect(prompt).not.toContain("I've joined Anthropic");
    expect(prompt).not.toContain("Retrieval-Augmented Generation");
    expect(prompt).not.toContain("Vector Databases");
  });

  it("classifier_examples with empty knowledge.counterExamples renders an empty block (no crash)", () => {
    // Defensive: a tenant could in principle ship classifier_examples with
    // only positive examples (no counters). The prompt builder must not crash.
    const minimal: ClassifierExamples = {
      knowledge: {
        counterExamples: [],
        positiveExamples: [{ title: "Foo", reasonIncluded: "bar" }],
      },
    };
    const prompt = buildTrendSynthesisDefaultPrompt(emptyScope, minimal);
    expect(prompt).toContain(`"Foo" → knowledge (bar).`);
    // Counter block still has its header line
    expect(prompt).toContain("Counter-examples (Spec 64.14");
  });

  it("classifier_examples with no `knowledge` key falls back to Toolwiki defaults", () => {
    // Edge case: tenant sets classifier_examples = {} (empty object, no
    // intent buckets). Fallback to Toolwiki defaults is the safe behavior.
    const prompt = buildTrendSynthesisDefaultPrompt(emptyScope, {} as ClassifierExamples);
    expect(prompt).toContain("I've joined Anthropic");
    expect(prompt).toContain("Was ist Retrieval-Augmented Generation");
  });
});
