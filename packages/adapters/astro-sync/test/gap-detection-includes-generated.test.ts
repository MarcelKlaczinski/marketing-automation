/**
 * Spec 54.3 Tech Debt #1 regression:
 * Gap detection must count generated articles, not only imported ones.
 *
 * Before 54.3: source='imported' filter meant a cluster with 1 imported + 2
 * generated articles would still emit cluster_too_small (effective count = 1).
 * After 54.3: all articles count → cluster_too_small is NOT emitted when total >= 3.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  articles,
  clusters,
  contentGaps,
  contentPillars,
  db,
  eq,
  projects,
  topicBriefs,
} from "@marketing-auto/db";
import { DetectContentGapsStep } from "../src/import/steps/detect-content-gaps.ts";
import { createLogger } from "@marketing-auto/shared";
import type { StepContext } from "@marketing-auto/pipelines";

const mockCtx = (projectId: string): StepContext => ({
  projectId,
  pipelineRunId: crypto.randomUUID(),
  stepRunId: crypto.randomUUID(),
  pipelineName: "test",
  log: createLogger("test"),
  reportProgress: async () => {},
  getStepOutput: () => undefined,
});

describe("DetectContentGapsStep — generated articles count (Spec 54.3)", () => {
  let projectId: string;
  let clusterId: string;

  beforeAll(async () => {
    const [p] = await db
      .insert(projects)
      .values({
        slug: `gap-detect-54-3-test-${Date.now()}`,
        name: "Gap Detect 54.3 Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    projectId = p!.id;

    const [pillar] = await db
      .insert(contentPillars)
      .values({ projectId, name: "AI Tools", position: 0 })
      .returning();

    const [c] = await db
      .insert(clusters)
      .values({
        projectId,
        pillarId: pillar!.id,
        name: "KI Tools Cluster",
        pillar: "AI Tools",
        cornerstoneKeywords: ["ki-tools"],
        satelliteKeywords: [],
        status: "approved",
      })
      .returning();
    clusterId = c!.id;

    // 1 imported + 2 generated = 3 total → cluster_too_small should NOT fire
    await db
      .insert(articles)
      .values([
        {
          projectId,
          clusterId,
          slug: `imported-spoke-${Date.now()}`,
          source: "imported",
          clusterRole: "spoke",
          intentType: "how_to",
          locale: "de",
          status: "published",
          approvalMode: "manual",
        },
        {
          projectId,
          clusterId,
          slug: `generated-spoke-1-${Date.now()}`,
          source: "generated",
          clusterRole: "spoke",
          intentType: "tutorial",
          locale: "de",
          status: "proposed",
          approvalMode: "manual",
        },
        {
          projectId,
          clusterId,
          slug: `generated-spoke-2-${Date.now()}`,
          source: "generated",
          clusterRole: "spoke",
          intentType: "use_case",
          locale: "de",
          status: "proposed",
          approvalMode: "manual",
        },
      ]);
  });

  afterAll(async () => {
    await db.delete(topicBriefs).where(eq(topicBriefs.projectId, projectId));
    await db.delete(contentGaps).where(eq(contentGaps.projectId, projectId));
    await db.delete(articles).where(eq(articles.projectId, projectId));
    await db.delete(clusters).where(eq(clusters.projectId, projectId));
    await db.delete(contentPillars).where(eq(contentPillars.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("does NOT emit cluster_too_small when 1 imported + 2 generated articles exist", async () => {
    const step = new DetectContentGapsStep();
    const out = await step.execute({ projectId }, mockCtx(projectId));

    expect(out.totalOpen).toBeGreaterThanOrEqual(0);

    const gaps = await db
      .select({ gapType: contentGaps.gapType, clusterId: contentGaps.clusterId })
      .from(contentGaps)
      .where(eq(contentGaps.projectId, projectId));

    const tooSmallForCluster = gaps.filter(
      (g) => g.gapType === "cluster_too_small" && g.clusterId === clusterId,
    );
    expect(tooSmallForCluster).toHaveLength(0);
  });

  it("counts generated articles toward intent coverage (missing_spoke_type check)", async () => {
    // With how_to + tutorial + use_case covered, missing_spoke_type for those intents
    // should NOT appear. Only intents missing from ALL articles would appear.
    const gaps = await db
      .select({ gapType: contentGaps.gapType, intentType: contentGaps.intentType })
      .from(contentGaps)
      .where(eq(contentGaps.projectId, projectId));

    const coveredIntents = ["how_to", "tutorial", "use_case"];
    const falsePositives = gaps.filter(
      (g) =>
        g.gapType === "missing_spoke_type" &&
        g.intentType !== null &&
        coveredIntents.includes(g.intentType),
    );
    expect(falsePositives).toHaveLength(0);
  });
});
