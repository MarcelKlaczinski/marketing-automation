#!/usr/bin/env bun
import { eq } from "drizzle-orm";
import { db, projects } from "@marketing-auto/db";
import { runPipeline } from "@marketing-auto/pipelines";
import {
  GoLiveChecklistPipeline,
  type GoLiveChecklistOutput,
} from "@marketing-auto/pipelines/cold-start";
import {
  coldStartFile,
  COLD_START_FILES,
  writeMarkdownAtomic,
  readMarkdownIfExists,
} from "@marketing-auto/pipelines/cold-start/shared";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("cold-start:go-live");

const slug = process.argv[2];
const force = process.argv.includes("--force");

if (!slug) {
  console.error(
    "Usage: bun src/scripts/cold-start/05-go-live-checklist.ts <slug> [--force]",
  );
  process.exit(1);
}

const [project] = await db
  .select()
  .from(projects)
  .where(eq(projects.slug, slug))
  .limit(1);

if (!project) {
  console.error(`Project not found: ${slug}. Create it via 'add-project' first.`);
  process.exit(1);
}

// ─── Guard: output file ───────────────────────────────────────────────────────

const outputPath = coldStartFile(slug, COLD_START_FILES.goLiveChecklist);
const existing = await readMarkdownIfExists(outputPath);
if (existing && !force) {
  console.error(`${outputPath} already exists. Use --force to regenerate.`);
  process.exit(1);
}

// ─── Guard: all prior phases must exist ──────────────────────────────────────

const requiredFiles = [
  { label: "Voice refinement (phase 1)", path: coldStartFile(slug, COLD_START_FILES.voiceRefinement) },
  { label: "Competitor analysis (phase 2)", path: coldStartFile(slug, COLD_START_FILES.competitorAnalysis) },
  { label: "Cluster plan (phase 3)", path: coldStartFile(slug, COLD_START_FILES.clusterPlan) },
  { label: "Cornerstone list (phase 4)", path: coldStartFile(slug, COLD_START_FILES.cornerstoneList) },
];

const missingPhases: string[] = [];
for (const { label, path } of requiredFiles) {
  const md = await readMarkdownIfExists(path);
  if (!md) missingPhases.push(label);
}

if (missingPhases.length > 0) {
  console.error(`Missing required cold-start files:`);
  for (const m of missingPhases) {
    console.error(`  - ${m}`);
  }
  console.error(`\nComplete all prior phases before running the go-live checklist.`);
  process.exit(1);
}

// ─── Run pipeline ─────────────────────────────────────────────────────────────

console.log(`Generating go-live checklist for ${slug}...`);
log.info({ slug }, "Running go-live-checklist pipeline");

const result = await runPipeline(
  new GoLiveChecklistPipeline(),
  { projectSlug: slug },
  { projectId: project.id },
);

if (!result.ok) {
  console.error(`Pipeline failed: ${result.error}`);
  process.exit(1);
}

const { checks, readyToLaunch, blockerCount } = result.output;

// ─── Write output ─────────────────────────────────────────────────────────────

const fullMd = renderChecklistMarkdown(slug, result.output);
await writeMarkdownAtomic(outputPath, fullMd);

console.log(`\nGo-live checklist written to:\n   ${outputPath}\n`);

if (readyToLaunch) {
  console.log(`All checks passed — ${slug} is ready for Article Pipeline!`);
} else {
  console.log(`${blockerCount} item(s) still need attention:`);
  for (const c of checks.filter((c) => !c.checked)) {
    console.log(`  [ ] ${c.label}`);
    if (c.note) console.log(`      ${c.note}`);
  }
  console.log(`\nAddress the items above, then re-run with --force to refresh the checklist.`);
}

process.exit(0);

// ─── Renderer ─────────────────────────────────────────────────────────────────

function renderChecklistMarkdown(
  projectSlug: string,
  output: GoLiveChecklistOutput,
): string {
  const { checks, readyToLaunch, blockerCount } = output;

  const sections: string[] = [
    `# Go-Live Checklist: ${projectSlug}`,
    "",
    readyToLaunch
      ? `**Status: READY TO LAUNCH** — all ${checks.length} checks passed.`
      : `**Status: ${blockerCount} item(s) remaining** — address blockers before starting Article Pipeline.`,
    "",
    "> Re-run with \`--force\` after completing items to refresh auto-checked boxes.",
    "",
    "---",
    "",
  ];

  // Group by section
  const sectionMap = new Map<string, typeof checks>();
  for (const check of checks) {
    const arr = sectionMap.get(check.section) ?? [];
    arr.push(check);
    sectionMap.set(check.section, arr);
  }

  for (const [sectionName, items] of sectionMap) {
    sections.push(`## ${sectionName}`);
    sections.push("");
    for (const item of items) {
      const box = item.checked ? "[x]" : "[ ]";
      sections.push(`- ${box} ${item.label}`);
      if (item.note && !item.checked) {
        sections.push(`  > ${item.note}`);
      }
    }
    sections.push("");
  }

  sections.push("---");
  sections.push("");
  sections.push("## Notes");
  sections.push("");
  sections.push("(add notes about blockers, decisions, or go-live timeline here)");
  sections.push("");

  return sections.join("\n");
}
