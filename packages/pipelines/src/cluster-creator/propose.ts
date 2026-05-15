import { createLogger } from "@marketing-auto/shared";
import { anthropic } from "@marketing-auto/adapter-anthropic";
import { db, clusters, projects, eq, type TopicBrief } from "@marketing-auto/db";
import { loadActiveConfig } from "../config/load-active-config.ts";
import { buildClusterProposalPrompt } from "./prompts.ts";
import { ClusterProposalSchema, type ClusterProposal } from "./types.ts";

const log = createLogger("cluster-creator:propose");

export type ProposeClusterInput = {
  projectId: string;
  brief: TopicBrief;
  pipelineRunId?: string;
};

export async function proposeCluster(input: ProposeClusterInput): Promise<ClusterProposal> {
  const { projectId, brief, pipelineRunId } = input;

  const [config, clusterRows, projectRow] = await Promise.all([
    loadActiveConfig(projectId),
    db
      .select({ name: clusters.name })
      .from(clusters)
      .where(eq(clusters.projectId, projectId)),
    db
      .select({ name: projects.name })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1),
  ]);

  const projectName = projectRow[0]?.name ?? projectId;
  const existingClusterNames = clusterRows.map((r) => r.name);

  log.info(
    { projectId, briefId: brief.id, existingCount: existingClusterNames.length },
    "proposing cluster for brief",
  );

  const { systemPrompt, userMessage } = buildClusterProposalPrompt({
    brief,
    projectName,
    topicScope: config.topicScope,
    intentTaxonomyDefault: config.intentTaxonomyDefault ?? null,
    existingClusterNames,
  });

  const result = await anthropic.messages({
    projectId,
    operation: "cluster-proposal",
    model: "claude-opus-4-7",
    systemPrefix: systemPrompt,
    systemSuffix: "",
    userMessage,
    maxTokens: 2000,
    jsonMode: true,
    estimatedCostEur: 0.25,
    ...(pipelineRunId !== undefined && { pipelineRunId }),
  });

  const parsed = ClusterProposalSchema.safeParse(result.json);
  if (!parsed.success) {
    log.error(
      { projectId, briefId: brief.id, issues: parsed.error.issues, raw: JSON.stringify(result.json).slice(0, 500) },
      "cluster proposal failed Zod validation",
    );
    throw new Error(`Cluster proposal validation failed: ${parsed.error.message}`);
  }

  const proposal = { ...parsed.data };

  // Validate spoke_intent is in the effective taxonomy
  const effectiveTaxonomy = proposal.intent_taxonomy_override ?? config.intentTaxonomyDefault;
  if (effectiveTaxonomy && !effectiveTaxonomy.includes(proposal.spoke_intent_for_originating_brief)) {
    log.warn(
      { spokeIntent: proposal.spoke_intent_for_originating_brief, effectiveTaxonomy },
      "spoke_intent not in effective taxonomy — using first available intent",
    );
    proposal.spoke_intent_for_originating_brief = effectiveTaxonomy[0]!;
  }

  log.info(
    { projectId, briefId: brief.id, clusterName: proposal.cluster_name },
    "cluster proposal generated",
  );

  return proposal;
}
