import { Hono } from "hono";
import { eq, desc, like, and } from "drizzle-orm";
import { db, pipelineRuns } from "@marketing-auto/db";
import { requireAuth } from "../middleware/auth.ts";

export const pipelineRunsRoutes = new Hono();

pipelineRunsRoutes.use(requireAuth);

pipelineRunsRoutes.get("/project/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const pipelineNamePrefix = c.req.query("pipelineNamePrefix");

  const conditions = [eq(pipelineRuns.projectId, projectId)];
  if (pipelineNamePrefix) {
    conditions.push(like(pipelineRuns.pipelineName, `${pipelineNamePrefix}%`));
  }

  const rows = await db
    .select()
    .from(pipelineRuns)
    .where(and(...conditions))
    .orderBy(desc(pipelineRuns.createdAt))
    .limit(limit);

  return c.json({ ok: true, data: rows });
});

pipelineRunsRoutes.get("/:runId", async (c) => {
  const runId = c.req.param("runId");
  const [run] = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).limit(1);
  if (!run) return c.json({ ok: false, error: "Run not found" }, 404);

  return c.json({
    ok: true,
    data: {
      id: run.id,
      pipelineName: run.pipelineName,
      projectId: run.projectId,
      status: run.status,
      stepName: run.stepName,
      input: run.input,
      output: run.output,
      error: run.errorMessage,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      createdAt: run.createdAt,
    },
  });
});
