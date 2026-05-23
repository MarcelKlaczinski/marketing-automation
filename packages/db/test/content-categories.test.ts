/**
 * Spec multi-domain-evolution S3.1 — content_categories table.
 * Real-DB integration tests covering the unique-index constraint,
 * cascade delete, and the translations jsonb shape.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { contentCategories, db, eq, projects } from "../src/index.ts";

describe("content_categories (Spec multi-domain-evolution S3.1)", () => {
  let projectId: string;

  beforeAll(async () => {
    const [p] = await db
      .insert(projects)
      .values({
        slug: `s31-test-${Date.now()}`,
        name: "S3.1 Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    projectId = p!.id;
  });

  afterAll(async () => {
    await db.delete(contentCategories).where(eq(contentCategories.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("inserts a tool-scoped category with locale-keyed translations", async () => {
    const [row] = await db
      .insert(contentCategories)
      .values({
        projectId,
        slug: "audio-music",
        scope: "tool",
        translations: {
          de: { label: "Audio & Musik", urlSlug: "audio-musik" },
          en: { label: "Audio & Music", urlSlug: "audio-music" },
        },
        icon: "Music",
      })
      .returning();
    expect(row?.slug).toBe("audio-music");
    expect(row?.scope).toBe("tool");
    expect(row?.translations.de?.urlSlug).toBe("audio-musik");
    expect(row?.translations.en?.urlSlug).toBe("audio-music");
  });

  it("allows same slug across different scopes (tool vs blog)", async () => {
    // Phase-1 finding: `audio-music` as a tool category is a different concept
    // from a hypothetical `audio-music` blog tag. The composite unique key
    // `(project_id, scope, slug)` must permit both.
    await db.insert(contentCategories).values({
      projectId,
      slug: "audio-music",
      scope: "blog",
      translations: {
        de: { label: "Audio & Musik", urlSlug: "audio-musik" },
        en: { label: "Audio & Music", urlSlug: "audio-music" },
      },
    });
    const rows = await db
      .select()
      .from(contentCategories)
      .where(eq(contentCategories.projectId, projectId));
    expect(rows.map((r) => r.scope).sort()).toEqual(["blog", "tool"]);
  });

  it("rejects duplicate (project_id, scope, slug) via the unique index", async () => {
    await expect(
      (async () => {
        await db.insert(contentCategories).values({
          projectId,
          slug: "audio-music",
          scope: "tool", // duplicate of the first insert
          translations: { de: { label: "Dupe", urlSlug: "dupe" } },
        });
      })(),
    ).rejects.toThrow();
  });

  it("supports parent_slug for hierarchical taxonomy (app-layer validated)", async () => {
    await db.insert(contentCategories).values({
      projectId,
      slug: "song-generation",
      scope: "tool",
      parentSlug: "audio-music",
      translations: { de: { label: "Song-Erzeugung", urlSlug: "song-erzeugung" } },
    });
    const [row] = await db
      .select()
      .from(contentCategories)
      .where(eq(contentCategories.slug, "song-generation"));
    expect(row?.parentSlug).toBe("audio-music");
  });

  it("cascades on project delete", async () => {
    const [p] = await db
      .insert(projects)
      .values({
        slug: `s31-cascade-${Date.now()}`,
        name: "Cascade",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    await db.insert(contentCategories).values({
      projectId: p!.id,
      slug: "to-be-cascaded",
      scope: "tool",
      translations: { de: { label: "x", urlSlug: "x" } },
    });
    await db.delete(projects).where(eq(projects.id, p!.id));
    const rows = await db
      .select()
      .from(contentCategories)
      .where(eq(contentCategories.projectId, p!.id));
    expect(rows).toHaveLength(0);
  });
});
