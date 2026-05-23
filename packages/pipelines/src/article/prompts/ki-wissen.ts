import type { KiWissenCategory } from "../frontmatter/ki-wissen.ts";

/**
 * Locale-specific labels for the ki-wissen body template. Output strings are
 * localised; instructions and rules stay in English (root CLAUDE.md:
 * "few-shot examples that demonstrate target-language output format may stay
 * in target language — they are output data, not instructions").
 */
type KiWissenLocaleLabels = {
  outputLanguage: string;
  tldrLeadIn: string;
  sections: {
    mythGrid: string;
    definition: string;
    taxonomy: string;
    examples: string;
    risks: string;
    nextSteps: string;
  };
  /** Table headers used inside the myth-vs-reality grid section. */
  mythTableHeaders: { myth: string; reality: string };
};

const LOCALE_LABELS: Record<"de" | "en", KiWissenLocaleLabels> = {
  de: {
    outputLanguage: "German, du-form, sachlich und konkret, kein Marketingsprech",
    tldrLeadIn: "**TL;DR:**",
    sections: {
      mythGrid: "Mythos vs. Realität",
      definition: "Definition",
      taxonomy: "Abgrenzung",
      examples: "Alltagsbeispiele",
      risks: "Grenzen und Risiken",
      nextSteps: "Nächste Schritte",
    },
    mythTableHeaders: { myth: "Mythos", reality: "Realität" },
  },
  en: {
    outputLanguage: "English, direct, factual, no marketing speak",
    tldrLeadIn: "**TL;DR:**",
    sections: {
      mythGrid: "Myth vs. Reality",
      definition: "Definition",
      taxonomy: "Related concepts",
      examples: "Real-world examples",
      risks: "Limitations and risks",
      nextSteps: "Next steps",
    },
    mythTableHeaders: { myth: "Myth", reality: "Reality" },
  },
};

/**
 * Lucide icon-name suggestions per category. Injected into the prompt as a
 * non-strict hint to prevent hallucination of non-existent icon names; the LLM
 * may pick a close variant. Pattern 115.
 */
const KI_WISSEN_ICON_SUGGESTIONS: Record<KiWissenCategory, string[]> = {
  Grundlagen: ["brain", "sparkles", "lightbulb", "cpu", "book-open"],
  Technik: ["cpu", "circuit-board", "code", "layers", "server"],
  "Ethik & Recht": ["scale", "shield", "eye", "lock", "users"],
  Praxis: ["rocket", "wrench", "zap", "play", "check-circle"],
  Zukunft: ["telescope", "trending-up", "globe", "star", "infinity"],
};

function flattenIconSuggestions(): string {
  return Object.entries(KI_WISSEN_ICON_SUGGESTIONS)
    .map(([cat, icons]) => `    - ${cat}: ${icons.join(", ")}`)
    .join("\n");
}

/**
 * ki-wissen draft prompt (Spec 61.3 §2.1 + §2.2).
 *
 * Single-shot DraftStep (Pattern 110): emits body + FRONTMATTER_EXTRAS in one
 * LLM call. Replaces the default blog draft instructions when
 * `collectionType === "ki-wissen"` (Pattern 109 — see `selectDraftPrompt`).
 *
 * Pattern 114: no extra brief fields are forwarded at enqueue time — the LLM
 * infers category/level/icon from the keyword and outline context.
 *
 * Pattern 116: monetization fields (adsenseSlots, hasAffiliateLinks) must NOT
 * be emitted — they are injected by the Astro schema as `false`.
 */
