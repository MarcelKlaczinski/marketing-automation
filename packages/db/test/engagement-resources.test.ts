/**
 * Spec 65.1 — engagement_resources helper integration tests.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  createEngagementResource,
  db,
  deleteEngagementResource,
  eq,
  getEngagementResource,
  getEngagementResourceByKeyword,
  listEngagementResources,
  projects,
  updateEngagementResource,
} from "../src/index.ts";

describe("engagement_resources helpers (Spec 65.1)", () => {
  let projectId: string;
  let projectIdOther: string;

  beforeAll(async () => {
    const ts = Date.now();
    const [a] = await db
      .insert(projects)
      .values({
        slug: `er-a-${ts}`,
        name: "ER A",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    const [b] = await db
      .insert(projects)
      .values({
        slug: `er-b-${ts}`,
        name: "ER B",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!a || !b) throw new Error("project INSERT failed");
    projectId = a.id;
    projectIdOther = b.id;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
    await db.delete(projects).where(eq(projects.id, projectIdOther));
  });

  it("create + getByKeyword roundtrip", async () => {
    const row = await createEngagementResource({
      projectId,
      title: "Claude Prompt Library",
      fileUrl: "r2://resources/claude-prompts.pdf",
      keyword: "CLAUDE",
      resourceType: "pdf",
    });
    expect(row.id).toBeTruthy();

    const byKeyword = await getEngagementResourceByKeyword({
      projectId,
      keyword: "CLAUDE",
    });
    expect(byKeyword?.id).toBe(row.id);
  });

  it("UNIQUE (project_id, keyword) — duplicate keyword for same project throws", async () => {
    await createEngagementResource({
      projectId,
      title: "First",
      fileUrl: "r2://x",
      keyword: "DUPE",
      resourceType: "pdf",
    });
    await expect(
      createEngagementResource({
        projectId,
        title: "Second",
        fileUrl: "r2://y",
        keyword: "DUPE",
        resourceType: "pdf",
      }),
    ).rejects.toThrow();
  });

  it("same keyword across DIFFERENT projects is allowed", async () => {
    await createEngagementResource({
      projectId,
      title: "A-prompts",
      fileUrl: "r2://a",
      keyword: "PROMPT",
      resourceType: "prompt-list",
    });
    // No throw expected — different project_id.
    const b = await createEngagementResource({
      projectId: projectIdOther,
      title: "B-prompts",
      fileUrl: "r2://b",
      keyword: "PROMPT",
      resourceType: "prompt-list",
    });
    expect(b.projectId).toBe(projectIdOther);
  });

  it("multi-tenant isolation in listEngagementResources", async () => {
    const aRows = await listEngagementResources({ projectId });
    const bRows = await listEngagementResources({ projectId: projectIdOther });
    expect(aRows.every((r) => r.projectId === projectId)).toBe(true);
    expect(bRows.every((r) => r.projectId === projectIdOther)).toBe(true);
  });

  it("filters by resourceType", async () => {
    await createEngagementResource({
      projectId,
      title: "link-only",
      fileUrl: "https://example.com",
      keyword: "FILTER",
      resourceType: "link",
    });
    const links = await listEngagementResources({
      projectId,
      resourceType: "link",
    });
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((r) => r.resourceType === "link")).toBe(true);
  });

  it("update + delete", async () => {
    const row = await createEngagementResource({
      projectId,
      title: "to-update",
      fileUrl: "r2://x",
      keyword: "UPDATE_ME",
      resourceType: "pdf",
    });
    const patched = await updateEngagementResource(row.id, { title: "renamed" });
    expect(patched?.title).toBe("renamed");

    await deleteEngagementResource(row.id);
    const fetched = await getEngagementResource(row.id);
    expect(fetched).toBeNull();
  });
});
