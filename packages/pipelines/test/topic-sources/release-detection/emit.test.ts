// Spec 64.20 follow-up A3 — emitReleaseBrief integration tests.
// Real DB. Pacing + dedup + brief shape.

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  contentSourceInventory,
  db,
  eq,
  projects,
  topicBriefs,
} from "@marketing-auto/db";
import {
  emitReleaseBrief,
  RELEASE_DETECTION_WEEKLY_CAP,
} from "../../../src/topic-sources/release-detection/index.ts";

let projectId: string;
let inventoryRowId: string;

const BASE_INPUT = {
  sourceIdentifier:   "anthropics/claude-code",
  displayName:        "Claude Code",
  previousReleaseTag: "v1.0.0",
  newReleaseTag:      "v1.1.0",
  releaseName:        "Release 1.1",
  releasePublishedAt: "2026-05-25T08:00:00.000Z",
  starsCount:         25000,
};

beforeAll(async () => {
  const ts = Date.now();
  const [proj] = await db
    .insert(projects)
    .values({
      slug: `release-emit-${ts}`,
      name: "Release Emit Test",
      industry: "ai_education",
      pipelineTemplate: "educational",
    })
    .returning({ id: projects.id });
  projectId = proj!.id;

  const [inv] = await db
    .insert(contentSourceInventory)
    .values({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "anthropics/claude-code",
      displayName: "Claude Code",
      approvedAt: new Date(),
    })
    .returning({ id: contentSourceInventory.id });
  inventoryRowId = inv!.id;
});

afterEach(async () => {
  await db.delete(topicBriefs).where(eq(topicBriefs.projectId, projectId));
});

afterAll(async () => {
  await db.delete(topicBriefs).where(eq(topicBriefs.projectId, projectId));
  await db
    .delete(contentSourceInventory)
    .where(eq(contentSourceInventory.projectId, projectId));
  await db.delete(projects).where(eq(projects.id, projectId));
});

describe("emitReleaseBrief", () => {
  it("inserts a topic_brief with source='release_detection' + releaseMetadata", async () => {
    const result = await emitReleaseBrief({
      projectId,
      inventoryRowId,
      ...BASE_INPUT,
    });

    expect(result.briefId).not.toBeNull();
    expect(result.skipped).toBeNull();

    const [brief] = await db
      .select()
      .from(topicBriefs)
      .where(eq(topicBriefs.id, result.briefId!))
      .limit(1);
    expect(brief).toBeDefined();
    expect(brief?.source).toBe("release_detection");
    expect(brief?.clusterAction).toBe("standalone");
    expect(brief?.intentType).toBe("news");
    expect(brief?.approvalStatus).toBe("pending");
    expect(brief?.topicTitle).toContain("Claude Code");
    expect(brief?.topicTitle).toContain("v1.1.0");
    expect(brief?.releaseMetadata).not.toBeNull();
    expect(brief?.releaseMetadata?.inventoryRowId).toBe(inventoryRowId);
    expect(brief?.releaseMetadata?.previousReleaseTag).toBe("v1.0.0");
    expect(brief?.releaseMetadata?.newReleaseTag).toBe("v1.1.0");
    expect(brief?.releaseMetadata?.starsCount).toBe(25000);
  });

  it("dedups: same (inventoryRowId, newReleaseTag) returns skipped=duplicate", async () => {
    await emitReleaseBrief({ projectId, inventoryRowId, ...BASE_INPUT });
    const second = await emitReleaseBrief({ projectId, inventoryRowId, ...BASE_INPUT });
    expect(second.briefId).toBeNull();
    expect(second.skipped).toBe("duplicate");

    const all = await db.select({ id: topicBriefs.id }).from(topicBriefs).where(eq(topicBriefs.projectId, projectId));
    expect(all).toHaveLength(1);
  });

  it("respects per-week pacing cap (5 briefs/week per project)", async () => {
    // Emit 5 briefs successfully (different tags so dedup doesn't block)
    for (let i = 0; i < RELEASE_DETECTION_WEEKLY_CAP; i++) {
      const result = await emitReleaseBrief({
        projectId,
        inventoryRowId,
        ...BASE_INPUT,
        newReleaseTag: `v1.${i}.0`,
      });
      expect(result.briefId).not.toBeNull();
    }

    // 6th hits the pacing cap
    const blocked = await emitReleaseBrief({
      projectId,
      inventoryRowId,
      ...BASE_INPUT,
      newReleaseTag: "v1.999.0",
    });
    expect(blocked.briefId).toBeNull();
    expect(blocked.skipped).toBe("pacing_limit");

    const all = await db.select({ id: topicBriefs.id }).from(topicBriefs).where(eq(topicBriefs.projectId, projectId));
    expect(all).toHaveLength(RELEASE_DETECTION_WEEKLY_CAP);
  });

  it("uses German topic title for de-DE projects (default)", async () => {
    const result = await emitReleaseBrief({ projectId, inventoryRowId, ...BASE_INPUT });
    const [brief] = await db
      .select({ topicTitle: topicBriefs.topicTitle })
      .from(topicBriefs)
      .where(eq(topicBriefs.id, result.briefId!))
      .limit(1);
    expect(brief?.topicTitle).toContain("Neues Release:");
  });

  it("omits starsCount field cleanly when caller does not pass it", async () => {
    const result = await emitReleaseBrief({
      projectId,
      inventoryRowId,
      sourceIdentifier:   BASE_INPUT.sourceIdentifier,
      displayName:        BASE_INPUT.displayName,
      previousReleaseTag: "v2.0.0",
      newReleaseTag:      "v2.1.0",
      releaseName:        null,
      releasePublishedAt: BASE_INPUT.releasePublishedAt,
    });
    const [brief] = await db
      .select({ releaseMetadata: topicBriefs.releaseMetadata })
      .from(topicBriefs)
      .where(eq(topicBriefs.id, result.briefId!))
      .limit(1);
    expect(brief?.releaseMetadata?.starsCount).toBeUndefined();
    expect(brief?.releaseMetadata?.releaseName).toBeNull();
  });
});
