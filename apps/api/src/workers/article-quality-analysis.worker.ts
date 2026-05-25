// Spec E.1a: BullMQ worker for LLM-based article quality analysis.
// Runs a Sonnet 4.6 review of an article body and upserts a 'quality' refresh_suggestion row.
// "no-action" results clean up any existing open suggestion; actionable results upsert one.
import { Worker } from "bullmq";
import { createLogger, getEnv } from "@marketing-auto/shared";
import IORedis from "ioredis";
import { z } from "zod";
import {
  db, eq, and, isNull, isNotNull, lt, or, articles, markCronRunFailed, markCronRunSucceeded, refreshSuggestions, projects,
} from "@marketing-auto/db";
import { anthropic } from "@marketing-auto/adapter-anthropic";
import { COST_OPS, estimateCostEur } from "@marketing-auto/core/cost";
import { publishPipelineEvent } from "@marketing-auto/core/events";
import {
  getArticleQualityAnalysisQueue,
  type ArticleQualityAnalysisJobData,
  type ArticleQualityAnalysisJobResult,
  type ArticleQualityAnalysisPerArticleData,
} from "@marketing-auto/pipelines/article-quality-analysis-queue";
import {
  qualityFindingsSchema,
  buildReasoningString,
  totalFindingsCount,
  buildQualityAnalysisPrompt,
  parseJsonFromRaw,
} from "@marketing-auto/pipelines/article-quality";

const log = createLogger("workers:article-quality-analysis");

// Max articles per cron tick — prevents overwhelming the queue when backlog builds up.
// Daily cron means all articles rotate within ~ceil(total/50) days.
const CRON_BATCH_SIZE = 50;

// ─── Runtime Zod validation for job.data (arrives as unknown from Redis) ─────

const articleJobSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectSlug: z.string(),
});

// Cron-triggered batch job: finds due articles and enqueues per-article jobs
const cronJobSchema = z.object({
  projectId: z.string().uuid(),
  type: z.literal("cron-triggered"),
});

// ─── Worker factory ───────────────────────────────────────────────────────────

