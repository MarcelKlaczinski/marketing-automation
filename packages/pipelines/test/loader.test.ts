import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { db, projects } from "@marketing-auto/db";
import { loadProjectContext, _resetProjectContextCache } from "../src/skills/loader.ts";

describe("loadProjectContext", () => {
  const slug = `loader-test-${Date.now()}`;
  let projectId: string;

  beforeAll(async () => {
    const [p] = await db.insert(projects).values({
      slug,
      name: "Loader Test",
      industry: "ai_education",
      pipelineTemplate: "educational",
      marketingContextMd: "# Hello",
    }).returning();
    projectId = p!.id;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
    _resetProjectContextCache();
  });

  it("returns content by slug", async () => {
    _resetProjectContextCache();
    const result = await loadProjectContext(slug);
    expect(result).toBe("# Hello");
  });

  it("returns content by uuid", async () => {
    _resetProjectContextCache();
    const result = await loadProjectContext(projectId);
    expect(result).toBe("# Hello");
  });

  it("returns null for nonexistent project", async () => {
    _resetProjectContextCache();
    const result = await loadProjectContext("absolutely-no-such-slug");
    expect(result).toBeNull();
  });

  it("caches results for subsequent calls", async () => {
    _resetProjectContextCache();
    const first = await loadProjectContext(slug);
    const second = await loadProjectContext(slug);
    expect(first).toBe(second);
  });
});
