import { z } from "zod";
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { getInstallationOctokit } from "../github-auth.ts";
import { AstroSyncError, type AstroRepoConfig } from "../types.ts";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("astro-sync:commit");

const InputSchema = z.object({
  astroRepo: z.unknown(),
  files: z.array(z.object({
    path: z.string(),
    contentType: z.enum(["text", "base64"]),
    content: z.string(),
  })),
  commitMessage: z.string(),
});

const OutputSchema = z.object({
  commitSha: z.string(),
  commitUrl: z.string().url(),
  filesCommitted: z.array(z.string()),
  bytesCommitted: z.number(),
});

export class CommitToGitHubStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "commit-to-github";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0; }

  async execute(input: z.infer<typeof InputSchema>, _ctx: StepContext) {
    const repo = input.astroRepo as AstroRepoConfig;
    const octokit = await getInstallationOctokit(repo.installationId);
    const { owner, name: repoName, defaultBranch } = repo;

    try {
      // 1. Get current ref (SHA of branch tip)
      const { data: ref } = await octokit.request(
        "GET /repos/{owner}/{repo}/git/ref/{ref}",
        { owner, repo: repoName, ref: `heads/${defaultBranch}` },
      );
      const baseCommitSha = ref.object.sha;

      // 2. Get base tree SHA
      const { data: baseCommit } = await octokit.request(
        "GET /repos/{owner}/{repo}/git/commits/{commit_sha}",
        { owner, repo: repoName, commit_sha: baseCommitSha },
      );
      const baseTreeSha = baseCommit.tree.sha;

      // 3. Create blobs for each file
      log.debug({ count: input.files.length }, "Creating blobs");
      const blobs = await Promise.all(
        input.files.map(async (file) => {
          const { data } = await octokit.request(
            "POST /repos/{owner}/{repo}/git/blobs",
            {
              owner, repo: repoName,
              content: file.content,
              encoding: file.contentType === "text" ? "utf-8" : "base64",
            },
          );
          // GitHub doesn't return size in blob create response; compute from content
          const byteSize = file.contentType === "text"
            ? Buffer.byteLength(file.content, "utf-8")
            : Buffer.from(file.content, "base64").length;
          return { path: file.path, sha: data.sha, size: byteSize };
        }),
      );

      // 4. Create tree
      const { data: tree } = await octokit.request(
        "POST /repos/{owner}/{repo}/git/trees",
        {
          owner, repo: repoName,
          base_tree: baseTreeSha,
          tree: blobs.map((b) => ({
            path: b.path,
            mode: "100644" as const,
            type: "blob" as const,
            sha: b.sha,
          })),
        },
      );

      // 5. Create commit
      const { data: newCommit } = await octokit.request(
        "POST /repos/{owner}/{repo}/git/commits",
        {
          owner, repo: repoName,
          message: input.commitMessage,
          tree: tree.sha,
          parents: [baseCommitSha],
        },
      );

      // 6. Update ref to point at new commit
      await octokit.request(
        "PATCH /repos/{owner}/{repo}/git/refs/{ref}",
        {
          owner, repo: repoName,
          ref: `heads/${defaultBranch}`,
          sha: newCommit.sha,
          force: false,
        },
      );

      const bytesCommitted = blobs.reduce((sum, b) => sum + b.size, 0);
      const commitUrl = `https://github.com/${owner}/${repoName}/commit/${newCommit.sha}`;

      log.info({ commitSha: newCommit.sha, filesCommitted: input.files.length, bytesCommitted }, "Astro repo commit successful");

      return {
        commitSha: newCommit.sha,
        commitUrl,
        filesCommitted: input.files.map((f) => f.path),
        bytesCommitted,
      };
    } catch (e) {
      if (e instanceof AstroSyncError) throw e;
      throw new AstroSyncError(
        `GitHub API error: ${e instanceof Error ? e.message : String(e)}`,
        "commit",
        e,
      );
    }
  }
}
