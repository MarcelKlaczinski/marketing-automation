import { createNotification } from "@marketing-auto/core/notifications";
import { articles, astroSyncRuns, db, users } from "@marketing-auto/db";
import { enqueueClusterLinkRebuild } from "@marketing-auto/pipelines";
import { Pipeline } from "@marketing-auto/pipelines/engine";
import type { BaseStep } from "@marketing-auto/pipelines/engine";
import { createLogger } from "@marketing-auto/shared";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { CommitToGitHubStep } from "./steps/commit-to-github.ts";
import { DownloadHeroStep } from "./steps/download-hero.ts";
import { LoadArticleStep } from "./steps/load-article.ts";
import { RenderMdxStep } from "./steps/render-mdx.ts";
import { ResolveSchemaStep } from "./steps/resolve-schema.ts";
import { UpdateDbStatusStep } from "./steps/update-db-status.ts";
import { AstroSyncError } from "./types.ts";

const log = createLogger("astro-sync:pipeline");

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
});

const OutputSchema = z.object({
  articleId: z.string().uuid(),
  syncRunId: z.string().uuid(),
});

type PipelineInput = z.infer<typeof InputSchema>;

export class ArticleSyncPipeline extends Pipeline<PipelineInput, z.infer<typeof OutputSchema>> {
  readonly name = "article:astro-sync";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;
  readonly steps = [
    new LoadArticleStep(),
    new ResolveSchemaStep(),
    new DownloadHeroStep(),
    new RenderMdxStep(),
    new CommitToGitHubStep(),
    new UpdateDbStatusStep(),
  ] as const;

  override bridge(
    fromStep: BaseStep<unknown, unknown>,
    toStep: BaseStep<unknown, unknown>,
    output: unknown,
    pipelineInput: PipelineInput,
    getStepOutput: <T = unknown>(stepName: string) => T | undefined
  ): unknown {
    if (fromStep.name === "load-article" && toStep.name === "resolve-schema") {
      const out = output as { astroRepo: unknown };
      return { astroRepo: out.astroRepo };
    }

    if (fromStep.name === "resolve-schema" && toStep.name === "download-hero") {
      const load = getStepOutput<{
        article: { heroImagePublicUrl: string; heroImageR2Key: string | null; slug: string };
      }>("load-article")!;
      return {
        heroImagePublicUrl: load.article.heroImagePublicUrl,
        heroImageR2Key: load.article.heroImageR2Key ?? "",
        articleSlug: load.article.slug,
      };
    }

    if (fromStep.name === "download-hero" && toStep.name === "render-mdx") {
      const load = getStepOutput<{
        article: unknown;
        cluster: unknown;
        astroRepo: { contentRoot: string };
      }>("load-article")!;
      const schema = getStepOutput<{ collectionInfo: unknown }>("resolve-schema")!;
      const hero = output as { heroPublicPath: string };
      return {
        article: load.article,
        cluster: load.cluster,
        collectionInfo: schema.collectionInfo,
        heroPublicPath: hero.heroPublicPath,
        astroRepoRoot: load.astroRepo.contentRoot,
      };
    }

    if (fromStep.name === "render-mdx" && toStep.name === "commit-to-github") {
      const load = getStepOutput<{
        article: { title: string; slug: string; cornerstoneKeyword: string };
        astroRepo: unknown;
      }>("load-article")!;
      const hero = getStepOutput<{
        files: Array<{ repoPath: string; base64: string; contentType: string }>;
      }>("download-hero")!;
      const render = output as { mdxPath: string; mdxContent: string };
      return {
        astroRepo: load.astroRepo,
        files: [
          { path: render.mdxPath, contentType: "text" as const, content: render.mdxContent },
          // All hero image files (base + up to 22 variants)
          ...hero.files.map((f) => ({
            path: f.repoPath,
            contentType: "base64" as const,
            content: f.base64,
          })),
        ],
        commitMessage: `feat(blog): publish "${load.article.title}"\n\nAuto-generated from Marketing Automation Platform.\nCornerstone keyword: ${load.article.cornerstoneKeyword ?? "n/a"}\nArticle slug: ${load.article.slug}`,
      };
    }

    if (fromStep.name === "commit-to-github" && toStep.name === "update-db-status") {
      const load = getStepOutput<{ article: { id: string } }>("load-article")!;
      const render = getStepOutput<{ frontmatter: Record<string, unknown> }>("render-mdx")!;
      const hero = getStepOutput<{ heroPublicPath: string }>("download-hero")!;
      const commit = output as {
        commitSha: string;
        filesCommitted: string[];
        bytesCommitted: number;
      };
      return {
        articleId: load.article.id,
        projectId: pipelineInput.projectId,
        commitSha: commit.commitSha,
        filesCommitted: commit.filesCommitted,
        bytesCommitted: commit.bytesCommitted,
        frontmatter: render.frontmatter,
        heroPublicPath: hero.heroPublicPath,
      };
    }

    return output;
  }

