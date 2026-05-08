import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { createLogger } from "@marketing-auto/shared";
import { z } from "zod";
import { getInstallationOctokit } from "../../github-auth.ts";
import { AstroRepoConfigSchema, type AstroRepoConfig } from "../../types.ts";
import { parseMdxContent } from "../parse-frontmatter.ts";

const log = createLogger("astro-import:parse");

const FileSchema = z.object({ path: z.string(), sha: z.string(), size: z.number() });

const InputSchema = z.object({
  astroRepo: AstroRepoConfigSchema,
  changed: z.array(FileSchema),
});

const ParsedEntrySchema = z.object({
  filePath: z.string(),
  gitSha: z.string(),
  collection: z.string(),
  typed: z.record(z.unknown()),
  extras: z.record(z.unknown()),
  metadata: z.record(z.unknown()),
  body: z.string(),
});

const OutputSchema = z.object({
  parsed: z.array(ParsedEntrySchema),
  failedCount: z.number(),
});

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

// AstroRepoConfigSchema has .default() fields → cast to satisfy BaseStep's strict generic
const InputSchemaCast = InputSchema as z.ZodType<Input>;
const OutputSchemaCast = OutputSchema as z.ZodType<Output>;

export class ParseFrontmatterBatchStep extends BaseStep<Input, Output> {
  readonly name = "parse-frontmatter-batch";
  readonly inputSchema = InputSchemaCast;
  readonly outputSchema = OutputSchemaCast;

  override estimatedCostEur(): number {
    return 0;
  }

  async execute(input: Input, _ctx: StepContext) {
    const repo = input.astroRepo as AstroRepoConfig;
    const octokit = await getInstallationOctokit(repo.installationId);

    const parsed: z.infer<typeof ParsedEntrySchema>[] = [];
    let failedCount = 0;

    const batchSize = 10;
    for (let i = 0; i < input.changed.length; i += batchSize) {
      const batch = input.changed.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (file) => {
          const blobRes = await octokit.request(
            "GET /repos/{owner}/{repo}/git/blobs/{file_sha}",
            { owner: repo.owner, repo: repo.name, file_sha: file.sha }
          );
          const content = Buffer.from(blobRes.data.content, "base64").toString("utf-8");
          const collection = extractCollection(file.path, repo.contentRoot);
          const result = parseMdxContent(file.path, content);
          return {
            filePath: file.path,
            gitSha: file.sha,
            collection,
            typed: result.typed as Record<string, unknown>,
            extras: result.extras,
            metadata: result.metadata as Record<string, unknown>,
            body: result.body,
          };
        })
      );

      for (const r of results) {
        if (r.status === "fulfilled") {
          parsed.push(r.value);
        } else {
          failedCount++;
          log.warn({ error: r.reason }, "Failed to parse file");
        }
      }
    }

    return { parsed, failedCount };
  }
}

function extractCollection(filePath: string, contentRoot: string): string {
  const root = contentRoot.replace(/^\/|\/$/g, "");
  const relPath = filePath.startsWith(root) ? filePath.slice(root.length + 1) : filePath;
  return relPath.split("/")[0] ?? "unknown";
}
