/**
 * Locale-specific labels used by the comparison body template. Output strings
 * are localised; instructions and rules stay in English (per root CLAUDE.md:
 * "few-shot examples that demonstrate target-language output format may stay
 * in target language — they are output data, not instructions").
 */
type ComparisonLocaleLabels = {
  outputLanguage: string;
  sections: {
    glance: string;
    useCaseMatrix: string;
    priceComparison: string;
    methodology: string;
    conclusion: string;
  };
  toolPortraitColumns: string;
  pricingTimestampLabel: string;
};

const LOCALE_LABELS: Record<"de" | "en", ComparisonLocaleLabels> = {
  de: {
    outputLanguage: "German, du-form, no marketing speak",
    sections: {
      glance: "Auf einen Blick",
      useCaseMatrix: "Für welchen Use Case",
      priceComparison: "Preisvergleich",
      methodology: "Methodik",
      conclusion: "Fazit",
    },
    toolPortraitColumns: "Stärken, Schwächen, Pricing",
    pricingTimestampLabel: "Pricing-Stand",
  },
  en: {
    outputLanguage: "English, direct tone, no marketing speak",
    sections: {
      glance: "At a glance",
      useCaseMatrix: "Best tool per use case",
      priceComparison: "Pricing comparison",
      methodology: "Methodology",
      conclusion: "Verdict",
    },
    toolPortraitColumns: "Strengths, Weaknesses, Pricing",
    pricingTimestampLabel: "Pricing as of",
  },
};

/**
 * Comparison-article draft prompt (Spec 61.2 §3.2 + §3.1).
 *
 * The blog pipeline uses a single LLM call (DraftStep) that emits body + a
 * FRONTMATTER_EXTRAS HTML comment. For comparisons we extend that pattern:
 * the same call also emits the comparison-specific fields (toolSlugs, winner,
 * verdict, testMethodology, useCaseVerdicts, comparedAt) inside the extras.
 *
 * Step instructions returned here REPLACE the default blog draft instructions
 * when collectionType === "comparison" (see `selectDraftPrompt`).
 */