  override async afterError(error: unknown, pipelineInput: PipelineInput): Promise<void> {
    try {
      const [pendingRun] = await db
        .select({ id: astroSyncRuns.id })
        .from(astroSyncRuns)
        .where(
          and(
            eq(astroSyncRuns.articleId, pipelineInput.articleId),
            eq(astroSyncRuns.status, "pending")
          )
        )
        .orderBy(desc(astroSyncRuns.startedAt))
        .limit(1);

      if (pendingRun) {
        const message = error instanceof Error ? error.message : String(error);
        const updateBase = {
          status: "failed" as const,
          errorMessage: message,
          finishedAt: new Date(),
        };
        // Only persist stages that exist on the DB column type (auth/config are error types, not DB stages)
        const validStages = [
          "load",
          "schema",
          "image",
          "render",
          "commit",
          "db_update",
          "stale_read",
        ] as const;
        type ValidStage = (typeof validStages)[number];
        const rawStage = error instanceof AstroSyncError ? error.stage : undefined;
        const errorStage =
          rawStage !== undefined && (validStages as readonly string[]).includes(rawStage)
            ? (rawStage as ValidStage)
            : undefined;
        const updateSet = errorStage !== undefined ? { ...updateBase, errorStage } : updateBase;
        await db.update(astroSyncRuns).set(updateSet).where(eq(astroSyncRuns.id, pendingRun.id));
      }
    } catch {
      // Cleanup failure must not affect BullMQ retry behavior
    }

    // Notify owners of sync failure (critical — triggers Web Push)
    try {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const owners = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, "owner"));
      const errorStageLabel =
        error instanceof AstroSyncError ? ` (${error.stage})` : "";
      for (const owner of owners) {
        void createNotification({
          userId: owner.id,
          type: "sync_failure",
          severity: "critical",
          title: "Astro-Sync failed",
          message: `${errorMessage.slice(0, 200)}${errorStageLabel}`,
          link: `/articles/${pipelineInput.articleId}`,
          metadata: { articleId: pipelineInput.articleId },
        });
      }
    } catch {
      // Notification failure must not affect retry behavior
    }
  }

  override async afterComplete(
    _output: z.infer<typeof OutputSchema>,
    pipelineInput: PipelineInput
  ): Promise<void> {
    try {
      const [article] = await db
        .select({ clusterId: articles.clusterId })
        .from(articles)
        .where(eq(articles.id, pipelineInput.articleId))
        .limit(1);
      if (article?.clusterId) {
        await enqueueClusterLinkRebuild({
          clusterId: article.clusterId,
          projectId: pipelineInput.projectId,
          triggerType: "auto_after_sync",
          triggeringArticleId: pipelineInput.articleId,
        });
        log.info(
          { articleId: pipelineInput.articleId, clusterId: article.clusterId },
          "Cluster link rebuild enqueued after article sync"
        );
      }
    } catch (e) {
      log.warn(
        { articleId: pipelineInput.articleId, err: e },
        "Failed to enqueue link rebuild after sync"
      );
    }
  }
}
