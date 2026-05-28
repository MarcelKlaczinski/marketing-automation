/**
 * Spec 65.16 — Nano Banana 2 signature-prompt builder.
 *
 * Produces a single positive prompt string consumed by
 * `nanoBanana.generateImage({prompt, ...})`. Per Phase-0 verify (Memory D18):
 * the Gemini Image API has NO `negativePrompt` field — anti-AI-slop guidance
 * is folded into the positive prompt as "NOT <phrase>" instructions.
 *
 * Aspect-ratio is delivered by prompt text (matches `buildPromptWithResolutionHint`
 * for the hero-image step — Gemini parses the format hint from prose, not from
 * the request body).
 *
 * Prompt assembly (in order):
 *   1. baseDirection             — preset aesthetic anchor
 *   2. textureDirection          — preset texture/lighting language
 *   3. slide-role composition    — cover/conflict/resolution/payoff/item/etc.
 *   4. scene context             — narrative beat + hookContext (Marcel-relevant)
 *   5. aspect ratio hint         — "vertical 4:5, 1080×1350 resolution"
 *   6. anti-AI-slop avoidance    — global + per-preset "NOT ..." list
 *
 * Slide-context-aware: cover slides ask for hero composition + negative-space
 * in lower-third for headline; body slides ask for emotional resonance + room
 * for caption overlay. Per design-skill principles, each slide gets a
 * distinct seed so a 4-image carousel doesn't read as 4-of-the-same.
 */
import {
  GLOBAL_AVOID_PHRASES,
  PRESET_CATALOG,
  type PresetKey,
  type SlideRole,
} from "./catalog.ts";

/**
 * Per-role composition direction. The role drives the focal-point ask of the
 * NB2 prompt — Cover wants a bold hero composition with text-zone; conflict
 * slides want emotional weight; resolution slides want breakthrough mood.
 *
 * Slides that don't list a role here default to a neutral mid-shot
 * editorial composition with negative-space for text overlay.
 */
const ROLE_COMPOSITION: Record<SlideRole, string> = {
  cover:
    "bold hero composition with a single strong focal point, generous negative-space in the lower-third for headline overlay",
  conflict:
    "tension and contrast, dramatic side-lighting, emotional weight, single subject foregrounded against atmospheric backdrop",
  resolution:
    "breakthrough moment, light brightening from one direction, sense of forward momentum, hopeful and confident mood",
  payoff:
    "success and transformation, confident composition, aspirational mood, room for a short caption overlay",
  item:
    "single subject mid-shot, premium editorial framing, negative-space on one side for label overlay, calm and unhurried",
  "hot-take":
    "high-energy provocative composition, asymmetric off-center subject, dynamic contrast, emotional intensity",
  "top-pick":
    "elevated hero composition, single subject centered with breathing room, confident triumphant mood, room for badge overlay",
};

/**
 * Light hookContext shape — mirror the runtime shape used by photographic
 * orchestrator without coupling to its types (the NB2 path is a sibling,
 * not a downstream).
 */
export interface NB2HookContext {
  /** Rendered hook string (post-variable-substitution). Used as scene anchor. */
  rendered: string;
  /** Per-variable values (`{toolA: "Claude"}`, etc.) — used for subject anchoring. */
  variables: Record<string, string>;
}

export interface BuildNB2PromptInput {
  preset: PresetKey;
  /** Composition role — drives the focal-point + composition ask. */
  slideRole: SlideRole;
  /**
   * Optional narrative-beat label (e.g. "conflict") — used in prompt prose
   * for context. May be the same as `slideRole` for templates whose beats
   * align 1:1 with roles.
   */
  narrativeBeat?: string;
  /** LLM-generated beat-text (1-3 sentences) describing the slide content. */
  beatText: string;
  /** Hook context for subject-anchoring. */
  hookContext: NB2HookContext;
}

export interface BuildNB2PromptResult {
  /** Final positive prompt string passed to `nanoBanana.generateImage()`. */
  prompt: string;
}

/**
 * Build a signature NB2 prompt for one slide.
 *
 * Pure function — no I/O, no LLM calls. Tested via `nb2-prompts.test.ts`.
 */
export function buildNB2Prompt(input: BuildNB2PromptInput): BuildNB2PromptResult {
  const entry = PRESET_CATALOG[input.preset];
  const roleComposition =
    ROLE_COMPOSITION[input.slideRole] ??
    "single subject editorial composition with negative-space for text overlay";

  // Subject anchoring: the hook's first variable is typically the "hero" tool/concept.
  // Surfacing it in prose helps NB2 anchor the scene (avoids drifting to stock-cliché).
  const heroSubject = extractHeroSubject(input.hookContext);
  const subjectLine = heroSubject
    ? `Subject anchor: ${heroSubject} — frame the scene around this concept without rendering it literally.`
    : "";

  // Beat-context line: keeps prose concise but gives NB2 narrative grounding.
  const beatContext = input.beatText.trim().length > 0
    ? `Scene context: ${truncate(input.beatText, 240)}.`
    : "";

  // Combine global + preset-specific avoid lists into a single "NOT ..." block.
  // Per Phase-0: there's no negativePrompt field, so anti-slop is woven in.
  const avoidPhrases = [...GLOBAL_AVOID_PHRASES, ...entry.nb2.avoidPhrases];
  const avoidanceBlock = `AVOID: ${avoidPhrases.map((p) => `NOT ${p}`).join(", ")}.`;

  // Aspect-ratio hint — Gemini reads from prompt text (Memory D18).
  // Vertical 4:5 = 1080×1350, Instagram carousel standard.
  const aspectHint =
    "Aspect ratio: vertical 4:5 (portrait), premium editorial quality, sharp focus.";

  // Final assembly. Sections joined with newlines for readability + parsing
  // resilience (Gemini handles multi-line prompts well).
  const prompt = [
    entry.nb2.baseDirection.trim() + ".",
    entry.nb2.textureDirection.trim() + ".",
    `Composition: ${roleComposition}.`,
    subjectLine,
    beatContext,
    aspectHint,
    avoidanceBlock,
  ]
    .filter((line) => line.length > 0)
    .join("\n");

  return { prompt };
}

/**
 * Extract the first non-empty variable value as the subject anchor.
 * Heuristic: hooks like `{tool}`, `{toolA}`, `{tool_name}` carry the
 * Marcel-relevant subject. Falls back to `rendered` text if no variables
 * are present (rare; manual hooks may have none).
 */
function extractHeroSubject(hookContext: NB2HookContext): string {
  const vars = hookContext.variables ?? {};
  for (const value of Object.values(vars)) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  // Fallback: first ~80 chars of rendered hook (avoid stuffing the whole hook).
  const rendered = hookContext.rendered?.trim() ?? "";
  if (rendered.length > 0) {
    return truncate(rendered, 80);
  }
  return "";
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1).trimEnd() + "…";
}
