import { astroImportRuns, db } from "@marketing-auto/db";
import { Pipeline } from "@marketing-auto/pipelines/engine";
import type { BaseStep } from "@marketing-auto/pipelines/engine";
import { createLogger } from "@marketing-auto/shared";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { DetectContentGapsStep } from "./steps/detect-content-gaps.ts";
import { ExtractCollectionSchemasStep } from "./steps/extract-collection-schemas.ts";
import { FilterChangedFilesStep } from "./steps/filter-changed-files.ts";
import { LinkTranslationPairsStep } from "./steps/link-translation-pairs.ts";
import { ListContentFilesStep } from "./steps/list-content-files.ts";
import { ParseFrontmatterBatchStep } from "./steps/parse-frontmatter-batch.ts";
import { SyncClustersFromFrontmatterStep } from "./steps/sync-clusters-from-frontmatter.ts";
import { UpdateImportRunStep } from "./steps/update-import-run.ts";
import { UpsertArticlesStep } from "./steps/upsert-articles.ts";

const log = createLogger("astro-import:pipeline");

const InputSchema = z.object({
  projectId: z.string().uuid(),
  importRunId: z.string().uuid(),
  astroRepo: z.record(z.unknown()),
  forceAll: z.boolean().default(false),
});

const OutputSchema = z.object({
  importRunId: z.string().uuid(),
});

type PipelineInput = z.infer<typeof InputSchema>;

export class RepoImportPipeline extends Pipeline<PipelineInput, z.infer<typeof OutputSchema>> {
  readonly name = "astro:repo-import";
  readonly inputSchema = InputSchema as z.ZodType<z.infer<typeof InputSchema>>;
  readonly outputSchema = OutputSchema;
  readonly steps = [
    new ExtractCollectionSchemasStep(),    // Spec 50: extract + persist frontmatter schemas from content.config.ts
    new ListContentFilesStep(),
    new FilterChangedFilesStep(),
    new ParseFrontmatterBatchStep(),
    new UpsertArticlesStep(),
    new LinkTranslationPairsStep(),
    new SyncClustersFromFrontmatterStep(), // Spec 49a: auto-populate clusters from clusterKey frontmatter
    new DetectContentGapsStep(),           // Spec 49b: zero-cost gap detection after each import
    new UpdateImportRunStep(),
  ] as const;

  override bridge(
    fromStep: BaseStep<unknown, unknown>,
    toStep: BaseStep<unknown, unknown>,
    output: unknown,
    pipelineInput: PipelineInput,
    getStepOutput: <T = unknown>(stepName: string) => T | undefined
  ): unknown {
    if (fromStep.name === "extract-collection-schemas" && toStep.name === "list-content-files") {
      return { astroRepo: pipelineInput.astroRepo };
    }

    if (fromStep.name === "list-content-files" && toStep.name === "filter-changed-files") {
      const out = output as { headCommitSha: string; files: unknown[] };
      return {
        projectId: pipelineInput.projectId,
        files: out.files,
        forceAll: pipelineInput.forceAll ?? false,
      };
    }

    if (fromStep.name === "filter-changed-files" && toStep.name === "parse-frontmatter-batch") {
      const out = output as { changed: unknown[] };
      return {
        astroRepo: pipelineInput.astroRepo,
        changed: out.changed,
      };
    }

    if (fromStep.name === "parse-frontmatter-batch" && toStep.name === "upsert-articles") {
      const out = output as { parsed: unknown[]; failedCount: number };
      return {
        projectId: pipelineInput.projectId,
        parsed: out.parsed,
      };
    }

    if (fromStep.name === "upsert-articles" && toStep.name === "link-translation-pairs") {
      return { projectId: pipelineInput.projectId };
    }

    if (fromStep.name === "link-translation-pairs" && toStep.name === "sync-clusters-from-frontmatter") {
      return { projectId: pipelineInput.projectId };
    }

    if (fromStep.name === "sync-clusters-from-frontmatter" && toStep.name === "detect-content-gaps") {
      return { projectId: pipelineInput.projectId };
    }

    if (fromStep.name === "detect-content-gaps" && toStep.name === "update-import-run") {
      const list = getStepOutput<{ headCommitSha: string; files: unknown[] }>(
        "list-content-files"
      )!;
      const filter = getStepOutput<{
        changed: unknown[];
        unchangedCount: number;
        removedPaths: string[];
      }>("filter-changed-files")!;
      const parse = getStepOutput<{ parsed: unknown[]; failedCount: number }>(
        "parse-frontmatter-batch"
      )!;
      const upsert = getStepOutput<{ inserted: number; updated: number; failed: number }>(
        "upsert-articles"
      )!;
      const link = getStepOutput<{ totalPairs: number; orphans: number; unkeyed: number }>(
        "link-translation-pairs"
      )!;

      return {
        importRunId: pipelineInput.importRunId,
        filesDiscovered: list.files.length,
        filesParsed: parse.parsed.length,
        articlesInserted: upsert.inserted,
        articlesUpdated: upsert.updated,
        articlesUnchanged: filter.unchangedCount,
        articlesFailed: parse.failedCount + upsert.failed,
        totalPairs: link.totalPairs,
        orphans: link.orphans,
        headCommitSha: list.headCommitSha,
      };
    }

    return output;
  }

  override async afterError(error: unknown, pipelineInput: PipelineInput): Promise<void> {
    try {
      const [pendingRun] = await db
        .select({ id: astroImportRuns.id })
        .from(astroImportRuns)
        .where(
          and(
            eq(astroImportRuns.id, pipelineInput.importRunId),
            eq(astroImportRuns.status, "pending")
          )
        )
        .orderBy(desc(astroImportRuns.startedAt))
        .limit(1);

      if (pendingRun) {
        await db
          .update(astroImportRuns)
          .set({
            status: "failed",
            errorMessage: error instanceof Error ? error.message : String(error),
            finishedAt: new Date(),
          })
          .where(eq(astroImportRuns.id, pendingRun.id));
      }
    } catch {
      // Cleanup failure must not affect BullMQ retry behavior
    }
    log.warn({ importRunId: pipelineInput.importRunId, error }, "Import pipeline failed");
  }
}
