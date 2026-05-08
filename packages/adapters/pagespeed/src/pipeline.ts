import { createNotification } from "@marketing-auto/core/notifications";
import { db, users } from "@marketing-auto/db";
import { Pipeline } from "@marketing-auto/pipelines/engine";
import type { BaseStep } from "@marketing-auto/pipelines/engine";
import { createLogger } from "@marketing-auto/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { AstroBuildStep } from "./steps/astro-build.ts";
import { CloneOrUpdateAstroRepoStep } from "./steps/clone-or-update.ts";
import { EvaluateAndPersistStep } from "./steps/evaluate-and-persist.ts";
import { LighthouseStep } from "./steps/lighthouse.ts";
import { LoadArticleStep } from "./steps/load-article.ts";
import { AstroPreviewServerStep } from "./steps/preview-server.ts";
import { PsiApiStep } from "./steps/psi-api.ts";
import { PagespeedError } from "./types.ts";

const log = createLogger("pagespeed:pipeline");

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
});

const OutputSchema = z.object({
  outcome: z.enum(["pass", "fail"]),
  failedThresholds: z.array(z.string()),
  pagespeedRunId: z.string().uuid(),
});

type PipelineInput = z.infer<typeof InputSchema>;
type PipelineOutput = z.infer<typeof OutputSchema>;

export class PageSpeedValidationPipeline extends Pipeline<PipelineInput, PipelineOutput> {
  readonly name = "article:pagespeed-validation";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;
  readonly steps = [
    new LoadArticleStep(),
    new CloneOrUpdateAstroRepoStep(),
    new AstroBuildStep(),
    new AstroPreviewServerStep(),
    new LighthouseStep(),
    new EvaluateAndPersistStep(),
  ] as const;

  /** PID of the spawned Astro preview server — set in bridge, killed in cleanup hooks. */
  private previewServerPid: number | null = null;

  override bridge(
    fromStep: BaseStep<unknown, unknown>,
    toStep: BaseStep<unknown, unknown>,
    output: unknown,
    pipelineInput: PipelineInput,
    getStepOutput: <T = unknown>(stepName: string) => T | undefined
  ): unknown {
    if (fromStep.name === "load-article" && toStep.name === "clone-or-update") {
      const out = output as {
        astroRepo: { owner: string; name: string } | null;
        article: { astroCommitSha: string | null };
        workDir: string;
      };
      // Guard: local pipeline requires both astroRepo config and a prior Astro sync.
      // Status gate was removed in Spec 22.5 so these checks moved here from load-article.
      if (!out.astroRepo) {
        throw new PagespeedError(
          "Project has no astroRepo configured — set up via Spec 21 first",
          "config"
        );
      }
      if (!out.article.astroCommitSha) {
        throw new PagespeedError(
          "Article has no astroCommitSha — sync to Astro via Spec 21 first",
          "config"
        );
      }
      return {
        workDir: out.workDir,
        astroRepoOwner: out.astroRepo.owner,
        astroRepoName: out.astroRepo.name,
        astroCommitSha: out.article.astroCommitSha,
      };
    }

    if (fromStep.name === "clone-or-update" && toStep.name === "astro-build") {
      return { repoPath: (output as { repoPath: string }).repoPath };
    }

    if (fromStep.name === "astro-build" && toStep.name === "preview-server") {
      // AstroBuildStep output is buildSucceeded + buildOutputDir, but preview-server
      // needs the repoPath from clone-or-update
      const clone = getStepOutput<{ repoPath: string }>("clone-or-update")!;
      return { repoPath: clone.repoPath };
    }

    if (fromStep.name === "preview-server" && toStep.name === "lighthouse") {
      const out = output as { serverUrl: string; serverPid: number };
      this.previewServerPid = out.serverPid;
      const load = getStepOutput<{ article: { slug: string }; workDir: string }>("load-article")!;
      return {
        serverUrl: out.serverUrl,
        articleSlug: load.article.slug,
        workDir: load.workDir,
      };
    }

    if (fromStep.name === "lighthouse" && toStep.name === "evaluate-and-persist") {
      const out = output as {
        scores: unknown;
        coreWebVitals: unknown;
        reportPath: string;
        testedUrl: string;
      };
      const load = getStepOutput<{
        article: { id: string; astroCommitSha: string | null };
        thresholds: unknown;
      }>("load-article")!;
      return {
        articleId: load.article.id,
        projectId: pipelineInput.projectId,
        mode: "local" as const,
        scores: out.scores,
        coreWebVitals: out.coreWebVitals,
        thresholds: load.thresholds,
        reportPath: out.reportPath,
        testedUrl: out.testedUrl,
        astroCommitSha: load.article.astroCommitSha,
      };
    }

    return output;
  }

