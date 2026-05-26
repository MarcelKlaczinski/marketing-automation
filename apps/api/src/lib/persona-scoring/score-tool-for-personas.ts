/**
 * Spec 65.3 — Persona-Scorer (LLM batch-per-tool, all personas in one call).
 *
 * Mirror of the 65.4 Hook-Picker shape (Haiku 4.5 + jsonMode + Zod-validated
 * output + fallback to first LRU on hallucination). Differences:
 *
 *   1. Output is N scores in one call (one per persona) — not a top-1 pick.
 *   2. No LRU because the cache is per-tool (composite-PK upsert).
 *   3. Fallback on schema-parse-fail is to log + skip the tool (not to write
 *      a degraded score). Persona-scoring is opportunistic; the brief-generator
 *      can re-trigger on the next plan-tick.
 *
 * Batch shape (Option α from spec §3.1): one tool, all 10 personas in a
 * single Haiku call. Output cap is comfortable: 10 personas × ~60-char
 * reasoning = ~150-200 tokens. Input includes the tool's description,
 * category, and use-cases plus the 10 persona definitions.
 *
 * Cost: ~€0.01/call via `COST_OPS.PERSONA_SCORE`. ~€1.10 for a 108-tool
 * Toolwiki backfill.
 */
import { anthropic } from "@marketing-auto/adapter-anthropic";
import { COST_OPS } from "@marketing-auto/core/cost";
import { articles, db, eq, upsertPersonaScore } from "@marketing-auto/db";
import { DEFAULT_PERSONAS, PERSONA_DEFINITIONS, createLogger } from "@marketing-auto/shared";
import { z } from "zod";

const log = createLogger("persona-scoring:score-tool-for-personas");

const PERSONA_SCORE_SCHEMA = z.object({
  scores: z
    .array(
      z.object({
        persona: z.string().min(1),
        score: z.number().int().min(0).max(10),
        reasoning: z.string().min(1).max(280),
      })
    )
    .min(1),
});

type ScoreEntry = z.infer<typeof PERSONA_SCORE_SCHEMA>["scores"][number];

export interface ScoreToolForPersonasInput {
  projectId: string;
  toolId: string;
  /** Personas to score against. Defaults to DEFAULT_PERSONAS — pass a subset for lazy single-persona refresh. */
  personas?: readonly string[];
  /** Propagated to the cost-tracker so the LLM call attaches to the right run. */
  pipelineRunId?: string;
}

export interface ScoreToolResult {
  toolId: string;
  /** UUIDs of persona-rows that were UPSERTed. Empty when LLM failed and nothing landed. */
  written: string[];
  /** Source — `"llm"` on success, `"skipped"` when LLM returned but no parseable scores, `"failed"` on adapter error. */
  source: "llm" | "skipped" | "failed";
  /** Error message when `source === "failed"`. */
  error?: string;
}

const SYSTEM_PROMPT = `You are a marketing strategist scoring an AI tool's fit for different audience personas. You receive a tool description and a list of personas. For each persona, return a 0-10 relevance score with a one-sentence reasoning.

Scoring rubric:
- 0-2: irrelevant or actively wrong fit (paid-pro tool for absolute beginners, deep-tech for parents, etc.)
- 3-5: usable but not targeted — the persona could find a use, but better-fit tools exist
- 6-8: strong fit — the tool matches this persona's typical needs
- 9-10: ideal fit — the tool was effectively built for this persona

Be honest with low scores. Not every tool fits every persona. Coherence across personas matters: if you give "8 for developers" you should probably give a much lower score for "parents" unless the tool genuinely spans both audiences.

Respond with JSON only.`;

interface ToolRow {
  id: string;
  name: string | null;
  description: string | null;
  category: string | null;
  subcategory: string | null;
  metaDescription: string | null;
}

/**
 * Load the tool row's display fields. Throws when the row doesn't exist OR
 * isn't a tool (collection != 'tools') — both are programmer errors at the
 * callsite (the worker / backfill should pre-filter by collection).
 */
async function loadToolRow(toolId: string): Promise<ToolRow> {
  const rows = await db
    .select({
      id: articles.id,
      name: articles.title,
      description: articles.metaDescription,
      category: articles.category,
      subcategory: articles.subcategory,
      collection: articles.collection,
      metaDescription: articles.metaDescription,
    })
    .from(articles)
    .where(eq(articles.id, toolId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`scoreToolForPersonas: tool ${toolId} not found`);
  }
  if (row.collection !== "tools") {
    throw new Error(
      `scoreToolForPersonas: article ${toolId} has collection='${row.collection}', expected 'tools'`
    );
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    subcategory: row.subcategory,
    metaDescription: row.metaDescription,
  };
}

