/**
 * Spec 62.4 manual-verification script: synchronously runs the PlanWeekPipeline
 * against a real project + ISO week and prints a summary.
 *
 * Usage:
 *   bun run plan:generate <slug> [year] [isoWeek] [--force]
 *
 * Defaults: target = current ISO week. With no signal adapters wired here
 * the refresh step marks all sources as skipped — that's fine, the planner
 * still works against existing topic_briefs + signals already in the DB.
 *
 * For a "live" run with adapter wiring, trigger via the HTTP endpoint instead:
 *   curl -X POST http://localhost:3050/api/projects/<slug>/plans/generate \
 *     -H 'Content-Type: application/json' \
 *     -d '{"targetYear": 2026, "targetIsoWeek": 22, "force": true}'
 */

import {
  db,
  eq,
  listPlannedItemsByPlan,
  pipelineRuns,
  projects,
} from "@marketing-auto/db";
import {
  pipelineRegistry,
  PlanWeekPipeline,
  runPipeline,
} from "@marketing-auto/pipelines";
import { getIsoWeek } from "@marketing-auto/planner";

async function main(): Promise<void> {
  const [slugArg, yearArg, weekArg, ...flags] = process.argv.slice(2);
  if (!slugArg) {
    // biome-ignore lint/suspicious/noConsoleLog: script output
    console.error("Usage: bun run plan:generate <slug> [year] [isoWeek] [--force]");
    process.exit(1);
  }

  const now = new Date();
  const defaultIso = getIsoWeek(now);
  const targetYear = yearArg ? Number.parseInt(yearArg, 10) : defaultIso.year;
  const targetIsoWeek = weekArg ? Number.parseInt(weekArg, 10) : defaultIso.isoWeek;
  const force = flags.includes("--force");

  const [proj] = await db
    .select({ id: projects.id, slug: projects.slug })
    .from(projects)
    .where(eq(projects.slug, slugArg))
    .limit(1);
  if (!proj) {
    // biome-ignore lint/suspicious/noConsoleLog: script output
    console.error(`Project not found: ${slugArg}`);
    process.exit(1);
  }

  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log(
    `\nGenerating plan for "${proj.slug}" — KW${targetIsoWeek}/${targetYear}` +
      (force ? " (force, supersedes prior)" : "") +
      "\n",
  );

  const pipeline = new PlanWeekPipeline({
    resolvePipelineSteps: (name) => pipelineRegistry.get(name)?.steps,
    // No adapter fetchers wired — refresh step will mark all sources as
    // "skipped" with note "No fetcher wired by caller". Existing
    // external_signals rows are still snapshotted by signal-top-n.
    refreshDeps: {
      fetchers: {},
      readCreds: async () => ({}),
    },
  });

  const result = await runPipeline(
    pipeline,
    {
      projectId: proj.id,
      targetYear,
      targetIsoWeek,
      triggeredBy: "cli",
      force,
    },
    { projectId: proj.id },
  );

  if (!result.ok) {
    // biome-ignore lint/suspicious/noConsoleLog: script output
    console.error(`\n❌ Pipeline failed at "${result.failedAtStep}": ${result.error}\n`);
    process.exit(1);
  }

  const planRunRow = await db
    .select({ runId: pipelineRuns.id })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.id, result.runId))
    .limit(1);

  const items = await listPlannedItemsByPlan(result.output.weeklyPlanId);

  // Summary
  /* biome-ignore lint/suspicious/noConsoleLog: script output */
  console.log("─".repeat(60));
  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log(`✓ Plan ${result.output.weeklyPlanId}`);
  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log(`  status:          ${result.output.status}`);
  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log(`  itemCount:       ${result.output.itemCount}`);
  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log(`  estimatedCost:   €${result.output.estimatedCostEur.toFixed(2)}`);
  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log(`  supersededPlan:  ${result.output.supersededPlanId ?? "—"}`);
  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log(`  pipelineRunId:   ${planRunRow[0]?.runId ?? "—"}`);
  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log("─".repeat(60));

  // Per-day breakdown
  const byDay = new Map<string, typeof items>();
  for (const it of items) {
    const key = (it.slotDate instanceof Date ? it.slotDate : new Date(it.slotDate))
      .toISOString()
      .slice(0, 10);
    const bucket = byDay.get(key) ?? [];
    bucket.push(it);
    byDay.set(key, bucket);
  }
  for (const [day, bucket] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    // biome-ignore lint/suspicious/noConsoleLog: script output
    console.log(`\n${day} — ${bucket.length} item${bucket.length === 1 ? "" : "s"}`);
    for (const it of bucket) {
      const score = it.selectionScore ? ` score=${Number(it.selectionScore).toFixed(2)}` : "";
      // biome-ignore lint/suspicious/noConsoleLog: script output
      console.log(
        `  · [${it.sourceKind}] ${it.contentType.padEnd(11)} ${it.pipelineName}${score}`,
      );
      // biome-ignore lint/suspicious/noConsoleLog: script output
      console.log(`      ${it.selectionReason ?? ""}`);
    }
  }
  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log("");
}

void main()
  .then(() => process.exit(0))
  .catch((err) => {
    // biome-ignore lint/suspicious/noConsoleLog: script output
    console.error(err);
    process.exit(1);
  });
