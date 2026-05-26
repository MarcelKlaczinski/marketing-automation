/**
 * Spec 65.3 Part B — LLM-extract for tool-data refresh.
 *
 * Single Anthropic call with `webSearch.enabled = true` + structured JSON
 * output. The model fetches up to 3 web pages (we cap via `maxUses`) and
 * extracts pricing + features + a material-change judgment.
 *
 * Output is Zod-validated; on parse failure the function returns `null` and
 * the worker logs + skips. Material-change judgment is LLM-as-judge: we ask
 * "would these changes affect a comparison-article published last month?"
 * and the model answers with a boolean + reasoning.
 *
 * Cost: ~€0.05/call (Haiku + web-search 3 queries) per spec §4.3. Logged
 * via `COST_OPS.TOOL_DATA_REFRESH`.
 *
 * Per CLAUDE.md: web-search calls are NEVER cached (results go stale), and
 * `jsonMode: true` is safe with Haiku 4.5 (Sonnet 4.6 / Opus 4.7 reject
 * assistant prefill).
 */
import { anthropic } from "@marketing-auto/adapter-anthropic";
import { COST_OPS } from "@marketing-auto/core/cost";
import { createLogger } from "@marketing-auto/shared";
import { z } from "zod";

const log = createLogger("tool-data-refresh:extract");

/**
 * Strict Zod schema for the LLM-extracted tool-data snapshot. The shape is
 * intentionally narrow so the diff step has a stable contract — we don't
 * trust the LLM to emit arbitrary fields. `materialChangeJudgment` is the
 * LLM-as-judge boolean that drives the admin notification + persona-score
 * invalidation.
 */
export const TOOL_DATA_EXTRACT_SCHEMA = z.object({
  pricing: z.object({
    hasFreeTier: z.boolean(),
    /** Cheapest paid tier price in EUR (rounded). Null = pure free or pure enterprise-quote. */
    cheapestPaidEur: z.number().nullable(),
    /** Paid tier names extracted, max 5. Empty array = free-only or quote-only. */
    paidTierNames: z.array(z.string()).max(5),
    /** Billing model summary (free text, max 200 chars). */
    billingModel: z.string().max(200).nullable(),
  }),
  features: z.object({
    /** Public API available (programmatic access). Null = not stated. */
    apiAccess: z.boolean().nullable(),
    /** Self-hosting option offered. Null = not stated. */
    selfHosted: z.boolean().nullable(),
    /** Recent major features added. Free text, max 280 chars. */
    recentMajorFeatures: z.string().max(280).nullable(),
  }),
  materialChangeJudgment: z.object({
    /** True if these changes would affect a comparison-article published last month. */
    isMaterial: z.boolean(),
    /** One sentence explaining the judgment. */
    reasoning: z.string().min(1).max(280),
    /** One-line summary suitable for admin notification (e.g. "Pricing-tier 'Pro' added at €29"). */
    summary: z.string().max(200).nullable(),
  }),
  /** Up to 5 URLs the model cited (manually collected from the tool calls). */
  sources: z.array(z.string().url()).max(5),
});

export type ToolDataExtract = z.infer<typeof TOOL_DATA_EXTRACT_SCHEMA>;

const SYSTEM_PROMPT = `You are an analyst maintaining a directory of AI tools. You receive the current snapshot of a tool's pricing and features, then use web search to verify whether anything has changed materially since the last refresh. You answer with a strict JSON snapshot of the CURRENT state plus a material-change judgment.

Definitions:
- "Material change" = pricing-tier added/removed, free-tier status flipped, public API added/removed, self-hosting added/removed, or a major feature that would change which audience the tool fits.
- "Non-material" = marketing copy changes, brand refresh, minor UI improvements, ±5% price tweaks, blog/changelog noise.

Search rules:
- Search up to 3 times. Prefer the tool's own pricing or product page over third-party reviews.
- If the tool's pricing is in USD, convert to EUR using ~0.92 EUR/USD.
- Be conservative: if you cannot find clear evidence of a change, mark it non-material.

Respond with JSON only.`;

export interface ExtractToolDataInput {
  projectId: string;
  toolId: string;
  toolName: string;
  toolWebsite: string | null;
  /** Current snapshot the LLM compares against. */
  currentSnapshot: {
    priceFrom: number | null;
    pricing: string | null;
    /** ISO timestamp of the previous refresh, for the LLM to gauge "since when". */
    lastRefreshedAt: string | null;
  };
}

/**
 * Render the user message — keeps the LLM grounded with the current snapshot
 * so it can answer "what changed since N days ago?" rather than re-extract
 * from scratch.
 */
function buildUserMessage(input: ExtractToolDataInput): string {
  const lines: string[] = [
    `Tool: ${input.toolName}`,
    input.toolWebsite ? `Website: ${input.toolWebsite}` : "Website: (unknown)",
    "",
    "## Current snapshot",
    `- Price from: ${input.currentSnapshot.priceFrom !== null ? `€${input.currentSnapshot.priceFrom}` : "(unknown)"}`,
    `- Pricing notes: ${input.currentSnapshot.pricing ?? "(unknown)"}`,
    `- Last refreshed: ${input.currentSnapshot.lastRefreshedAt ?? "(never)"}`,
    "",
    "## Task",
    `Use web search to verify ${input.toolName}'s CURRENT pricing and features. Then judge whether any change is material per the rules above.`,
    "",
    "Respond with a single JSON object matching this shape:",
    "{",
    '  "pricing": { "hasFreeTier": boolean, "cheapestPaidEur": number|null, "paidTierNames": [string], "billingModel": string|null },',
    '  "features": { "apiAccess": boolean|null, "selfHosted": boolean|null, "recentMajorFeatures": string|null },',
    '  "materialChangeJudgment": { "isMaterial": boolean, "reasoning": string, "summary": string|null },',
    '  "sources": [string]',
    "}",
  ];
  return lines.join("\n");
}

/**
 * Run the LLM extraction. Returns `null` on adapter failure or schema-parse
 * failure — the caller logs + skips the tool.
 */
export async function extractToolData(
  input: ExtractToolDataInput
): Promise<ToolDataExtract | null> {
  const userMessage = buildUserMessage(input);

  try {
    const result = await anthropic.messages({
      projectId: input.projectId,
      operation: COST_OPS.TOOL_DATA_REFRESH,
      model: "claude-haiku-4-5",
      systemPrefix: SYSTEM_PROMPT,
      systemSuffix: "",
      userMessage,
      maxTokens: 1500,
      jsonMode: true,
      webSearch: {
        enabled: true,
        // Cap to 3 searches per spec §4.3 — keeps the cost predictable.
        maxUses: 3,
      },
      estimatedCostEur: 0.05,
    });

    const parsed = TOOL_DATA_EXTRACT_SCHEMA.safeParse(result.json);
    if (!parsed.success) {
      log.warn(
        {
          projectId: input.projectId,
          toolId: input.toolId,
          issues: parsed.error.issues,
        },
        "extractToolData: LLM output failed Zod parse — skipping tool"
      );
      return null;
    }
    return parsed.data;
  } catch (err) {
    log.warn(
      {
        projectId: input.projectId,
        toolId: input.toolId,
        err: err instanceof Error ? err.message : String(err),
      },
      "extractToolData: LLM call threw — skipping tool"
    );
    return null;
  }
}
