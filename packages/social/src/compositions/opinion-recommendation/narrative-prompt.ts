/**
 * Spec 65.8 — opinion-recommendation narrative LLM-prompt + validator.
 *
 * Single Sonnet call produces all 4 beats. Validator gates: Hot-Take must
 * be a declarative opinion (heuristic: no question mark, no "vielleicht" /
 * "maybe" / "I think"); Top-Pick must name the recommended tool verbatim.
 * Reasoning beats are free-form — they just need to satisfy schema bounds.
 */
import type { FamilyBHook } from "../_shared/family-b/types.ts";
import type {
  OpinionRecommendationBeat,
  OpinionRecommendationNarrative,
} from "./types.ts";

// ─── Per-beat tone guide ──────────────────────────────────────────────────────

interface BeatGuide {
  name: OpinionRecommendationBeat;
  toneDE: string;
  toneEN: string;
}

export const OPINION_RECOMMENDATION_BEAT_GUIDES: readonly BeatGuide[] = [
  {
    name: "hotTake",
    toneDE: "Hot-Take — die provokante Meinung in einem Satz, ohne Hedging",
    toneEN: "Hot-Take — the provocative opinion in one sentence, no hedging",
  },
  {
    name: "reasoning1",
    toneDE: "Begründung #1 — der erste konkrete Beleg / Argument für die These",
    toneEN: "Reasoning #1 — the first concrete piece of evidence supporting the take",
  },
  {
    name: "reasoning2",
    toneDE: "Begründung #2 — der zweite Beleg (anderer Aspekt, baut auf #1 auf)",
    toneEN: "Reasoning #2 — the second piece of evidence (different angle, builds on #1)",
  },
  {
    name: "topPick",
    toneDE: "Top-Pick — die konkrete Tool-Empfehlung mit Begründung",
    toneEN: "Top-Pick — the concrete tool recommendation with rationale",
  },
] as const;

// ─── Hedging-phrase detector (German + English) ───────────────────────────────

/**
 * Phrases that water down a Hot-Take into a soft statement. The validator
 * rejects Hot-Take text containing any of these so the slide reads with
 * the bold-declarative confidence the variant requires.
 */
const HEDGING_PHRASES_DE = [
  "vielleicht",
  "möglicherweise",
  "ich denke",
  "ich glaube",
  "vermutlich",
  "eventuell",
  "irgendwie",
];

const HEDGING_PHRASES_EN = [
  "maybe",
  "perhaps",
  "i think",
  "i believe",
  "kind of",
  "sort of",
  "possibly",
  "arguably",
];

const HEDGING_PHRASES = [...HEDGING_PHRASES_DE, ...HEDGING_PHRASES_EN];

// ─── Prompt builder ───────────────────────────────────────────────────────────

export interface BuildOpinionRecommendationPromptInput {
  hook: FamilyBHook;
  recommendedToolName: string;
  locale: "de" | "en";
}

export const OPINION_RECOMMENDATION_SYSTEM_PROMPT =
  "You are an opinion columnist for Instagram carousels. You produce short, declarative, first-person opinion pieces: bold hot-take + 2 reasoning beats + concrete recommendation. You receive a hook (resolved variables) and a tool to recommend. The hot-take MUST be a declarative statement, never a question, never hedged with 'maybe' / 'I think' / 'perhaps'. You never break the 4th wall, never address the camera, never use AI-generic phrasing.";

