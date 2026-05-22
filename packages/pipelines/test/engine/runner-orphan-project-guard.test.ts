// Regression test for the orphan-project guard in runPipeline (Phase-E diagnose
// 2026-05-22).
//
// Background: tests + admin deletes can wipe a project while a BullMQ job for
// that project is still parked in Redis. The PG `ON DELETE CASCADE` chain wipes
// every related DB row (pipeline_runs, link_rebuild_runs, planned_items, …) but
// the BullMQ job in Redis is not in PG and survives untouched. When the worker
// eventually picks it up, the first pipeline_runs INSERT used to fail with FK
// violation `pipeline_runs_project_id_projects_id_fk` and BullMQ flagged the
// job as failed, surfacing a noisy "Pipeline failed - localhost" notification.
//
// Fix: `runPipeline` checks the project still exists BEFORE any DB write and
// returns `{ ok: false, error: "project_deleted", runId: "" }` on miss. The
// BullMQ worker in queue.ts discriminates on this error string and returns a
// clean completion (no throw → no failure notification).

import { afterAll, describe, expect, it } from "bun:test";
import { db, eq, pipelineRuns, projects } from "@marketing-auto/db";
import { runPipeline } from "../../src/engine/runner.ts";
import { TestPipeline } from "../fixtures/test-pipeline.ts";

describe("runPipeline orphan-project guard", () => {
  const stranded = new Set<string>();
  afterAll(async () => {
    for (const id of stranded) {
      await db.delete(projects).where(eq(projects.id, id));
    }
  });

  it("returns project_deleted without INSERTing pipeline_runs when projectId is unknown", async () => {
    // A UUID that never existed in projects — the guard's path for the race
    // where the project row is gone before the worker picks up the job.
    const phantomProjectId = crypto.randomUUID();

    const before = await db
      .select({ id: pipelineRuns.id })
      .from(pipelineRuns)
      .where(eq(pipelineRuns.projectId, phantomProjectId));

    const result = await runPipeline(
      new TestPipeline(),
      { x: 5 },
      { projectId: phantomProjectId }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return; // type narrow
    expect(result.error).toBe("project_deleted");
    expect(result.runId).toBe("");
    expect(result.failedAtStep).toBe("");

    const after = await db
      .select({ id: pipelineRuns.id })
      .from(pipelineRuns)
      .where(eq(pipelineRuns.projectId, phantomProjectId));
    expect(after.length).toBe(before.length); // no INSERT happened
  });

  it("runs the pipeline normally when the project exists", async () => {
    const [proj] = await db
      .insert(projects)
      .values({
        slug: `runner-guard-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: "runner-guard-test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning({ id: projects.id });
    const projectId = proj!.id;
    stranded.add(projectId);

    const result = await runPipeline(new TestPipeline(), { x: 5 }, { projectId });

    expect(result.ok).toBe(true);
    if (!result.ok) return; // type narrow
    expect(result.runId).not.toBe("");
    expect(result.output.final).toBe(5 * 2 + 1);
  });
});
