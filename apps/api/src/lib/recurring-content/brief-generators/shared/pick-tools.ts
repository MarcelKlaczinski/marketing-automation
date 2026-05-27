/**
 * Spec 65.5 — LLM-curated + manual-override tool selection.
 *
 * Marcel-Decision: adaptive. The brief-generator picks tools via one of two
 * paths:
 *
 *   - **manual** — `format_config.manualToolIds` is set → use as-is (first
 *     `topN` after dedup).
 *   - **LLM-curated** — load a candidate pool (category-filtered or pre-seeded
 *     `articles WHERE collection='tools'`), rank by (stars/votes desc,
 *     freshness desc) and optionally fold persona-fit when `formatConfig.persona`
 *     is set. The LLM picks the final N from the oversampled pool.
 *
 * Stars/votes are stand-ins for "popularity proxy" — Toolwiki's tool articles
 * store community vote counts in `articles.tool_votes` (Spec 54.8 promoted
 * column). Newer tools (`articles.last_refreshed_at`) bubble up as a freshness
 * boost so a static top-5 doesn't lock in the same tools forever.
 */
import { anthropic } from "@marketing-auto/adapter-anthropic";
import { COST_OPS } from "@marketing-auto/core/cost";
import {
  type Article,
  articles,
  and,
  db,
  desc,
  eq,
  inArray,
  isNotNull,
  not,
  sql,
  toolBrandAssets,
} from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { z } from "zod";
import { pickPersonaScoredTools } from "../../../persona-scoring/pick-persona-scored-tools.ts";

const log = createLogger("recurring-content:pick-tools");

/** Oversample multiplier for LLM-curate — pool size ≈ topN × OVERSAMPLE. */
const OVERSAMPLE = 4;

const LLM_CURATE_SCHEMA = z.object({
  pickedToolIds: z.array(z.string().uuid()).min(1),
  reasoning: z.string().min(1).max(500),
});

export interface PickToolsInput {
  projectId: string;
  formatType: string;
  /** Project tools' locale — drives which `articles` row we pick from (per-locale article rows since Spec 59.2). */
  locale: "de" | "en";
  config: {
    topN?: number;
    /** When set, bypass the LLM and use these IDs (first topN). */
    manualToolIds?: string[];
    /** Restrict candidate pool to one tool-category (e.g. "ai-image-generation"). */
    categorySlug?: string;
    /** Optional persona slug — when set, fold persona-fit into the rank (Marcel-Decision V1). */
    persona?: string;
    /** When true, skip tool IDs that ran in the most recent run of this definition. */
    excludeRecentlyUsed?: boolean;
  };
  /** IDs from the definition's most recent run — fed in by the worker. */
  previousRunToolIds?: string[];
  /** Propagated to Anthropic for cost-attribution. */
  pipelineRunId?: string;
}

export interface PickToolsResult {
  toolIds: string[];
  /** "manual" | "llm-curated" | "stars-only" (fallback when LLM rejects). */
  pickedVia: "manual" | "llm-curated" | "stars-only";
  /** Free-text reasoning surfaced by the LLM (or sentinel for fallback paths). */
  reasoning: string;
}

/**
 * Load the candidate tool pool. Filters: `collection='tools'`, `locale`,
 * optionally `category`, AND **pre-filters to tools that have a brand-asset
 * row with a non-null `logo_url`** via inner-join against `tool_brand_assets`.
 *
 * The pre-filter (Spec 65.5-followup, 2026-05-27) closes a real V1-launch
 * gap: prior behaviour let `pickToolsForBrief` LLM-curate across all
 * category+locale tools regardless of logo coverage. Toolwiki has ~35% of
 * tools on `deterministic-avatar` source (no logo file) and the LLM
 * consistently picked at least one of them, which `ensureBrandAssetsAvailable`
 * then rejected — skipping the entire fire. Pre-filtering keeps the LLM
 * inside the "renderable" subset; the post-check stays as defence-in-depth
 * for the race where a brand-asset row is deleted between pick + render.
 *
 * Manual-override path stays unfiltered (Marcel-controlled — if he sets
 * `manualToolIds` explicitly he gets what he asked for, and the post-check
 * still gates render time).
 *
 * Excludes `previousRunToolIds` when `excludeRecentlyUsed` is on. Orders by
 * (toolRating desc, toolVotes desc, lastRefreshedAt desc) so the LLM sees
 * the strongest candidates first.
 */
