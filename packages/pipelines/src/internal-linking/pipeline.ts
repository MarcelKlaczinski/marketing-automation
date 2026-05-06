import { z } from "zod";
import { eq, and, inArray, sum, gte } from "drizzle-orm";
import { Pipeline } from "../engine/pipeline.ts";
import { runPipeline } from "../engine/runner.ts";
import { ArticleLinkUpdatePipeline } from "./article-pipeline.ts";
import { db, articles, projects, linkRebuildRuns } from "@marketing-auto/db";
import { InternalLinkingError } from "./types.ts";
import { BaseStep, type StepContext } from "../engine/step.ts";
import { createLogger } from "@marketing-auto/shared";

const PUBLISHED_STATUSES: Array<"published" | "ready_to_publish"> = ["published", "ready_to_publish"];

const log = createLogger("internal-linking:cluster");

const ClusterRebuildInputSchema = z.object({
  clusterId: z.string().uuid(),
  projectId: z.string().uuid(),
  triggeringArticleId: z.string().uuid().nullable(),
  triggerType: z.enum(["auto_after_sync", "manual_cli", "manual_http"]),
  linkRebuildRunId: z.string().uuid().optional(),
});

const ClusterRebuildOutputSchema = z.object({
  clusterId: z.string().uuid(),
  articlesProcessed: z.number(),
  articlesModified: z.number(),
  totalLinksAdded: z.number(),
  totalCostEur: z.number(),
});

class OrchestrateClusterRebuildStep extends BaseStep<
  z.infer<typeof ClusterRebuildInputSchema>,
  z.infer<typeof ClusterRebuildOutputSchema>
> {
  readonly name = "orchestrate-cluster-rebuild";
  readonly inputSchema = ClusterRebuildInputSchema;
  readonly outputSchema = ClusterRebuildOutputSchema;

  override estimatedCostEur(): number {
    return 8 * 0.30;
  }

  async execute(input: z.infer<typeof ClusterRebuildInputSchema>, _ctx: StepContext) {
    await this.checkBudget(input.projectId);

    const clusterArticles = await db
      .select({
        id: articles.id,
        slug: articles.slug,
        title: articles.title,
      })
      .from(articles)
      .where(and(
        eq(articles.clusterId, input.clusterId),
        inArray(articles.status, PUBLISHED_STATUSES),
      ));

    if (clusterArticles.length === 0) {
      log.info({ clusterId: input.clusterId }, "Cluster has no published articles, nothing to do");
      return { clusterId: input.clusterId, articlesProcessed: 0, articlesModified: 0, totalLinksAdded: 0, totalCostEur: 0 };
    }
    if (clusterArticles.length === 1) {
      log.info({ clusterId: input.clusterId }, "Cluster has only 1 article, no candidates for linking");
      return { clusterId: input.clusterId, articlesProcessed: 1, articlesModified: 0, totalLinksAdded: 0, totalCostEur: 0 };
    }

    let articlesModified = 0;
    let totalLinksAdded = 0;
    let totalCostEur = 0;

    for (const article of clusterArticles) {
      try {
        const result = await runPipeline(
          new ArticleLinkUpdatePipeline(),
          {
            articleId: article.id,
            clusterId: input.clusterId,
            projectId: input.projectId,
            triggerResync: true,
          },
          { projectId: input.projectId },
        );

        if (!result.ok) {
          log.error({ articleId: article.id, error: result.error }, "Per-article link update failed; continuing");
          continue;
        }

        if (result.output.linksAdded > 0) {
          articlesModified++;
          totalLinksAdded += result.output.linksAdded;
        }
        totalCostEur += 0.30;

        log.info({
          articleId: article.id,
          linksAdded: result.output.linksAdded,
        }, "Per-article link update done");
      } catch (e) {
        log.error({ articleId: article.id, error: e }, "Per-article link update crashed; continuing");
      }
    }

    return {
      clusterId: input.clusterId,
      articlesProcessed: clusterArticles.length,
      articlesModified,
      totalLinksAdded,
      totalCostEur,
    };
  }

  private async checkBudget(projectId: string): Promise<void> {
    const [proj] = await db.select({ cap: projects.linkRebuildBudgetMonthly })
      .from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!proj) throw new InternalLinkingError("Project not found", "budget");

    const cap = parseFloat(proj.cap ?? "30.00");

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [usage] = await db
      .select({ total: sum(linkRebuildRuns.totalCostEur) })
      .from(linkRebuildRuns)
      .where(and(
        eq(linkRebuildRuns.projectId, projectId),
        gte(linkRebuildRuns.startedAt, monthStart),
      ));

    const used = parseFloat(String(usage?.total ?? "0"));
    if (used >= cap) {
      throw new InternalLinkingError(
        `Monthly link-rebuild budget exceeded: €${used.toFixed(2)} / €${cap.toFixed(2)}. ` +
        `Increase via projects.linkRebuildBudgetMonthly or wait until next month.`,
        "budget",
      );
    }
  }
}

export class ClusterLinkRebuildPipeline extends Pipeline<
  z.infer<typeof ClusterRebuildInputSchema>,
  z.infer<typeof ClusterRebuildOutputSchema>
> {
  readonly name = "cluster:link-rebuild";
  readonly inputSchema = ClusterRebuildInputSchema;
  readonly outputSchema = ClusterRebuildOutputSchema;
  readonly steps = [new OrchestrateClusterRebuildStep()] as const;

  override async afterComplete(
    output: z.infer<typeof ClusterRebuildOutputSchema>,
    input: z.infer<typeof ClusterRebuildInputSchema>,
  ): Promise<void> {
    if (!input.linkRebuildRunId) return;
    await db.update(linkRebuildRuns).set({
      status: "succeeded",
      articlesProcessed: output.articlesProcessed,
      articlesModified: output.articlesModified,
      totalLinksAdded: output.totalLinksAdded,
      totalCostEur: output.totalCostEur.toFixed(4),
      finishedAt: new Date(),
    }).where(eq(linkRebuildRuns.id, input.linkRebuildRunId));
    log.info({ linkRebuildRunId: input.linkRebuildRunId }, "link_rebuild_runs row settled: succeeded");
  }

  override async afterError(
    error: unknown,
    input: z.infer<typeof ClusterRebuildInputSchema>,
  ): Promise<void> {
    if (!input.linkRebuildRunId) return;
    const isBudgetError = error instanceof InternalLinkingError && error.stage === "budget";
    const status = isBudgetError ? ("budget_exceeded" as const) : ("failed" as const);
    await db.update(linkRebuildRuns).set({
      status,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStage: error instanceof InternalLinkingError ? error.stage : null,
      finishedAt: new Date(),
    }).where(eq(linkRebuildRuns.id, input.linkRebuildRunId));
    log.info({ linkRebuildRunId: input.linkRebuildRunId, status }, "link_rebuild_runs row settled: failed");
  }
}
