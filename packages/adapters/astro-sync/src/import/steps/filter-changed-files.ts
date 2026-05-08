import { articles, db } from "@marketing-auto/db";
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const FileSchema = z.object({ path: z.string(), sha: z.string(), size: z.number() });

const InputSchema = z.object({
  projectId: z.string().uuid(),
  files: z.array(FileSchema),
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
  readonly inputSchema = InputSchema;
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

    for (const file of input.files) {
      const rec = existingByPath.get(file.path);
      if (!rec || rec.gitSha !== file.sha) {
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
