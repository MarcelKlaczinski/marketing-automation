/**
 * Spec 65.5 — 3-Layer Template-Selector (absorbs 65.6).
 *
 * Per Marcel-Decision §0 the brief-generator picks the template at emit time
 * so the planner-card + brief detail page show the final visual choice. The
 * three layers are applied in order:
 *
 *   - **Layer 0 — `fixed`**: definition has `templateSelectionStrategy='fixed'`
 *     and a `fixedTemplateKey`. Returns immediately, bypasses Layers 1+.
 *   - **Layer 1 — Eligible**: `FORMAT_TYPES[formatType].eligibleTemplates`
 *     (Spec 65.4 registry) gives the candidate set. Throws when empty —
 *     a format-type with no eligible templates is a configuration bug.
 *     Single-eligible → trivially returned as `selectedVia: 'lru'`.
 *   - **Layer 2 — LRU**: strategy `'lru'` (default) — drop templates used in
 *     the most recent `eligible.length - 1` rows of `template_usage_log` and
 *     pick the first remaining eligible. Falls back to `eligible[0]` when no
 *     LRU candidate is left (cold start / all candidates recently used).
 *   - **Layer 3 — LLM-rank**: strategy `'llm-picks'` — Haiku 4.5 + jsonMode
 *     picks one by string key. Hallucination / Zod-fail / LLM-throw all
 *     fall back to the LRU pick (defense in depth — never block the brief
 *     just because the LLM had a bad day).
 *
 * Post-select: caller logs the pick via `logTemplateUsage` to feed the LRU
 * for the next run. Centralising the write here would be cleaner but the
 * worker needs to log it AFTER `persistRecurringBrief` lands so a failed
 * persistence step doesn't leave a phantom usage entry.
 */
import { anthropic } from "@marketing-auto/adapter-anthropic";
import { COST_OPS } from "@marketing-auto/core/cost";
import {
  type RecurringContentDefinition,
  listRecentTemplateUsage,
} from "@marketing-auto/db";
import { FORMAT_TYPES, createLogger } from "@marketing-auto/shared";
import { z } from "zod";

const log = createLogger("recurring-content:select-template");

const LLM_RANK_SCHEMA = z.object({
  pickedTemplateKey: z.string().min(1),
  reasoning: z.string().min(1).max(400),
});

export type SelectedVia = "fixed" | "lru" | "llm-rank";

export interface SelectedTemplate {
  templateKey: string;
  selectedVia: SelectedVia;
  /** LLM reasoning sentence; sentinel string for fixed/LRU. */
  reasoning?: string;
}

export interface SelectTemplateInput {
  definition: RecurringContentDefinition;
  /** Context the LLM-rank prompt consumes (light — tool names, persona, angle). */
  briefContext?: {
    toolNames?: string[];
    persona?: string;
    angle?: string;
  };
  /** Propagated to the cost-tracker for LLM-rank cost-attribution. */
  pipelineRunId?: string;
}

export class NoEligibleTemplatesError extends Error {
  readonly formatType: string;
  constructor(formatType: string) {
    super(`No eligible templates registered for format-type '${formatType}'`);
    this.name = "NoEligibleTemplatesError";
    this.formatType = formatType;
  }
}

function lruPick(eligible: string[], recentlyUsedKeys: Set<string>): string {
  // Eligible templates that have NOT been used recently win — preserves the
  // declared order of `eligible` so the first-registered template is the
  // tiebreaker. `eligible[0]` as the cold-start fallback when EVERYTHING in
  // eligible has been used recently.
  const lru = eligible.find((t) => !recentlyUsedKeys.has(t));
  const fallback = eligible[0];
  if (!fallback) {
    // Pre-condition: Layer 1 guarantees eligible.length ≥ 1, but a defensive
    // throw here keeps the helper honest.
    throw new Error("lruPick: eligible array unexpectedly empty");
  }
  return lru ?? fallback;
}

