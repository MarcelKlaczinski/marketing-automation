#!/usr/bin/env bun
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, projects } from "@marketing-auto/db";
import { runPipeline } from "@marketing-auto/pipelines";
import {
  ClusterProposePipeline,
  ClusterExpandPipeline,
  ConfirmedClusterSchema,
  ValidatedClusterSchema,
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

const log = createLogger("cold-start:cluster");

const slug = process.argv[2];
const mode = process.argv[3] ?? "propose";
const force = process.argv.includes("--force");

if (!slug) {
  console.error(
    "Usage: bun src/scripts/cold-start/03-cluster-plan.ts <slug> [propose|expand] [--force]",
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

const outputPath = coldStartFile(slug, COLD_START_FILES.clusterPlan);
const competitorPath = coldStartFile(slug, COLD_START_FILES.competitorAnalysis);

// ─── Read content gaps + topics to avoid from Phase 2 ────────────────────────

async function loadPhase2Data(): Promise<{ contentGaps: string[]; topicsToAvoid: string[] }> {
  const competitorMd = await readMarkdownIfExists(competitorPath);
  if (!competitorMd) {
    console.error(`${competitorPath} not found.`);
    console.error("Run phase 2 first: bun --filter @marketing-auto/api cold-start:competitor-analysis " + slug + " analyze");
    process.exit(1);
  }

  let contentGaps: string[];
  let topicsToAvoid: string[];

  try {
    contentGaps = parseDataBlock(competitorMd, "content-gaps", z.array(z.string()).min(1));
  } catch (e) {
    if (e instanceof DataBlockParseError) {
      console.error(`Could not parse content-gaps from ${competitorPath}:\n  ${e.message}`);
      console.error("Make sure the <!-- DATA:content-gaps BEGIN/END --> block is intact.");
    } else {
      console.error(e);
    }
    process.exit(1);
  }

  try {
    topicsToAvoid = parseDataBlock(competitorMd, "topics-to-avoid", z.array(z.string()));
  } catch (e) {
    if (e instanceof DataBlockParseError) {
      // topics-to-avoid is optional if Marcel deleted it — fall back to empty
      topicsToAvoid = [];
    } else {
      console.error(e);
      process.exit(1);
    }
  }

  return { contentGaps, topicsToAvoid };
}

// ─── Mode: propose ────────────────────────────────────────────────────────────

if (mode === "propose") {
  const existing = await readMarkdownIfExists(outputPath);
  if (existing && !force) {
    console.error(`${outputPath} already exists. Use --force to overwrite (your edits will be lost).`);
    process.exit(1);
  }

  const { contentGaps, topicsToAvoid } = await loadPhase2Data();

  console.log(`Generating cluster candidates for ${slug}...`);
  console.log(`  Content gaps: ${contentGaps.length}`);
  console.log(`  Topics to avoid: ${topicsToAvoid.length}`);
  console.log();

  log.info({ slug, contentGapsCount: contentGaps.length }, "Running cluster propose pipeline");

  const result = await runPipeline(
    new ClusterProposePipeline(),
    { projectSlug: slug, contentGaps, topicsToAvoid },
    { projectId: project.id },
  );

  if (!result.ok) {
    console.error(`Pipeline failed: ${result.error}`);
    process.exit(1);
  }

  const { validated, filteredCount } = result.output;

  const md = renderProposalMarkdown(slug, validated, filteredCount);
  await writeMarkdownAtomic(outputPath, md);

  console.log(`Cluster proposal written to:\n   ${outputPath}\n`);
  console.log(`Candidates: ${validated.length} passed volume check, ${filteredCount} filtered out (< 50/month)`);
  console.log(`\nNext:`);
  console.log(`  1. Review the file — set "status: skip" on clusters you want to drop`);
  console.log(`     (or just delete rows from the DATA block)`);
  console.log(`  2. Run expand: bun --filter @marketing-auto/api cold-start:cluster-plan ${slug} expand`);
  process.exit(0);
}

// ─── Mode: expand ─────────────────────────────────────────────────────────────

if (mode === "expand") {
  const proposalMd = await readMarkdownIfExists(outputPath);
  if (!proposalMd) {
    console.error(`${outputPath} not found. Run propose phase first.`);
    process.exit(1);
  }

  let confirmedClusters: z.infer<typeof ConfirmedClusterSchema>[];
  try {
    confirmedClusters = parseDataBlock(
      proposalMd,
      "cluster-candidates",
      z.array(ConfirmedClusterSchema).min(1),
    );
  } catch (e) {
    if (e instanceof DataBlockParseError) {
      console.error(`Could not parse cluster-candidates from ${outputPath}:\n  ${e.message}`);
      console.error("Make sure the <!-- DATA:cluster-candidates BEGIN/END --> block is intact.");
    } else {
      console.error(e);
    }
    process.exit(1);
  }

  const { contentGaps, topicsToAvoid } = await loadPhase2Data();

  console.log(`Expanding ${confirmedClusters.length} clusters with satellite keywords for ${slug}...`);
  console.log(`  This calls DataForSEO relatedKeywords once per cluster.`);
  console.log();

  log.info({ slug, clusterCount: confirmedClusters.length }, "Running cluster expand pipeline");

  const result = await runPipeline(
    new ClusterExpandPipeline(),
    { projectSlug: slug, confirmedClusters, contentGaps, topicsToAvoid },
    { projectId: project.id },
  );

  if (!result.ok) {
    console.error(`Pipeline failed: ${result.error}`);
    process.exit(1);
  }

  const { reportMd, clusters } = result.output;

  const fullMd = [
    reportMd,
    "",
    "---",
    "",
    "## Cluster Data",
    "",
    "> Edit `status` from `proposed` to `approved` or `rejected`.",
    "> Phase 4 (cornerstone-list) reads only `approved` clusters.",
    "",
    renderDataBlock("clusters", clusters),
    "",
    "## Notes from Marcel",
    "",
    "(add reasoning for approve/reject decisions here)",
    "",
  ].join("\n");

  await writeMarkdownAtomic(outputPath, fullMd);

  console.log(`Cluster plan written to:\n   ${outputPath}\n`);
  console.log(`Clusters: ${clusters.length} total (all marked "proposed")`);
  console.log(`\nNext:`);
  console.log(`  1. Review ${outputPath}`);
  console.log(`  2. Set "status: approved" on clusters you want to produce content for`);
  console.log(`  3. Run: bun --filter @marketing-auto/api cold-start:cornerstone-list ${slug}`);
  process.exit(0);
}

console.error(`Unknown mode: ${mode}. Expected "propose" or "expand".`);
process.exit(1);

// ─── Renderer ────────────────────────────────────────────────────────────────

function renderProposalMarkdown(
  projectSlug: string,
  validated: z.infer<typeof ValidatedClusterSchema>[],
  filteredCount: number,
): string {
  const sections: string[] = [
    `# Cluster Plan: ${projectSlug}`,
    "",
    "AI has generated and volume-validated the cluster candidates below.",
    `${filteredCount > 0 ? `${filteredCount} candidate(s) were filtered out for having < 50 searches/month. ` : ""}`,
    "",
    "**Your tasks before running the expand phase:**",
    "1. Review each cluster in the DATA block below",
    "2. Delete rows for clusters you don't want to produce content for",
    "3. You can edit `cornerstone_keyword` if you know a better match",
    "4. Keep at least 5 clusters for a useful cornerstone list",
    "5. Run expand: `bun --filter @marketing-auto/api cold-start:cluster-plan " + projectSlug + " expand`",
    "",
    "> **Important:** Only edit the YAML inside the DATA block. The `<!-- DATA:cluster-candidates BEGIN/END -->` markers must stay intact.",
    "",
    "---",
    "",
    renderDataBlock("cluster-candidates", validated),
    "",
    "---",
    "",
    "## Notes",
    "",
    "(add observations or reasoning for your edits here)",
    "",
  ];

  return sections.join("\n");
}
