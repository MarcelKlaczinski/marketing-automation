import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { Pipeline } from "@marketing-auto/pipelines/engine";
import { enqueueClusterLinkRebuild } from "@marketing-auto/pipelines";
import { db, articles, astroSyncRuns } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { LoadArticleStep } from "./steps/load-article.ts";
import { ResolveSchemaStep } from "./steps/resolve-schema.ts";
import { DownloadHeroStep } from "./steps/download-hero.ts";
import { RenderMdxStep } from "./steps/render-mdx.ts";
import { CommitToGitHubStep } from "./steps/commit-to-github.ts";
import { UpdateDbStatusStep } from "./steps/update-db-status.ts";
import type { BaseStep } from "@marketing-auto/pipelines/engine";

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
    getStepOutput: <T = unknown>(stepName: string) => T | undefined,
  ): unknown {
    if (fromStep.name === "load-article" && toStep.name === "resolve-schema") {
      const out = output as { astroRepo: unknown };
      return { astroRepo: out.astroRepo };
    }

    if (fromStep.name === "resolve-schema" && toStep.name === "download-hero") {
      const load = getStepOutput<{ article: { heroImagePublicUrl: string; slug: string } }>("load-article")!;
      return {
        heroImagePublicUrl: load.article.heroImagePublicUrl,
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
      const hero = output as { astroAssetPath: string };
      return {
        article: load.article,
        cluster: load.cluster,
        collectionInfo: schema.collectionInfo,
        heroAstroAssetPath: hero.astroAssetPath,
        astroRepoRoot: load.astroRepo.contentRoot,
      };
    }

    if (fromStep.name === "render-mdx" && toStep.name === "commit-to-github") {
      const load = getStepOutput<{
        article: { title: string; slug: string; cornerstoneKeyword: string };
        astroRepo: unknown;
      }>("load-article")!;
      const hero = getStepOutput<{ base64: string; astroAssetPath: string }>("download-hero")!;
      const render = output as { mdxPath: string; mdxContent: string };
      return {
        astroRepo: load.astroRepo,
        files: [
          { path: render.mdxPath, contentType: "text" as const, content: render.mdxContent },
          { path: hero.astroAssetPath, contentType: "base64" as const, content: hero.base64 },
        ],
        commitMessage:
          `feat(blog): publish "${load.article.title}"\n\n` +
          `Auto-generated from Marketing Automation Platform.\n` +
          `Cornerstone keyword: ${load.article.cornerstoneKeyword}\n` +
          `Article slug: ${load.article.slug}`,
      };
    }

    if (fromStep.name === "commit-to-github" && toStep.name === "update-db-status") {
      const load = getStepOutput<{ article: { id: string } }>("load-article")!;
      const render = getStepOutput<{ frontmatter: Record<string, unknown> }>("render-mdx")!;
      const hero = getStepOutput<{ astroAssetPath: string }>("download-hero")!;
      const commit = output as { commitSha: string; filesCommitted: string[]; bytesCommitted: number };
      return {
        articleId: load.article.id,
        projectId: pipelineInput.projectId,
        commitSha: commit.commitSha,
        filesCommitted: commit.filesCommitted,
        bytesCommitted: commit.bytesCommitted,
        frontmatter: render.frontmatter,
        heroAstroAssetPath: hero.astroAssetPath,
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
            eq(astroSyncRuns.status, "pending"),
          ),
        )
        .orderBy(desc(astroSyncRuns.startedAt))
        .limit(1);

      if (pendingRun) {
        const message = error instanceof Error ? error.message : String(error);
        await db.update(astroSyncRuns).set({
          status: "failed",
          errorMessage: message,
          finishedAt: new Date(),
        }).where(eq(astroSyncRuns.id, pendingRun.id));
      }
    } catch {
      // Cleanup failure must not affect BullMQ retry behavior
    }
  }

  override async afterComplete(
    _output: z.infer<typeof OutputSchema>,
    pipelineInput: PipelineInput,
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
          "Cluster link rebuild enqueued after article sync",
        );
      }
    } catch (e) {
      log.warn({ articleId: pipelineInput.articleId, err: e }, "Failed to enqueue link rebuild after sync");
    }
  }
}
