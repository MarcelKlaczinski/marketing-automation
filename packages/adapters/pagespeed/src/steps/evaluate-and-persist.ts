import { z } from "zod";
import { eq } from "drizzle-orm";
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { db, articles, pagespeedRuns } from "@marketing-auto/db";
import {
  PagespeedScoresSchema,
  CoreWebVitalsSchema,
  type PagespeedOutcome,
} from "../types.ts";

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  scores: PagespeedScoresSchema,
  coreWebVitals: CoreWebVitalsSchema,
  thresholds: PagespeedScoresSchema,
  reportPath: z.string(),
  testedUrl: z.string().url(),
  astroCommitSha: z.string(),
});

const OutputSchema = z.object({
  outcome: z.enum(["pass", "fail"]),
  failedThresholds: z.array(z.string()),
  pagespeedRunId: z.string().uuid(),
});

export class EvaluateAndPersistStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "evaluate-and-persist";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0; }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext): Promise<z.infer<typeof OutputSchema>> {
    const failed: string[] = [];
    if (input.scores.performance < input.thresholds.performance) failed.push("performance");
    if (input.scores.accessibility < input.thresholds.accessibility) failed.push("accessibility");
    if (input.scores.bestPractices < input.thresholds.bestPractices) failed.push("bestPractices");
    if (input.scores.seo < input.thresholds.seo) failed.push("seo");

    const outcome: PagespeedOutcome = failed.length === 0 ? "pass" : "fail";
    const newStatus = outcome === "pass" ? "published" : "blocked_by_pagespeed";
    const now = new Date();

    await db.update(articles).set({
      status: newStatus,
      pagespeedValidatedAt: now,
      pagespeedScores: input.scores,
      pagespeedCoreWebVitals: input.coreWebVitals,
      pagespeedFailedThresholds: failed.length > 0 ? failed : null,
      pagespeedReportUrl: input.reportPath,
      pagespeedAstroCommitSha: input.astroCommitSha,
      updatedAt: now,
    }).where(eq(articles.id, input.articleId));

    const [run] = await db.insert(pagespeedRuns).values({
      projectId: input.projectId,
      articleId: input.articleId,
      pipelineRunId: ctx.pipelineRunId,
      status: "succeeded",
      outcome,
      scores: input.scores as Record<string, number>,
      coreWebVitals: input.coreWebVitals as Record<string, number>,
      thresholdsUsed: input.thresholds as Record<string, number>,
      failedCategories: failed.length > 0 ? failed : null,
      reportPath: input.reportPath,
      astroCommitSha: input.astroCommitSha,
      testedUrl: input.testedUrl,
      finishedAt: now,
    }).returning();

    return {
      outcome,
      failedThresholds: failed,
      pagespeedRunId: run!.id,
    };
  }
}
