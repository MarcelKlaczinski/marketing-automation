import { anthropic } from "@marketing-auto/adapter-anthropic";
import { COST_OPS } from "@marketing-auto/core";
import { createLogger } from "@marketing-auto/shared";
import { buildClusterPlanPrompt } from "./prompts.ts";
import { ClusterPlanOutputSchema, type ClusterPlanInput, type ClusterPlanOutput } from "./types.ts";

const log = createLogger("pipelines:cluster-full-plan");

export async function generateClusterPlan(
  input: ClusterPlanInput,
  opts?: { pipelineRunId?: string; refinementHint?: string },
): Promise<ClusterPlanOutput> {
  const { systemPrompt, userMessage } = buildClusterPlanPrompt(
    input,
    opts?.refinementHint !== undefined ? { refinementHint: opts.refinementHint } : undefined,
  );

  log.info(
    {
      projectId: input.projectId,
      briefId: input.triggerBrief.id,
      pillarCount: input.existingPillars.length,
      clusterCount: input.existingClusters.length,
    },
    "generating cluster plan",
  );

  // Sonnet 4.6 rejects assistant-message prefill — omit jsonMode and extract JSON manually.
  const result = await anthropic.messages({
    projectId: input.projectId,
    operation: COST_OPS.CLUSTER_PLAN_GENERATION,
    model: "claude-sonnet-4-6",
    systemPrefix: systemPrompt,
    systemSuffix:
      "Respond with only a valid JSON object. No markdown fences, no prose preamble.",
    userMessage,
    maxTokens: 3000,
    estimatedCostEur: 0.40,
    ...(opts?.pipelineRunId !== undefined && { pipelineRunId: opts.pipelineRunId }),
  });

  const startIdx = result.raw.indexOf("{");
  const endIdx = result.raw.lastIndexOf("}");
  let parsedJson: unknown;
  try {
    if (startIdx < 0 || endIdx <= startIdx) {
      throw new SyntaxError("no JSON object braces in cluster-plan response");
    }
    parsedJson = JSON.parse(result.raw.slice(startIdx, endIdx + 1));
  } catch (err) {
    log.error(
      {
        projectId: input.projectId,
        briefId: input.triggerBrief.id,
        err: err instanceof Error ? err.message : String(err),
        rawPrefix: result.raw.slice(0, 400),
      },
      "cluster plan JSON parse failed",
    );
    throw new Error(
      `Cluster plan JSON parse failed: ${err instanceof Error ? err.message : "unknown"}`,
    );
  }

  const parsed = ClusterPlanOutputSchema.safeParse(parsedJson);

  if (!parsed.success) {
    log.error(
      {
        projectId: input.projectId,
        briefId: input.triggerBrief.id,
        issues: parsed.error.issues,
        raw: JSON.stringify(parsedJson).slice(0, 800),
      },
      "cluster plan failed Zod validation",
    );
    throw new Error(`Cluster plan validation failed: ${parsed.error.message}`);
  }

  const plan = parsed.data;

  // Validate pillarId: must be "new" or one of the existing pillar UUIDs
  const validPillarIds = new Set(input.existingPillars.map((p) => p.id));
  if (plan.pillarId !== "new" && !validPillarIds.has(plan.pillarId)) {
    log.warn(
      { pillarId: plan.pillarId, validIds: [...validPillarIds] },
      "LLM returned unknown pillarId — defaulting to 'new'",
    );
    return { ...plan, pillarId: "new", pillarSuggestedName: plan.pillarSuggestedName ?? plan.cluster.name };
  }

  // Validate pillarSuggestedName is present when pillarId === "new"
  if (plan.pillarId === "new" && !plan.pillarSuggestedName) {
    return { ...plan, pillarSuggestedName: plan.cluster.name };
  }

  log.info(
    {
      projectId: input.projectId,
      briefId: input.triggerBrief.id,
      clusterName: plan.cluster.name,
      spokeCount: plan.spokes.length,
      pillarId: plan.pillarId,
    },
    "cluster plan generated",
  );

  return plan;
}
