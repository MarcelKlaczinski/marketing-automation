/**
 * Spec 65.8 — Image query-keyword generator (Haiku 4.5).
 *
 * Per Family-B image slide (spec §3.7 Option γ) we generate 3 short image-
 * search query strings that capture the emotional tone of the narrative
 * beat the slide is rendering. The output feeds `searchAllProviders` from
 * `@marketing-auto/social/photographic` which fans out across Pexels +
 * Unsplash + Pixabay.
 *
 * Cost: per spec §3.8 Haiku batch-call ≈ €0.01-0.02 per slide. Tracked
 * under `COST_OPS.IMAGE_QUERY_KEYWORDS` (€0.015 per-call upper bound).
 *
 * Soft-fail semantics: if Haiku throws, returns Zod-invalid JSON, or
 * hallucinates a non-array, returns a `source: "fallback"` result built
 * from the hook variables + narrative beat name. The caller (the
 * photographic orchestrator) keeps going with the fallback queries —
 * provider search may still surface decent candidates from text-only
 * tokens like profession / life-area.
 */
import { anthropic } from "@marketing-auto/adapter-anthropic";
import { COST_OPS } from "@marketing-auto/core/cost";
import { createLogger } from "@marketing-auto/shared";
import { z } from "zod";

const log = createLogger("photographic:generate-query-keywords");

/** Output schema — Haiku must return EXACTLY 3 strings, each 3-6 words. */
export const imageQueryKeywordsSchema = z
  .array(z.string().min(3).max(60))
  .length(3);

export type ImageQueryKeywords = z.infer<typeof imageQueryKeywordsSchema>;

export interface HookContextForQueries {
  /** The rendered hook string (after variable substitution). */
  rendered: string;
  /** The variable map that produced `rendered` — e.g. `{ profession: "Texter", lifeArea: "Job" }`. */
  variables: Record<string, string>;
}

export interface GenerateImageQueryKeywordsInput {
  hookContext: HookContextForQueries;
  /** Narrative beat name — one of the per-template beats (cover/setup/conflict/resolution/payoff/etc.). */
  narrativeBeat: string;
  /** LLM-generated narrative text for this specific beat (~30-100 words). */
  beatText: string;
  /** Format-type discriminator — `story_arc_clickbait` / `lifestyle_listicle` / `opinion_recommendation`. */
  formatType: string;
  /** Project context for cost-tracking + ID propagation. */
  projectId: string;
  /** Pipeline run ID — passed through to cost-tracker so the call is attributable. Optional for ad-hoc usage. */
  pipelineRunId?: string;
}

export interface GenerateImageQueryKeywordsResult {
  queries: ImageQueryKeywords;
  source: "llm" | "fallback";
  reasoning?: string;
}

const SYSTEM_PROMPT =
  "You are a stock-photo search assistant. Generate exactly 3 short English query strings (3-6 words each) for an Instagram-carousel slide. Each query should evoke a specific emotional tone matching the narrative beat. Prefer concrete nouns + emotional adjectives over abstract concepts. Respond with JSON only: a single array of 3 strings.";

const BEAT_TONE_GUIDE: Record<string, string> = {
  cover: "scene-setting, attention-grabbing, central subject",
  setup: "scene-setting, contextual, ordinary moment",
  conflict: "tension, frustration, problem-state",
  resolution: "discovery, breakthrough, hope",
  payoff: "success, transformation, positive outcome",
  lesson: "reflection, calm, contemplative",
  intro: "introduction, scene-setting, anticipation",
  item: "feature-focused, product-context, clean composition",
  "hot-take": "bold statement, contrast, emotional impact",
  reasoning: "analytical, balanced, focused subject",
  "top-pick": "highlight, hero composition, winner-frame",
};

export function buildQueryKeywordsUserMessage(input: GenerateImageQueryKeywordsInput): string {
  const tone = BEAT_TONE_GUIDE[input.narrativeBeat] ?? "general emotional match";
  const varsList = Object.entries(input.hookContext.variables)
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join("\n");
  return [
    "Generate 3 image-search-query keywords for this carousel slide.",
    "",
    "## Slide context",
    `Hook: "${input.hookContext.rendered}"`,
    `Format-type: ${input.formatType}`,
    `Narrative beat: ${input.narrativeBeat}`,
    `Beat tone: ${tone}`,
    "",
    "## Hook variables",
    varsList || "  (none)",
    "",
    "## Beat narrative",
    `"${input.beatText}"`,
    "",
    "## Rules",
    "1. English queries (most provider APIs index English best).",
    "2. Each query 3-6 words.",
    "3. Prefer concrete nouns + emotional adjectives.",
    "4. Avoid AI-generic phrasing ('person looking at screen' / 'modern workspace').",
    "5. Match the beat tone — different queries can emphasise slightly different angles.",
    "",
    'Respond with JSON: ["query1", "query2", "query3"]',
  ].join("\n");
}

/**
 * Defensive fallback queries when the LLM call fails. Uses hook variables +
 * the narrative beat name to compose plausible search terms. Not great, but
 * good enough to keep the photographic pipeline from blocking — the resulting
 * provider hits may still be acceptable, and the LLM-pick step will pick the
 * best of whatever lands.
 */
export function buildFallbackQueries(
  input: GenerateImageQueryKeywordsInput,
): ImageQueryKeywords {
  const vars = input.hookContext.variables;
  const profession = vars.profession ?? vars.role ?? null;
  const lifeArea = vars.lifeArea ?? vars.life_area ?? null;
  const subject = profession ?? lifeArea ?? "modern professional";
  const tone = BEAT_TONE_GUIDE[input.narrativeBeat] ?? "emotional moment";
  const generic = `${subject} ${input.narrativeBeat}`.trim().slice(0, 60);
  return [
    `${subject} ${tone.split(",")[0] ?? "moment"}`.trim().slice(0, 60) || "modern lifestyle",
    `${subject} workspace authentic`.slice(0, 60),
    generic || "candid lifestyle shot",
  ] as ImageQueryKeywords;
}

export async function generateImageQueryKeywords(
  input: GenerateImageQueryKeywordsInput,
): Promise<GenerateImageQueryKeywordsResult> {
  const userMessage = buildQueryKeywordsUserMessage(input);
  try {
    const result = await anthropic.messages({
      projectId: input.projectId,
      operation: COST_OPS.IMAGE_QUERY_KEYWORDS,
      model: "claude-haiku-4-5",
      systemPrefix: SYSTEM_PROMPT,
      systemSuffix: "",
      userMessage,
      maxTokens: 200,
      jsonMode: true,
      estimatedCostEur: 0.015,
      ...(input.pipelineRunId !== undefined && { pipelineRunId: input.pipelineRunId }),
    });
    const parsed = imageQueryKeywordsSchema.safeParse(result.json);
    if (!parsed.success) {
      log.warn(
        { projectId: input.projectId, narrativeBeat: input.narrativeBeat, issues: parsed.error.issues },
        "Image query-keywords LLM output failed Zod parse — using fallback",
      );
      return { queries: buildFallbackQueries(input), source: "fallback" };
    }
    return { queries: parsed.data, source: "llm" };
  } catch (err) {
    log.warn(
      {
        projectId: input.projectId,
        narrativeBeat: input.narrativeBeat,
        err: err instanceof Error ? err.message : String(err),
      },
      "Image query-keywords LLM call threw — using fallback",
    );
    return { queries: buildFallbackQueries(input), source: "fallback" };
  }
}
