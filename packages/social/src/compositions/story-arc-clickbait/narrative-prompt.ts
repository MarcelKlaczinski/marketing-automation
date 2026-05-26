/**
 * Spec 65.8 — story_arc_clickbait narrative LLM-prompt + validator.
 *
 * Single Sonnet call produces all 5 beats in one structured response, per
 * spec §1 mental-model "1 LLM-call full narrative, split by slide". The
 * output uses `## <beatName>` headers + body so `splitNarrativeByBeats`
 * (family-b/helpers.ts) can parse it back into a `StoryArcNarrative` shape
 * for Zod validation.
 *
 * Variable-verbatim refinement (Pattern §3.3 Option γ): every beat must
 * mention at least one of the hook's variables (`profession`, `lifeArea`,
 * etc.) verbatim to keep the narrative tied to the hook context. The
 * validator runs AFTER Zod parse and returns a structured `valid + reasons`
 * shape so the caller can retry with a stronger prompt or fall back.
 *
 * Output language: matches `locale` ("de" / "en"). Instruction text stays
 * in English per the project's English-prompts rule; output examples are
 * shown in the target language so the model anchors on the correct register.
 */
import type { FamilyBHook } from "../_shared/family-b/types.ts";
import type { StoryArcBeat, StoryArcNarrative } from "./types.ts";

// ─── Per-beat tone guide ──────────────────────────────────────────────────────

interface BeatGuide {
  name: StoryArcBeat;
  tone: string;
  toneDE: string;
  toneEN: string;
}

export const STORY_ARC_BEAT_GUIDES: readonly BeatGuide[] = [
  {
    name: "setup",
    tone: "ordinary-day scene-setting",
    toneDE: "Alltagsszene — etabliere die Ausgangslage",
    toneEN: "Ordinary-day scene-setting — establish the baseline",
  },
  {
    name: "conflict",
    tone: "tension, problem state",
    toneDE: "Konflikt — der Bruch im Alltag",
    toneEN: "Conflict — the break in routine",
  },
  {
    name: "resolution",
    tone: "discovery, breakthrough",
    toneDE: "Auflösung — die Entdeckung / der Wendepunkt",
    toneEN: "Resolution — the discovery / turning point",
  },
  {
    name: "payoff",
    tone: "transformation, outcome",
    toneDE: "Auswirkung — wie sich der Alltag verändert hat",
    toneEN: "Payoff — how the everyday has changed",
  },
  {
    name: "lesson",
    tone: "reflection, takeaway",
    toneDE: "Lehre — das Mitnehmen für die Leser:innen",
    toneEN: "Lesson — the takeaway for readers",
  },
] as const;

// ─── Prompt builder ───────────────────────────────────────────────────────────

export interface BuildStoryArcPromptInput {
  hook: FamilyBHook;
  /**
   * Optional tool mention for Resolution + Payoff beats. When present the
   * prompt encourages the LLM to weave the tool name into those two beats.
   */
  primaryToolName?: string;
  locale: "de" | "en";
}

export const STORY_ARC_SYSTEM_PROMPT =
  "You are a narrative writer for Instagram carousel posts. You produce short, emotion-driven, first-person narratives in 5 distinct beats. You receive a hook (with variable placeholders that have been resolved to concrete words) and must thread those variables through every beat — they anchor the story to the audience. You never break the 4th wall, never address the camera, never use AI-generic phrasing.";

