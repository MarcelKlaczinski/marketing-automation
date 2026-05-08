#!/usr/bin/env bun
import { db, projects } from "@marketing-auto/db";
import { runPipeline } from "@marketing-auto/pipelines";
import {
  ApprovedClusterSchema,
  CornerstoneListPipeline,
  type LocaleAwareCornerstoneSpec,
} from "@marketing-auto/pipelines/cold-start";
import {
  COLD_START_FILES,
  DataBlockParseError,
  coldStartFile,
  parseDataBlock,
  readMarkdownIfExists,
  renderDataBlock,
  writeMarkdownAtomic,
} from "@marketing-auto/pipelines/cold-start/shared";
import { createLogger } from "@marketing-auto/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";

const log = createLogger("cold-start:cornerstone");

const slug = process.argv[2];
const force = process.argv.includes("--force");

if (!slug) {
  console.error("Usage: bun src/scripts/cold-start/04-cornerstone-list.ts <slug> [--force]");
  process.exit(1);
}

const [project] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);

if (!project) {
  console.error(`Project not found: ${slug}. Create it via 'add-project' first.`);
  process.exit(1);
}

// ─── Guard: output file ───────────────────────────────────────────────────────

const outputPath = coldStartFile(slug, COLD_START_FILES.cornerstoneList);
const existing = await readMarkdownIfExists(outputPath);
if (existing && !force) {
  console.error(
    `${outputPath} already exists. Use --force to overwrite (your edits will be lost).`
  );
  process.exit(1);
}

// ─── Read approved clusters from Phase 3 ─────────────────────────────────────

const clusterPlanPath = coldStartFile(slug, COLD_START_FILES.clusterPlan);
const clusterPlanMd = await readMarkdownIfExists(clusterPlanPath);
if (!clusterPlanMd) {
  console.error(`${clusterPlanPath} not found.`);
  console.error(
    `Run phase 3 first: bun --filter @marketing-auto/api cold-start:cluster-plan ${slug} expand`
  );
  process.exit(1);
}

let allClusters: z.infer<typeof ApprovedClusterSchema>[];
try {
  allClusters = parseDataBlock(clusterPlanMd, "clusters", z.array(ApprovedClusterSchema).min(1));
} catch (e) {
  if (e instanceof DataBlockParseError) {
    console.error(`Could not parse clusters from ${clusterPlanPath}:\n  ${e.message}`);
    console.error("Make sure the <!-- DATA:clusters BEGIN/END --> block is intact.");
    console.error(
      "If you only have the proposal file, run: bun --filter @marketing-auto/api cold-start:cluster-plan " +
        slug +
        " expand"
    );
  } else {
    console.error(e);
  }
  process.exit(1);
}

const approvedClusters = allClusters.filter((c) => c.status === "approved");

if (approvedClusters.length === 0) {
  console.error(`No approved clusters found in ${clusterPlanPath}.`);
  console.error(
    `Open the file and set "status: approved" on the clusters you want cornerstone articles for.`
  );
  console.error(`Total clusters in file: ${allClusters.length}`);
  process.exit(1);
}

// ─── Run pipeline ─────────────────────────────────────────────────────────────

console.log(`Generating cornerstone specs (DE+EN) for ${slug}...`);
console.log(`  Approved clusters: ${approvedClusters.length}`);
console.log(`  Cluster names: ${approvedClusters.map((c) => c.name).join(", ")}`);
console.log();

log.info(
  { slug, approvedClusterCount: approvedClusters.length },
  "Running cornerstone-list pipeline (DE+EN)"
);

const result = await runPipeline(
  new CornerstoneListPipeline(),
  { projectSlug: slug, approvedClusters, locales: ["de", "en"] },
  { projectId: project.id }
);

if (!result.ok) {
  console.error(`Pipeline failed: ${result.error}`);
  process.exit(1);
}

const { specs } = result.output;

// ─── Write output ─────────────────────────────────────────────────────────────

const fullMd = renderCornerstoneMarkdown(slug, specs, approvedClusters.length);
await writeMarkdownAtomic(outputPath, fullMd);

console.log(`Cornerstone list written to:\n   ${outputPath}\n`);
console.log(`Cornerstones: ${specs.length} generated (${approvedClusters.length} clusters × DE+EN)`);
console.log(`\nNext:`);
console.log(`  1. Review ${outputPath} and approve/reject specs in the DB (use /cornerstone-specs API)`);
console.log(`  2. Once approved, trigger article generation via cluster endpoint`);
console.log(`  3. Run: bun --filter @marketing-auto/api cold-start:go-live-checklist ${slug}`);
process.exit(0);

// ─── Renderer ─────────────────────────────────────────────────────────────────

function renderCornerstoneMarkdown(
  projectSlug: string,
  specs: LocaleAwareCornerstoneSpec[],
  totalApprovedClusters: number
): string {
  const sections: string[] = [
    `# Cornerstone List: ${projectSlug}`,
    "",
    `Generated ${specs.length} cornerstone specs (DE+EN) from ${totalApprovedClusters} approved cluster(s).`,
    "Specs are persisted in the `cornerstone_specs` DB table with status `proposed`.",
    "",
    "**Your tasks:**",
    "1. Review each cornerstone spec pair below",
    "2. Approve or reject via the Web UI or API (`/api/projects/:slug/cornerstone-specs`)",
    "3. Trigger article generation per cluster once pairs are approved",
    "4. Run: `bun --filter @marketing-auto/api cold-start:go-live-checklist " + projectSlug + "`",
    "",
    "---",
    "",
    "## Cornerstone Previews",
    "",
  ];

  // Group by cornerstone_keyword to show DE+EN side by side
  const byKeyword = new Map<string, LocaleAwareCornerstoneSpec[]>();
  for (const spec of specs) {
    const key = spec.cornerstone_keyword;
    const arr = byKeyword.get(key) ?? [];
    arr.push(spec);
    byKeyword.set(key, arr);
  }

  for (const [keyword, pair] of byKeyword) {
    sections.push(`### Cluster: ${keyword}`);
    sections.push("");
    for (const spec of pair.sort((a, b) => a.locale.localeCompare(b.locale))) {
      sections.push(`#### [${spec.locale.toUpperCase()}] ${spec.proposed_title}`);
      sections.push(`**Slug:** \`/${spec.proposed_slug}/\`  `);
      sections.push(`**Target length:** ~${spec.estimated_word_count.toLocaleString()} words`);
      sections.push("");
      sections.push(`**Meta:** ${spec.meta_description}`);
      sections.push("");
      sections.push("**Outline:**");
      for (const h2 of spec.h2_outline) {
        sections.push(`- ${h2}`);
      }
      sections.push("");
    }
  }

  sections.push("---");
  sections.push("");
  sections.push("## Cornerstone Spec Data");
  sections.push("");
  sections.push("> This data is stored in the DB. Edit specs via the Web UI approval page.");
  sections.push("> Translation key links DE+EN pairs. Do not edit translation_key manually.");
  sections.push("");
  sections.push(renderDataBlock("cornerstones", specs));
  sections.push("");

  return sections.join("\n");
}
