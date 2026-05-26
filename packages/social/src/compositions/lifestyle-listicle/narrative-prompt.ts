/**
 * Spec 65.8 — lifestyle-listicle narrative LLM-prompt + validator.
 *
 * Single Sonnet call produces all 4 beats (intro + 3 items) with the
 * `## <beatName>` header convention parsed by `splitNarrativeByBeats`.
 *
 * Validator (Pattern §3.3 looser variant): the INTRO must mention at least
 * one hook variable verbatim — item beats can omit them because each item
 * carries the featured tool name as the protagonist. This is a softer
 * variant of story-arc's all-beats refinement; lifestyle-listicle's value
 * comes from item-specific use-cases, not from hook anchoring per beat.
 */
import type { FamilyBHook } from "../_shared/family-b/types.ts";
import type {
  LifestyleListicleBeat,
  LifestyleListicleNarrative,
} from "./types.ts";

// ─── Per-beat tone guide ──────────────────────────────────────────────────────

interface BeatGuide {
  name: LifestyleListicleBeat;
  toneDE: string;
  toneEN: string;
}

export const LIFESTYLE_LISTICLE_BEAT_GUIDES: readonly BeatGuide[] = [
  {
    name: "intro",
    toneDE: "Intro — etabliere die Lifestyle-Frage (warum verändert dieses Tool den Alltag?)",
    toneEN: "Intro — establish the lifestyle question (why does this tool change everyday life?)",
  },
  {
    name: "item1",
    toneDE: "Item #1 — ein konkreter Alltagsmoment (z.B. Morgens, Pendeln, Mittagspause)",
    toneEN: "Item #1 — a concrete everyday moment (e.g. morning routine, commute, lunch break)",
  },
  {
    name: "item2",
    toneDE: "Item #2 — ein zweiter Moment in einem anderen Lebensbereich (Arbeit, Hobby, Familie)",
    toneEN: "Item #2 — a second moment in a different life-area (work, hobby, family)",
  },
  {
    name: "item3",
    toneDE: "Item #3 — die unerwartete Anwendung (überraschender Kontext, nicht offensichtlich)",
    toneEN: "Item #3 — the unexpected application (surprising context, not obvious)",
  },
] as const;

// ─── Prompt builder ───────────────────────────────────────────────────────────

export interface BuildLifestyleListiclePromptInput {
  hook: FamilyBHook;
  featuredToolName: string;
  locale: "de" | "en";
}

export const LIFESTYLE_LISTICLE_SYSTEM_PROMPT =
  "You are a lifestyle-content writer for Instagram carousels. You produce short, concrete, first-person narratives that show a single tool from THREE different everyday angles. You receive a hook (with variable placeholders that have been resolved to concrete words) and a tool name; the intro grounds the hook context, then each item highlights a different real-world moment where the tool fits naturally. You never break the 4th wall, never address the camera, never use AI-generic phrasing.";

