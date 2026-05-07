import { afterAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src/client.ts";
import { projects } from "../src/schema/index.ts";

describe("Schema smoke test", () => {
  let projectId: string;

  it("inserts and reads a project", async () => {
    const [inserted] = await db
      .insert(projects)
      .values({
        slug: "test-project-" + Date.now(),
        name: "Test Project",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();

    expect(inserted).toBeDefined();
    expect(inserted!.lifecycleStage).toBe("cold_start");
    projectId = inserted!.id;

    const [read] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(read).toBeDefined();
    expect(read!.name).toBe("Test Project");
  });

  afterAll(async () => {
    if (projectId) {
      await db.delete(projects).where(eq(projects.id, projectId));
    }
  });
});