async function loadCandidatePool(input: {
  projectId: string;
  locale: "de" | "en";
  categorySlug?: string;
  excludeIds?: string[];
  limit: number;
}): Promise<Article[]> {
  const conditions = [
    eq(articles.projectId, input.projectId),
    eq(articles.collection, "tools"),
    eq(articles.locale, input.locale),
    eq(articles.status, "published"),
    // Spec 65.5-followup brand-asset pre-filter: only consider tools with a
    // non-null `logo_url`. EXISTS keeps the return shape as `Article[]` so we
    // don't need a projection cast. PostgreSQL plans EXISTS as a semi-join,
    // performance is identical to INNER JOIN.
    sql`EXISTS (SELECT 1 FROM ${toolBrandAssets} tba WHERE tba.tool_id = ${articles.id} AND tba.logo_url IS NOT NULL)`,
  ];
  if (input.categorySlug) {
    conditions.push(eq(articles.category, input.categorySlug));
  }
  if (input.excludeIds && input.excludeIds.length > 0) {
    conditions.push(not(inArray(articles.id, input.excludeIds)));
  }
  return await db
    .select()
    .from(articles)
    .where(and(...conditions))
    .orderBy(
      desc(articles.toolRating),
      desc(articles.toolVotes),
      // lastRefreshedAt NULLS LAST is fine here — fresh > stale > never-refreshed
      sql`${articles.lastRefreshedAt} DESC NULLS LAST`,
    )
    .limit(input.limit);
}

/** Format a tool for the LLM prompt — one line per candidate. */
function formatToolLine(tool: Article): string {
  const meta: string[] = [];
  meta.push(`id=${tool.id}`);
  if (tool.toolRating) meta.push(`rating=${tool.toolRating}`);
  if (tool.toolVotes !== null) meta.push(`votes=${tool.toolVotes}`);
  if (tool.subcategory) meta.push(`subcat=${tool.subcategory}`);
  if (tool.toolPricing) meta.push(`pricing=${tool.toolPricing}`);
  return `- ${tool.title ?? tool.slug} (${meta.join(", ")})`;
}

const SYSTEM_PROMPT = `You are a marketing curator picking the strongest tools for a recurring social-media post. You receive a list of candidate tools (each with a UUID, rating, vote count, and category) and must pick exactly N by UUID. Prioritise popular, well-rated, and diverse tools — avoid picking 4 tools from the same vendor family. Respond with JSON only.`;

function buildUserMessage(input: {
  candidates: Article[];
  topN: number;
  formatType: string;
  persona: string | null;
  categorySlug: string | null;
}): string {
  const lines: string[] = [];
  lines.push(`Pick the top ${input.topN} tools for a "${input.formatType}" recurring post.`);
  lines.push("");
  if (input.persona) {
    lines.push(`## Target persona: ${input.persona}`);
    lines.push("");
  }
  if (input.categorySlug) {
    lines.push(`## Category: ${input.categorySlug}`);
    lines.push("");
  }
  lines.push("## Candidate tools");
  for (const tool of input.candidates) {
    lines.push(formatToolLine(tool));
  }
  lines.push("");
  lines.push("## Selection rules");
  lines.push(`1. Pick exactly ${input.topN} tool UUIDs from the candidates above.`);
  lines.push("2. Bias toward rating + votes, but inject 1-2 less-obvious picks for diversity.");
  lines.push("3. Avoid picking 2 tools that share the same parent vendor (Anthropic, OpenAI, Google).");
  lines.push("");
  lines.push(
    `Respond with JSON: {"pickedToolIds": ["<uuid>", ...], "reasoning": "<one short sentence>"}`,
  );
  return lines.join("\n");
}

/**
 * Adjust the order of `candidates` by persona-fit when a persona is set.
 * Tools with no fresh score fall through to their original order (helper
 * returns persona-scored rows; we re-rank only the subset that has a score).
 */
async function applyPersonaFit(input: {
  projectId: string;
  candidates: Article[];
  persona: string;
  pipelineRunId?: string;
}): Promise<Article[]> {
  const ids = input.candidates.map((c) => c.id);
  const { scoredTools } = await pickPersonaScoredTools({
    projectId: input.projectId,
    persona: input.persona,
    toolIds: ids,
    minScore: 0, // we want the full ranked list, not a filtered subset
    ...(input.pipelineRunId !== undefined && { pipelineRunId: input.pipelineRunId }),
  });
  const scoreById = new Map(scoredTools.map((s) => [s.toolId, s.score] as const));
  // Sort: scored tools by score desc first, unscored tools (no fresh entry) at
  // the end in their original popularity order.
  return [...input.candidates].sort((a, b) => {
    const sa = scoreById.get(a.id);
    const sb = scoreById.get(b.id);
    if (sa !== undefined && sb !== undefined) return sb - sa;
    if (sa !== undefined) return -1;
    if (sb !== undefined) return 1;
    return 0;
  });
}