export function startArticleQualityAnalysisWorker(): Worker<ArticleQualityAnalysisJobData, ArticleQualityAnalysisJobResult> {
  const env = getEnv();
  const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

  getArticleQualityAnalysisQueue();

  const worker = new Worker<ArticleQualityAnalysisJobData, ArticleQualityAnalysisJobResult>(
    "article-quality-analysis",
    async (job) => {
      // ── Cron-triggered batch: find due articles, enqueue per-article jobs ─────
      const cronResult = cronJobSchema.safeParse(job.data);
      if (cronResult.success) {
        const { projectId } = cronResult.data;
        try {
          const [project] = await db
            .select({ id: projects.id, slug: projects.slug })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);
          if (!project) {
            // Project gone — record success (we ran, found no work) so the
            // Settings UI doesn't show stale "—".
            await markCronRunSucceeded({ projectId, jobType: "quality_analysis" });
            return { articleId: "", recommendation: "no-action" as const, suggestionId: null };
          }

          const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
          const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);

          const due = await db
            .select({ id: articles.id })
            .from(articles)
            .leftJoin(
              refreshSuggestions,
              and(
                eq(refreshSuggestions.articleId, articles.id),
                eq(refreshSuggestions.source, "quality")
              )
            )
            .where(and(
              eq(articles.projectId, projectId),
              eq(articles.status, "published"),
              isNotNull(articles.lastRefreshedAt),
              lt(articles.lastRefreshedAt, thirtyDaysAgo),
              or(
                isNull(refreshSuggestions.id),
                lt(refreshSuggestions.generatedAt, sevenDaysAgo),
              ),
            ))
            .limit(CRON_BATCH_SIZE);

          const queue = getArticleQualityAnalysisQueue();
          for (const a of due) {
            await queue.add("analyze", { articleId: a.id, projectId, projectSlug: project.slug }, {
              jobId: `quality-cron-${a.id}`,
            });
          }

          log.info({ projectId, count: due.length }, "Quality analysis cron enqueued per-article jobs");
          // Spec 62.7-followup — record cron_state.lastRun* for the cron tick.
          // Per-article jobs themselves don't record (they aren't cron ticks).
          await markCronRunSucceeded({ projectId, jobType: "quality_analysis" });
          return { articleId: "", recommendation: "no-action" as const, suggestionId: null };
        } catch (err) {
          await markCronRunFailed({
            projectId,
            jobType: "quality_analysis",
            errorMessage: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }
      }

      const data = articleJobSchema.parse(job.data) as ArticleQualityAnalysisPerArticleData;
      const { articleId, projectId, projectSlug } = data;

      // ── 1. Load article ───────────────────────────────────────────────────
      const rows = await db
        .select({
          id: articles.id,
          title: articles.title,
          bodyMd: articles.bodyMd,
          locale: articles.locale,
          publishedAt: articles.publishedAt,
          lastRefreshedAt: articles.lastRefreshedAt,
          domainExtras: articles.domainExtras,
        })
        .from(articles)
        .where(and(
          eq(articles.id, articleId),
          eq(articles.projectId, projectId),
        ))
        .limit(1);

      const article = rows[0];
      if (!article) {
        log.warn({ articleId, projectId }, "Article not found — skipping quality analysis");
        return { articleId, recommendation: "no-action", suggestionId: null };
      }

      if (!article.bodyMd || article.bodyMd.trim().length < 200) {
        log.info({ articleId }, "Article body too short — skipping quality analysis");
        return { articleId, recommendation: "no-action", suggestionId: null };
      }

      // ── 2. Compute staleness ──────────────────────────────────────────────
      const referenceDate = article.lastRefreshedAt ?? article.publishedAt;
      const daysSinceRefresh: number | "unknown" = referenceDate
        ? Math.floor((Date.now() - referenceDate.getTime()) / 86_400_000)
        : "unknown";

      // ── 3. Call Sonnet 4.6 ────────────────────────────────────────────────
      const prompt = buildQualityAnalysisPrompt({
        title: article.title ?? "(untitled)",
        body: article.bodyMd,
        domainExtras: article.domainExtras ?? {},
        locale: article.locale,
        daysSinceRefresh,
      });

      const result = await anthropic.messages({
        projectId,
        operation: COST_OPS.ARTICLE_QUALITY_ANALYSIS,
        estimatedCostEur: estimateCostEur("anthropic", COST_OPS.ARTICLE_QUALITY_ANALYSIS),
        model: "claude-sonnet-4-6",
        systemPrefix: "",
        systemSuffix: "You are an expert SEO content reviewer. Analyze articles for staleness and quality issues.",
        userMessage: prompt,
        maxTokens: 2000,
        jsonMode: false,
      });

      // ── 4. Parse + validate LLM response ─────────────────────────────────
      let findings;
      try {
        const raw = parseJsonFromRaw(result.raw);
        findings = qualityFindingsSchema.parse(raw);
      } catch (err) {
        log.error({ articleId, err, raw: result.raw.slice(0, 300) }, "Failed to parse quality analysis response");
        throw err;
      }

      const recommendation = findings.overallRecommendation;

      // ── 5. Upsert or clean up refresh_suggestion ──────────────────────────
      if (recommendation === "no-action" && totalFindingsCount(findings) === 0) {
        // Clean up any existing open quality suggestion — article is fine
        await db
          .update(refreshSuggestions)
          .set({ dismissedAt: new Date() })
          .where(and(
            eq(refreshSuggestions.articleId, articleId),
            eq(refreshSuggestions.source, "quality"),
            isNull(refreshSuggestions.dismissedAt),
            isNull(refreshSuggestions.approvedAt),
          ));
        log.info({ articleId, projectSlug }, "Quality analysis: no action needed");
        return { articleId, recommendation, suggestionId: null };
      }

      // Upsert: ON CONFLICT (articleId, source) DO UPDATE
      const reasoning = buildReasoningString(findings);
      const stalenessDays = typeof daysSinceRefresh === "number" ? daysSinceRefresh : null;

      const upserted = await db
        .insert(refreshSuggestions)
        .values({
          projectId,
          articleId,
          source: "quality",
          reasoning,
          stalenessDays,
          qualityFindings: {
            outdatedClaims: findings.outdatedClaims,
            missingCoverage: findings.missingCoverage,
            staleReferences: findings.staleReferences,
            overallRecommendation: findings.overallRecommendation,
            confidence: findings.confidence,
          },
          generatedAt: new Date(),
          dismissedAt: null,
          approvedAt: null,
        })
        .onConflictDoUpdate({
          target: [refreshSuggestions.articleId, refreshSuggestions.source],
          set: {
            reasoning,
            stalenessDays,
            qualityFindings: {
              outdatedClaims: findings.outdatedClaims,
              missingCoverage: findings.missingCoverage,
              staleReferences: findings.staleReferences,
              overallRecommendation: findings.overallRecommendation,
              confidence: findings.confidence,
            },
            generatedAt: new Date(),
            dismissedAt: null,
            approvedAt: null,
          },
        })
        .returning({ id: refreshSuggestions.id });

      const suggestionId = upserted[0]?.id ?? null;
      log.info({ articleId, projectSlug, recommendation, suggestionId }, "Quality analysis upserted");

      void publishPipelineEvent(projectId, {
        type: "refresh.suggestion.created",
        timestamp: new Date().toISOString(),
        articleId,
      });

      return { articleId, recommendation, suggestionId };
    },
    {
      connection,
      concurrency: 3,
      lockDuration: 3 * 60 * 1000,   // 3 minutes — Sonnet call + DB
    }
  );

  worker.on("ready", () => log.info("article-quality-analysis worker ready (concurrency=3)"));
  worker.on("error", (err) => log.error({ err }, "article-quality-analysis worker error"));

  return worker;
}
