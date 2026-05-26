/**
 * Spec 65.1 — end_slide_definitions helper integration tests.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  createEndSlideDefinition,
  db,
  eq,
  getEndSlideDefinition,
  listEndSlideDefinitions,
  projects,
  setEndSlideActive,
  updateEndSlideDefinition,
} from "../src/index.ts";

describe("end_slide_definitions helpers (Spec 65.1)", () => {
  let projectId: string;
  let projectIdOther: string;

  beforeAll(async () => {
    const ts = Date.now();
    const [a] = await db
      .insert(projects)
      .values({
        slug: `esd-a-${ts}`,
        name: "ESD A",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    const [b] = await db
      .insert(projects)
      .values({
        slug: `esd-b-${ts}`,
        name: "ESD B",
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

  it("create + read roundtrip with default config", async () => {
    const row = await createEndSlideDefinition({
      projectId,
      name: { de: "Follow CTA", en: "Follow CTA" },
      type: "follow-cta",
      config: { handle: "@toolwiki", arrowDirection: "right" },
    });
    expect(row.isActive).toBe(true);
    const fetched = await getEndSlideDefinition(row.id);
    expect(fetched?.type).toBe("follow-cta");
    expect((fetched?.config as { handle: string }).handle).toBe("@toolwiki");
  });

  it("multi-tenant isolation by project_id", async () => {
    await createEndSlideDefinition({
      projectId,
      name: { de: "A-slide", en: "A-slide" },
      type: "follow-cta",
    });
    await createEndSlideDefinition({
      projectId: projectIdOther,
      name: { de: "B-slide", en: "B-slide" },
      type: "follow-cta",
    });
    const aRows = await listEndSlideDefinitions({ projectId });
    const bRows = await listEndSlideDefinitions({ projectId: projectIdOther });
    expect(aRows.every((r) => r.projectId === projectId)).toBe(true);
    expect(bRows.every((r) => r.projectId === projectIdOther)).toBe(true);
  });

  it("filters by type + excludes inactive by default", async () => {
    await createEndSlideDefinition({
      projectId,
      name: { de: "comment-1", en: "comment-1" },
      type: "comment-to-get",
    });
    const disabled = await createEndSlideDefinition({
      projectId,
      name: { de: "comment-2-disabled", en: "comment-2-disabled" },
      type: "comment-to-get",
    });
    await setEndSlideActive(disabled.id, false);

    const active = await listEndSlideDefinitions({
      projectId,
      type: "comment-to-get",
    });
    expect(active.find((r) => r.id === disabled.id)).toBeUndefined();
    expect(active.length).toBeGreaterThan(0);

    const all = await listEndSlideDefinitions({
      projectId,
      type: "comment-to-get",
      includeInactive: true,
    });
    expect(all.find((r) => r.id === disabled.id)).toBeDefined();
  });

  it("updateEndSlideDefinition patches editable fields", async () => {
    const row = await createEndSlideDefinition({
      projectId,
      name: { de: "patch-test", en: "patch-test" },
      type: "link-in-bio",
    });
    const patched = await updateEndSlideDefinition(row.id, {
      name: { de: "renamed", en: "renamed" },
      config: { url: "https://example.com" },
    });
    expect(patched?.name).toEqual({ de: "renamed", en: "renamed" });
    expect((patched?.config as { url: string }).url).toBe("https://example.com");

    const ghost = await updateEndSlideDefinition(
      "00000000-0000-0000-0000-000000000000",
      { name: { de: "x", en: "x" } },
    );
    expect(ghost).toBeNull();
  });
});
