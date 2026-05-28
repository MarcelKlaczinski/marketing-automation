/**
 * Spec 65.4 — Hook-Picker (LLM top-1 with LRU + hallucination fallback).
 *
 * Brief-Generators (65.5) call `pickHook()` whenever the resolved
 * `FormatTypeDefinition.needsHooks === true`. The picker:
 *
 *   1. Loads up to 10 LRU-eligible hooks for `(projectId, formatType,
 *      language)` via the 65.1 `listLruEligibleHooks` helper — never-used
 *      hooks bubble up first, then least-used.
 *   2. Asks Haiku 4.5 to pick one by UUID with a one-sentence reasoning
 *      (jsonMode — Haiku supports assistant prefill, unlike Sonnet 4.6 /
 *      Opus 4.7).
 *   3. Falls back to the first LRU candidate if the LLM hallucinates a
 *      UUID or the call throws.
 *   4. Bumps the LRU counter via `markHookUsed` (fire-and-forget).
 *
 * Returns `null` only when no candidates exist (project has no seeded
 * hooks for this format-type/language). Callers must handle this — Family
 * B brief-generation cannot proceed without a hook.
 */
import { anthropic } from "@marketing-auto/adapter-anthropic";
import { COST_OPS } from "@marketing-auto/core/cost";
import {
  type HookDramaIntensity,
  type HookTemplate,
  listLruEligibleHooks,
  markHookUsed,
} from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { z } from "zod";

const log = createLogger("hook-library:pick-hook");

const HOOK_PICKER_SCHEMA = z.object({
  pickedHookId: z.string().uuid(),
  reasoning: z.string().min(1).max(500),
});

/**
 * Spec 65.14 — derive the allowed drama-intensity set from a definition's
 * `outputTargets`. Pure helper, exported for offline tests.
 *
 *   - article ONLY (no social) → `['subtle']` only — Spec 64.16 drama-ban
 *     compliance for SEO output.
 *   - social = true (regardless of article) → all three intensities.
 *   - article=false + social=false (degenerate; shouldn't happen at runtime
 *     because the DB default is `{article:false,social:true}`) → defaults
 *     to all three so we never starve the picker.
 */
export function allowedDramaIntensitiesFor(outputTargets: {
  article?: boolean;
  social?: boolean;
}): HookDramaIntensity[] {
  if (outputTargets.social === true) return ["subtle", "moderate", "aggressive"];
  if (outputTargets.article === true) return ["subtle"];
  return ["subtle", "moderate", "aggressive"];
}

export interface PickHookInput {
  projectId: string;
  formatType: string;
  language: "de" | "en";
  /**
   * Spec 65.14 — caller MUST supply the definition's `outputTargets` so the
   * picker can derive the drama-intensity allow-list. Article-only callers
   * get `['subtle']` (Spec 64.16); social callers get all three.
   */
  outputTargets: { article?: boolean; social?: boolean };
  /** Optional structured context the LLM gets to weigh fit (tool names, professions, life-area, etc.). */
  contentContext?: {
    toolNames?: string[];
    professionPool?: string[];
    lifeArea?: string;
    narrativeIntent?: string;
    /**
     * Spec 65.14 — short topic-summary string derived per generator from
     * format-config (e.g. `"career-disruption" arc featuring Claude for
     * Texter`). Helps the LLM weigh topic-fit alongside tool-fit.
     */
    briefTopic?: string;
    /**
     * Spec 65.14 — incumbent / "established" competitor the contrarian-pattern
     * hooks substitute as `{established}`. Optional — pre-filter drops hooks
     * referencing `{established}` when this is undefined.
     */
    competitorTool?: string;
  };
  /** Propagated to the cost-tracker so the LLM call attaches to the right run. */
  pipelineRunId?: string;
}

export interface PickedHook {
  hookId: string;
  pattern: string;
  variables: string[];
  /** Either the LLM's justification or a sentinel string when the fallback fired. */
  reasoning: string;
  /** `"llm"` for normal picks, `"fallback"` when hallucination/LLM-error forced the first LRU. */
  source: "llm" | "fallback";
}

/**
 * Render the LRU-eligible hook list into the prompt user-message.
 *
 * @internal Exported only for unit testing.
 */
