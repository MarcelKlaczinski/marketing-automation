// Spec 62.0b unit tests for promoteToGolden + read helpers.
// Covers: insert as golden, supersede prior golden, race-condition via UNIQUE constraint,
// project-scoped vs global goldens, listing.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  db,
  eq,
  getGoldenPrompt,
  listPromptVersionsForProject,
  projects,
  promoteToGolden,
  promptVersions,
} from "../src/index.ts";

const STEP = "step-test";

describe("prompt-version-write", () => {
  let projectA: string;
  let projectB: string;

  beforeAll(async () => {
    const ts = Date.now();
    const [a] = await db
      .insert(projects)
      .values({
        slug: `pv-a-${ts}`,
        name: "Prompt Version Test A",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    const [b] = await db
      .insert(projects)
      .values({
        slug: `pv-b-${ts}`,
        name: "Prompt Version Test B",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!a || !b) throw new Error("project insert failed");
    projectA = a.id;
    projectB = b.id;
  });

  afterAll(async () => {
    // FK cascade deletes prompt_versions rows along with the project.
    await db.delete(projects).where(eq(projects.id, projectA));
    await db.delete(projects).where(eq(projects.id, projectB));
  });

  it("inserts the first golden and getGoldenPrompt returns it", async () => {
    const row = await promoteToGolden({
      stepName: STEP,
      projectId: projectA,
      body: "first-golden-body",
      sourcePauseId: null,
      promoteNote: "initial promote",
      createdBy: "test",
    });
    expect(row.isGolden).toBe(true);
    expect(row.body).toBe("first-golden-body");

    const fetched = await getGoldenPrompt({ stepName: STEP, projectId: projectA });
    expect(fetched?.id).toBe(row.id);
    expect(fetched?.body).toBe("first-golden-body");
  });

  it("supersedes the prior golden when a second promote runs for the same (step, project)", async () => {
    const v2 = await promoteToGolden({
      stepName: STEP,
      projectId: projectA,
      body: "second-golden-body",
      sourcePauseId: null,
      promoteNote: null,
      createdBy: "test",
    });

    const all = await listPromptVersionsForProject({ projectId: projectA, stepName: STEP });
    // Should have v1 (superseded) + v2 (golden) — newest first.
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all[0]?.id).toBe(v2.id);
    expect(all[0]?.isGolden).toBe(true);
    const v1 = all.find((r) => r.id !== v2.id);
    expect(v1?.isGolden).toBe(false);
    expect(v1?.supersededAt).not.toBeNull();

    const active = await getGoldenPrompt({ stepName: STEP, projectId: projectA });
    expect(active?.id).toBe(v2.id);
  });

  it("keeps project-A and project-B goldens independent", async () => {
    await promoteToGolden({
      stepName: STEP,
      projectId: projectB,
      body: "project-b-golden",
      sourcePauseId: null,
      promoteNote: null,
      createdBy: "test",
    });

    const aGolden = await getGoldenPrompt({ stepName: STEP, projectId: projectA });
    const bGolden = await getGoldenPrompt({ stepName: STEP, projectId: projectB });

    expect(aGolden?.body).toBe("second-golden-body"); // still v2 from earlier test
    expect(bGolden?.body).toBe("project-b-golden");
    expect(aGolden?.id).not.toBe(bGolden?.id);
  });

  it("treats NULL projectId as a global golden (separate from any project)", async () => {
    await promoteToGolden({
      stepName: STEP,
      projectId: null,
      body: "global-golden",
      sourcePauseId: null,
      promoteNote: null,
      createdBy: "test",
    });

    const global = await getGoldenPrompt({ stepName: STEP, projectId: null });
    const aGolden = await getGoldenPrompt({ stepName: STEP, projectId: projectA });

    expect(global?.body).toBe("global-golden");
    expect(aGolden?.body).toBe("second-golden-body"); // unaffected by the global promote
    expect(global?.id).not.toBe(aGolden?.id);

    // Cleanup the global row — projects FK cascade won't reach it.
    await db
      .delete(promptVersions)
      .where(eq(promptVersions.id, global!.id));
  });

  it("partial unique index prevents two goldens for the same (step, project) at once", async () => {
    // Direct INSERT trying to add a second golden without first superseding the old one.
    // The UNIQUE index `prompt_versions_one_golden_per_step` (WHERE is_golden = true)
    // is the race-condition safety net for promoteToGolden.
    const attempt = async () => {
      await db.insert(promptVersions).values({
        stepName: STEP,
        projectId: projectA,
        body: "should-fail",
        sourcePauseId: null,
        isGolden: true,
        createdBy: "test",
      });
    };
    await expect(attempt()).rejects.toThrow();
  });
});
