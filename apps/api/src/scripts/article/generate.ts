#!/usr/bin/env bun
import { articles, clusters, db, projects } from "@marketing-auto/db";
import { enqueueArticleGeneration } from "@marketing-auto/pipelines";
import { createLogger } from "@marketing-auto/shared";
import { and, eq, inArray } from "drizzle-orm";

const log = createLogger("cli:article-generate");

const args = process.argv.slice(2);
const approvalMode = args.includes("--auto") ? "auto" : "manual";
const allApproved = args.includes("--all-approved");
const limitIdx = args.indexOf("--limit");
const limit = limitIdx !== -1 ? Number.parseInt(args[limitIdx + 1]!, 10) : undefined;

if (allApproved) {
  // Batch mode: article:generate --all-approved <project-slug> [--limit N] [--auto]
  const projectSlug = args.find(
    (a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--limit"
  );
  if (!projectSlug) {
    console.error(
      "Usage: bun ... article:generate --all-approved <project-slug> [--limit N] [--auto]"
    );
    process.exit(1);
  }

  const [project] = await db.select().from(projects).where(eq(projects.slug, projectSlug)).limit(1);
  if (!project) {
    console.error(`Project not found: ${projectSlug}`);
    process.exit(1);
  }

  const cornerstones = await findApprovedCornerstones(project.id, limit);
  if (cornerstones.length === 0) {
    console.log(
      "No approved cornerstones available for generation. Mark clusters as approved first."
    );
    process.exit(0);
  }

  console.log(`Enqueuing ${cornerstones.length} article(s) for project "${projectSlug}"...`);
  let successCount = 0;
  for (const kw of cornerstones) {
    try {
      const result = await enqueueArticleGeneration({
        cornerstoneSlug: kw,
        projectId: project.id,
        approvalMode,
      });
      console.log(`  OK  ${kw} → article ${result.articleId} (job ${result.outlineJobId})`);
      successCount++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error({ err: e, kw }, "Failed to enqueue article");
      console.error(`  ERR ${kw} → ${msg}`);
    }
  }

  console.log(`
Enqueued ${successCount}/${cornerstones.length}. Mode: ${approvalMode}.
${
  approvalMode === "manual"
    ? "Run `article:continue <cornerstone-keyword>` after reviewing each outline."
    : "Job 2 (draft + image) auto-runs after each outline completes."
}`);
  process.exit(successCount > 0 ? 0 : 1);
}

// Single mode: article:generate <cornerstone-keyword> [--auto]
const cornerstoneSlug = args.find(
  (a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--limit"
);
if (!cornerstoneSlug) {
  console.error(`Usage:
  Single: bun ... article:generate <cornerstone-keyword> [--auto]
  Batch:  bun ... article:generate --all-approved <project-slug> [--limit N] [--auto]`);
  process.exit(1);
}

const project = await findProjectForCornerstone(cornerstoneSlug);
if (!project) {
  console.error(
    `Cornerstone "${cornerstoneSlug}" not found in any cluster. Run cold-start cluster-plan first.`
  );
  process.exit(1);
}

try {
  const result = await enqueueArticleGeneration({
    cornerstoneSlug,
    projectId: project.id,
    approvalMode,
  });

  console.log(`Article generation enqueued:
  Article ID : ${result.articleId}
  Job ID     : ${result.outlineJobId}
  Mode       : ${approvalMode}

Job 1 (research + outline) running in background. Check Drizzle Studio in ~2-3 min.

Next:
${
  approvalMode === "manual"
    ? `  After outline review: bun --filter @marketing-auto/api article:continue ${cornerstoneSlug}`
    : `  Job 2 (draft + image) auto-runs after Job 1 completes.`
}`);

  process.exit(0);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  log.error({ err: e, cornerstoneSlug }, "article:generate failed");
  console.error(`Error: ${msg}`);
  process.exit(1);
}

// ───── Helpers ────────────────────────────────────────────────────────────────

async function findApprovedCornerstones(projectId: string, limitN?: number): Promise<string[]> {
  const approvedClusters = await db
    .select()
    .from(clusters)
    .where(and(eq(clusters.projectId, projectId), eq(clusters.status, "approved")));

  const allKeywords: string[] = [];
  for (const c of approvedClusters) {
    allKeywords.push(...c.cornerstoneKeywords);
  }

  // Exclude cornerstones that already have active or published articles
  const activeStatuses: Array<
    "generating" | "outline_review" | "drafting" | "final_review" | "ready_to_publish" | "published"
  > = ["generating", "outline_review", "drafting", "final_review", "ready_to_publish", "published"];
  const existing = await db
    .select({ kw: articles.cornerstoneKeyword })
    .from(articles)
    .where(and(eq(articles.projectId, projectId), inArray(articles.status, activeStatuses)));
  const existingSet = new Set(existing.map((e) => e.kw));

  const available = allKeywords.filter((kw) => !existingSet.has(kw));
  return limitN !== undefined ? available.slice(0, limitN) : available;
}

async function findProjectForCornerstone(cornerstone: string) {
  const allClusters = await db.select().from(clusters);
  for (const c of allClusters) {
    if (c.cornerstoneKeywords.includes(cornerstone)) {
      const [p] = await db.select().from(projects).where(eq(projects.id, c.projectId)).limit(1);
      return p ?? null;
    }
  }
  return null;
}
