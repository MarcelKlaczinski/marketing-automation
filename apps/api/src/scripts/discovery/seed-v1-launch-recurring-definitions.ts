/**
 * Seed 3 hand-picked recurring_content_definitions for Marcel's V1-launch
 * live-test of Theme 65. One per Family-B narrative format + one Family-A
 * data-driven grid. All set to next_run_at=NOW() so the 15-min cron
 * coordinator picks them up immediately.
 *
 * Auto-approve stays project-default (FALSE) → briefs land as plan_pending
 * for Marcel review.
 *
 * Re-run safe via name-based existence check (deletes the 3 rows if they
 * already exist with `--reseed`, else no-op).
 */
import { db, projects, recurringContentDefinitions, eq, and, inArray, sql } from "@marketing-auto/db";

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");
const RESEED = args.has("--reseed");

const [project] = await db.select().from(projects).where(eq(projects.slug, "toolwiki"));
if (!project) {
  console.error("toolwiki project not found");
  process.exit(1);
}
const pid = project.id;
console.log(`Toolwiki project_id: ${pid}`);
console.log(`Mode: ${APPLY ? (RESEED ? "APPLY (re-seed)" : "APPLY") : "DRY-RUN (preview SQL only)"}`);

// Tool article-id resolved fresh from the DB at script-time (avoids hardcoding
// a project-specific UUID into a committed script).
const tools = await db.execute(sql`
  SELECT id, slug FROM articles
  WHERE project_id = ${pid} AND collection = 'tools' AND locale = 'de'
    AND slug = 'chatgpt'
`);
const chatgptId = String(tools[0]?.id ?? "");
if (!chatgptId) {
  console.error("ChatGPT tool article not found");
  process.exit(1);
}
console.log(`ChatGPT tool_id: ${chatgptId}`);

const definitions = [
  {
    name: "Karriere-Disruption — Wissensarbeit & ChatGPT",
    formatType: "story_arc_clickbait",
    formatConfig: {
      toolToFeature: chatgptId,
      professionPool: ["Texter", "Übersetzer", "SEO-Manager", "Journalist", "Marketing-Manager"],
      narrativeAngle: "career-disruption",
      toneIntensity: "dramatic",
    },
    frequency: "weekly",
  },
  {
    name: "Solopreneur-Alltag mit KI — Wöchentliches Tool",
    formatType: "lifestyle_listicle",
    formatConfig: {
      lifeArea: "Solopreneur-Alltag",
      itemCount: 3, // V1 template renders EXACTLY 3 items (Cover/Intro/Item×3/End)
      toolFilter: {
        categorySlugs: ["business-productivity", "marketing-seo"],
        personaFilter: "solopreneurs",
      },
    },
    frequency: "weekly",
  },
  {
    name: "Top 5 KI-Video-Tools — Wöchentliches Ranking",
    formatType: "top_n_comparison",
    formatConfig: {
      categorySlug: "video-animation",
      topN: 5,
      rankingSource: "llm-curated",
      excludeRecentlyUsed: true,
    },
    frequency: "weekly",
  },
] as const;

console.log("\n=== SQL PREVIEW (INSERT statements) ===\n");
for (const d of definitions) {
  console.log(`-- ${d.name}`);
  const formatConfigJson = JSON.stringify(d.formatConfig);
  console.log(`INSERT INTO recurring_content_definitions
  (project_id, name, format_type, format_config, frequency, next_run_at,
   output_targets, template_selection_strategy, end_slide_strategy, end_slide_pool,
   target_locales, is_active, auto_approve_override)
VALUES
  ('${pid}',
   ${sqlString(d.name)},
   '${d.formatType}',
   '${formatConfigJson}'::jsonb,
   '${d.frequency}',
   NOW(),
   '{"article":false,"social":true}'::jsonb,
   'lru',
   'rotation',
   '[]'::jsonb,
   '["de","en"]'::jsonb,
   TRUE,
   NULL);
`);
}

function sqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

if (!APPLY) {
  console.log("\nDRY-RUN complete — re-run with --apply to INSERT");
  process.exit(0);
}

if (RESEED) {
  const names = definitions.map((d) => d.name);
  const deleted = await db
    .delete(recurringContentDefinitions)
    .where(
      and(
        eq(recurringContentDefinitions.projectId, pid),
        inArray(recurringContentDefinitions.name, names),
      ),
    )
    .returning({ id: recurringContentDefinitions.id });
  console.log(`\n--reseed: deleted ${deleted.length} prior rows by name match`);
} else {
  const existing = await db
    .select({ id: recurringContentDefinitions.id, name: recurringContentDefinitions.name })
    .from(recurringContentDefinitions)
    .where(
      and(
        eq(recurringContentDefinitions.projectId, pid),
        inArray(
          recurringContentDefinitions.name,
          definitions.map((d) => d.name),
        ),
      ),
    );
  if (existing.length > 0) {
    console.log(`\nABORT: ${existing.length} definition(s) already exist with these names:`);
    for (const e of existing) console.log(`  - ${e.name} (${String(e.id).slice(0, 8)})`);
    console.log("Pass --reseed to delete + re-insert.");
    process.exit(2);
  }
}

console.log("\n=== APPLYING INSERTS ===");
const inserted = await db
  .insert(recurringContentDefinitions)
  .values(
    definitions.map((d) => ({
      projectId: pid,
      name: d.name,
      formatType: d.formatType,
      formatConfig: d.formatConfig as Record<string, unknown>,
      frequency: d.frequency,
      nextRunAt: new Date(),
      targetLocales: ["de", "en"],
      isActive: true,
    })),
  )
  .returning({
    id: recurringContentDefinitions.id,
    name: recurringContentDefinitions.name,
    formatType: recurringContentDefinitions.formatType,
    nextRunAt: recurringContentDefinitions.nextRunAt,
  });

console.log(`Inserted ${inserted.length} rows:`);
for (const r of inserted) {
  console.log(`  ${r.formatType.padEnd(24)} ${String(r.id)}  next_run=${r.nextRunAt.toISOString()}`);
  console.log(`    "${r.name}"`);
}

console.log("\n=== NEXT STEPS ===");
console.log("1. Confirm worker is running (apps/api worker process).");
console.log("2. Within 15 min the recurring-content cron will pick these up.");
console.log("3. Each definition fires ONCE → 3 plan_pending briefs in topic_briefs.");
console.log("4. Cost estimate per first-fire: ~€0.40 (story-arc + lifestyle) + €0.06 (top-n) ≈ €0.86 total.");
console.log("5. Visit /projects/toolwiki/briefs to approve before they enter the planner.");

process.exit(0);