/**
 * Render the personas list + tool descriptor into the prompt user-message.
 *
 * @internal Exported only for unit testing.
 */
export function buildScoreToolUserMessage(
  tool: ToolRow,
  personas: readonly string[]
): string {
  const lines: string[] = [
    "Score this AI tool's relevance for each of the listed personas.",
    "",
    "## Tool",
    `- Name: ${tool.name ?? "(unnamed)"}`,
    `- Category: ${tool.category ?? "(unknown)"}${tool.subcategory ? ` / ${tool.subcategory}` : ""}`,
    `- Description: ${tool.description ?? "(no description)"}`,
    "",
    "## Personas",
  ];
  for (const persona of personas) {
    const def = PERSONA_DEFINITIONS[persona as keyof typeof PERSONA_DEFINITIONS] ?? persona;
    lines.push(`- ${persona}: ${def}`);
  }
  lines.push("");
  lines.push(
    'Respond with JSON: {"scores": [{"persona": "<one of the personas above>", "score": <0-10 integer>, "reasoning": "<one short sentence>"}, ...]}. Include every listed persona exactly once.'
  );
  return lines.join("\n");
}

/**
 * Score a single tool against the given personas (default = all
 * DEFAULT_PERSONAS) and upsert each result via `upsertPersonaScore`. Returns
 * a discriminated result the caller can fan-in for a batch summary.
 *
 * Failure posture: the function NEVER throws on adapter or schema-parse
 * failure — it logs + returns `source="failed"` / `source="skipped"` so the
 * batch can continue with the remaining tools.
 */
export async function scoreToolForPersonas(
  input: ScoreToolForPersonasInput
): Promise<ScoreToolResult> {
  const personas = input.personas ?? DEFAULT_PERSONAS;
  if (personas.length === 0) {
    return { toolId: input.toolId, written: [], source: "skipped" };
  }

  let tool: ToolRow;
  try {
    tool = await loadToolRow(input.toolId);
  } catch (err) {
    log.warn(
      {
        toolId: input.toolId,
        err: err instanceof Error ? err.message : String(err),
      },
      "scoreToolForPersonas: tool lookup failed"
    );
    return {
      toolId: input.toolId,
      written: [],
      source: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const userMessage = buildScoreToolUserMessage(tool, personas);

  let parsedScores: ScoreEntry[] = [];
  try {
    const result = await anthropic.messages({
      projectId: input.projectId,
      operation: COST_OPS.PERSONA_SCORE,
      model: "claude-haiku-4-5",
      systemPrefix: SYSTEM_PROMPT,
      systemSuffix: "",
      userMessage,
      maxTokens: 1500,
      jsonMode: true,
      estimatedCostEur: 0.01,
      ...(input.pipelineRunId !== undefined && { pipelineRunId: input.pipelineRunId }),
    });

    const parsed = PERSONA_SCORE_SCHEMA.safeParse(result.json);
    if (!parsed.success) {
      log.warn(
        {
          projectId: input.projectId,
          toolId: input.toolId,
          issues: parsed.error.issues,
        },
        "Persona-Scorer LLM output failed Zod parse — skipping tool"
      );
      return { toolId: input.toolId, written: [], source: "skipped" };
    }
    parsedScores = parsed.data.scores;
  } catch (err) {
    log.warn(
      {
        projectId: input.projectId,
        toolId: input.toolId,
        err: err instanceof Error ? err.message : String(err),
      },
      "Persona-Scorer LLM call threw — skipping tool"
    );
    return {
      toolId: input.toolId,
      written: [],
      source: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Defensive: drop any LLM-emitted persona slug that isn't in our requested
  // set. The schema-parse already validated shape; this filter handles
  // hallucinated persona names that wouldn't match a PK row anyway.
  const requestedSet = new Set(personas);
  const validScores = parsedScores.filter((s) => requestedSet.has(s.persona));

  if (validScores.length === 0) {
    log.warn(
      { toolId: input.toolId, personas: personas.length, emitted: parsedScores.length },
      "Persona-Scorer: LLM returned no valid persona matches"
    );
    return { toolId: input.toolId, written: [], source: "skipped" };
  }

  const written: string[] = [];
  for (const s of validScores) {
    try {
      await upsertPersonaScore({
        toolId: input.toolId,
        projectId: input.projectId,
        persona: s.persona,
        score: s.score,
        reasoning: s.reasoning,
      });
      written.push(s.persona);
    } catch (err) {
      log.warn(
        {
          projectId: input.projectId,
          toolId: input.toolId,
          persona: s.persona,
          err: err instanceof Error ? err.message : String(err),
        },
        "Persona-Scorer upsert failed for single persona — continuing batch"
      );
    }
  }

  return { toolId: input.toolId, written, source: "llm" };
}