export function buildOpinionRecommendationNarrativePrompt(
  input: BuildOpinionRecommendationPromptInput,
): string {
  const isDE = input.locale === "de";
  const variablesLines = Object.entries(input.hook.variables)
    .map(([k, v]) => `  - ${k}: "${v}"`)
    .join("\n");
  const toneLines = OPINION_RECOMMENDATION_BEAT_GUIDES.map(
    (g) => `  - ${g.name}: ${isDE ? g.toneDE : g.toneEN}`,
  ).join("\n");

  return [
    "Write a 4-beat opinion-recommendation post for an Instagram carousel.",
    "",
    "## Hook context",
    `Rendered hook: "${input.hook.rendered}"`,
    "Variables:",
    variablesLines || "  (none)",
    "",
    "## Recommended tool",
    `Tool name: "${input.recommendedToolName}"`,
    "The `topPick` beat MUST name this tool verbatim. Use the exact tool name (no German translation of brand names).",
    "",
    "## Beat structure",
    toneLines,
    "",
    "## Output format",
    "Emit EXACTLY this structure — four `## <beatName>` headers, each followed by 2-4 sentences (40-200 chars per beat). No extra prose before/after:",
    "",
    "## hotTake",
    isDE
      ? "Die meisten Texter benutzen ChatGPT falsch. Punkt."
      : "Most writers use ChatGPT wrong. Period.",
    "",
    "## reasoning1",
    isDE
      ? "Erster Beleg — was die meisten übersehen …"
      : "First reason — what most people miss …",
    "",
    "## reasoning2",
    isDE
      ? "Zweiter Beleg — und das macht den Unterschied …"
      : "Second reason — and that's what makes the difference …",
    "",
    "## topPick",
    isDE
      ? `Meine Empfehlung: ${input.recommendedToolName}, weil …`
      : `My pick: ${input.recommendedToolName}, because …`,
    "",
    "## Rules",
    `1. Output language: ${isDE ? "German (du-form, conversational, no business-speak)" : "English (concise, first-person, no business-speak)"}.`,
    `2. Hot-Take MUST be declarative (no question mark, no hedging). FORBIDDEN: ${HEDGING_PHRASES.join(", ")}.`,
    `3. Top-Pick MUST name "${input.recommendedToolName}" verbatim.`,
    "4. First-person ('ich' / 'I') throughout.",
    "5. Avoid AI-generic phrasing: 'in der heutigen Zeit' / 'in today's world' / 'as an AI'.",
    "6. Each beat 40–400 chars.",
  ].join("\n");
}

// ─── Validator ────────────────────────────────────────────────────────────────

export interface OpinionRecommendationNarrativeValidation {
  valid: boolean;
  hotTakeIsDeclarative: boolean;
  hotTakeHedgingHits: string[];
  topPickMentionsRecommendation: boolean;
  reasons: string[];
}

export function validateOpinionRecommendationNarrative(
  narrative: OpinionRecommendationNarrative,
  recommendedToolName: string,
): OpinionRecommendationNarrativeValidation {
  const reasons: string[] = [];

  // Hot-Take: no question mark, no hedging phrase
  const hotTakeLower = narrative.hotTake.text.toLowerCase();
  const hotTakeHedgingHits: string[] = [];
  for (const phrase of HEDGING_PHRASES) {
    // Word-boundary check so "irgendwie" matches but "sportlich" doesn't (no
    // false-positive on substrings).
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\b${escaped}\\b`, "i");
    if (pattern.test(hotTakeLower)) {
      hotTakeHedgingHits.push(phrase);
    }
  }
  const hasQuestion = narrative.hotTake.text.includes("?");
  const hotTakeIsDeclarative = hotTakeHedgingHits.length === 0 && !hasQuestion;
  if (!hotTakeIsDeclarative) {
    if (hasQuestion) {
      reasons.push("Hot-Take contains a question mark — must be a declarative statement");
    }
    if (hotTakeHedgingHits.length > 0) {
      reasons.push(
        `Hot-Take uses hedging phrases: ${hotTakeHedgingHits.join(", ")} — rewrite without hedging`,
      );
    }
  }

  // Top-Pick: must name the recommended tool verbatim
  const escapedTool = recommendedToolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const toolPattern = new RegExp(`\\b${escapedTool}\\b`, "i");
  const topPickMentionsRecommendation = toolPattern.test(narrative.topPick.text);
  if (!topPickMentionsRecommendation) {
    reasons.push(
      `Top-Pick does not name "${recommendedToolName}" verbatim — the tool must appear in the recommendation beat`,
    );
  }

  return {
    valid: reasons.length === 0,
    hotTakeIsDeclarative,
    hotTakeHedgingHits,
    topPickMentionsRecommendation,
    reasons,
  };
}

export function buildOpinionRecommendationRetrySuffix(
  validation: OpinionRecommendationNarrativeValidation,
): string {
  if (validation.valid) return "";
  return [
    "",
    "## Retry — please fix:",
    ...validation.reasons.map((r) => `- ${r}`),
    "Keep the other beats intact; rewrite the failing beats to meet the constraints.",
  ].join("\n");
}