  override async afterComplete(_output: PipelineOutput, _input: PipelineInput): Promise<void> {
    await this.killPreviewServer();
  }

  override async afterError(error: unknown, input: PipelineInput): Promise<void> {
    await this.killPreviewServer();

    // Notify owners of pagespeed failure (warning — in-app only)
    try {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const owners = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, "owner"));
      for (const owner of owners) {
        void createNotification({
          userId: owner.id,
          type: "pagespeed_failure",
          severity: "warning",
          title: "PageSpeed validation failed",
          message: errorMessage.slice(0, 200),
          link: `/articles/${input.articleId}`,
          metadata: { articleId: input.articleId },
        });
      }
    } catch {
      // Notification failure must not affect retry behavior
    }
  }

  private async killPreviewServer(): Promise<void> {
    if (!this.previewServerPid) return;
    const pid = this.previewServerPid;
    try {
      process.kill(pid, "SIGTERM");
      await sleep(2000);
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Process already exited — expected
      }
    } catch (e) {
      // PID no longer exists; nothing to do
      log.debug({ pid }, "Preview server already exited before kill");
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ────────────────────────────────────────────────────────────
// API pipeline (Spec 22.5): load-article → psi-api → evaluate-and-persist
// No local Astro build needed — tests a live public URL via Google PSI.
// ────────────────────────────────────────────────────────────

const ApiInputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  url: z.string().url(),
});

const ApiOutputSchema = z.object({
  outcome: z.enum(["pass", "fail"]),
  failedThresholds: z.array(z.string()),
  pagespeedRunId: z.string().uuid(),
});

type ApiPipelineInput = z.infer<typeof ApiInputSchema>;
type ApiPipelineOutput = z.infer<typeof ApiOutputSchema>;

export class PageSpeedApiValidationPipeline extends Pipeline<
  ApiPipelineInput,
  ApiPipelineOutput
> {
  readonly name = "article:pagespeed-validation-api";
  readonly inputSchema = ApiInputSchema;
  readonly outputSchema = ApiOutputSchema;
  readonly steps = [
    new LoadArticleStep(),
    new PsiApiStep(),
    new EvaluateAndPersistStep(),
  ] as const;

  override bridge(
    fromStep: BaseStep<unknown, unknown>,
    toStep: BaseStep<unknown, unknown>,
    output: unknown,
    pipelineInput: ApiPipelineInput,
    getStepOutput: <T = unknown>(stepName: string) => T | undefined
  ): unknown {
    if (fromStep.name === "load-article" && toStep.name === "psi-api") {
      return {
        url: pipelineInput.url,
        articleId: pipelineInput.articleId,
      };
    }

    if (fromStep.name === "psi-api" && toStep.name === "evaluate-and-persist") {
      const psiOut = output as {
        scores: Record<string, number>;
        coreWebVitals: Record<string, number | null>;
        testedUrl: string;
        reportPath: null;
      };
      const loadOut = getStepOutput<{ thresholds: Record<string, number> }>("load-article")!;
      return {
        articleId: pipelineInput.articleId,
        projectId: pipelineInput.projectId,
        mode: "api" as const,
        scores: psiOut.scores,
        coreWebVitals: psiOut.coreWebVitals,
        thresholds: loadOut.thresholds,
        reportPath: psiOut.reportPath,
        testedUrl: psiOut.testedUrl,
        astroCommitSha: null,
      };
    }

    return output;
  }

  override async afterError(error: unknown, input: ApiPipelineInput): Promise<void> {
    try {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const owners = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, "owner"));
      for (const owner of owners) {
        void createNotification({
          userId: owner.id,
          type: "pagespeed_failure",
          severity: "warning",
          title: "PageSpeed API validation failed",
          message: errorMessage.slice(0, 200),
          link: `/articles/${input.articleId}`,
          metadata: { articleId: input.articleId },
        });
      }
    } catch {
      // Notification failure must not affect retry behavior
    }
  }
}
