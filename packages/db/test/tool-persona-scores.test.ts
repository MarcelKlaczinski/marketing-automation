/**
 * Spec 65.1 — tool_persona_scores helper integration tests.
 *
 * Covers the collection='tools' guard, project-scoped composite PK,
 * top-tools ranking + missing-scores backlog read, and stale prune.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  articles,
  db,
  deleteStalePersonaScores,
  eq,
  getPersonaScore,
  listPersonaScoresForTool,
  listToolsMissingPersonaScores,
  listTopToolsForPersona,
  projects,
  toolPersonaScores,
  upsertPersonaScore,
} from "../src/index.ts";

describe("tool_persona_scores helpers (Spec 65.1)", () => {
  let projectId: string;
  let projectIdOther: string;
  let toolA: string;
  let toolB: string;
  let toolC: string;
  let blogId: string;

  beforeAll(async () => {
    const ts = Date.now();
    const [pA] = await db
      .insert(projects)
      .values({
        slug: `tps-a-${ts}`,
        name: "TPS A",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    const [pB] = await db
      .insert(projects)
      .values({
        slug: `tps-b-${ts}`,
        name: "TPS B",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!pA || !pB) throw new Error("project INSERT failed");
    projectId = pA.id;
    projectIdOther = pB.id;

    const [a] = await db
      .insert(articles)
      .values({
        projectId,
        source: "imported",
        collection: "tools",
        locale: "de",
        slug: `tps-tool-a-${ts}`,
        title: "Tool A",
        status: "proposed",
      })
      .returning();
    const [b] = await db
      .insert(articles)
      .values({
        projectId,
        source: "imported",
        collection: "tools",
        locale: "de",
        slug: `tps-tool-b-${ts}`,
        title: "Tool B",
        status: "proposed",
      })
      .returning();
    const [c] = await db
      .insert(articles)
      .values({
        projectId,
        source: "imported",
        collection: "tools",
        locale: "de",
        slug: `tps-tool-c-${ts}`,
        title: "Tool C",
        status: "proposed",
      })
      .returning();
    const [blog] = await db
      .insert(articles)
      .values({
        projectId,
        source: "imported",
        collection: "blog",
        locale: "de",
        slug: `tps-blog-${ts}`,
        title: "Blog",
        status: "proposed",
      })
      .returning();
    if (!a || !b || !c || !blog) throw new Error("article INSERT failed");
    toolA = a.id;
    toolB = b.id;
    toolC = c.id;
    blogId = blog.id;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
    await db.delete(projects).where(eq(projects.id, projectIdOther));
  });

  it("upsertPersonaScore + getPersonaScore roundtrip", async () => {
    await upsertPersonaScore({
      toolId: toolA,
      projectId,
      persona: "beginners",
      score: 8,
      reasoning: "Easy onboarding flow",
    });
    const row = await getPersonaScore({ toolId: toolA, projectId, persona: "beginners" });
    expect(row?.score).toBe(8);
    expect(row?.reasoning).toContain("Easy");
  });

  it("re-upsert replaces score + reasoning + stamps scored_at", async () => {
    await upsertPersonaScore({
      toolId: toolA,
      projectId,
      persona: "beginners",
      score: 3,
      reasoning: "v1",
    });
    const before = await getPersonaScore({
      toolId: toolA,
      projectId,
      persona: "beginners",
    });
    await new Promise((r) => setTimeout(r, 20));
    const replaced = await upsertPersonaScore({
      toolId: toolA,
      projectId,
      persona: "beginners",
      score: 9,
      reasoning: "v2-revised",
    });
    expect(replaced.score).toBe(9);
    expect(replaced.reasoning).toBe("v2-revised");
    expect(replaced.scoredAt.getTime()).toBeGreaterThan(before!.scoredAt.getTime());
  });

  it("rejects insert against a non-tool article (collection guard)", async () => {
    await expect(
      upsertPersonaScore({
        toolId: blogId,
        projectId,
        persona: "beginners",
        score: 5,
        reasoning: "x",
      }),
    ).rejects.toThrow(/expected 'tools'/);
  });

  it("composite PK isolates per project — same tool + persona in two projects", async () => {
    await upsertPersonaScore({
      toolId: toolA,
      projectId,
      persona: "students",
      score: 7,
      reasoning: "A-students",
    });
    // toolA is OWNED by projectId; can't FK it into projectIdOther's article set.
    // Instead, create a second tool-article under projectIdOther:
    const tsOther = Date.now();
    const [otherTool] = await db
      .insert(articles)
      .values({
        projectId: projectIdOther,
        source: "imported",
        collection: "tools",
        locale: "de",
        slug: `tps-other-${tsOther}`,
        title: "Other-project Tool",
        status: "proposed",
      })
      .returning();
    if (!otherTool) throw new Error("other-tool INSERT failed");
    await upsertPersonaScore({
      toolId: otherTool.id,
      projectId: projectIdOther,
      persona: "students",
      score: 4,
      reasoning: "B-students",
    });

    const aScore = await getPersonaScore({ toolId: toolA, projectId, persona: "students" });
    const bScore = await getPersonaScore({
      toolId: otherTool.id,
      projectId: projectIdOther,
      persona: "students",
    });
    expect(aScore?.score).toBe(7);
    expect(bScore?.score).toBe(4);
  });

  it("listTopToolsForPersona returns rows ordered by score DESC and respects minScore", async () => {
    await upsertPersonaScore({
      toolId: toolA,
      projectId,
      persona: "designers",
      score: 9,
      reasoning: "a",
    });
    await upsertPersonaScore({
      toolId: toolB,
      projectId,
      persona: "designers",
      score: 7,
      reasoning: "b",
    });
    await upsertPersonaScore({
      toolId: toolC,
      projectId,
      persona: "designers",
      score: 4,
      reasoning: "c",
    });
    const top = await listTopToolsForPersona({
      projectId,
      persona: "designers",
      minScore: 5,
      limit: 10,
    });
    const ids = top.map((r) => r.toolId);
    expect(ids[0]).toBe(toolA);
    expect(ids[1]).toBe(toolB);
    expect(ids).not.toContain(toolC); // filtered by minScore
  });

  it("listPersonaScoresForTool returns all personas for one (tool, project)", async () => {
    await upsertPersonaScore({
      toolId: toolA,
      projectId,
      persona: "marketers",
      score: 6,
      reasoning: "m",
    });
    await upsertPersonaScore({
      toolId: toolA,
      projectId,
      persona: "developers",
      score: 9,
      reasoning: "d",
    });
    const rows = await listPersonaScoresForTool({ toolId: toolA, projectId });
    const personas = rows.map((r) => r.persona).sort();
    // Includes previously-inserted personas + the two new ones; sanity-check the new pair:
    expect(personas).toContain("marketers");
    expect(personas).toContain("developers");
  });

  it("listToolsMissingPersonaScores returns tools without a score for the given persona", async () => {
    await upsertPersonaScore({
      toolId: toolA,
      projectId,
      persona: "seniors",
      score: 6,
      reasoning: "ok",
    });
    const missing = await listToolsMissingPersonaScores({
      projectId,
      persona: "seniors",
      toolIds: [toolA, toolB, toolC],
    });
    expect(missing).not.toContain(toolA);
    expect(missing).toContain(toolB);
    expect(missing).toContain(toolC);

    // Empty input → empty output
    const empty = await listToolsMissingPersonaScores({
      projectId,
      persona: "seniors",
      toolIds: [],
    });
    expect(empty).toEqual([]);
  });

  it("deleteStalePersonaScores removes scored_at < cutoff", async () => {
    // Insert + immediately backdate
    await upsertPersonaScore({
      toolId: toolB,
      projectId,
      persona: "teachers",
      score: 5,
      reasoning: "stale",
    });
    await db
      .update(toolPersonaScores)
      .set({ scoredAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000) })
      .where(eq(toolPersonaScores.toolId, toolB));

    const deleted = await deleteStalePersonaScores({ olderThanDays: 30 });
    expect(deleted).toBeGreaterThan(0);
  });
});
