/**
 * Spec 65.3 — invalidatePersonaScoresForTool DB integration test.
 *
 * Confirms the Marcel-Decision §10 cross-project cascade: a material change
 * to a tool deletes its scores in every project that had cached them.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  articles,
  db,
  inArray,
  listPersonaScoresForTool,
  projects,
  upsertPersonaScore,
} from "@marketing-auto/db";
import { invalidatePersonaScoresForTool } from "../../../src/lib/persona-scoring/invalidate-persona-scores.ts";

describe("invalidatePersonaScoresForTool (Spec 65.3)", () => {
  const projectIds: string[] = [];
  let sharedToolId: string;

  beforeAll(async () => {
    const ts = Date.now();

    // Two projects share the same tool — assertArticleIsTool only checks
    // collection, not projectId, so we INSERT the article under project A
    // and pretend project B also cached scores against it.
    const [p1] = await db
      .insert(projects)
      .values({
        slug: `inval-a-${ts}`,
        name: "Project A",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    const [p2] = await db
      .insert(projects)
      .values({
        slug: `inval-b-${ts}`,
        name: "Project B",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!p1 || !p2) throw new Error("project INSERTs failed");
    projectIds.push(p1.id, p2.id);

    const [tool] = await db
      .insert(articles)
      .values({
        projectId: p1.id,
        slug: `shared-tool-${ts}`,
        title: "Shared Tool",
        collection: "tools",
        locale: "de",
        status: "proposed",
        source: "imported",
      })
      .returning();
    if (!tool) throw new Error("article INSERT failed");
    sharedToolId = tool.id;

    // Seed scores in BOTH projects against the same tool.
    for (const projectId of projectIds) {
      for (const persona of ["beginners", "developers"]) {
        await upsertPersonaScore({
          toolId: sharedToolId,
          projectId,
          persona,
          score: 7,
          reasoning: `seed ${persona}`,
        });
      }
    }
  });

  afterAll(async () => {
    if (projectIds.length > 0) {
      await db.delete(projects).where(inArray(projects.id, projectIds));
    }
  });

  it("deletes ALL persona-score rows for the tool across every project", async () => {
    // Pre: each project has 2 scores.
    for (const projectId of projectIds) {
      const before = await listPersonaScoresForTool({ toolId: sharedToolId, projectId });
      expect(before).toHaveLength(2);
    }

    const result = await invalidatePersonaScoresForTool({
      toolId: sharedToolId,
      reason: "test material change",
    });

    expect(result.deletedCount).toBe(4);
    expect(result.toolId).toBe(sharedToolId);
    expect(result.reason).toBe("test material change");

    // Post: both projects empty.
    for (const projectId of projectIds) {
      const after = await listPersonaScoresForTool({ toolId: sharedToolId, projectId });
      expect(after).toHaveLength(0);
    }
  });

  it("returns deletedCount=0 when no scores exist (idempotent)", async () => {
    const result = await invalidatePersonaScoresForTool({
      toolId: sharedToolId,
      reason: "second call",
    });
    expect(result.deletedCount).toBe(0);
  });
});
