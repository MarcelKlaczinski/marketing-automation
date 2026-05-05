#!/usr/bin/env bun
import { eq } from "drizzle-orm";
import { db, projects, clusters } from "@marketing-auto/db";
import { enqueueArticleGeneration } from "@marketing-auto/pipelines";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("cli:article-generate");

const args = process.argv.slice(2);
const approvalMode = args.includes("--auto") ? "auto" : "manual";
const cornerstoneSlug = args.find((a) => !a.startsWith("--"));

if (!cornerstoneSlug) {
  console.error(`Usage: bun ... article:generate <cornerstone-keyword> [--auto]`);
  process.exit(1);
}

const project = await findProjectForCornerstone(cornerstoneSlug);
if (!project) {
  console.error(`Cornerstone "${cornerstoneSlug}" not found in any cluster. Run cold-start cluster-plan first.`);
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
${approvalMode === "manual"
    ? `  After outline review: bun --filter @marketing-auto/api article:continue ${cornerstoneSlug}`
    : `  Job 2 (draft + image) auto-runs after Job 1 completes.`}`);

  process.exit(0);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  log.error({ err: e, cornerstoneSlug }, "article:generate failed");
  console.error(`Error: ${msg}`);
  process.exit(1);
}

async function findProjectForCornerstone(cornerstone: string) {
  const allClusters = await db.select().from(clusters);
  for (const c of allClusters) {
    const ks = (c.cornerstoneKeywords as string[]) ?? [];
    if (ks.includes(cornerstone)) {
      const [p] = await db.select().from(projects).where(eq(projects.id, c.projectId)).limit(1);
      return p ?? null;
    }
  }
  return null;
}