export function buildKiWissenDraftPrompt(opts: {
  authorInstruction: string;
  /** YYYY-MM-DD used by the model for `updatedAt`. */
  today: string;
  /** Article locale — drives section heading language. */
  locale: "de" | "en";
  /** Spec multi-domain-evolution S4.4 — tenant-resolved prompt variables. */
  tenantVars: import("../../_lib/tenant-prompt-vars.ts").TenantPromptVars;
}): string {
  const { authorInstruction, today, locale, tenantVars } = opts;
  const L = LOCALE_LABELS[locale];
  return `
You are writing the FULL DRAFT of a KNOWLEDGE PILLAR article for the
\`ki-wissen\` collection on ${tenantVars.domain} — the trust layer of the site.

Output locale: ${locale} (${L.outputLanguage}).

SCOPE CHECK: Every ki-wissen article must explain an AI/ML concept, technique,
ethical question, or future implication. If the topic has no meaningful AI
angle, stop immediately and output ONLY:
{"draftRefused": true, "reason": "topic is not AI-related"}

ki-wissen articles are NOT marketing copy. They are factual, honest, concrete.
Reader profile: curious non-experts → early practitioners. Explain complex
ideas simply, but do not oversimplify. Never use superlatives.

Monetization: NO ads, NO affiliate links. This collection is the trust layer.

Hard rules:
1. Write in the project's voice (loaded from marketing-context.md). NEVER drift.
2. Required body structure — follow this order exactly:
     a. <aside> Block — TL;DR definition in 60-80 words.
        Format: \`<aside>\\n\\n${L.tldrLeadIn} …\\n\\n</aside>\`
        NO heading before it. NO intro paragraph. The aside is the first thing.
     b. ## ${L.sections.mythGrid} — exactly 4 myth/reality pairs.
        Render as a Markdown table with columns "${L.mythTableHeaders.myth}" and
        "${L.mythTableHeaders.reality}".
     c. ## ${L.sections.definition} — main definition in 2-3 paragraphs plus
        analogies. Anchor the analogy in everyday experience.
     d. ## ${L.sections.taxonomy} — distinguish the concept from related
        concepts (e.g. AI vs. ML vs. Deep Learning). Use a Markdown table when
        clarifying multiple terms.
     e. ## ${L.sections.examples} — at least 6 concrete everyday examples.
        Each example: one short paragraph or a bullet with a specific scenario.
     f. ## ${L.sections.risks} — balanced view of limitations and risks.
        At least 3 distinct risks; avoid "AI is dangerous" generalities.
     g. ## ${L.sections.nextSteps} — "Next steps" how-to list.
        Each item in the \`next\` FRONTMATTER_EXTRAS array gets a matching
        bullet/section here with a short explanation.
     h. <FaqBlock /> — last line in the body. Nothing after it.
3. NO H1 (#) anywhere in the body. Title comes from frontmatter.
4. NO intro paragraph before the <aside>. The aside IS the entry point.
5. Minimum 2500 words. Do not pad — use concrete examples, real numbers,
   real product/research names where appropriate.
6. Weave satellite keywords naturally (1-3 mentions total). NO stuffing.
7. NO internal links — Spec 24 handles linkification post-draft.
8. NO custom JSX/MDX component tags except <FaqBlock /> and the auto-injected
   <HubCarousel>. Do NOT write import statements for custom components.
9. Do NOT write any "Stand: <date> · Tested by …" / "Stand: <Datum>" / author
   placeholder metadata in the body — attribution is system-rendered.
10. After ${L.sections.nextSteps} (and before <FaqBlock />), output the
    FRONTMATTER_EXTRAS block.${authorInstruction}

FRONTMATTER_EXTRAS — fields specific to ki-wissen articles:

  ALWAYS include (in addition to the standard fields):
  - "category": EXACTLY ONE of: "Grundlagen" | "Technik" | "Ethik & Recht" | "Praxis" | "Zukunft"
      Copy character-for-character. The ampersand and spacing in "Ethik & Recht" are part of the value.
  - "level": EXACTLY ONE of: "Einsteiger" | "Praktiker" | "Profi"
  - "icon": Lucide icon name (kebab-case). Pick one of the suggestions for the
      chosen category, OR a closely related valid Lucide name:
${flattenIconSuggestions()}
  - "facts": array of 3-5 short factual bullets (each ≤ 80 chars).
      Each fact opens with a concrete statement (e.g. "KI ist ...", "KI kann ...",
      "AI is ...", "AI can ..."). NO marketing claims. NO superlatives.
  - "next": array of 2-4 display labels (each ≤ 40 chars) for the
      ${L.sections.nextSteps} section. Each label is the heading the reader sees on
      the card; the body section explains what to do.

  REQUIRED MONETIZATION CONSTRAINT:
  - Do NOT emit "adsenseSlots" or "hasAffiliateLinks" — these are injected as
    \`false\` by the Astro schema. ki-wissen is the trust layer.

  ALSO include the standard fields used by all articles:
  - "author" (slug from the author list above, or omit if empty)
  - "intentType": always "general" for ki-wissen (knowledge pillar, not tool/comparison)
  - "tags": 3-6 specific tags (strings array, written in the article's locale, kebab-case preferred)
  - "excerpt": 1-2 sentences (≤ 200 chars, in the article's locale) summarising the concept
  - "bottomLinksVariant": "default" (ki-wissen is non-commercial)
  - "seoTitle": (≤ 70 chars) — punchier than the H-tag title if useful, otherwise omit
  - "seoDescription": (≤ 180 chars) — concrete promise, no clickbait, includes the primary keyword
  - "translationKey": stable, locale-neutral, kebab-case (e.g. "what-is-machine-learning")
  - "faq": 7-15 Q&A pairs in the article's locale. Each question ≤ 100 chars, answer ≤ 300 chars.
      Note: ki-wissen requires MORE FAQs than blog/comparison (minimum 7) because pillar pages
      are entry points for many related queries.

Output format:
<aside>

${L.tldrLeadIn} [60-80 word definition]

</aside>

## ${L.sections.mythGrid}

| ${L.mythTableHeaders.myth} | ${L.mythTableHeaders.reality} |
| --- | --- |
| [myth 1] | [reality 1] |
| [myth 2] | [reality 2] |
| [myth 3] | [reality 3] |
| [myth 4] | [reality 4] |

## ${L.sections.definition}

[2-3 paragraphs + analogy]

## ${L.sections.taxonomy}

[distinguish from related concepts; table recommended]

## ${L.sections.examples}

[at least 6 concrete examples]

## ${L.sections.risks}

[balanced limitations + risks]

## ${L.sections.nextSteps}

[one entry per item in the \`next\` array]

<!-- FRONTMATTER_EXTRAS: {"author":"<slug>","category":"...","level":"...","icon":"...","facts":[...],"next":[...],"intentType":"general","excerpt":"...","bottomLinksVariant":"default","tags":[...],"seoTitle":"...","seoDescription":"...","translationKey":"...","updatedAt":"${today}","faq":[{"question":"...","answer":"..."}]} -->

<FaqBlock />
  `.trim();
}
