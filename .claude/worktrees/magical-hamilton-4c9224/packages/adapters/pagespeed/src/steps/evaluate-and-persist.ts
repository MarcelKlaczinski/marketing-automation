import { articles, db, pagespeedRuns } from "@marketing-auto/db";
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { CoreWebVitalsSchema, type PagespeedOutcome, PagespeedScoresSchema } from "../types.ts";

type EvaluateAndPersistInput = {
  articleId: string;
  projectId: string;
  /** Present for local mode (pre-created by trigger). Absent for API mode — triggers INSERT. */
  pagespeedRunId?: string;
  mode: "local" | "api";
  scores: z.infer<typeof PagespeedScoresSchema>;
  coreWebVitals: z.infer<typeof CoreWebVitalsSchema>;
  thresholds: z.infer<typeof PagespeedScoresSchema>;
  reportPath: string | null;
  testedUrl: string;
  astroCommitSha: string | null;
};

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  pagespeedRunId: z.string().uuid().optional(),
  mode: z.enum(["local", "api"]).default("local"),
  scores: PagespeedScoresSchema,
  coreWebVitals: CoreWebVitalsSchema,
  thresholds: PagespeedScoresSchema,
  reportPath: z.string().nullable(),
  testedUrl: z.string().url(),
  astroCommitSha: z.string().nullable(),
}) as z.ZodType<EvaluateAndPersistInput>;

const OutputSchema = z.object({
  outcome: z.enum(["pass", "fail"]),
  failedThresholds: z.array(z.string()),
  pagespeedRunId: z.string().uuid(),
});

export class EvaluateAndPersistStep extends BaseStep<
  EvaluateAndPersistInput,
  z.infer<typeof OutputSchema>
> {
  readonly name = "evaluate-and-persist";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number {
    return 0;
  }

  async execute(
    input: EvaluateAndPersistInput,
    ctx: StepContext
  ): Promise<z.infer<typeof OutputSchema>> {
    const failed: string[] = [];
    if (input.scores.performance < input.thresholds.performance) failed.push("performance");
    if (input.scores.accessibility < input.thresholds.accessibility) failed.push("accessibility");
    if (input.scores.bestPractices < input.thresholds.bestPractices) failed.push("bestPractices");
    if (input.scores.seo < input.thresholds.seo) failed.push("seo");

    const outcome: PagespeedOutcome = failed.length === 0 ? "pass" : "fail";
    const now = new Date();

    if (input.mode === "local") {
      // Local mode is the quality gate — transition article status based on outcome
      const newStatus = outcome === "pass" ? "published" : "blocked_by_pagespeed";
      await db
        .update(articles)
        .set({
          status: newStatus,
          pagespeedValidatedAt: now,
          pagespeedScores: input.scores,
          pagespeedCoreWebVitals: input.coreWebVitals,
          pagespeedFailedThresholds: failed.length > 0 ? failed : null,
          pagespeedReportUrl: input.reportPath,
          pagespeedAstroCommitSha: input.astroCommitSha,
          updatedAt: now,
        })
        .where(eq(articles.id, input.articleId));
    } else {
      // API mode is informational — update scores but leave article status unchanged
      await db
        .update(articles)
        .set({
          pagespeedValidatedAt: now,
          pagespeedScores: input.scores,
          pagespeedCoreWebVitals: input.coreWebVitals,
          pagespeedFailedThresholds: failed.length > 0 ? failed : null,
          updatedAt: now,
        })
        .where(eq(articles.id, input.articleId));
    }

    const runUpdate = {
      pipelineRunId: ctx.pipelineRunId,
      status: "succeeded" as const,
      mode: input.mode,
      outcome,
      scores: input.scores as Record<string, number>,
      coreWebVitals: input.coreWebVitals as Record<string, number>,
      thresholdsUsed: input.thresholds as Record<string, number>,
      failedCategories: failed.length > 0 ? failed : null,
      testedUrl: input.testedUrl,
      finishedAt: now,
      ...(input.reportPath !== null ? { reportPath: input.reportPath } : {}),
      ...(input.astroCommitSha !== null ? { astroCommitSha: input.astroCommitSha } : {}),
    };

    let resolvedRunId: string;

    if (input.pagespeedRunId) {
      // Local mode: UPDATE the pre-created 'pending' row so it never stays stuck
      await db
        .update(pagespeedRuns)
        .set(runUpdate)
        .where(and(eq(pagespeedRuns.id, input.pagespeedRunId), eq(pagespeedRuns.articleId, input.articleId)));
      resolvedRunId = input.pagespeedRunId;
    } else {
      // API mode: no pre-created row — INSERT a new one
      const [run] = await db
        .insert(pagespeedRuns)
        .values({ projectId: input.projectId, articleId: input.articleId, ...runUpdate })
        .returning();
      resolvedRunId = run!.id;
    }

    return {
      outcome,
      failedThresholds: failed,
      pagespeedRunId: resolvedRunId,
    };
  }
}
