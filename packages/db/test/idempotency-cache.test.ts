// Spec 62.0a unit tests for the idempotency-cache helpers.
// Covers: cache miss, cache hit, TTL expiry, per-project isolation, idempotent write.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  db,
  eq,
  getIdempotencyOutput,
  idempotencyOutputs,
  projects,
  writeIdempotencyOutput,
} from "../src/index.ts";

const PIPELINE = "test:idempotency";
const STEP = "step-a";

describe("idempotency-cache", () => {
  let projectA: string;
  let projectB: string;

  beforeAll(async () => {
    const ts = Date.now();
    const [a] = await db
      .insert(projects)
      .values({
        slug: `idem-a-${ts}`,
        name: "Idempotency Test A",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    const [b] = await db
      .insert(projects)
      .values({
        slug: `idem-b-${ts}`,
        name: "Idempotency Test B",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!a || !b) throw new Error("project insert failed");
    projectA = a.id;
    projectB = b.id;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectA));
    await db.delete(projects).where(eq(projects.id, projectB));
  });

  it("returns null on cache miss", async () => {
    const result = await getIdempotencyOutput({
      idempotencyKey: "never-stored",
      pipelineName: PIPELINE,
      stepName: STEP,
      projectId: projectA,
    });
    expect(result).toBeNull();
  });

  it("writes + reads back a cached output (cache hit)", async () => {
    await writeIdempotencyOutput({
      idempotencyKey: "k1",
      pipelineName: PIPELINE,
      stepName: STEP,
      projectId: projectA,
      stepOutput: { value: 42 },
      costEur: 0.05,
    });
    const result = await getIdempotencyOutput({
      idempotencyKey: "k1",
      pipelineName: PIPELINE,
      stepName: STEP,
      projectId: projectA,
    });
    expect(result).not.toBeNull();
    expect(result!.stepOutput).toEqual({ value: 42 });
    expect(Number(result!.costEur)).toBeCloseTo(0.05, 6);
  });

  it("ON CONFLICT DO NOTHING — second write with same key does not overwrite", async () => {
    await writeIdempotencyOutput({
      idempotencyKey: "k-conflict",
      pipelineName: PIPELINE,
      stepName: STEP,
      projectId: projectA,
      stepOutput: { source: "first" },
    });
    await writeIdempotencyOutput({
      idempotencyKey: "k-conflict",
      pipelineName: PIPELINE,
      stepName: STEP,
      projectId: projectA,
      stepOutput: { source: "second" }, // would-be overwrite
    });
    const result = await getIdempotencyOutput({
      idempotencyKey: "k-conflict",
      pipelineName: PIPELINE,
      stepName: STEP,
      projectId: projectA,
    });
    expect(result!.stepOutput).toEqual({ source: "first" });
  });

  it("isolates cache entries by projectId", async () => {
    await writeIdempotencyOutput({
      idempotencyKey: "shared-key",
      pipelineName: PIPELINE,
      stepName: STEP,
      projectId: projectA,
      stepOutput: { owner: "A" },
    });
    await writeIdempotencyOutput({
      idempotencyKey: "shared-key",
      pipelineName: PIPELINE,
      stepName: STEP,
      projectId: projectB,
      stepOutput: { owner: "B" },
    });

    const a = await getIdempotencyOutput({
      idempotencyKey: "shared-key",
      pipelineName: PIPELINE,
      stepName: STEP,
      projectId: projectA,
    });
    const b = await getIdempotencyOutput({
      idempotencyKey: "shared-key",
      pipelineName: PIPELINE,
      stepName: STEP,
      projectId: projectB,
    });
    expect(a!.stepOutput).toEqual({ owner: "A" });
    expect(b!.stepOutput).toEqual({ owner: "B" });
  });

  it("respects expiresAt — already-expired rows are not returned", async () => {
    const pastExpiry = new Date(Date.now() - 1000); // 1 second ago
    await writeIdempotencyOutput({
      idempotencyKey: "k-expired",
      pipelineName: PIPELINE,
      stepName: STEP,
      projectId: projectA,
      stepOutput: { stale: true },
      expiresAt: pastExpiry,
    });
    const result = await getIdempotencyOutput({
      idempotencyKey: "k-expired",
      pipelineName: PIPELINE,
      stepName: STEP,
      projectId: projectA,
    });
    expect(result).toBeNull();

    // Sanity check: the row IS persisted (just filtered out by expiresAt check)
    const raw = await db
      .select()
      .from(idempotencyOutputs)
      .where(eq(idempotencyOutputs.idempotencyKey, "k-expired"));
    expect(raw.length).toBe(1);
  });

  it("isolates cache entries by stepName within the same pipeline", async () => {
    await writeIdempotencyOutput({
      idempotencyKey: "k-step",
      pipelineName: PIPELINE,
      stepName: "step-a",
      projectId: projectA,
      stepOutput: { fromStep: "a" },
    });
    await writeIdempotencyOutput({
      idempotencyKey: "k-step",
      pipelineName: PIPELINE,
      stepName: "step-b",
      projectId: projectA,
      stepOutput: { fromStep: "b" },
    });
    const a = await getIdempotencyOutput({
      idempotencyKey: "k-step",
      pipelineName: PIPELINE,
      stepName: "step-a",
      projectId: projectA,
    });
    const b = await getIdempotencyOutput({
      idempotencyKey: "k-step",
      pipelineName: PIPELINE,
      stepName: "step-b",
      projectId: projectA,
    });
    expect(a!.stepOutput).toEqual({ fromStep: "a" });
    expect(b!.stepOutput).toEqual({ fromStep: "b" });
  });
});