async function llmRankPick(input: {
  definition: RecurringContentDefinition;
  candidates: string[];
  briefContext: SelectTemplateInput["briefContext"];
  projectId: string;
  pipelineRunId?: string;
}): Promise<{ pickedTemplateKey: string; reasoning: string } | null> {
  const ctx = input.briefContext ?? {};
  const lines: string[] = [];
  lines.push(`Pick the best template for a "${input.definition.formatType}" recurring post.`);
  lines.push("");
  lines.push("## Brief context");
  lines.push(`- Tools featured: ${ctx.toolNames?.join(", ") ?? "(none / n/a)"}`);
  lines.push(`- Persona: ${ctx.persona ?? "general"}`);
  lines.push(`- Angle: ${ctx.angle ?? "standard"}`);
  lines.push("");
  lines.push("## Candidate templates");
  for (const key of input.candidates) {
    lines.push(`- ${key}`);
  }
  lines.push("");
  lines.push(
    `Respond with JSON: {"pickedTemplateKey": "<key from list>", "reasoning": "<one short sentence>"}`,
  );

  try {
    const result = await anthropic.messages({
      projectId: input.projectId,
      operation: COST_OPS.RECURRING_TEMPLATE_RANK,
      model: "claude-haiku-4-5",
      systemPrefix:
        "You are picking the best social-media template from a candidate list. Match template tone to the brief context. Respond with JSON only.",
      systemSuffix: "",
      userMessage: lines.join("\n"),
      maxTokens: 200,
      jsonMode: true,
      estimatedCostEur: 0.005,
      ...(input.pipelineRunId !== undefined && { pipelineRunId: input.pipelineRunId }),
    });
    const parsed = LLM_RANK_SCHEMA.safeParse(result.json);
    if (!parsed.success) {
      log.warn(
        { projectId: input.projectId, issues: parsed.error.issues },
        "template-rank LLM output failed Zod parse — using LRU fallback",
      );
      return null;
    }
    if (!input.candidates.includes(parsed.data.pickedTemplateKey)) {
      log.warn(
        {
          projectId: input.projectId,
          pickedTemplateKey: parsed.data.pickedTemplateKey,
          candidates: input.candidates,
        },
        "template-rank LLM picked an unknown key — using LRU fallback",
      );
      return null;
    }
    return parsed.data;
  } catch (err) {
    log.warn(
      {
        projectId: input.projectId,
        err: err instanceof Error ? err.message : String(err),
      },
      "template-rank LLM call threw — using LRU fallback",
    );
    return null;
  }
}

export async function selectTemplateForRecurringBrief(
  input: SelectTemplateInput,
): Promise<SelectedTemplate> {
  const { definition } = input;

  // ── Layer 0: fixed ─────────────────────────────────────────────────────
  if (definition.templateSelectionStrategy === "fixed") {
    const key = definition.fixedTemplateKey;
    if (!key) {
      throw new Error(
        `Definition ${definition.id} has templateSelectionStrategy='fixed' but no fixedTemplateKey`,
      );
    }
    return { templateKey: key, selectedVia: "fixed", reasoning: "Fixed strategy (Layer 0)" };
  }

  // ── Layer 1: eligible templates ────────────────────────────────────────
  const formatTypeDef = FORMAT_TYPES[definition.formatType];
  if (!formatTypeDef) {
    throw new Error(
      `Definition ${definition.id} format-type '${definition.formatType}' is not in FORMAT_TYPES registry`,
    );
  }
  const eligible = formatTypeDef.eligibleTemplates;
  if (eligible.length === 0) {
    throw new NoEligibleTemplatesError(definition.formatType);
  }
  if (eligible.length === 1) {
    return {
      templateKey: eligible[0] as string,
      selectedVia: "lru",
      reasoning: "Single eligible template (Layer 1 shortcut)",
    };
  }

  // ── Compute LRU set (consumed by Layer 2 + Layer 3 fallback) ───────────
  const recent = await listRecentTemplateUsage({
    recurringDefinitionId: definition.id,
    // Keep at least one template eligible by leaving 1 slot uncovered.
    limit: Math.max(eligible.length - 1, 1),
  });
  const recentlyUsedKeys = new Set(recent.map((r) => r.templateKey));
  const lruWinner = lruPick(eligible, recentlyUsedKeys);

  // ── Layer 2: LRU (default + 'latest') ──────────────────────────────────
  if (
    definition.templateSelectionStrategy === "lru" ||
    definition.templateSelectionStrategy === "latest"
  ) {
    return {
      templateKey: lruWinner,
      selectedVia: "lru",
      reasoning:
        definition.templateSelectionStrategy === "latest"
          ? "Latest strategy mapped to LRU pick (Layer 2)"
          : "LRU strategy (Layer 2)",
    };
  }

  // ── Layer 3: LLM-rank ──────────────────────────────────────────────────
  if (definition.templateSelectionStrategy === "llm-picks") {
    const ranked = await llmRankPick({
      definition,
      candidates: eligible,
      briefContext: input.briefContext,
      projectId: definition.projectId,
      ...(input.pipelineRunId !== undefined && { pipelineRunId: input.pipelineRunId }),
    });
    if (ranked) {
      return {
        templateKey: ranked.pickedTemplateKey,
        selectedVia: "llm-rank",
        reasoning: ranked.reasoning,
      };
    }
    // Fall-through to LRU (defense in depth — never block a brief just
    // because the LLM hallucinated or timed out).
    return {
      templateKey: lruWinner,
      selectedVia: "lru",
      reasoning: "LLM-rank failed; fell back to LRU pick (Layer 3 → 2)",
    };
  }

  // Unknown strategy — defensive fallback to LRU.
  log.warn(
    {
      definitionId: definition.id,
      strategy: definition.templateSelectionStrategy,
    },
    "Unknown templateSelectionStrategy; falling back to LRU",
  );
  return {
    templateKey: lruWinner,
    selectedVia: "lru",
    reasoning: `Unknown strategy '${definition.templateSelectionStrategy}'; fell back to LRU`,
  };
}
