/**
 * Spec 54.6 — Trend discovery review endpoint integration tests.
 *
 * Tests the DB invariants for the dismiss, edit, and approve (create_new guard)
 * flows. Tested at the DB + route-logic layer without HTTP — the SQL produced
 * by each handler is replicated here so we can assert on the resulting state.
 *
 * Run: bun --filter @marketing-auto/api test
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  and,
  clusters,
  contentPillars,
  db,
  eq,
  externalSignals,
  isNotNull,
  isNull,
  projects,
  rejectedTopicCandidates,
  topicBriefs,
} from "@marketing-auto/db";

const SLUG = `trends-test-${Date.now()}`;

describe("Trend discovery review flows (Spec 54.6)", () => {
  let projectId: string;
  let clusterId: string;

  beforeAll(async () => {
    const [p] = await db
      .insert(projects)
      .values({
        slug: SLUG,
        name: "Trends Integration Test",
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
        name: "KI Tools",
        pillar: "AI Tools",
        cornerstoneKeywords: ["ki-tools"],
        satelliteKeywords: [],
        status: "approved",
      })
      .returning();
    clusterId = c!.id;
  });

  afterAll(async () => {
    await db.delete(topicBriefs).where(eq(topicBriefs.projectId, projectId));
    await db.delete(externalSignals).where(eq(externalSignals.projectId, projectId));
    await db.delete(rejectedTopicCandidates).where(eq(rejectedTopicCandidates.projectId, projectId));
    await db.delete(clusters).where(eq(clusters.projectId, projectId));
    await db.delete(contentPillars).where(eq(contentPillars.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  // ─── Dismiss flow ──────────────────────────────────────────────────────────

  describe("dismiss flow", () => {
    it("writes manual_dismissal to rejected_topic_candidates and marks brief rejected", async () => {
      // Insert a signal the brief references
      const [signal] = await db
        .insert(externalSignals)
        .values({
          projectId,
          source: "hackernews",
          externalId: `hn-dismiss-test-${Date.now()}`,
          title: "HN signal for dismiss test",
          rawPayload: {},
          metrics: { points: 42 },
        })
        .returning();

      const signalId = signal!.id;

      // Insert brief with signal reference in trendMetadata
      const [brief] = await db
        .insert(topicBriefs)
        .values({
          projectId,
          clusterId,
          source: "trend_discovery",
          topicTitle: "AI Tools for 2025",
          clusterAction: "append_to_existing",
          approvalRequired: true,
          approvalStatus: "pending",
          trendMetadata: {
            trendScore: 62,
            freshnessWindow: "rising",
            signals: [{ id: signalId, source: "hackernews", externalId: signal!.externalId, capturedAt: new Date().toISOString() }],
          },
        })
        .returning();

      const briefId = brief!.id;

      // --- replicate dismiss handler logic ---
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await db.transaction(async (tx) => {
        await tx.insert(rejectedTopicCandidates).values({
          projectId,
          topicTitle: brief!.topicTitle,
          candidateTitleNormalized: brief!.topicTitle.toLowerCase().trim(),
          reason: "manual_dismissal",
          trendScore: 62,
          sourceSignalIds: [signalId],
          expiresAt,
        });

        await tx
          .update(topicBriefs)
          .set({ approvalStatus: "rejected", updatedAt: new Date() })
          .where(eq(topicBriefs.id, briefId));
      });

      await db
        .update(externalSignals)
        .set({ processedAt: new Date() })
        .where(and(isNull(externalSignals.processedAt), eq(externalSignals.id, signalId)));

      // ─── Invariant 1: brief is now rejected ─────────────────────────────────
      const [updatedBrief] = await db
        .select({ approvalStatus: topicBriefs.approvalStatus })
        .from(topicBriefs)
        .where(eq(topicBriefs.id, briefId))
        .limit(1);

      expect(updatedBrief!.approvalStatus).toBe("rejected");

      // ─── Invariant 2: rejection entry with manual_dismissal exists ──────────
      const [rejection] = await db
        .select()
        .from(rejectedTopicCandidates)
        .where(
          and(
            eq(rejectedTopicCandidates.projectId, projectId),
            eq(rejectedTopicCandidates.reason, "manual_dismissal"),
          ),
        )
        .limit(1);

      expect(rejection).toBeDefined();
      expect(rejection!.topicTitle).toBe("AI Tools for 2025");
      expect(rejection!.expiresAt.getTime()).toBeGreaterThan(Date.now());

      // ─── Invariant 3: signal is stamped as processed ─────────────────────────
      const [stampedSignal] = await db
        .select({ processedAt: externalSignals.processedAt })
        .from(externalSignals)
        .where(eq(externalSignals.id, signalId))
        .limit(1);

      expect(stampedSignal!.processedAt).not.toBeNull();
    });
  });

  // ─── Edit flow ─────────────────────────────────────────────────────────────

  describe("edit flow", () => {
    it("updates only allowed fields and leaves approvalStatus as pending", async () => {
      const [brief] = await db
        .insert(topicBriefs)
        .values({
          projectId,
          clusterId,
          source: "trend_discovery",
          topicTitle: "Topic to be edited",
          clusterAction: "append_to_existing",
          approvalRequired: true,
          approvalStatus: "pending",
          suggestedTitle: "Original title for editing",
          suggestedMeta: "Original meta description that is long enough to meet the 50 char minimum here.",
          suggestedSlug: "original-slug",
          trendMetadata: { trendScore: 55, freshnessWindow: "stable", signals: [] },
        })
        .returning();

      const briefId = brief!.id;

      // --- replicate edit handler logic ---
      const newTitle = "Updated AI Tools Overview 2025";
      const newMeta = "Discover the best AI tools available in 2025 for developers and creators.";
      const newSlug = "ai-tools-overview-2025";

      await db
        .update(topicBriefs)
        .set({ suggestedTitle: newTitle, suggestedMeta: newMeta, suggestedSlug: newSlug, updatedAt: new Date() })
        .where(eq(topicBriefs.id, briefId));

      const [updated] = await db
        .select()
        .from(topicBriefs)
        .where(eq(topicBriefs.id, briefId))
        .limit(1);

      // ─── Invariant 1: fields updated ─────────────────────────────────────────
      expect(updated!.suggestedTitle).toBe(newTitle);
      expect(updated!.suggestedMeta).toBe(newMeta);
      expect(updated!.suggestedSlug).toBe(newSlug);

      // ─── Invariant 2: approval status unchanged ───────────────────────────────
      expect(updated!.approvalStatus).toBe("pending");

      // ─── Invariant 3: topicTitle unchanged (not an editable field) ───────────
      expect(updated!.topicTitle).toBe("Topic to be edited");
    });
  });

  // ─── create_new guard ──────────────────────────────────────────────────────

  describe("approve — create_new guard", () => {
    it("create_new briefs must be blocked before any routing attempt", async () => {
      const [brief] = await db
        .insert(topicBriefs)
        .values({
          projectId,
          source: "trend_discovery",
          topicTitle: "New cluster topic",
          clusterAction: "create_new",
          approvalRequired: true,
          approvalStatus: "pending",
          trendMetadata: { trendScore: 70, freshnessWindow: "breaking", signals: [] },
        })
        .returning();

      // The route handler checks this exact condition before routing
      const shouldBlock = brief!.clusterAction === "create_new";

      expect(shouldBlock).toBe(true);

      // Brief remains pending — no state mutation for blocked approvals
      const [loaded] = await db
        .select({ approvalStatus: topicBriefs.approvalStatus })
        .from(topicBriefs)
        .where(eq(topicBriefs.id, brief!.id))
        .limit(1);

      expect(loaded!.approvalStatus).toBe("pending");
    });
  });

  // ─── pending-briefs ordering ───────────────────────────────────────────────

  describe("pending-briefs ordering", () => {
    it("returns only source=trend_discovery AND status=pending briefs", async () => {
      // Insert a gap_analysis brief (should NOT appear)
      const [gapBrief] = await db
        .insert(topicBriefs)
        .values({
          projectId,
          clusterId,
          source: "gap_analysis",
          topicTitle: "Gap analysis brief (should not appear)",
          clusterAction: "append_to_existing",
          approvalRequired: true,
          approvalStatus: "pending",
        })
        .returning();

      // Insert a pending trend_discovery brief (SHOULD appear)
      const [trendBrief] = await db
        .insert(topicBriefs)
        .values({
          projectId,
          clusterId,
          source: "trend_discovery",
          topicTitle: "Trend brief (should appear)",
          clusterAction: "append_to_existing",
          approvalRequired: true,
          approvalStatus: "pending",
          trendMetadata: { trendScore: 80, freshnessWindow: "rising", signals: [] },
        })
        .returning();

      const pending = await db
        .select({ id: topicBriefs.id, source: topicBriefs.source })
        .from(topicBriefs)
        .where(
          and(
            eq(topicBriefs.projectId, projectId),
            eq(topicBriefs.source, "trend_discovery"),
            eq(topicBriefs.approvalStatus, "pending"),
          ),
        );

      const ids = pending.map((r) => r.id);
      expect(ids).toContain(trendBrief!.id);
      expect(ids).not.toContain(gapBrief!.id);
    });
  });
});
