import { Pipeline } from "@marketing-auto/pipelines/engine";
import type { BaseStep } from "@marketing-auto/pipelines/engine";
import { createLogger } from "@marketing-auto/shared";
import { z } from "zod";
import { AstroBuildStep } from "./steps/astro-build.ts";
import { CloneOrUpdateAstroRepoStep } from "./steps/clone-or-update.ts";
import { EvaluateAndPersistStep } from "./steps/evaluate-and-persist.ts";
import { LighthouseStep } from "./steps/lighthouse.ts";
import { LoadArticleStep } from "./steps/load-article.ts";
import { AstroPreviewServerStep } from "./steps/preview-server.ts";

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
        astroRepo: { owner: string; name: string };
        article: { astroCommitSha: string };
        workDir: string;
      };
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
        article: { id: string; astroCommitSha: string };
        thresholds: unknown;
      }>("load-article")!;
      return {
        articleId: load.article.id,
        projectId: pipelineInput.projectId,
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

  override async afterError(_error: unknown, _input: PipelineInput): Promise<void> {
    await this.killPreviewServer();
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
