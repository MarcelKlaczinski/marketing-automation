/**
 * Discovery script — aggregate `cost_logs.cost_eur` by
 * (parent pipeline_name, operation) over the last 30 days. Companion to
 * `check-cost-estimate.ts`: this one drills into the per-LLM-op cost so
 * each step's `estimatedCostEur()` can be calibrated against the real
 * `operation` it logs (e.g. `article-draft`, `translate-draft`).
 *
 * Joins `cost_logs.pipeline_run_id → child` then walks
 * `COALESCE(child.parent_run_id, child.id)` to the parent row — this is
 * the standard 1-parent + N-child shape (Spec 004 / F2, packages/pipelines/CLAUDE.md).
 *
 * Hardcoded `slug = "toolwiki"` because the audit is tenant-specific.
 * Read-only — no `--apply` flag (Pattern 121 / Memory D146).
 *
 * Usage: `bun --env-file .env apps/api/src/scripts/discovery/check-cost-per-step.ts`
 */
import { db, projects, eq, sql } from "@marketing-auto/db";

const [proj] = await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, "toolwiki")).limit(1);
if (!proj) process.exit(1);

const cutoff = new Date(Date.now() - 30 * 86_400_000);

// Cost per (parent pipeline_name, operation) over last 30d
const rows = await db.execute(sql`
  SELECT
    parent.pipeline_name AS pipeline,
    cl.operation AS op,
    COUNT(*)::int AS calls,
    COALESCE(SUM(cl.cost_eur::numeric), 0)::float AS total_eur,
    COALESCE(AVG(cl.cost_eur::numeric), 0)::float AS avg_eur
  FROM cost_logs cl
  JOIN pipeline_runs child ON child.id = cl.pipeline_run_id
  JOIN pipeline_runs parent ON parent.id = COALESCE(child.parent_run_id, child.id)
  WHERE parent.project_id = ${proj.id}
    AND parent.created_at >= ${cutoff.toISOString()}
    AND parent.step_name IS NULL
  GROUP BY parent.pipeline_name, cl.operation
  ORDER BY parent.pipeline_name, total_eur DESC
`);

// `db.execute(sql\`...\`)` returns a typed Drizzle execute result for which we
// only need the row array; the SQL above is fixed so the cast to the literal
// row shape is safe (verified at write time against the SELECT).
let prev = "";
for (const r of rows as unknown as Array<{pipeline:string;op:string;calls:number;total_eur:number;avg_eur:number}>) {
  if (r.pipeline !== prev) {
    // biome-ignore lint/suspicious/noConsoleLog: script output
    console.log(`\n--- ${r.pipeline} ---`);
    prev = r.pipeline;
  }
  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log(`  ${String(r.op).padEnd(40)} calls=${String(r.calls).padStart(3)}  total=€${r.total_eur.toFixed(4).padStart(8)}  avg=€${r.avg_eur.toFixed(4).padStart(8)}`);
}
process.exit(0);
