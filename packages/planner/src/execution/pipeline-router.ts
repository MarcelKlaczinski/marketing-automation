// Spec 62.8: pure routing function — maps a planned_items row to the dispatch
// the plan-execution worker should perform.
//
// Two dispatch kinds:
//   - `enqueue`: a BullMQ-backed registered pipeline (article:blog,
//     article:social-image). The worker calls `triggerWithPreRunId` and lets
//     the pipeline's `afterComplete`/`afterError` hooks finalize the
//     planned_item status.
//   - `inline`: a free-function path (`cluster:full-plan`). The worker awaits
//     the call inline and finalizes the planned_item status itself. Memory
//     D127 documents why cluster:full-plan stays a free function for now.
//
// The router has zero side effects — the worker owns DB writes and BullMQ
// enqueues. Keeping it pure means tests can verify routing decisions without
// stubbing Redis or the DB.

import type { PlannedItem } from "@marketing-auto/db";

export type LlmMode = "sync" | "batch";

export type RoutedJob =
  | {
      kind: "enqueue";
      pipelineName: "article:blog" | "article:social-image";
      /** Forwarded to the per-pipeline enqueue wrapper. */
      jobData: Record<string, unknown>;
    }
  | {
      kind: "inline";
      action: "cluster:full-plan";
      briefId: string;
    };

/**
 * Decide how `executePlan()` should dispatch one planned_items row.
 *
 * Spec deviation: §2.3 routing table calls cluster's pipeline
 * `ClusterGenerationPipeline { briefId, projectId, llmMode }`. No such
 * pipeline is registered — `cluster:full-plan` is currently an HTTP-only free
 * function (Memory D127). We route cluster items to the inline path. `llmMode`
 * is still threaded through for non-cluster pipelines that honour it.
 */
export function getPipelineForItem(
  item: Pick<PlannedItem, "id" | "contentType" | "pipelineInput">,
  llmMode: LlmMode,
): RoutedJob {
  const pipelineInput = (item.pipelineInput ?? {}) as Record<string, unknown>;

  switch (item.contentType) {
    case "cluster": {
      const briefId = typeof pipelineInput.briefId === "string" ? pipelineInput.briefId : null;
      if (briefId === null) {
        throw new Error(
          `planned_item ${item.id} is content_type='cluster' but pipelineInput.briefId is missing`,
        );
      }
      return { kind: "inline", action: "cluster:full-plan", briefId };
    }

    case "comparison":
      return {
        kind: "enqueue",
        pipelineName: "article:blog",
        jobData: {
          ...pipelineInput,
          collectionType: "comparisons",
          llmMode,
          plannedItemId: item.id,
        },
      };

    case "ki_wissen":
      return {
        kind: "enqueue",
        pipelineName: "article:blog",
        jobData: {
          ...pipelineInput,
          collectionType: "ki-wissen",
          llmMode,
          plannedItemId: item.id,
        },
      };

    case "social_post":
      return {
        kind: "enqueue",
        pipelineName: "article:social-image",
        jobData: {
          ...pipelineInput,
          llmMode,
          plannedItemId: item.id,
        },
      };

    default:
      throw new Error(`Unknown content_type for planned_item ${item.id}: ${item.contentType}`);
  }
}
