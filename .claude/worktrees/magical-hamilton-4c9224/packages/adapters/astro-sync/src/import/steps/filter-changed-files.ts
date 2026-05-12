import { articles, db } from "@marketing-auto/db";
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { createLogger } from "@marketing-auto/shared";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const log = createLogger("astro-import:filter-changed");

const FileSchema = z.object({ path: z.string(), sha: z.string(), size: z.number() });

const InputSchema = z.object({
  projectId: z.string().uuid(),
  files: z.array(FileSchema),
  forceAll: z.boolean().default(false),
});

const OutputSchema = z.object({
  changed: z.array(FileSchema),
  unchangedCount: z.number(),
  removedPaths: z.array(z.string()),
});

export class FilterChangedFilesStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "filter-changed-files";
  readonly inputSchema = InputSchema as z.ZodType<z.infer<typeof InputSchema>>;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number {
    return 0;
  }

  async execute(input: z.infer<typeof InputSchema>, _ctx: StepContext) {
    const existing = await db
      .select({ filePath: articles.filePath, gitSha: articles.gitSha, id: articles.id })
      .from(articles)
      .where(and(eq(articles.projectId, input.projectId), eq(articles.source, "imported")));

    const existingByPath = new Map(existing.map((a) => [a.filePath ?? "", a]));
    const incomingPaths = new Set(input.files.map((f) => f.path));

    const changed: z.infer<typeof FileSchema>[] = [];
    let unchangedCount = 0;

    if (input.forceAll) {
      log.info(
        { totalFiles: input.files.length },
        "forceAll=true: all files marked as changed regardless of git_sha"
      );
    }

    for (const file of input.files) {
      const rec = existingByPath.get(file.path);
      if (input.forceAll || !rec || rec.gitSha !== file.sha) {
        changed.push(file);
      } else {
        unchangedCount++;
      }
    }

    const removedPaths: string[] = [];
    for (const [path] of existingByPath) {
      if (!incomingPaths.has(path)) removedPaths.push(path);
    }

    return { changed, unchangedCount, removedPaths };
  }
}
