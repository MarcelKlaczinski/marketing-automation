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
import type { ArticleCollectionType } from "@marketing-auto/shared";

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
 * Spec 63.7b: map a brief's `intent_type` to the Astro collection used for
 * append_to_existing spoke generation. Missing/unknown intent defaults to
 * `"blog"` — safe because `article:blog` is the spoke pipeline's natural
 * collection and the LLM picks tutorial/general structure from the brief.
 *
 * Intent rationale:
 *   - 'knowledge'           → 'ki-wissen' (theme-centric editorial content)
 *   - 'use_case' / 'usecase' → 'usecases' (use-case-driven content)
 *   - everything else       → 'blog' (default tool-spoke article)
 *
 * Note: comparison briefs route through `case "comparison":` upstream, so
 * `'comparison'` is not a value this branch sees.
 */
function deriveCollectionFromIntent(intentType: string | null): ArticleCollectionType {
  switch (intentType) {
    case "knowledge":
      return "ki-wissen";
    case "use_case":
    case "usecase":
      return "usecases";
    default:
      return "blog";
  }
}

/**
 * Decide how `executePlan()` should dispatch one planned_items row.
 *
 * Spec deviation: §2.3 routing table calls cluster's pipeline
 * `ClusterGenerationPipeline { briefId, projectId, llmMode }`. No such
 * pipeline is registered — `cluster:full-plan` is currently an HTTP-only free
 * function (Memory D127). We route cluster items to the inline path. `llmMode`
 * is still threaded through for non-cluster pipelines that honour it.
 *
 * Spec 63.7b: cluster items used to branch on `pipelineInput.clusterAction` —
 * `append_to_existing` routed to `article:blog` (spoke), `create_new` stayed on
 * the inline `cluster:full-plan` path.
 *
 * Spec 64.1: the append_to_existing branch now has its own content_type bucket
 * (`cluster_spoke`) so Plan-Goals can target spokes vs new clusters separately.
 * The `cluster` case keeps the inline-`cluster:full-plan` predicate plus a
 * defensive append→article:blog fallthrough for legacy planned_items that
 * were persisted before 64.1's matchBriefToContentType change shipped.
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

      // Legacy backstop: 64.1 routes append_to_existing into the `cluster_spoke`
      // case below. Pre-64.1 plans persist `cluster` for these — keep the
      // article:blog fallthrough so replays still execute correctly.
      const clusterAction =
        typeof pipelineInput.clusterAction === "string" ? pipelineInput.clusterAction : null;
      const clusterId =
        typeof pipelineInput.clusterId === "string" ? pipelineInput.clusterId : null;
      const intentType =
        typeof pipelineInput.intentType === "string" ? pipelineInput.intentType : null;

      if (clusterAction === "append_to_existing" && clusterId !== null) {
        return {
          kind: "enqueue",
          pipelineName: "article:blog",
          jobData: {
            briefId,
            projectId: pipelineInput.projectId,
            collectionType: deriveCollectionFromIntent(intentType),
            llmMode,
            plannedItemId: item.id,
          },
        };
      }

      return { kind: "inline", action: "cluster:full-plan", briefId };
    }

    case "cluster_spoke": {
      // Spec 64.1: single spoke under an existing cluster. matchBriefToContentType
      // guarantees clusterId is set (orphan append_to_existing falls back to
      // the `cluster` bucket), but we re-check here so a hand-crafted
      // planned_items row can't crash the router.
      const briefId = typeof pipelineInput.briefId === "string" ? pipelineInput.briefId : null;
      if (briefId === null) {
        throw new Error(
          `planned_item ${item.id} is content_type='cluster_spoke' but pipelineInput.briefId is missing`,
        );
      }
      const intentType =
        typeof pipelineInput.intentType === "string" ? pipelineInput.intentType : null;
      return {
        kind: "enqueue",
        pipelineName: "article:blog",
        jobData: {
          briefId,
          projectId: pipelineInput.projectId,
          collectionType: deriveCollectionFromIntent(intentType),
          llmMode,
          plannedItemId: item.id,
        },
      };
    }

    case "comparison": {
      // Spec 63.7b: must match the `ArticleCollectionType` enum value
      // ("comparison" singular), NOT the Astro folder name ("comparisons").
      // `BlogPipelineInputSchema` validates against the enum, so the
      // `satisfies` here turns a future typo into a compile error instead of
      // a runtime Zod rejection deep inside the worker.
      const collectionType: ArticleCollectionType = "comparison";
      return {
        kind: "enqueue",
        pipelineName: "article:blog",
        jobData: {
          ...pipelineInput,
          collectionType,
          llmMode,
          plannedItemId: item.id,
        },
      };
    }

    case "ki_wissen": {
      const collectionType: ArticleCollectionType = "ki-wissen";
      return {
        kind: "enqueue",
        pipelineName: "article:blog",
        jobData: {
          ...pipelineInput,
          collectionType,
          llmMode,
          plannedItemId: item.id,
        },
      };
    }

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
