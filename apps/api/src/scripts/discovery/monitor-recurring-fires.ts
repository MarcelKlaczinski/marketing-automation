/**
 * Single-shot snapshot of recurring-content cron + worker state.
 * Run periodically (cron, watch loop, etc.) to track first-fire progress.
 */
import { db, sql } from "@marketing-auto/db";

const pid = "3fad7929-b06d-47ce-b6a1-8ac134362c42";
const stamp = new Date().toISOString();
console.log(`\n=== ${stamp} ===`);

const defs = await db.execute(sql`
  SELECT format_type, name,
         to_char(next_run_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS next_utc,
         to_char(last_run_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS last_utc,
         next_run_at <= NOW() AS due
  FROM recurring_content_definitions
  WHERE project_id = ${pid}
  ORDER BY format_type
`);
console.log("Definitions:");
for (const d of defs) {
  const lastStr = d.last_utc ? String(d.last_utc) : "(never)";
  console.log(
    `  ${String(d.format_type).padEnd(24)} due=${d.due ? "YES" : "no"} last=${lastStr} next=${d.next_utc}`,
  );
}

const briefs = await db.execute(sql`
  SELECT
    (recurring_metadata->>'definitionId') AS def_id,
    (recurring_metadata->>'targetLocale') AS locale,
    (recurring_metadata->>'runGroupId') AS run_group,
    approval_status, source,
    to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS created_utc,
    topic_title
  FROM topic_briefs
  WHERE project_id = ${pid} AND source = 'recurring'
  ORDER BY created_at DESC
  LIMIT 20
`);
console.log(`\nRecurring briefs total: ${briefs.length}`);
for (const b of briefs) {
  console.log(
    `  [${b.created_utc}] ${String(b.locale ?? "?").padEnd(2)} ${String(b.approval_status).padEnd(12)} def=${String(b.def_id).slice(0, 8)} group=${String(b.run_group ?? "-").slice(0, 8)}  "${b.topic_title}"`,
  );
}

const runs = await db.execute(sql`
  SELECT pipeline_name, status, started_at, completed_at, error_message
  FROM pipeline_runs
  WHERE project_id = ${pid}
    AND started_at > NOW() - INTERVAL '1 hour'
    AND pipeline_name IN ('article:social-image', 'recurring-brief-generator')
  ORDER BY started_at DESC
  LIMIT 10
`);
console.log(`\nPipeline runs (last 1h): ${runs.length}`);
for (const r of runs) {
  const t = String(r.started_at).slice(11, 19);
  const err = r.error_message ? ` ERR=${String(r.error_message).slice(0, 60)}` : "";
  console.log(`  [${t}] ${String(r.pipeline_name).padEnd(28)} ${String(r.status).padEnd(10)}${err}`);
}

const skipNotifs = await db.execute(sql`
  SELECT type, severity, title, created_at, metadata
  FROM notifications
  WHERE created_at > NOW() - INTERVAL '1 hour'
    AND (
      type LIKE '%recurring%'
      OR title LIKE '%recurring%'
      OR title LIKE '%brief%skipped%'
      OR metadata->>'definitionId' IS NOT NULL
    )
  ORDER BY created_at DESC
  LIMIT 5
`);
if (skipNotifs.length > 0) {
  console.log(`\nNotifications (last 1h): ${skipNotifs.length}`);
  for (const n of skipNotifs) {
    const t = String(n.created_at).slice(11, 19);
    console.log(`  [${t}] ${n.severity} | ${n.title}`);
  }
}

const queue = await db.execute(sql`
  SELECT COUNT(*) AS n
  FROM social_posts
  WHERE project_id = ${pid}
    AND render_started_at > NOW() - INTERVAL '1 hour'
`);
console.log(`\nSocial-renders started last 1h: ${queue[0]?.n ?? 0}`);

process.exit(0);
