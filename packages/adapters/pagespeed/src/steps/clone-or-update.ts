import { z } from "zod";
import { spawn } from "node:child_process";
import { mkdir, access } from "node:fs/promises";
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { createLogger } from "@marketing-auto/shared";
import { PagespeedError } from "../types.ts";

const log = createLogger("pagespeed:clone");

const InputSchema = z.object({
  workDir: z.string(),
  astroRepoOwner: z.string(),
  astroRepoName: z.string(),
  astroCommitSha: z.string(),
});

const OutputSchema = z.object({
  repoPath: z.string(),
  checkedOutSha: z.string(),
});

export class CloneOrUpdateAstroRepoStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "clone-or-update";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0; }

  async execute(input: z.infer<typeof InputSchema>, _ctx: StepContext): Promise<z.infer<typeof OutputSchema>> {
    await mkdir(input.workDir, { recursive: true });
    const repoPath = `${input.workDir}/repo`;
    const cloneUrl = `https://github.com/${input.astroRepoOwner}/${input.astroRepoName}.git`;

    const exists = await fileExists(repoPath);

    if (!exists) {
      log.info({ cloneUrl, repoPath }, "Cloning Astro repo");
      await runCmd("git", ["clone", "--depth=50", cloneUrl, repoPath], {
        cwd: input.workDir,
        stage: "clone",
      });
    } else {
      log.info({ repoPath }, "Repo exists, fetching latest");
      await runCmd("git", ["fetch", "origin"], { cwd: repoPath, stage: "clone" });
    }

    log.info({ sha: input.astroCommitSha }, "Checking out commit");
    await runCmd("git", ["checkout", input.astroCommitSha], { cwd: repoPath, stage: "clone" });

    return {
      repoPath,
      checkedOutSha: input.astroCommitSha,
    };
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export type RunCmdStage = "clone" | "build" | "preview" | "lighthouse" | "evaluate" | "config";

/**
 * Structural type describing the subset of Node.js ChildProcess used by runCmd.
 * Necessary because Bun's node:child_process types don't model ChildProcess as
 * an EventEmitter, omitting .on() from the inferred return type of spawn().
 */
interface SpawnResult {
  readonly stdout: { on(event: 'data', cb: (d: Buffer) => void): void };
  readonly stderr: { on(event: 'data', cb: (d: Buffer) => void): void };
  on(event: 'close', cb: (code: number | null) => void): void;
  on(event: 'error', cb: (err: Error) => void): void;
  kill(signal?: string): boolean;
}

export function runCmd(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeoutMs?: number; stage?: RunCmdStage },
): Promise<{ stdout: string; stderr: string }> {
  const stage = opts.stage ?? "clone";
  return new Promise((resolve, reject) => {
    // Bun's node:child_process types don't model ChildProcess as an EventEmitter,
    // so .on() is absent from the inferred type. SpawnResult below is the accurate
    // structural description of what spawn() actually returns at runtime.
    const proc = spawn(cmd, args, { cwd: opts.cwd }) as unknown as SpawnResult;
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d: Buffer) => { stdout += String(d); });
    proc.stderr.on("data", (d: Buffer) => { stderr += String(d); });

    const timeout = opts.timeoutMs
      ? setTimeout(() => {
          proc.kill("SIGKILL");
          reject(new PagespeedError(
            `${cmd} timed out after ${opts.timeoutMs}ms`,
            stage,
          ));
        }, opts.timeoutMs)
      : null;

    proc.on("close", (code: number | null) => {
      if (timeout) clearTimeout(timeout);
      if (code !== 0) {
        reject(new PagespeedError(
          `${cmd} ${args.join(" ")} failed (exit ${code}):\n${stderr}`,
          stage,
        ));
      } else {
        resolve({ stdout, stderr });
      }
    });

    proc.on("error", (err: Error) => {
      if (timeout) clearTimeout(timeout);
      reject(new PagespeedError(`${cmd} spawn error: ${err.message}`, stage, err));
    });
  });
}