export function buildLifestyleListicleNarrativePrompt(
  input: BuildLifestyleListiclePromptInput,
): string {
  const isDE = input.locale === "de";
  const variablesLines = Object.entries(input.hook.variables)
    .map(([k, v]) => `  - ${k}: "${v}"`)
    .join("\n");
  const variableNames = Object.keys(input.hook.variables);
  const toneLines = LIFESTYLE_LISTICLE_BEAT_GUIDES.map(
    (g) => `  - ${g.name}: ${isDE ? g.toneDE : g.toneEN}`,
  ).join("\n");

  return [
    "Write a 4-beat lifestyle-listicle for an Instagram-carousel post.",
    "",
    "## Hook context",
    `Rendered hook: "${input.hook.rendered}"`,
    "Variables (must appear verbatim in the intro at minimum):",
    variablesLines || "  (none)",
    "",
    "## Featured tool",
    `Tool name: "${input.featuredToolName}"`,
    "Every item beat MUST name the tool. Use the exact tool name (no German translation of brand names).",
    "",
    "## Beat structure",
    toneLines,
    "",
    "## Output format",
    "Emit EXACTLY this structure — four `## <beatName>` headers, each followed by 2-4 sentences (40-200 chars per beat). No extra prose before/after:",
    "",
    "## intro",
    isDE
      ? `Warum ${input.featuredToolName} meinen Alltag verändert hat …`
      : `Why ${input.featuredToolName} changed my everyday life …`,
    "",
    "## item1",
    isDE
      ? `Morgens, beim Kaffee: ${input.featuredToolName} …`
      : `Morning, over coffee: ${input.featuredToolName} …`,
    "",
    "## item2",
    isDE
      ? `Im Job: ${input.featuredToolName} hilft mir bei …`
      : `At work: ${input.featuredToolName} helps me with …`,
    "",
    "## item3",
    isDE
      ? `Was ich am wenigsten erwartet hätte: ${input.featuredToolName} …`
      : `The unexpected one: ${input.featuredToolName} …`,
    "",
    "## Rules",
    `1. Output language: ${isDE ? "German (du-form, conversational, no business-speak)" : "English (concise, first-person, no business-speak)"}.`,
    `2. The INTRO MUST mention at least one of the hook variables verbatim: ${variableNames.map((v) => `\`${v}\``).join(", ") || "(none)"}.`,
    `3. Each ITEM MUST name "${input.featuredToolName}" verbatim — it's the protagonist of every item.`,
    "4. First-person ('ich' / 'I') throughout.",
    "5. Avoid AI-generic phrasing: 'in der heutigen Zeit' / 'in today's world' / 'as an AI'.",
    "6. Each beat 40–400 chars (Instagram carousel text reads fast).",
  ].join("\n");
}

// ─── Validator (softer variant: intro requires variable, items require tool) ──

export interface LifestyleListicleNarrativeValidation {
  valid: boolean;
  /** True when intro mentions at least one hook variable verbatim. */
  introMentionsVariable: boolean;
  /** Per-item: true when item mentions the featured tool name verbatim. */
  itemsMentionTool: Record<"item1" | "item2" | "item3", boolean>;
  reasons: string[];
}

export function validateLifestyleListicleNarrative(
  narrative: LifestyleListicleNarrative,
  variables: Record<string, string>,
  featuredToolName: string,
): LifestyleListicleNarrativeValidation {
  const reasons: string[] = [];
  const variableValues = Object.values(variables).filter((v) => v.length > 0);

  // Intro check: at least one variable verbatim (skipped if no variables).
  let introMentionsVariable = variableValues.length === 0;
  if (variableValues.length > 0) {
    for (const value of variableValues) {
      const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`\\b${escaped}\\b`, "i");
      if (pattern.test(narrative.intro.text)) {
        introMentionsVariable = true;
        break;
      }
    }
    if (!introMentionsVariable) {
      reasons.push(
        `Intro does not mention any hook variable verbatim (looked for: ${variableValues.join(", ")})`,
      );
    }
  }

  // Item check: each must name the tool verbatim.
  const escapedTool = featuredToolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const toolPattern = new RegExp(`\\b${escapedTool}\\b`, "i");
  const itemKeys = ["item1", "item2", "item3"] as const;
  const itemsMentionTool: Record<"item1" | "item2" | "item3", boolean> = {
    item1: false,
    item2: false,
    item3: false,
  };
  for (const key of itemKeys) {
    const hit = toolPattern.test(narrative[key].text);
    itemsMentionTool[key] = hit;
    if (!hit) {
      reasons.push(`${key} does not mention featured tool "${featuredToolName}" verbatim`);
    }
  }

  return {
    valid: reasons.length === 0,
    introMentionsVariable,
    itemsMentionTool,
    reasons,
  };
}

export function buildLifestyleListicleRetrySuffix(
  validation: LifestyleListicleNarrativeValidation,
): string {
  if (validation.valid) return "";
  return [
    "",
    "## Retry — please fix:",
    ...validation.reasons.map((r) => `- ${r}`),
    "Keep the rest of the narrative intact; just rewrite the failing beats so the constraints are met.",
  ].join("\n");
}
