/**
 * Spec 65.14 — Per-brief `{painPoint}` derivation for drama-pattern hooks.
 *
 * Number-driven and contrarian hooks (Spec 65.14 §3.1) reference a generic
 * `{painPoint}` placeholder — "{n} AI tools to kill {painPoint}" or
 * "RIP {established}: {n} tools that end {painPoint}". The brief-generator
 * calls this helper once per fire when the picked pattern's variables array
 * includes `painPoint`, threads the result into `renderHook(...)`, and the
 * substituted string lands in the persisted brief's `recurringMetadata`.
 *
 * Output target: a single noun-phrase (1-4 words) in the brief's language
 * that names the specific friction the featured tool(s) remove. Examples:
 *
 *   topic="career-disruption" tools=["Claude"] profession="Texter"
 *     → "stundenlanges Brainstorming"
 *
 *   topic="lifestyle-listicle" tools=["Notion","Linear"] lifeArea="Solopreneur"
 *     → "tab-switching all day"
 *
 *   topic="opinion-recommendation" tools=["Cursor"] profession="Entwickler"
 *     → "boilerplate code"
 *
 * Soft-fail: returns `{ source: "fallback", painPoint: <generic> }` if the
 * LLM throws or the Zod schema rejects. Generic fallback per language is a
 * deliberately bland anchor ("manual work" / "manuelle Arbeit") so the
 * substituted hook still reads naturally even when the LLM failed.
 *
 * Cost: ~€0.005/call (Haiku 4.5, jsonMode, small prompt). See
 * `COST_OPS.HOOK_PAIN_POINT_DERIVE`.
 */
import { anthropic } from "@marketing-auto/adapter-anthropic";
import { COST_OPS } from "@marketing-auto/core/cost";
import { createLogger } from "@marketing-auto/shared";
import { z } from "zod";

const log = createLogger("hook-library:derive-pain-point");

const PAIN_POINT_SCHEMA = z.object({
  painPoint: z.string().min(2).max(80),
  reasoning: z.string().min(1).max(200).optional(),
});

export interface DerivePainPointInput {
  projectId: string;
  language: "de" | "en";
  /** Tool names featured in the brief — drives "X removes Y" inference. */
  toolNames: string[];
  /** Optional brief-topic summary (narrativeAngle / lifeArea / opinionStance). */
  briefTopic?: string;
  /** Optional profession (story_arc_clickbait Y-axis). */
  profession?: string;
  /** Cost-attribution. */
  pipelineRunId?: string;
}

export interface DerivedPainPoint {
  painPoint: string;
  source: "llm" | "fallback";
  reasoning?: string;
}

const GENERIC_FALLBACK: Record<"de" | "en", string> = {
  de: "manuelle Arbeit",
  en: "manual work",
};

/**
 * Build the LLM user-message. Exported for unit tests.
 *
 * @internal
 */
export function buildPainPointUserMessage(input: DerivePainPointInput): string {
  const parts: string[] = [
    `Output language: ${input.language === "de" ? "German (du-form)" : "English"}.`,
    "",
    "Derive ONE specific friction (the painPoint) that the featured tools remove or replace.",
    "",
    "Context:",
    `- Tools: ${input.toolNames.join(", ") || "(none)"}`,
  ];
  if (input.briefTopic) parts.push(`- Brief topic: ${input.briefTopic}`);
  if (input.profession) parts.push(`- Profession: ${input.profession}`);
  parts.push(
    "",
    "Rules:",
    "1. Output 1-4 words. Concrete noun-phrase, NOT a sentence.",
    "2. Name the FRICTION (e.g. \"stundenlanges Brainstorming\", \"boilerplate code\", \"tab-switching all day\"), NOT the activity (NOT \"writing\", NOT \"coding\").",
    "3. Avoid generic words like \"work\", \"tasks\", \"productivity\" — pick something specific the tool actually targets.",
    `4. Match the output language: ${input.language === "de" ? "German (du-form, no Sie)" : "English"}.`,
    "",
    'Respond with JSON: {"painPoint": "<1-4 words>", "reasoning": "<one short sentence, optional>"}',
  );
  return parts.join("\n");
}

const SYSTEM_PROMPT = `You are a marketing copywriter deriving a specific friction-point noun-phrase that featured tools remove. Output is a 1-4 word noun-phrase only — never a sentence. Respond with JSON.`;

export async function derivePainPoint(
  input: DerivePainPointInput,
): Promise<DerivedPainPoint> {
  const fallback: DerivedPainPoint = {
    painPoint: GENERIC_FALLBACK[input.language],
    source: "fallback",
  };

  try {
    const result = await anthropic.messages({
      projectId: input.projectId,
      operation: COST_OPS.HOOK_PAIN_POINT_DERIVE,
      model: "claude-haiku-4-5",
      systemPrefix: SYSTEM_PROMPT,
      systemSuffix: "",
      userMessage: buildPainPointUserMessage(input),
      maxTokens: 150,
      jsonMode: true,
      estimatedCostEur: 0.005,
      ...(input.pipelineRunId !== undefined && { pipelineRunId: input.pipelineRunId }),
    });

    const parsed = PAIN_POINT_SCHEMA.safeParse(result.json);
    if (!parsed.success) {
      log.warn(
        { projectId: input.projectId, issues: parsed.error.issues },
        "derivePainPoint Zod parse failed — using generic fallback",
      );
      return fallback;
    }

    const cleaned: DerivedPainPoint = {
      painPoint: parsed.data.painPoint.trim(),
      source: "llm",
    };
    if (parsed.data.reasoning !== undefined) cleaned.reasoning = parsed.data.reasoning;
    return cleaned;
  } catch (err) {
    log.warn(
      {
        projectId: input.projectId,
        err: err instanceof Error ? err.message : String(err),
      },
      "derivePainPoint LLM call threw — using generic fallback",
    );
    return fallback;
  }
}
