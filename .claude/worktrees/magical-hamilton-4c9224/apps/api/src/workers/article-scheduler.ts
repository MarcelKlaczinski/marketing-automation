import { articles, clusters, db, projects } from "@marketing-auto/db";
import { enqueueArticleGenerationLegacy as enqueueArticleGeneration } from "@marketing-auto/pipelines";
import { createLogger } from "@marketing-auto/shared";
import { and, eq, inArray } from "drizzle-orm";

const log = createLogger("article-scheduler");

const PER_PROJECT_DAILY_LIMIT = 2;

const ACTIVE_STATUSES: Array<
  "generating" | "outline_review" | "drafting" | "final_review" | "ready_to_publish" | "published"
> = ["generating", "outline_review", "drafting", "final_review", "ready_to_publish", "published"];

export async function runArticleSchedulerTick(): Promise<{
  projectsProcessed: number;
  articlesEnqueued: number;
  errors: number;
}> {
  log.info("Article scheduler tick started");

  const allProjects = await db.select().from(projects);
  let articlesEnqueued = 0;
  let errors = 0;

  for (const project of allProjects) {
    try {
      const cornerstones = await pickNextCornerstones(project.id, PER_PROJECT_DAILY_LIMIT);
      for (const kw of cornerstones) {
        try {
          await enqueueArticleGeneration({
            cornerstoneSlug: kw,
            projectId: project.id,
            // Scheduler always uses manual — auto-mode requires explicit CLI/HTTP opt-in
            approvalMode: "manual",
          });
          articlesEnqueued++;
          log.info({ project: project.slug, cornerstone: kw }, "Auto-enqueued by scheduler");
        } catch (e) {
          errors++;
          log.error(
            { err: e, project: project.slug, cornerstone: kw },
            "Failed to enqueue article"
          );
        }
      }
    } catch (e) {
      errors++;
      log.error({ err: e, project: project.slug }, "Scheduler failed for project");
    }
  }

  return { projectsProcessed: allProjects.length, articlesEnqueued, errors };
}

async function pickNextCornerstones(projectId: string, limit: number): Promise<string[]> {
  const approvedClusters = await db
    .select()
    .from(clusters)
    .where(and(eq(clusters.projectId, projectId), eq(clusters.status, "approved")));

  const allKeywords: string[] = [];
  for (const c of approvedClusters) {
    allKeywords.push(...c.cornerstoneKeywords);
  }

  const existing = await db
    .select({ kw: articles.cornerstoneKeyword })
    .from(articles)
    .where(and(eq(articles.projectId, projectId), inArray(articles.status, ACTIVE_STATUSES)));

  const existingSet = new Set(existing.map((e) => e.kw));
  return allKeywords.filter((kw) => !existingSet.has(kw)).slice(0, limit);
}
