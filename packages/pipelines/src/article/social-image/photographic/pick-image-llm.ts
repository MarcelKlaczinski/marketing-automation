/**
 * Spec 65.8 — Vision-LLM image picker (Sonnet 4.6).
 *
 * Given a candidate pool of `ProviderSearchResult`s (collected by
 * `searchAllProviders` from `@marketing-auto/social/photographic`), the
 * picker asks Sonnet vision to evaluate each thumbnail and return the
 * best index for the slide's narrative beat + theme + brand context.
 *
 * Sonnet 4.6 / Opus 4.7 reject `jsonMode: true` (assistant prefill rejected
 * with HTTP 400 — root CLAUDE.md DO-NOT). The implementation omits jsonMode
 * and extracts JSON manually from `result.raw` via indexOf("{") / lastIndexOf("}").
 *
 * Cost: per spec §3.9 Sonnet vision with ~10 thumbnails ≈ €0.02-0.04 per call.
 * Tracked under `COST_OPS.IMAGE_VISION_PICK` (€0.04 per-call upper bound).
 *
 * Soft-fail semantics: if the LLM call throws, returns invalid JSON, picks
 * an out-of-range index, or otherwise fails Zod validation, falls back to
 * `candidates[0]` (the first provider hit by search order) with
 * `source: "fallback"`. Caller decides whether to surface the degraded
 * pick or skip the image-slide entirely.
 */
import { anthropic, type UserImageAttachment } from "@marketing-auto/adapter-anthropic";
import { COST_OPS } from "@marketing-auto/core/cost";
import { createLogger } from "@marketing-auto/shared";
import { z } from "zod";

const log = createLogger("photographic:pick-image-llm");

const MAX_CANDIDATES = 10;

/** Sonnet's JSON output schema. `selectedIndex` is 1-based per the prompt. */
const PICK_RESPONSE_SCHEMA = z.object({
  selectedIndex: z.number().int().min(1),
  reasoning: z.string().min(1).max(300),
});

/** Minimum-viable shape of a candidate the picker needs to evaluate. */
export interface PickableCandidate {
  providerId: string;
  thumbnailUrl: string;
  provider: string;
}

export interface PickBestImageInput<T extends PickableCandidate> {
  candidates: T[];
  /** Narrative beat text the slide will render — drives "emotional match" scoring. */
  beatText: string;
  /** Rendered hook string for slide context. */
  hookRendered: string;
  theme: "dark" | "light";
  /** Brand primary color for overlay-harmony scoring. CSS color string. */
  brandPrimaryColor: string;
  /** Project context for cost-tracking. */
  projectId: string;
  pipelineRunId?: string;
}

export interface PickBestImageResult<T extends PickableCandidate> {
  picked: T;
  reasoning: string;
  source: "llm" | "fallback";
}

const SYSTEM_PROMPT =
  "You are an editorial visual director picking the single best image for an Instagram-carousel slide from a numbered set of thumbnails. Evaluate each image's emotional fit with the beat-text mood, composition (text-overlay friendly, single subject or strong negative space), authenticity (avoid generic stock-photo cliches), and brand harmony with the project's primary color. Respond with only a JSON object: no markdown fences, no prose preamble.";

export function buildPickImageUserMessage(
  candidates: ReadonlyArray<PickableCandidate>,
  beatText: string,
  hookRendered: string,
  theme: "dark" | "light",
  brandPrimaryColor: string,
): string {
  const numbered = candidates
    .map((c, i) => `Image ${i + 1}: provider=${c.provider}, id=${c.providerId}`)
    .join("\n");
  const themeHint =
    theme === "dark"
      ? "Prefer darker images (deeper shadows, low-key lighting) — they harmonise with the dark theme."
      : "Prefer brighter images (open highlights, airy lighting) — they harmonise with the light theme.";
  return [
    `Pick the single best image (1 to ${candidates.length}) for this carousel slide.`,
    "",
    "## Slide context",
    `Hook: "${hookRendered}"`,
    `Beat text: "${beatText}"`,
    `Theme: ${theme}`,
    `Brand primary color (semi-transparent overlay will be applied): ${brandPrimaryColor}`,
    "",
    "## Candidates",
    numbered,
    "",
    "## Scoring criteria",
    "1. Emotional match — does the mood align with the beat?",
    "2. Composition — single clear subject OR strong negative space so text can overlay readably.",
    "3. Authenticity — prefer candid moments, avoid corporate-stock clichés.",
    "4. Brand harmony — image tones should not clash with the brand color overlay.",
    `5. Theme fit — ${themeHint}`,
    "",
    `Respond with JSON: {"selectedIndex": <1-${candidates.length}>, "reasoning": "<one short sentence>"}`,
  ].join("\n");
}