export function buildStoryArcNarrativePrompt(input: BuildStoryArcPromptInput): string {
  const isDE = input.locale === "de";
  const variablesLines = Object.entries(input.hook.variables)
    .map(([k, v]) => `  - ${k}: "${v}"`)
    .join("\n");
  const variableNames = Object.keys(input.hook.variables);
  const toneLines = STORY_ARC_BEAT_GUIDES.map(
    (g) => `  - ${g.name}: ${isDE ? g.toneDE : g.toneEN}`,
  ).join("\n");

  const toolBlock = input.primaryToolName
    ? [
        "",
        `## Tool mention`,
        `Tool name: "${input.primaryToolName}"`,
        isDE
          ? "Weave this tool naturally into the `resolution` and `payoff` beats — it's the protagonist's tool of choice. Use the exact tool name (no German translation of brand names)."
          : "Weave this tool naturally into the `resolution` and `payoff` beats — it's the protagonist's tool of choice.",
      ].join("\n")
    : "";

  return [
    "Write a 5-beat narrative for an Instagram-carousel story-arc clickbait post.",
    "",
    "## Hook context",
    `Rendered hook: "${input.hook.rendered}"`,
    "Variables (must appear verbatim in at least one beat each):",
    variablesLines || "  (none)",
    "",
    "## Beat structure",
    toneLines,
    toolBlock,
    "",
    "## Output format",
    "Emit EXACTLY this structure — five `## <beatName>` headers, each followed by 2-4 sentences (40-200 chars per beat). No extra prose before/after:",
    "",
    "## setup",
    isDE ? "Ich saß da wie immer …" : "I sat there like every day …",
    "",
    "## conflict",
    isDE ? "Bis ich merkte, dass …" : "Until I realised that …",
    "",
    "## resolution",
    isDE ? "Dann probierte ich …" : "Then I tried …",
    "",
    "## payoff",
    isDE ? "Heute spare ich …" : "Today I save …",
    "",
    "## lesson",
    isDE ? "Was ich daraus gelernt habe …" : "What I learned …",
    "",
    "## Rules",
    `1. Output language: ${isDE ? "German (du-form, conversational, no business-speak)" : "English (concise, first-person, no business-speak)"}.`,
    `2. Every beat MUST mention at least one of the hook variables verbatim: ${variableNames.map((v) => `\`${v}\``).join(", ")}.`,
    "3. First-person ('ich' / 'I') throughout — this is a personal story.",
    "4. Avoid AI-generic phrasing: 'in der heutigen Zeit' / 'in today's world' / 'as an AI'.",
    "5. Each beat 40–400 chars (you have headroom but keep it tight — Instagram carousel text gets read fast).",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

// ─── Validator (variable-verbatim refinement, Pattern §3.3 Option γ) ──────────

export interface StoryArcNarrativeValidation {
  valid: boolean;
  /** Per-beat list of variables that were NOT found verbatim in that beat's text. */
  missingVariablesByBeat: Record<StoryArcBeat, string[]>;
  /** Human-readable reasons (one per missing variable) — drives retry prompt + log message. */
  reasons: string[];
}

/**
 * Verify every beat mentions at least one hook variable verbatim. Caller can
 * use the structured result to build a retry hint ("beats X, Y missed
 * variables A, B — include them") or to soft-fail to a degraded narrative.
 *
 * Pure function — no I/O, no globals. Variable matching is case-insensitive
 * and word-boundary-aware (avoids matching `Texter` inside `Geotexter`).
 */
export function validateStoryArcNarrative(
  narrative: StoryArcNarrative,
  variables: Record<string, string>,
): StoryArcNarrativeValidation {
  const variableValues = Object.values(variables).filter((v) => v.length > 0);
  if (variableValues.length === 0) {
    return {
      valid: true,
      missingVariablesByBeat: { setup: [], conflict: [], resolution: [], payoff: [], lesson: [] },
      reasons: [],
    };
  }

  const missing: Record<StoryArcBeat, string[]> = {
    setup: [],
    conflict: [],
    resolution: [],
    payoff: [],
    lesson: [],
  };
  const reasons: string[] = [];

  const beats: StoryArcBeat[] = ["setup", "conflict", "resolution", "payoff", "lesson"];
  for (const beat of beats) {
    const text = narrative[beat].text;
    // Case-insensitive word-boundary check per variable VALUE. We don't
    // require ALL variables in every beat — just at least one. The "missing"
    // list still records all values for retry-hint precision.
    let foundAny = false;
    const beatMissing: string[] = [];
    for (const value of variableValues) {
      if (!value) continue;
      const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`\\b${escaped}\\b`, "i");
      if (pattern.test(text)) {
        foundAny = true;
      } else {
        beatMissing.push(value);
      }
    }
    if (!foundAny) {
      missing[beat] = beatMissing;
      reasons.push(
        `Beat "${beat}" does not mention any hook variable verbatim (looked for: ${variableValues.join(", ")})`,
      );
    }
  }

  return {
    valid: reasons.length === 0,
    missingVariablesByBeat: missing,
    reasons,
  };
}

/**
 * Build a stronger retry-prompt suffix from the validation reasons. Append
 * to the original user message and re-run the LLM. Caller decides retry
 * count (typically 1×, matches the Pattern §3.3 refinement convention).
 */
export function buildStoryArcRetrySuffix(validation: StoryArcNarrativeValidation): string {
  if (validation.valid) return "";
  return [
    "",
    "## Retry — please fix:",
    ...validation.reasons.map((r) => `- ${r}`),
    "Make sure every beat references at least one of the hook variables verbatim. Keep the rest of the narrative intact.",
  ].join("\n");
}