export function buildComparisonDraftPrompt(opts: {
  authorInstruction: string;
  /** YYYY-MM-DD used by the model for `comparedAt`. */
  today: string;
  /** Article locale — drives section heading language. */
  locale: "de" | "en";
  /** Spec multi-domain-evolution S4.4 — tenant-resolved prompt variables. */
  tenantVars: import("../../_lib/tenant-prompt-vars.ts").TenantPromptVars;
}): string {
  const { authorInstruction, today, locale, tenantVars } = opts;
  const L = LOCALE_LABELS[locale];
  return `
You are writing the FULL DRAFT of a COMPARISON article for ${tenantVars.domain}.
Output locale: ${locale} (${L.outputLanguage}).

SCOPE CHECK: Every article must be primarily about ${tenantVars.nicheContentScope}.
If the topic has no meaningful AI angle, stop immediately and output
ONLY: {"draftRefused": true, "reason": "topic is not AI-related"}

A comparison article evaluates ${tenantVars.comparisonEntityLabel} head-to-head. It must give
the reader a decision: pick winner, recommend per-scenario, or call a tie.

Hard rules:
1. Write in the project's voice (loaded from marketing-context.md). NEVER drift.
2. Match the outline's H2s, BUT the comparison body must follow this exact
   structure (in this order):
     a. Intro paragraphs (2-4) — what you compared and why it matters. NO H1.
     b. ## TL;DR — 60-80 words. Direct winner-per-scenario summary.
     c. ## ${L.sections.glance} — Markdown table comparing the key features.
        Header row: | Feature | Tool A | Tool B | (extend for more tools).
     d. ## ${L.sections.useCaseMatrix} — derived from useCaseVerdicts;
        each row spells out winner + reason.
     e. ## [Tool A name] — portrait: ${L.toolPortraitColumns}. Use H3s.
     f. ## [Tool B name] — same structure. Repeat for each tool in toolSlugs.
     g. ## ${L.sections.priceComparison} — Markdown table with current pricing.
        Include the line "${L.pricingTimestampLabel}: ${today}" directly under the table.
     h. ## ${L.sections.methodology} — transparency section; mirrors testMethodology field.
     i. ## ${L.sections.conclusion} — recommendation. When winner="depends"
        provide a short decision-tree (one bullet per scenario).
3. Minimum 2000 words. Do not pad — use concrete examples, real pricing,
   specific feature names.
4. Weave satellite keywords naturally (1-3 mentions, total). NO stuffing.
5. No internal links — Spec 24 handles linkification post-draft.
6. NO custom JSX/MDX component tags. The ONLY allowed component is
   <HubCarousel> — auto-injected after generation.
7. Do NOT write any "Stand: <date> · Tested by …" / "Stand: <Datum> · Getestet von …"
   metadata header or placeholder text.
8. After the conclusion, output a FRONTMATTER_EXTRAS block (see below).${authorInstruction}

FRONTMATTER_EXTRAS — fields specific to comparison articles:

  ALWAYS include (in addition to the standard fields):
  - "toolSlugs": 2-4 kebab-case tool slugs in comparison order
      (e.g. ["chatgpt", "claude", "gemini"]). Use the exact slugs from the
      tool list in the user message.
  - "winner": EXACTLY ONE of these literal values — copy character-for-character:
      "tool-a" | "tool-b" | "tool-c" | "tool-d" | "depends" | "tie"
      Positional: "tool-a" = toolSlugs[0], "tool-b" = toolSlugs[1], etc.
      Use "depends" only when no single tool wins overall and useCaseVerdicts
      meaningfully differ. Use "tie" sparingly — only for genuinely equivalent
      tools.
  - "verdict": 20-400 chars, multi-sentence summary of the comparison outcome.
  - "comparedAt": "${today}" (today's date in YYYY-MM-DD).

  STRONGLY RECOMMENDED:
  - "testMethodology": 1-3 sentences (max 200 chars) describing how you tested.
      Required for E-E-A-T. Example: "Tested all three tools on 12 real coding
      tasks across TypeScript, Python and SQL during May 2026."

  REQUIRED WHEN winner == "depends":
  - "useCaseVerdicts": 3-9 entries of shape
      {"useCase": "...", "winner": "<tool-slug>", "reason": "..."}
      Each useCase ≤ 40 chars, reason ≤ 120 chars. Winner is the literal tool
      slug (e.g. "chatgpt"), NOT the positional label.

  ALSO include the standard fields used by all articles:
  - "author" (slug from the author list above, or omit if empty)
  - "category" (from "# Frontmatter Requirements" enum — exact value)
  - "intentType": always "comparison" for this collection
  - "tags": 5-8 specific tags (strings array, written in the article's locale)
  - "excerpt": 1-2 sentences (max 160 chars, in the article's locale) summarising the verdict
  - "bottomLinksVariant": pick "comparison" or "tool" per the enum guidance
  - "faq": 5-15 Q&A pairs in the article's locale (each question ≤ 100 chars, answer ≤ 300 chars)

Output format:
[intro paragraphs — no # H1]

## TL;DR
[60-80 words]

## ${L.sections.glance}
| Feature | Tool A | Tool B |
| --- | --- | --- |
| ... | ... | ... |

## ${L.sections.useCaseMatrix}
[use-case verdict prose; can mirror useCaseVerdicts]

## [Tool A name]
[portrait with H3s]

## [Tool B name]
[portrait with H3s]

## ${L.sections.priceComparison}
[pricing table + "${L.pricingTimestampLabel}: ${today}"]

## ${L.sections.methodology}
[1-3 paragraphs — mirrors testMethodology]

## ${L.sections.conclusion}
[recommendation; decision-tree if winner=="depends"]

<!-- FRONTMATTER_EXTRAS: {"author":"<slug>","category":"...","intentType":"comparison","toolSlugs":[...],"winner":"...","verdict":"...","testMethodology":"...","comparedAt":"${today}","useCaseVerdicts":[{"useCase":"...","winner":"...","reason":"..."}],"excerpt":"...","bottomLinksVariant":"comparison","tags":[...],"faq":[{"question":"...","answer":"..."}]} -->
  `.trim();
}

/** Build a short paragraph for the user message that lists the compared tools. */
export function buildComparisonContextFragment(opts: {
  toolSlugs: string[];
  toolNames?: string[];
}): string {
  const { toolSlugs, toolNames } = opts;
  const lines = ["# Tools to compare"];
  toolSlugs.forEach((slug, i) => {
    // 0→a, 1→b, 2→c, 3→d (matches the "tool-a"..."tool-d" positional winner enum)
    const positional = String.fromCharCode("a".charCodeAt(0) + i);
    const name = toolNames?.[i] ?? slug;
    lines.push(`- tool-${positional}: ${name} (slug: ${slug})`);
  });
  lines.push("");
  lines.push("In FRONTMATTER_EXTRAS.winner, use the positional label (tool-a/b/c/d) — NOT the slug.");
  lines.push(`In useCaseVerdicts[].winner, use the actual slug (e.g. ${toolSlugs[0] ?? "chatgpt"}).`);
  return lines.join("\n");
}

// Selector (Pattern 109) lives in ./index.ts so all collection-specific draft
// prompts have a single entry point. This file is pure builders.
