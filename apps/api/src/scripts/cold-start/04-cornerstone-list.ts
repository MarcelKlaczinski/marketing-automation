#!/usr/bin/env bun
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, projects } from "@marketing-auto/db";
import { runPipeline } from "@marketing-auto/pipelines";
import {
  CornerstoneListPipeline,
  ApprovedClusterSchema,
  CornerstoneSpecSchema,
} from "@marketing-auto/pipelines/cold-start";
import {
  coldStartFile,
  COLD_START_FILES,
  readMarkdownIfExists,
  writeMarkdownAtomic,
  parseDataBlock,
  renderDataBlock,
  DataBlockParseError,
} from "@marketing-auto/pipelines/cold-start/shared";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("cold-start:cornerstone");

const slug = process.argv[2];
const force = process.argv.includes("--force");

if (!slug) {
  console.error(
    "Usage: bun src/scripts/cold-start/04-cornerstone-list.ts <slug> [--force]",
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

const outputPath = coldStartFile(slug, COLD_START_FILES.cornerstoneList);
const existing = await readMarkdownIfExists(outputPath);
if (existing && !force) {
  console.error(`${outputPath} already exists. Use --force to overwrite (your edits will be lost).`);
  process.exit(1);
}

// ─── Read approved clusters from Phase 3 ─────────────────────────────────────

const clusterPlanPath = coldStartFile(slug, COLD_START_FILES.clusterPlan);
const clusterPlanMd = await readMarkdownIfExists(clusterPlanPath);
if (!clusterPlanMd) {
  console.error(`${clusterPlanPath} not found.`);
  console.error(`Run phase 3 first: bun --filter @marketing-auto/api cold-start:cluster-plan ${slug} expand`);
  process.exit(1);
}

let allClusters: z.infer<typeof ApprovedClusterSchema>[];
try {
  allClusters = parseDataBlock(
    clusterPlanMd,
    "clusters",
    z.array(ApprovedClusterSchema).min(1),
  );
} catch (e) {
  if (e instanceof DataBlockParseError) {
    console.error(`Could not parse clusters from ${clusterPlanPath}:\n  ${e.message}`);
    console.error("Make sure the <!-- DATA:clusters BEGIN/END --> block is intact.");
    console.error("If you only have the proposal file, run: bun --filter @marketing-auto/api cold-start:cluster-plan " + slug + " expand");
  } else {
    console.error(e);
  }
  process.exit(1);
}

const approvedClusters = allClusters.filter((c) => c.status === "approved");

if (approvedClusters.length === 0) {
  console.error(`No approved clusters found in ${clusterPlanPath}.`);
  console.error(`Open the file and set "status: approved" on the clusters you want cornerstone articles for.`);
  console.error(`Total clusters in file: ${allClusters.length}`);
  process.exit(1);
}

// ─── Run pipeline ─────────────────────────────────────────────────────────────

console.log(`Generating cornerstone specs for ${slug}...`);
console.log(`  Approved clusters: ${approvedClusters.length}`);
console.log(`  Cluster names: ${approvedClusters.map((c) => c.name).join(", ")}`);
console.log();

log.info({ slug, approvedClusterCount: approvedClusters.length }, "Running cornerstone-list pipeline");

const result = await runPipeline(
  new CornerstoneListPipeline(),
  { projectSlug: slug, approvedClusters },
  { projectId: project.id },
);

if (!result.ok) {
  console.error(`Pipeline failed: ${result.error}`);
  process.exit(1);
}

const { cornerstones } = result.output;

// ─── Write output ─────────────────────────────────────────────────────────────

const fullMd = renderCornerstoneMarkdown(slug, cornerstones, approvedClusters.length);
await writeMarkdownAtomic(outputPath, fullMd);

console.log(`Cornerstone list written to:\n   ${outputPath}\n`);
console.log(`Cornerstones: ${cornerstones.length} generated (all marked "proposed")`);
console.log(`\nNext:`);
console.log(`  1. Review ${outputPath}`);
console.log(`  2. Set "status: approved" on articles you want to produce`);
console.log(`  3. Run: bun --filter @marketing-auto/api cold-start:go-live-checklist ${slug}`);
process.exit(0);

// ─── Renderer ─────────────────────────────────────────────────────────────────

function renderCornerstoneMarkdown(
  projectSlug: string,
  cornerstones: z.infer<typeof CornerstoneSpecSchema>[],
  totalApprovedClusters: number,
): string {
  const sections: string[] = [
    `# Cornerstone List: ${projectSlug}`,
    "",
    `Generated ${cornerstones.length} cornerstone article spec(s) from ${totalApprovedClusters} approved cluster(s).`,
    "",
    "**Your tasks before running the go-live checklist:**",
    "1. Review each cornerstone spec in the DATA block below",
    "2. Set `status: approved` on articles you want to produce in Phase 3",
    "3. Edit `proposed_title`, `proposed_slug`, or `h2_outline` if you want different angles",
    "4. Run: `bun --filter @marketing-auto/api cold-start:go-live-checklist " + projectSlug + "`",
    "",
    "> **Important:** Only edit the YAML inside the DATA block. The `<!-- DATA:cornerstones BEGIN/END -->` markers must stay intact.",
    "",
    "---",
    "",
    "## Cornerstone Previews",
    "",
  ];

  for (const cs of cornerstones) {
    sections.push(`### ${cs.proposed_title}`);
    sections.push("");
    sections.push(`**Cluster:** ${cs.cluster}  `);
    sections.push(`**Keyword:** \`${cs.cornerstone_keyword}\`  `);
    sections.push(`**Slug:** \`/${cs.proposed_slug}/\`  `);
    sections.push(`**Target length:** ~${cs.estimated_word_count.toLocaleString()} words`);
    sections.push("");
    sections.push(`**Meta:** ${cs.meta_description}`);
    sections.push("");
    sections.push("**Outline:**");
    for (const h2 of cs.h2_outline) {
      sections.push(`- ${h2}`);
    }
    sections.push("");
  }

  sections.push("---");
  sections.push("");
  sections.push("## Cornerstone Data");
  sections.push("");
  sections.push("> Edit `status` from `proposed` to `approved` on articles you want to produce.");
  sections.push("> Phase 3 Article Pipeline reads only `approved` cornerstones.");
  sections.push("");
  sections.push(renderDataBlock("cornerstones", cornerstones));
  sections.push("");
  sections.push("## Notes from Marcel");
  sections.push("");
  sections.push("(add reasoning for approve/reject decisions here)");
  sections.push("");

  return sections.join("\n");
}
