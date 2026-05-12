import { spawn } from "node:child_process";
import { z } from "zod";

/**
 * Structural type describing the subset of Node.js ChildProcess used here.
 * Necessary because Bun's node:child_process types don't model ChildProcess as
 * an EventEmitter, omitting .on() from the inferred return type of spawn().
 */
interface SpawnResult {
  readonly stdout: { on(event: "data", cb: (d: Buffer) => void): void };
  readonly stderr: { on(event: "data", cb: (d: Buffer) => void): void };
  on(event: "error", cb: (err: Error) => void): void;
  kill(signal?: string): boolean;
  readonly pid?: number;
}
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { createLogger } from "@marketing-auto/shared";
import { PagespeedError } from "../types.ts";

const log = createLogger("pagespeed:preview");

const InputSchema = z.object({
  repoPath: z.string(),
});

const OutputSchema = z.object({
  serverUrl: z.string().url(),
  serverPid: z.number(),
});

const START_TIMEOUT_MS = 30_000;

/**
 * Boots `astro preview` and waits for the "Local: http://..." line in stdout.
 * Returns the URL and PID so the pipeline can kill the process in afterComplete/afterError.
 * Uses a fixed port (14321) since Astro doesn't support --port 0 for dynamic binding.
 */
export class AstroPreviewServerStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "preview-server";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number {
    return 0;
  }

  async execute(
    input: z.infer<typeof InputSchema>,
    _ctx: StepContext
  ): Promise<z.infer<typeof OutputSchema>> {
    const port = 14321;

    // Bun's node:child_process types don't model ChildProcess as an EventEmitter,
    // so .on() is absent from the inferred type. SpawnResult above is the accurate
    // structural description of what spawn() actually returns at runtime.
    const proc = spawn("npx", ["astro", "preview", "--port", String(port)], {
      cwd: input.repoPath,
      detached: false,
    }) as unknown as SpawnResult;

    let serverUrl: string | null = null;
    let stderr = "";
    let stdout = "";

    proc.stdout.on("data", (d: Buffer) => {
      const s = String(d);
      stdout += s;
      // Astro logs "Local: http://localhost:XXXX/" — capture it
      const m = s.match(/Local:\s+(http:\/\/localhost:\d+\/?)/);
      if (m && !serverUrl) serverUrl = m[1]!;
    });

    proc.stderr.on("data", (d: Buffer) => {
      stderr += String(d);
      // Some Astro versions write the URL to stderr
      const m = String(d).match(/Local:\s+(http:\/\/localhost:\d+\/?)/);
      if (m && !serverUrl) serverUrl = m[1]!;
    });

    proc.on("error", (err: Error) => {
      if (!serverUrl) {
        // Will be caught by the timeout loop rejection
        stderr += `\nSpawn error: ${err.message}`;
      }
    });

    const startTime = Date.now();
    while (!serverUrl) {
      if (Date.now() - startTime > START_TIMEOUT_MS) {
        proc.kill("SIGKILL");
        throw new PagespeedError(
          `Astro preview server did not start within ${START_TIMEOUT_MS}ms.\nstderr: ${stderr}\nstdout: ${stdout}`,
          "preview"
        );
      }
      await sleep(200);
    }

    if (!proc.pid) {
      throw new PagespeedError("Preview server has no PID", "preview");
    }

    log.info({ serverUrl, pid: proc.pid }, "Astro preview server started");

    return {
      serverUrl,
      serverPid: proc.pid,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