/**
 * Extract a JSON object from a Sonnet response. Sonnet rejects assistant
 * prefill so the adapter doesn't preload `{` — the raw string may contain
 * preamble, trailing prose, or markdown fences. Use indexOf/lastIndexOf
 * brace boundaries (root CLAUDE.md Sonnet+JSON canonical pattern).
 */
export function extractJsonFromRaw(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("No JSON object braces found in raw response");
  }
  return JSON.parse(raw.slice(start, end + 1));
}

export async function pickBestImage<T extends PickableCandidate>(
  input: PickBestImageInput<T>,
): Promise<PickBestImageResult<T>> {
  const { candidates } = input;
  const first = candidates[0];
  if (!first) {
    throw new Error("pickBestImage called with empty candidates array — caller must guard");
  }
  // Cap at MAX_CANDIDATES to keep the vision-token cost predictable; the
  // first MAX are typically the top-ranked from `searchAllProviders` anyway.
  const trimmed = candidates.slice(0, MAX_CANDIDATES);
  const fallback: PickBestImageResult<T> = {
    picked: first,
    reasoning: "Fallback to first candidate (LLM-pick failed or out of range).",
    source: "fallback",
  };

  const userImages: UserImageAttachment[] = trimmed.map((c) => ({
    type: "url",
    url: c.thumbnailUrl,
  }));
  const userMessage = buildPickImageUserMessage(
    trimmed,
    input.beatText,
    input.hookRendered,
    input.theme,
    input.brandPrimaryColor,
  );

  try {
    const result = await anthropic.messages({
      projectId: input.projectId,
      operation: COST_OPS.IMAGE_VISION_PICK,
      model: "claude-sonnet-4-6",
      systemPrefix: SYSTEM_PROMPT,
      // Sonnet 4.6 rejects assistant prefill; use the explicit-format suffix
      // canonical pattern (see GenerateCaptionStep / synthesizeTopics).
      systemSuffix: "Respond with only a valid JSON object. No markdown fences, no prose preamble.",
      userMessage,
      userImages,
      maxTokens: 400,
      estimatedCostEur: 0.04,
      ...(input.pipelineRunId !== undefined && { pipelineRunId: input.pipelineRunId }),
    });

    let parsed: z.infer<typeof PICK_RESPONSE_SCHEMA>;
    try {
      const json = extractJsonFromRaw(result.raw);
      const validated = PICK_RESPONSE_SCHEMA.safeParse(json);
      if (!validated.success) {
        log.warn(
          { projectId: input.projectId, issues: validated.error.issues },
          "Vision-pick LLM output failed Zod parse — using first-candidate fallback",
        );
        return fallback;
      }
      parsed = validated.data;
    } catch (parseErr) {
      log.warn(
        {
          projectId: input.projectId,
          err: parseErr instanceof Error ? parseErr.message : String(parseErr),
          rawHead: result.raw.slice(0, 200),
        },
        "Vision-pick JSON extraction failed — using first-candidate fallback",
      );
      return fallback;
    }

    // Index is 1-based per prompt; clamp + range-check.
    const idx0 = parsed.selectedIndex - 1;
    if (idx0 < 0 || idx0 >= trimmed.length) {
      log.warn(
        { projectId: input.projectId, selectedIndex: parsed.selectedIndex, poolSize: trimmed.length },
        "Vision-pick returned out-of-range index — using first-candidate fallback",
      );
      return fallback;
    }
    const pickedCandidate = trimmed[idx0];
    if (!pickedCandidate) {
      // Defensive — idx0 was bounds-checked above.
      return fallback;
    }
    return { picked: pickedCandidate, reasoning: parsed.reasoning, source: "llm" };
  } catch (err) {
    log.warn(
      {
        projectId: input.projectId,
        err: err instanceof Error ? err.message : String(err),
      },
      "Vision-pick LLM call threw — using first-candidate fallback",
    );
    return fallback;
  }
}
