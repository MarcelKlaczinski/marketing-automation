/**
 * Discovery script — compare real 30-day cost per pipeline against the
 * Planner's per-step `estimatedCostEur()` upper bounds. Used in Spec 65.x
 * (cost-recalibration session 2026-05-27) to surface the systematic
 * over-estimation that triggered false-positive budget overruns at plan
 * generation time.
 *
 * Hardcoded `slug = "toolwiki"` because the audit is tenant-specific.
 * Read-only — no `--apply` flag (Pattern 121 / Memory D146).
 *
 * Usage: `bun --env-file .env apps/api/src/scripts/discovery/check-cost-estimate.ts`
 */
import { db, costLogs, pipelineRuns, projects, projectPlannerConfig, eq, and, gte, sql } from "@marketing-auto/db";

const slug = "toolwiki";
const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, slug)).limit(1);
if (!project) {
  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log("project not found");
  process.exit(1);
}

const [cfg] = await db.select({ weeklyBudgetEur: projectPlannerConfig.weeklyBudgetEur })
  .from(projectPlannerConfig).where(eq(projectPlannerConfig.projectId, project.id)).limit(1);

const cutoff = new Date(Date.now() - 30 * 86_400_000);

// Actual cost per pipeline_name over last 30 days
const rows = await db.select({
  pipelineName: pipelineRuns.pipelineName,
  runCount: sql<number>`COUNT(DISTINCT ${pipelineRuns.id})::int`,
  totalEur: sql<number>`COALESCE(SUM(${costLogs.costEur}::numeric), 0)::float`,
  avgEur: sql<number>`COALESCE(SUM(${costLogs.costEur}::numeric) / NULLIF(COUNT(DISTINCT ${pipelineRuns.id}), 0), 0)::float`,
}).from(pipelineRuns)
  .leftJoin(costLogs, eq(costLogs.pipelineRunId, pipelineRuns.id))
  .where(and(
    eq(pipelineRuns.projectId, project.id),
    gte(pipelineRuns.createdAt, cutoff),
    sql`${pipelineRuns.stepName} IS NULL`,
    eq(pipelineRuns.status, "completed"),
  ))
  .groupBy(pipelineRuns.pipelineName)
  .orderBy(sql`SUM(${costLogs.costEur}::numeric) DESC NULLS LAST`);

// biome-ignore lint/suspicious/noConsoleLog: script output
console.log(`\n=== Toolwiki weekly budget: €${cfg?.weeklyBudgetEur ?? "(no config)"}`);
// biome-ignore lint/suspicious/noConsoleLog: script output
console.log(`=== Actual cost per pipeline (last 30d, completed runs only):\n`);
for (const r of rows) {
  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log(`  ${r.pipelineName.padEnd(40)} runs=${String(r.runCount).padStart(3)}  total=€${r.totalEur.toFixed(4).padStart(8)}  avg/run=€${r.avgEur.toFixed(4).padStart(8)}`);
}

// Last 7 days total
const sevenDayCutoff = new Date(Date.now() - 7 * 86_400_000);
const [last7] = await db.select({
  totalEur: sql<number>`COALESCE(SUM(${costLogs.costEur}::numeric), 0)::float`,
  callCount: sql<number>`COUNT(*)::int`,
}).from(costLogs)
  .where(and(eq(costLogs.projectId, project.id), gte(costLogs.createdAt, sevenDayCutoff)));

// biome-ignore lint/suspicious/noConsoleLog: script output
console.log(`\n=== Last 7d total spend: €${last7?.totalEur.toFixed(4) ?? "0"} across ${last7?.callCount ?? 0} cost_log calls`);

process.exit(0);
