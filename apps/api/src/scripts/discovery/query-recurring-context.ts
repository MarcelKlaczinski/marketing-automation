import { db, projects, eq, sql } from "@marketing-auto/db";

const [project] = await db.select().from(projects).where(eq(projects.slug, "toolwiki"));
if (!project) process.exit(1);
const pid = project.id;

console.log("project_id:", pid);
console.log("target_locales:", project.targetLocales);

console.log("\n=== HOOK_TEMPLATES (Toolwiki) ===");
const hooks = await db.execute(sql`
  SELECT format_type, language, COUNT(*) AS n
  FROM hook_templates
  WHERE project_id = ${pid} AND is_active = TRUE
  GROUP BY format_type, language
  ORDER BY format_type, language
`);
for (const r of hooks) console.log(" ", r.format_type, "|", r.language, "x", r.n);

console.log("\n=== SAMPLE HOOKS (DE) ===");
for (const fmt of ["story_arc_clickbait", "lifestyle_listicle", "opinion_recommendation"]) {
  const rows = await db.execute(sql`
    SELECT pattern, variables
    FROM hook_templates
    WHERE project_id = ${pid} AND format_type = ${fmt} AND language = 'de' AND is_active = TRUE
    LIMIT 4
  `);
  console.log(`\n  ${fmt}:`);
  for (const r of rows) console.log(`    "${r.pattern}"  vars=${JSON.stringify(r.variables)}`);
}

console.log("\n=== END_SLIDE_DEFINITIONS (Toolwiki) ===");
const endSlides = await db.execute(sql`
  SELECT id, type, name FROM end_slide_definitions
  WHERE project_id = ${pid} AND is_active = TRUE
  ORDER BY type
`);
for (const r of endSlides) console.log(" ", String(r.type).padEnd(20), "-", r.name, `(${String(r.id).slice(0, 8)})`);

console.log("\n=== TOOL_BRAND_ASSETS COVERAGE ===");
const bac = await db.execute(sql`
  SELECT COUNT(*) AS rows,
         COUNT(*) FILTER (WHERE tba.logo_url IS NOT NULL) AS has_logo,
         COUNT(*) FILTER (WHERE tba.primary_color IS NOT NULL) AS has_color,
         COUNT(*) FILTER (WHERE tba.source = 'deterministic-avatar') AS avatar_fallback
  FROM tool_brand_assets tba
  JOIN articles a ON a.id = tba.tool_id
  WHERE a.project_id = ${pid}
`);
console.log(" ", bac[0]);

console.log("\n=== TOOLS WITH BRAND ASSETS (DE-only, per category) ===");
const tools = await db.execute(sql`
  SELECT a.id, a.slug, a.title, a.category, a.tool_pricing,
         tba.logo_url IS NOT NULL AS has_logo,
         tba.primary_color IS NOT NULL AS has_color,
         tba.source AS asset_source
  FROM articles a
  LEFT JOIN tool_brand_assets tba ON tba.tool_id = a.id
  WHERE a.project_id = ${pid}
    AND a.collection = 'tools'
    AND a.locale = 'de'
  ORDER BY a.category, a.title
`);
const byCategory: Record<string, any[]> = {};
for (const t of tools) {
  const cat = String(t.category ?? "uncategorized");
  if (!byCategory[cat]) byCategory[cat] = [];
  byCategory[cat].push(t);
}
for (const cat of Object.keys(byCategory).sort()) {
  const rows = byCategory[cat] ?? [];
  console.log(`\n  [${cat}] (${rows.length})`);
  for (const t of rows) {
    const flag = (t.has_logo ? "L" : "-") + (t.has_color ? "C" : "-");
    const src = t.asset_source ? `[${t.asset_source}]` : "[-]";
    console.log(`    ${flag} ${String(t.slug).padEnd(28)} ${src.padEnd(22)} ${String(t.id).slice(0,8)}  ${t.title}`);
  }
}

console.log("\n=== TOOL_PERSONA_SCORES coverage ===");
const tps = await db.execute(sql`
  SELECT persona, COUNT(*) AS n
  FROM tool_persona_scores
  WHERE project_id = ${pid}
  GROUP BY persona
  ORDER BY persona
`);
if (tps.length === 0) console.log("  (no rows — lazy scoring will fire at first brief-gen)");
for (const r of tps) console.log(" ", r.persona, "x", r.n);

console.log("\n=== EXISTING RECURRING_CONTENT_DEFINITIONS ===");
const existing = await db.execute(sql`
  SELECT id, name, format_type, frequency, is_active, next_run_at, last_run_at
  FROM recurring_content_definitions
  WHERE project_id = ${pid}
  ORDER BY created_at DESC
`);
if (existing.length === 0) console.log("  (none)");
for (const r of existing) console.log(" ", r.format_type, "|", r.name, "active=", r.is_active);

console.log("\n=== DEFAULT_PERSONAS ===");
const { DEFAULT_PERSONAS } = await import("@marketing-auto/shared/recurring-content");
// DEFAULT_PERSONAS is `readonly string[]`, not `{slug, name}[]` — just print
// the slugs (the natural-language definitions live in PERSONA_DEFINITIONS).
for (const p of DEFAULT_PERSONAS) console.log(" ", p);

process.exit(0);