export function buildHookPickerUserMessage(
  candidates: HookTemplate[],
  context: PickHookInput["contentContext"] | undefined,
): string {
  const ctx = context ?? {};
  const lines: string[] = [
    "Pick the single best narrative hook for a social-media carousel from the list below.",
    "",
    "## Content context",
    `- Brief topic: ${ctx.briefTopic ?? "(not provided)"}`,
    `- Tools featured: ${ctx.toolNames?.join(", ") ?? "(none)"}`,
    `- Profession pool: ${ctx.professionPool?.join(", ") ?? "(n/a)"}`,
    `- Life area: ${ctx.lifeArea ?? "(n/a)"}`,
    `- Competitor / incumbent ("{established}"): ${ctx.competitorTool ?? "(none)"}`,
    `- Narrative intent: ${ctx.narrativeIntent ?? "engagement-driven"}`,
    "",
    "## Eligible hooks",
  ];
  for (const h of candidates) {
    const last = h.lastUsedAt ? h.lastUsedAt.toISOString().slice(0, 10) : "never";
    lines.push(
      `- id=${h.id} intensity=${h.dramaIntensity} usage=${h.usageCount} last=${last} pattern="${h.pattern}"`,
    );
  }
  lines.push("");
  lines.push("## Selection rules");
  lines.push("1. Pick by topic-coherence first — the hook angle must fit the brief topic.");
  lines.push("2. Then tool-fit — does the pattern work with these specific tools?");
  lines.push("3. Then drama-pattern-match — strong patterns win for engagement-driven carousels.");
  lines.push("4. Prefer hooks that have NOT been used recently (LRU preferential).");
  lines.push("5. Avoid AI-generic phrasing — favour fresh, specific narratives.");
  lines.push("");
  lines.push(
    'Respond with JSON: {"pickedHookId": "<uuid from the list above>", "reasoning": "<one short sentence>"}',
  );
  return lines.join("\n");
}

const SYSTEM_PROMPT = `You are a marketing copy editor picking the best narrative hook for a social-media carousel. You receive a context block and a list of eligible hook patterns (each with a UUID, usage count, last-used date, and the {variable}-placeholder pattern). Pick exactly one. Respond with JSON only.`;

export async function pickHook(input: PickHookInput): Promise<PickedHook | null> {
  const dramaIntensities = allowedDramaIntensitiesFor(input.outputTargets);

  // Spec 65.14 — over-fetch (20) so the post-filter for `{established}`-bearing
  // hooks (when the caller didn't supply a competitorTool) still leaves a
  // workable LRU window. Final cap stays at 10 candidates.
  const pool = await listLruEligibleHooks({
    projectId: input.projectId,
    formatType: input.formatType,
    language: input.language,
    limit: 20,
    dramaIntensities,
  });

  const competitorTool = input.contentContext?.competitorTool;
  const candidates =
    competitorTool !== undefined
      ? pool.slice(0, 10)
      : // Drop hooks that reference `{established}` when no competitor was
        // supplied — renderHook would throw HookRenderError otherwise.
        pool.filter((h) => !h.variables.includes("established")).slice(0, 10);

  if (candidates.length === 0) {
    log.warn(
      {
        projectId: input.projectId,
        formatType: input.formatType,
        language: input.language,
        dramaIntensities,
        poolBeforeEstablishedFilter: pool.length,
      },
      "no eligible hooks — pickHook returning null",
    );
    return null;
  }

  const userMessage = buildHookPickerUserMessage(candidates, input.contentContext);
  const fallback = candidates[0];
  if (!fallback) {
    // Defensive — we just checked length above; but TS narrows on candidates[0].
    return null;
  }

  let pickedHookId: string | null = null;
  let reasoning: string | null = null;

  try {
    const result = await anthropic.messages({
      projectId: input.projectId,
      operation: COST_OPS.HOOK_PICK,
      model: "claude-haiku-4-5",
      systemPrefix: SYSTEM_PROMPT,
      systemSuffix: "",
      userMessage,
      maxTokens: 200,
      jsonMode: true,
      estimatedCostEur: 0.005,
      ...(input.pipelineRunId !== undefined && { pipelineRunId: input.pipelineRunId }),
    });

    const parsed = HOOK_PICKER_SCHEMA.safeParse(result.json);
    if (parsed.success) {
      pickedHookId = parsed.data.pickedHookId;
      reasoning = parsed.data.reasoning;
    } else {
      log.warn(
        { projectId: input.projectId, issues: parsed.error.issues },
        "Hook-Picker LLM output failed Zod parse — using LRU fallback",
      );
    }
  } catch (err) {
    log.warn(
      {
        projectId: input.projectId,
        formatType: input.formatType,
        err: err instanceof Error ? err.message : String(err),
      },
      "Hook-Picker LLM call threw — using LRU fallback",
    );
  }

  const picked =
    pickedHookId !== null ? candidates.find((c) => c.id === pickedHookId) ?? null : null;

  if (picked === null) {
    // Hallucination or LLM error → first LRU candidate.
    await markHookUsed(fallback.id);
    return {
      hookId: fallback.id,
      pattern: fallback.pattern,
      variables: fallback.variables,
      reasoning: "Fallback to first LRU candidate (LLM picked an unknown UUID or failed).",
      source: "fallback",
    };
  }

  await markHookUsed(picked.id);
  return {
    hookId: picked.id,
    pattern: picked.pattern,
    variables: picked.variables,
    reasoning: reasoning ?? "(no reasoning returned)",
    source: "llm",
  };
}