export async function pickToolsForBrief(input: PickToolsInput): Promise<PickToolsResult> {
  const topN = input.config.topN ?? 5;

  // ── Manual override path ───────────────────────────────────────────────
  if (input.config.manualToolIds && input.config.manualToolIds.length > 0) {
    // Dedup while preserving order, then truncate to topN.
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const id of input.config.manualToolIds) {
      if (!seen.has(id)) {
        seen.add(id);
        ordered.push(id);
      }
    }
    // Verify the IDs exist + match the project + are tool articles before we
    // hand them off — defensive against stale definitions.
    const verified = await db
      .select({ id: articles.id })
      .from(articles)
      .where(
        and(
          eq(articles.projectId, input.projectId),
          eq(articles.collection, "tools"),
          inArray(articles.id, ordered),
          isNotNull(articles.title),
        ),
      );
    const validIds = new Set(verified.map((v) => v.id));
    const finalIds = ordered.filter((id) => validIds.has(id)).slice(0, topN);
    return {
      toolIds: finalIds,
      pickedVia: "manual",
      reasoning: "Marcel-defined manualToolIds (Spec 65.5 §4.1 override path).",
    };
  }

  // ── LLM-curated path ────────────────────────────────────────────────────
  const poolLimit = Math.max(topN * OVERSAMPLE, topN + 4);
  const excludeIds = input.config.excludeRecentlyUsed ? input.previousRunToolIds ?? [] : [];
  const poolFilter: {
    projectId: string;
    locale: "de" | "en";
    categorySlug?: string;
    excludeIds?: string[];
    limit: number;
  } = {
    projectId: input.projectId,
    locale: input.locale,
    limit: poolLimit,
  };
  if (input.config.categorySlug) poolFilter.categorySlug = input.config.categorySlug;
  if (excludeIds.length > 0) poolFilter.excludeIds = excludeIds;
  let pool = await loadCandidatePool(poolFilter);

  if (pool.length < topN) {
    log.warn(
      {
        projectId: input.projectId,
        formatType: input.formatType,
        poolSize: pool.length,
        topN,
        categorySlug: input.config.categorySlug,
      },
      "pickToolsForBrief: pool smaller than topN — returning what we have",
    );
    return {
      toolIds: pool.map((t) => t.id),
      pickedVia: "stars-only",
      reasoning: "Pool was thin; returned the full candidate set without LLM curation.",
    };
  }

  // Persona-fit reorder when a persona is configured (Marcel-decision V1).
  if (input.config.persona) {
    pool = await applyPersonaFit({
      projectId: input.projectId,
      candidates: pool,
      persona: input.config.persona,
      ...(input.pipelineRunId !== undefined && { pipelineRunId: input.pipelineRunId }),
    });
  }

  const userMessage = buildUserMessage({
    candidates: pool,
    topN,
    formatType: input.formatType,
    persona: input.config.persona ?? null,
    categorySlug: input.config.categorySlug ?? null,
  });

  let pickedToolIds: string[] | null = null;
  let reasoning: string | null = null;
  try {
    const result = await anthropic.messages({
      projectId: input.projectId,
      operation: COST_OPS.RECURRING_TOOLS_CURATE,
      model: "claude-haiku-4-5",
      systemPrefix: SYSTEM_PROMPT,
      systemSuffix: "",
      userMessage,
      maxTokens: 400,
      jsonMode: true,
      estimatedCostEur: 0.005,
      ...(input.pipelineRunId !== undefined && { pipelineRunId: input.pipelineRunId }),
    });
    const parsed = LLM_CURATE_SCHEMA.safeParse(result.json);
    if (parsed.success) {
      pickedToolIds = parsed.data.pickedToolIds;
      reasoning = parsed.data.reasoning;
    } else {
      log.warn(
        { projectId: input.projectId, issues: parsed.error.issues },
        "tools-curate LLM output failed Zod parse — using stars-only fallback",
      );
    }
  } catch (err) {
    log.warn(
      {
        projectId: input.projectId,
        formatType: input.formatType,
        err: err instanceof Error ? err.message : String(err),
      },
      "tools-curate LLM call threw — using stars-only fallback",
    );
  }

  if (pickedToolIds === null) {
    return {
      toolIds: pool.slice(0, topN).map((t) => t.id),
      pickedVia: "stars-only",
      reasoning: "Fallback: LLM call failed or hallucinated; used pool head ordered by rating + votes.",
    };
  }

  // Filter LLM output against the candidate pool (defensive — drops
  // hallucinated UUIDs). Preserve LLM order for downstream `ResolvedTool[]`.
  const poolIds = new Set(pool.map((t) => t.id));
  const validIds = pickedToolIds.filter((id) => poolIds.has(id)).slice(0, topN);
  if (validIds.length < topN) {
    // Top-up from the head of the pool (skipping IDs the LLM already picked).
    const already = new Set(validIds);
    for (const tool of pool) {
      if (validIds.length >= topN) break;
      if (!already.has(tool.id)) {
        validIds.push(tool.id);
        already.add(tool.id);
      }
    }
  }
  return {
    toolIds: validIds,
    pickedVia: "llm-curated",
    reasoning: reasoning ?? "(no reasoning returned)",
  };
}
