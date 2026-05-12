import { costLogs, db, projects } from "@marketing-auto/db";
import { and, eq, gte, sql } from "drizzle-orm";

/**
 * Returns a per-service spend breakdown for a project for today and current month.
 * Used by GET /api/projects/:id/costs/summary.
 */
export async function getProjectCostSummary(projectId: string): Promise<{
  today: Array<{ service: string; eur: number }>;
  month: Array<{ service: string; eur: number }>;
  totals: { todayEur: number; monthEur: number };
}> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const rows = await db
    .select({
      service: costLogs.service,
      todayEur: sql<string>`COALESCE(SUM(CASE WHEN ${costLogs.createdAt} >= ${startOfDay.toISOString()} THEN ${costLogs.costEur} ELSE 0 END), 0)`,
      monthEur: sql<string>`COALESCE(SUM(${costLogs.costEur}), 0)`,
    })
    .from(costLogs)
    .where(and(eq(costLogs.projectId, projectId), gte(costLogs.createdAt, startOfMonth)))
    .groupBy(costLogs.service);

  const today: Array<{ service: string; eur: number }> = [];
  const month: Array<{ service: string; eur: number }> = [];
  let todayTotal = 0;
  let monthTotal = 0;

  for (const row of rows) {
    const t = Number(row.todayEur);
    const m = Number(row.monthEur);
    if (t > 0) today.push({ service: row.service, eur: t });
    if (m > 0) month.push({ service: row.service, eur: m });
    todayTotal += t;
    monthTotal += m;
  }

  return { today, month, totals: { todayEur: todayTotal, monthEur: monthTotal } };
}

/**
 * CLI report: prints all projects' current spend.
 * Usage: bun --filter @marketing-auto/cost-tracker run report
 *
 * console.log is intentional here — this is human-readable CLI output.
 * Pino structured JSON would make the report unreadable in a terminal.
 */
export async function printAllProjectsReport(): Promise<void> {
  const allProjects = await db
    .select({ id: projects.id, name: projects.name, slug: projects.slug })
    .from(projects);

  // biome-ignore lint/suspicious/noConsoleLog: intentional CLI report output — pino JSON would be unreadable in terminal
  console.log("\n📊 Cost Report - " + new Date().toISOString().split("T")[0] + "\n");

  for (const p of allProjects) {
    const summary = await getProjectCostSummary(p.id);
    // biome-ignore lint/suspicious/noConsoleLog: intentional CLI report output
    console.log(`\n=== ${p.name} (${p.slug}) ===`);
    // biome-ignore lint/suspicious/noConsoleLog: intentional CLI report output
    console.log(`Today:  €${summary.totals.todayEur.toFixed(4)}`);
    // biome-ignore lint/suspicious/noConsoleLog: intentional CLI report output
    console.log(`Month:  €${summary.totals.monthEur.toFixed(4)}`);
    if (summary.today.length > 0) {
      // biome-ignore lint/suspicious/noConsoleLog: intentional CLI report output
      console.log("  Today by service:");
      for (const s of summary.today) {
        // biome-ignore lint/suspicious/noConsoleLog: intentional CLI report output
        console.log(`    ${s.service.padEnd(20)} €${s.eur.toFixed(4)}`);
      }
    }
  }
}

if (import.meta.main) {
  await printAllProjectsReport();
  process.exit(0);
}
