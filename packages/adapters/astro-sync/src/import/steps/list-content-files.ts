import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { z } from "zod";
import { getInstallationOctokit } from "../../github-auth.ts";
import { AstroRepoConfigSchema, type AstroRepoConfig } from "../../types.ts";

const InputSchema = z.object({
  astroRepo: AstroRepoConfigSchema,
});

const OutputSchema = z.object({
  headCommitSha: z.string(),
  files: z.array(
    z.object({
      path: z.string(),
      sha: z.string(),
      size: z.number(),
    })
  ),
});

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

// AstroRepoConfigSchema has .default() fields — _input type gets `string | undefined` for those.
// Cast to ZodType<Input> to satisfy BaseStep's strict generic (safe: .parse() always returns Input).
const InputSchemaCast = InputSchema as z.ZodType<Input>;
const OutputSchemaCast = OutputSchema as z.ZodType<Output>;

export class ListContentFilesStep extends BaseStep<Input, Output> {
  readonly name = "list-content-files";
  readonly inputSchema = InputSchemaCast;
  readonly outputSchema = OutputSchemaCast;

  override estimatedCostEur(): number {
    return 0;
  }

  async execute(input: Input, _ctx: StepContext) {
    const repo = input.astroRepo as AstroRepoConfig;
    const octokit = await getInstallationOctokit(repo.installationId);

    const refRes = await octokit.request(
      "GET /repos/{owner}/{repo}/git/refs/heads/{branch}",
      { owner: repo.owner, repo: repo.name, branch: repo.defaultBranch }
    );
    const headCommitSha = refRes.data.object.sha;

    const treeRes = await octokit.request(
      "GET /repos/{owner}/{repo}/git/trees/{tree_sha}",
      { owner: repo.owner, repo: repo.name, tree_sha: headCommitSha, recursive: "1" }
    );

    const contentPathPrefix = repo.contentRoot.replace(/^\/|\/$/g, "");
    const files = (treeRes.data.tree ?? [])
      .filter(
        (entry) =>
          entry.type === "blob" &&
          entry.path?.startsWith(contentPathPrefix) &&
          /\.mdx?$/i.test(entry.path)
      )
      .map((entry) => ({
        path: entry.path!,
        sha: entry.sha!,
        size: entry.size ?? 0,
      }));

    return { headCommitSha, files };
  }
}
