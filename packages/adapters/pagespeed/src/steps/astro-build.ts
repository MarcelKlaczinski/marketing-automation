import { access } from "node:fs/promises";
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { createLogger, getEnv } from "@marketing-auto/shared";
import { z } from "zod";
import { runCmd } from "./clone-or-update.ts";

const log = createLogger("pagespeed:build");

const InputSchema = z.object({
  repoPath: z.string(),
});

const OutputSchema = z.object({
  buildSucceeded: z.literal(true),
  buildOutputDir: z.string(),
});

export class AstroBuildStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "astro-build";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number {
    return 0;
  }

  async execute(
    input: z.infer<typeof InputSchema>,
    _ctx: StepContext
  ): Promise<z.infer<typeof OutputSchema>> {
    const env = getEnv();
    const timeoutMs = env.PAGESPEED_BUILD_TIMEOUT_MS;

    const packageMgr = await detectPackageManager(input.repoPath);
    log.info({ packageMgr, repoPath: input.repoPath }, "Installing dependencies");

    const installArgs: Record<string, string[]> = {
      npm: ["ci"],
      pnpm: ["install", "--frozen-lockfile"],
      yarn: ["install", "--frozen-lockfile"],
    };

    await runCmd(packageMgr, installArgs[packageMgr]!, {
      cwd: input.repoPath,
      timeoutMs,
      stage: "build",
    });

    log.info({ repoPath: input.repoPath }, "Running astro build");
    await runCmd(packageMgr, ["run", "build"], {
      cwd: input.repoPath,
      timeoutMs,
      stage: "build",
    });

    return {
      buildSucceeded: true as const,
      buildOutputDir: `${input.repoPath}/dist`,
    };
  }
}

async function detectPackageManager(repoPath: string): Promise<"npm" | "pnpm" | "yarn"> {
  if (await fileExists(`${repoPath}/pnpm-lock.yaml`)) return "pnpm";
  if (await fileExists(`${repoPath}/yarn.lock`)) return "yarn";
  return "npm";
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}
