// Spec 62.0b unit tests for the golden-prompt cache.
// Covers: positive hit (no second DB read), negative cache, invalidation, project isolation.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  clearGoldenPromptCacheForTesting,
  getGoldenPromptCached,
  invalidateGoldenPromptCache,
} from "../../src/engine/golden-prompt-cache.ts";
import { db, eq, projects, promoteToGolden, promptVersions } from "@marketing-auto/db";

const STEP = "cache-test-step";

describe("golden-prompt-cache", () => {
  let projectA: string;
  let projectB: string;

  beforeAll(async () => {
    const ts = Date.now();
    const [a] = await db
      .insert(projects)
      .values({
        slug: `cache-a-${ts}`,
        name: "Cache Test A",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    const [b] = await db
      .insert(projects)
      .values({
        slug: `cache-b-${ts}`,
        name: "Cache Test B",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!a || !b) throw new Error("project insert failed");
    projectA = a.id;
    projectB = b.id;
  });

  afterAll(async () => {
    await db.delete(promptVersions).where(eq(promptVersions.stepName, STEP));
    await db.delete(projects).where(eq(projects.id, projectA));
    await db.delete(projects).where(eq(projects.id, projectB));
  });

  afterEach(() => {
    clearGoldenPromptCacheForTesting();
  });

  it("returns null when no golden exists (and caches the negative result)", async () => {
    const result = await getGoldenPromptCached({ stepName: STEP, projectId: projectA });
    expect(result).toBeNull();

    // Second call returns the cached null without hitting the DB. We verify this
    // indirectly by promoting a golden BETWEEN the two calls and confirming the
    // cache returns stale null (until invalidated).
    await promoteToGolden({
      stepName: STEP,
      projectId: projectA,
      body: "fresh-after-negative-cache",
      sourcePauseId: null,
      promoteNote: null,
      createdBy: "test",
    });
    // Note: in real code promoteToGolden would call invalidateGoldenPromptCache.
    // Here we want to test the raw cache, so we skip invalidation.
    const cached = await getGoldenPromptCached({ stepName: STEP, projectId: projectA });
    expect(cached).toBeNull(); // stale negative-cache hit

    // After invalidation we read the fresh value.
    invalidateGoldenPromptCache({ stepName: STEP, projectId: projectA });
    const fresh = await getGoldenPromptCached({ stepName: STEP, projectId: projectA });
    expect(fresh?.body).toBe("fresh-after-negative-cache");
  });

  it("caches positive hits — second call sees the same value even if DB changes", async () => {
    // Read once → cache the body.
    const first = await getGoldenPromptCached({ stepName: STEP, projectId: projectA });
    expect(first?.body).toBe("fresh-after-negative-cache");

    // Mutate DB without invalidation.
    await db
      .update(promptVersions)
      .set({ body: "mutated-without-invalidation" })
      .where(eq(promptVersions.stepName, STEP));

    const second = await getGoldenPromptCached({ stepName: STEP, projectId: projectA });
    expect(second?.body).toBe("fresh-after-negative-cache"); // cache hit, NOT the new DB value

    invalidateGoldenPromptCache({ stepName: STEP, projectId: projectA });
    const third = await getGoldenPromptCached({ stepName: STEP, projectId: projectA });
    expect(third?.body).toBe("mutated-without-invalidation");
  });

  it("keeps project-scoped entries independent from each other and from global", async () => {
    await promoteToGolden({
      stepName: STEP,
      projectId: projectB,
      body: "project-b-body",
      sourcePauseId: null,
      promoteNote: null,
      createdBy: "test",
    });

    const a = await getGoldenPromptCached({ stepName: STEP, projectId: projectA });
    const b = await getGoldenPromptCached({ stepName: STEP, projectId: projectB });
    const g = await getGoldenPromptCached({ stepName: STEP, projectId: null });

    expect(a?.body).toBe("mutated-without-invalidation");
    expect(b?.body).toBe("project-b-body");
    expect(g).toBeNull();

    // Invalidate only A — B + global stay cached.
    invalidateGoldenPromptCache({ stepName: STEP, projectId: projectA });
    await db
      .update(promptVersions)
      .set({ body: "b-mutated-stale" })
      .where(eq(promptVersions.projectId, projectB));
    const bAgain = await getGoldenPromptCached({ stepName: STEP, projectId: projectB });
    expect(bAgain?.body).toBe("project-b-body"); // still cached value, not the mutated body
  });
});
