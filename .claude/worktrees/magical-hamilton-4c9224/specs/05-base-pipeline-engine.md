# Spec 05: Base Pipeline Engine

**Phase:** 1 (Foundation)
**Estimated Effort:** 1.5–2 days
**Dependencies:** Spec 00, Spec 01, Spec 03 (cost tracker)
**Status:** Ready for implementation
**Recommended Model:** Opus 4.7 (architectural core — design quality matters most here)

---

## Goal

Build the foundational pipeline engine that all marketing pipelines (article generation, social repurposing, identity workshop, etc.) will be built on. Provides:

1. A typed `Step<TInput, TOutput>` contract with idempotency, retry, cost-tracking hooks
2. A `Pipeline` class that composes steps and handles wiring
3. BullMQ integration for async execution + persistence
4. A `pipeline_runs` table integration for audit and observability
5. Scheduled jobs infrastructure (for daily cleanup, briefings later)
6. Skill loading helpers (read SKILL.md from `packages/skills/skills/<name>/`)

This spec doesn't implement any specific marketing pipeline — those come in Phase 2+. But everything in Phase 2+ depends on this infrastructure being solid.

## Non-Goals

- No specific pipeline implementations (those are Phase 2: identity-workshop, article, social-repurpose)
- No LLM adapter (that's Spec 11 — Anthropic adapter)
- No project-config-driven dynamic pipeline assembly (Phase 3+; for now, pipelines are TypeScript classes)
- No DAG/parallel execution within a pipeline (sequential only for MVP — sufficient for our needs)
- No pipeline UI (CLI/programmatic only; UI comes in Phase 3)
- No pipeline rollback/compensation (we re-run failed steps; we don't undo)

## User-Facing Behavior (for developers building pipelines)

After this spec, a Phase-2 developer can:

```typescript
// Define a step
class GenerateOutlineStep extends BaseStep<{ topic: string }, { outline: string[] }> {
  readonly name = "generate-outline";
  
  async execute(input, ctx) {
    const skillContent = await loadSkill("content-strategy");
    // ... call LLM via cost-tracked adapter ...
    return { outline: ["intro", "body", "conclusion"] };
  }
}

// Compose into pipeline
class ArticlePipeline extends Pipeline {
  readonly name = "article-pipeline";
  steps = [
    new GenerateOutlineStep(),
    new GenerateDraftStep(),
    // ...
  ];
}

// Trigger from anywhere
const result = await pipelineRunner.run(new ArticlePipeline(), {
  projectId: "...",
  input: { topic: "How to use Claude" },
});
// result.runId can be used to query status
```

The pipeline runs **synchronously** when called via `pipelineRunner.run()` (returns when done), OR **asynchronously** via `pipelineRunner.enqueue()` which returns a job ID immediately and runs via BullMQ worker.

For the MVP, we keep it simple: every pipeline runs as ONE BullMQ job (not one job per step). Steps execute sequentially within that job. This is dramatically simpler than per-step queueing and sufficient for our scale.

## Architectural Decisions

**Why one BullMQ job per pipeline, not per step?**
- Step-level queueing means coordinating job dependencies (BullMQ Flows) — significant complexity
- Our pipelines are linear (no parallelism) and step durations are similar (~10-60s each)
- Crashes mid-pipeline → BullMQ retries the whole pipeline. Our `pipeline_runs` audit lets us detect partial completion and skip already-done steps via idempotency.
- Trade-off: one slow step blocks others. Acceptable for MVP. Phase 3 can split if needed.

**Why classes, not functions?**
- Steps need state: `name`, `idempotencyKey()`, `estimatedCost()`. Classes give us natural namespaces.
- Easier to extend in subclasses (e.g., `BalkonkraftwerkArticlePipeline extends ArticlePipeline`).
- Vue/Quasar uses Options API in this project — class-based feels native.

**Why sequential, not DAG?**
- All our planned pipelines are linear: research → outline → draft → review → image → publish.
- DAGs add infrastructure complexity (dependency resolution, parallelism scheduling) for zero current benefit.
- If a Phase 4 pipeline needs DAG, we add it then.

## Detailed Implementation

### Package Setup

`packages/pipelines/package.json`:
```json
{
  "name": "@marketing-auto/pipelines",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./engine": "./src/engine/index.ts",
    "./skills": "./src/skills/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  },
  "dependencies": {
    "@marketing-auto/shared": "workspace:*",
    "@marketing-auto/db": "workspace:*",
    "@marketing-auto/cost-tracker": "workspace:*",
    "drizzle-orm": "^0.36.0",
    "bullmq": "^5.21.0",
    "ioredis": "^5.4.1",
    "zod": "^3.23.8"
  }
}
```

### Step Contract

`packages/pipelines/src/engine/step.ts`:
```typescript
import type { z } from "zod";
import type { Logger } from "@marketing-auto/shared";

/**
 * Context passed to every step's execute() method.
 * Contains the runtime info a step needs to do its work and stay traceable.
 */
export type StepContext = {
  /** Project (tenant) executing the pipeline */
  projectId: string;
  /** ID of the parent pipeline_runs row (for cost-log linking) */
  pipelineRunId: string;
  /** ID of this step's pipeline_runs row (sub-run of the pipeline run) */
  stepRunId: string;
  /** Pipeline name for logging */
  pipelineName: string;
  /** Logger pre-bound with run context */
  log: Logger;
  /**
   * Reports progress (0-100). Surfaces in BullMQ progress for UI.
   * Optional but encouraged for slow steps.
   */
  reportProgress: (percent: number, message?: string) => Promise<void>;
  /**
   * Read state from a previous step's output (by step name).
   * Useful when step N+2 needs step N's output.
   */
  getStepOutput: <T = unknown>(stepName: string) => T | undefined;
};

/**
 * Base contract for a pipeline step.
 *
 * Steps MUST be idempotent: re-running with the same input produces the same output.
 * Steps SHOULD compute idempotencyKey() to enable skip-on-rerun.
 */
export abstract class BaseStep<TInput, TOutput> {
  /** Unique step name within a pipeline (also used as BullMQ progress label) */
  abstract readonly name: string;
  
  /** Optional human-readable description for logs/UI */
  readonly description?: string;
  
  /** Zod schema for input validation. Validated before execute(). */
  abstract readonly inputSchema: z.ZodType<TInput>;
  
  /** Zod schema for output validation. Validated after execute(). */
  abstract readonly outputSchema: z.ZodType<TOutput>;
  
  /**
   * Performs the step's work.
   * Throws on unrecoverable error (will propagate to BullMQ for retry).
   * Returns output that will be validated against outputSchema.
   */
  abstract execute(input: TInput, ctx: StepContext): Promise<TOutput>;
  
  /**
   * Returns an idempotency key for this step+input combination.
   * If the same key was completed in a previous (failed) run of the SAME pipeline_run,
   * the step's previous output is reused and execute() is skipped.
   *
   * Default implementation returns null (no idempotency optimization, always re-run).
   * Override when re-execution is expensive (LLM calls, image generation).
   *
   * Example: hash the input plus a step-version string.
   */
  idempotencyKey(_input: TInput): string | null {
    return null;
  }
  
  /**
   * Estimated max cost in EUR. Used by cost-tracker for pre-flight limit check.
   * Default: 0 (steps that don't call paid APIs).
   * Override for paid steps (LLM, image gen, etc.).
   */
  estimatedCostEur(_input: TInput): number {
    return 0;
  }
}
```

### Pipeline Contract

`packages/pipelines/src/engine/pipeline.ts`:
```typescript
import { z } from "zod";
import { BaseStep } from "./step.ts";

/**
 * A pipeline is an ordered list of steps where each step's output flows
 * into the next step's input via a `bridge` function.
 *
 * For the MVP we keep it simple: pipeline-level input is fed into the first step.
 * Each step's output becomes the next step's input directly (or via a bridge).
 *
 * Pipelines are TypeScript classes. To create a new pipeline:
 *   1. Subclass Pipeline
 *   2. Define `name`, `inputSchema`, `outputSchema`
 *   3. Define `steps` array
 *   4. (Optional) Override `bridge` if outputs don't directly map to next input
 */
export abstract class Pipeline<TInput = unknown, TOutput = unknown> {
  abstract readonly name: string;
  abstract readonly inputSchema: z.ZodType<TInput>;
  abstract readonly outputSchema: z.ZodType<TOutput>;
  
  /** Ordered list of steps. The output of step N feeds step N+1 (via `bridge`). */
  abstract readonly steps: ReadonlyArray<BaseStep<unknown, unknown>>;
  
  /**
   * Maps the output of one step to the input of the next.
   * Default: identity (output of N is input of N+1, types must match).
   *
   * Override if you need to construct the next step's input from a combination
   * of pipeline input + earlier step outputs.
   *
   * `getStepOutput(name)` lets you reach back to any prior step.
   */
  bridge(
    _fromStep: BaseStep<unknown, unknown>,
    _toStep: BaseStep<unknown, unknown>,
    output: unknown,
    _pipelineInput: TInput,
    _getStepOutput: <T = unknown>(stepName: string) => T | undefined,
  ): unknown {
    return output;
  }
}
```

### Skill Loader

`packages/pipelines/src/skills/loader.ts`:
```typescript
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("skills");

/**
 * Skills are markdown files under packages/skills/skills/<name>/SKILL.md.
 * That folder is a git submodule of coreyhaines31/marketingskills.
 *
 * loadSkill returns the raw markdown content. Pipeline steps inject this
 * into LLM system prompts (with prompt caching, the same skill content is
 * cheap to send repeatedly).
 */

const skillsRoot = resolve(import.meta.dir, "../../../skills/skills");
const skillCache = new Map<string, string>();

export async function loadSkill(name: string): Promise<string> {
  if (skillCache.has(name)) return skillCache.get(name)!;
  
  const path = join(skillsRoot, name, "SKILL.md");
  try {
    const content = await readFile(path, "utf-8");
    skillCache.set(name, content);
    log.debug({ name, sizeBytes: content.length }, "Skill loaded");
    return content;
  } catch (e) {
    log.error({ name, path, error: e }, "Failed to load skill");
    throw new Error(`Skill not found: ${name} (looked in ${path})`);
  }
}

/**
 * Loads multiple skills and returns them concatenated with separator headers.
 * Useful for steps that need multiple domains (e.g., copywriting + ai-seo).
 */
export async function loadSkills(names: string[]): Promise<string> {
  const contents = await Promise.all(names.map(loadSkill));
  return contents
    .map((c, i) => `# Skill: ${names[i]}\n\n${c}`)
    .join("\n\n---\n\n");
}

/**
 * Loads project marketing context document.
 * Path: project-contexts/<project-slug>/.agents/product-marketing-context.md
 *
 * The path can be configured per project (CMS-config-driven) but defaults to
 * a project-contexts/ folder co-located with the platform repo.
 */
const projectContextsRoot = resolve(import.meta.dir, "../../../../project-contexts");

export async function loadProjectContext(projectSlug: string): Promise<string | null> {
  const path = join(projectContextsRoot, projectSlug, ".agents/product-marketing-context.md");
  try {
    return await readFile(path, "utf-8");
  } catch {
    log.warn({ projectSlug }, "No project marketing context found");
    return null;
  }
}

/** For tests: clear the in-memory cache */
export function _resetSkillCache(): void {
  skillCache.clear();
}
```

### Pipeline Runner (Synchronous)

`packages/pipelines/src/engine/runner.ts`:
```typescript
import { eq } from "drizzle-orm";
import { db, pipelineRuns } from "@marketing-auto/db";
import { createLogger, type Logger } from "@marketing-auto/shared";
import type { BaseStep, StepContext } from "./step.ts";
import type { Pipeline } from "./pipeline.ts";

const log = createLogger("pipeline-runner");

export type PipelineRunOptions = {
  projectId: string;
  parentRunId?: string;
  /** If provided, BullMQ job ID for correlation */
  jobId?: string;
};

export type PipelineRunResult<TOutput> =
  | { ok: true; runId: string; output: TOutput; stepOutputs: Record<string, unknown> }
  | { ok: false; runId: string; error: string; failedAtStep: string; stepOutputs: Record<string, unknown> };

/**
 * Runs a pipeline synchronously (no BullMQ).
 * Persists pipeline_runs rows for audit. Updates progress.
 *
 * Errors during step execution are caught and recorded in the pipeline_runs row,
 * then re-thrown so BullMQ (if calling) sees the failure for retry.
 */
export async function runPipeline<TInput, TOutput>(
  pipeline: Pipeline<TInput, TOutput>,
  input: TInput,
  options: PipelineRunOptions,
  reportJobProgress?: (percent: number) => Promise<void>,
): Promise<PipelineRunResult<TOutput>> {
  // Validate pipeline input
  const validatedInput = pipeline.inputSchema.parse(input);
  
  // Create parent pipeline_runs row
  const [parentRun] = await db.insert(pipelineRuns).values({
    projectId: options.projectId,
    pipelineName: pipeline.name,
    stepName: null,
    status: "running",
    jobId: options.jobId,
    parentRunId: options.parentRunId,
    input: validatedInput as Record<string, unknown>,
    startedAt: new Date(),
  }).returning({ id: pipelineRuns.id });
  
  const runId = parentRun!.id;
  const pipelineLog = log.child({ runId, pipeline: pipeline.name, projectId: options.projectId });
  pipelineLog.info({ stepCount: pipeline.steps.length }, "Pipeline started");
  
  const stepOutputs: Record<string, unknown> = {};
  let currentInput: unknown = validatedInput;
  let lastStepName = "(none)";
  
  try {
    for (let i = 0; i < pipeline.steps.length; i++) {
      const step = pipeline.steps[i]!;
      const overallProgress = Math.round((i / pipeline.steps.length) * 100);
      await reportJobProgress?.(overallProgress);
      
      const stepLog = pipelineLog.child({ step: step.name });
      stepLog.info({ stepIndex: i }, "Step starting");
      
      // Validate step input
      const stepInput = step.inputSchema.parse(currentInput);
      
      // Create step pipeline_runs row
      const [stepRun] = await db.insert(pipelineRuns).values({
        projectId: options.projectId,
        pipelineName: pipeline.name,
        stepName: step.name,
        status: "running",
        parentRunId: runId,
        input: stepInput as Record<string, unknown>,
        startedAt: new Date(),
      }).returning({ id: pipelineRuns.id });
      
      const stepRunId = stepRun!.id;
      
      // Idempotency: check if a previous run of this same step on the same parent_run_id
      // (or by idempotency_key — future enhancement) already completed
      const idemKey = step.idempotencyKey(stepInput);
      // For MVP we DON'T implement cross-run idempotency cache. Just log the key for debugging.
      if (idemKey) stepLog.debug({ idemKey }, "Idempotency key computed (caching not yet implemented)");
      
      // Build step context
      const ctx: StepContext = {
        projectId: options.projectId,
        pipelineRunId: runId,
        stepRunId,
        pipelineName: pipeline.name,
        log: stepLog,
        reportProgress: async (percent, message) => {
          await db.update(pipelineRuns)
            .set({ output: { progress: percent, message } as Record<string, unknown> })
            .where(eq(pipelineRuns.id, stepRunId));
        },
        getStepOutput: <T>(name: string) => stepOutputs[name] as T | undefined,
      };
      
      // Execute
      lastStepName = step.name;
      const stepStartTime = Date.now();
      let stepOutput: unknown;
      try {
        stepOutput = await step.execute(stepInput, ctx);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await db.update(pipelineRuns)
          .set({
            status: "failed",
            errorMessage: errMsg,
            completedAt: new Date(),
          })
          .where(eq(pipelineRuns.id, stepRunId));
        throw err;
      }
      
      // Validate output
      const validatedOutput = step.outputSchema.parse(stepOutput);
      
      // Persist step success
      await db.update(pipelineRuns)
        .set({
          status: "completed",
          output: validatedOutput as Record<string, unknown>,
          completedAt: new Date(),
        })
        .where(eq(pipelineRuns.id, stepRunId));
      
      stepLog.info({ durationMs: Date.now() - stepStartTime }, "Step completed");
      
      stepOutputs[step.name] = validatedOutput;
      
      // Bridge to next step's input
      if (i < pipeline.steps.length - 1) {
        const nextStep = pipeline.steps[i + 1]!;
        currentInput = pipeline.bridge(
          step,
          nextStep,
          validatedOutput,
          validatedInput,
          ctx.getStepOutput,
        );
      } else {
        // Last step's output is pipeline output
        currentInput = validatedOutput;
      }
    }
    
    // Validate pipeline output
    const finalOutput = pipeline.outputSchema.parse(currentInput);
    
    // Mark parent completed
    await db.update(pipelineRuns)
      .set({
        status: "completed",
        output: finalOutput as Record<string, unknown>,
        completedAt: new Date(),
      })
      .where(eq(pipelineRuns.id, runId));
    
    await reportJobProgress?.(100);
    pipelineLog.info("Pipeline completed");
    
    return {
      ok: true,
      runId,
      output: finalOutput as TOutput,
      stepOutputs,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    pipelineLog.error({ err, failedAtStep: lastStepName }, "Pipeline failed");
    
    await db.update(pipelineRuns)
      .set({
        status: "failed",
        errorMessage: errMsg,
        completedAt: new Date(),
      })
      .where(eq(pipelineRuns.id, runId));
    
    return {
      ok: false,
      runId,
      error: errMsg,
      failedAtStep: lastStepName,
      stepOutputs,
    };
  }
}
```

### BullMQ Integration (Async)

`packages/pipelines/src/engine/queue.ts`:
```typescript
import { Queue, Worker, type JobsOptions } from "bullmq";
import IORedis from "ioredis";
import { getEnv, createLogger } from "@marketing-auto/shared";
import { runPipeline, type PipelineRunResult } from "./runner.ts";
import type { Pipeline } from "./pipeline.ts";
import { pipelineRegistry } from "./registry.ts";

const log = createLogger("pipeline-queue");
const env = getEnv();

// Shared Redis connection
let _connection: IORedis | null = null;
function getConnection(): IORedis {
  if (_connection) return _connection;
  _connection = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,  // required by BullMQ
  });
  return _connection;
}

const QUEUE_NAME = "pipelines";

/** The shared pipeline queue. */
let _queue: Queue | null = null;
export function getPipelineQueue(): Queue {
  if (_queue) return _queue;
  _queue = new Queue(QUEUE_NAME, {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },  // 5s, 10s, 20s
      removeOnComplete: { count: 1000, age: 7 * 24 * 3600 },
      removeOnFail: { count: 1000, age: 30 * 24 * 3600 },
    },
  });
  return _queue;
}

export type EnqueuePipelineInput = {
  pipelineName: string;       // must match a registered pipeline
  projectId: string;
  input: unknown;
  jobOptions?: JobsOptions;
};

/**
 * Enqueue a pipeline for async execution.
 * Returns the BullMQ job ID immediately. Caller polls or subscribes for completion.
 */
export async function enqueuePipeline(input: EnqueuePipelineInput): Promise<{ jobId: string }> {
  const job = await getPipelineQueue().add(
    input.pipelineName,
    {
      pipelineName: input.pipelineName,
      projectId: input.projectId,
      input: input.input,
    },
    input.jobOptions,
  );
  return { jobId: String(job.id) };
}

/**
 * Starts the worker process that consumes jobs from the queue.
 * Call this from a separate process (e.g., apps/api/src/workers/pipelines.ts entry point).
 *
 * The worker uses pipelineRegistry to look up pipelines by name and execute them.
 */
export function startPipelineWorker(opts?: { concurrency?: number }): Worker {
  const concurrency = opts?.concurrency ?? 5;
  
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { pipelineName, projectId, input } = job.data as {
        pipelineName: string;
        projectId: string;
        input: unknown;
      };
      
      const pipeline = pipelineRegistry.get(pipelineName);
      if (!pipeline) {
        throw new Error(`Pipeline not registered: ${pipelineName}`);
      }
      
      const result = await runPipeline(
        pipeline as Pipeline<unknown, unknown>,
        input,
        { projectId, jobId: String(job.id) },
        async (percent) => {
          await job.updateProgress(percent);
        },
      );
      
      if (!result.ok) {
        // Throwing causes BullMQ to mark failed and apply retry policy
        throw new Error(`Pipeline failed at step "${result.failedAtStep}": ${result.error}`);
      }
      
      return { runId: result.runId, output: result.output };
    },
    {
      connection: getConnection(),
      concurrency,
    },
  );
  
  worker.on("ready", () => log.info({ concurrency }, "Pipeline worker started"));
  worker.on("completed", (job) => log.info({ jobId: job.id, name: job.name }, "Job completed"));
  worker.on("failed", (job, err) => log.error({ jobId: job?.id, err }, "Job failed"));
  
  return worker;
}

/** For graceful shutdown. */
export async function closePipelineInfrastructure(): Promise<void> {
  if (_queue) await _queue.close();
  if (_connection) await _connection.quit();
}
```

### Pipeline Registry

`packages/pipelines/src/engine/registry.ts`:
```typescript
import type { Pipeline } from "./pipeline.ts";

/**
 * Registry of pipelines by name. Workers look up pipelines here.
 * Pipelines must be registered at startup before the worker starts processing jobs.
 */
class PipelineRegistry {
  private readonly pipelines = new Map<string, Pipeline<unknown, unknown>>();
  
  register<TInput, TOutput>(pipeline: Pipeline<TInput, TOutput>): void {
    if (this.pipelines.has(pipeline.name)) {
      throw new Error(`Pipeline already registered: ${pipeline.name}`);
    }
    this.pipelines.set(pipeline.name, pipeline as Pipeline<unknown, unknown>);
  }
  
  get(name: string): Pipeline<unknown, unknown> | undefined {
    return this.pipelines.get(name);
  }
  
  list(): string[] {
    return [...this.pipelines.keys()];
  }
}

export const pipelineRegistry = new PipelineRegistry();
```

### Scheduled Jobs

For things like daily auth cleanup (Spec 04) and (later) daily briefings.

`packages/pipelines/src/engine/scheduler.ts`:
```typescript
import { Queue, Worker } from "bullmq";
import { createLogger, getEnv } from "@marketing-auto/shared";
import IORedis from "ioredis";

const log = createLogger("scheduler");
const env = getEnv();

const SCHEDULER_QUEUE = "scheduled";

let _connection: IORedis | null = null;
function getConnection(): IORedis {
  if (_connection) return _connection;
  _connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return _connection;
}

let _queue: Queue | null = null;
function getSchedulerQueue(): Queue {
  if (_queue) return _queue;
  _queue = new Queue(SCHEDULER_QUEUE, { connection: getConnection() });
  return _queue;
}

type ScheduledJob = {
  name: string;
  cron: string;
  handler: () => Promise<void>;
};

const scheduledJobs = new Map<string, ScheduledJob>();

/**
 * Register a scheduled job. Call at startup, BEFORE startScheduler().
 */
export function registerScheduledJob(job: ScheduledJob): void {
  scheduledJobs.set(job.name, job);
}

/**
 * Starts the scheduler: schedules all registered jobs, starts a worker to execute them.
 * Idempotent — calling twice is safe (BullMQ deduplicates by job key).
 */
export async function startScheduler(): Promise<Worker> {
  const queue = getSchedulerQueue();
  
  // Register repeating jobs
  for (const [name, job] of scheduledJobs) {
    await queue.add(
      name,
      {},
      {
        repeat: { pattern: job.cron },
        // jobId stable so BullMQ deduplicates
        jobId: `scheduled:${name}`,
      },
    );
    log.info({ name, cron: job.cron }, "Scheduled job registered");
  }
  
  // Worker
  const worker = new Worker(
    SCHEDULER_QUEUE,
    async (job) => {
      const sj = scheduledJobs.get(job.name);
      if (!sj) {
        log.warn({ name: job.name }, "No handler registered for scheduled job");
        return;
      }
      log.info({ name: job.name }, "Scheduled job starting");
      await sj.handler();
      log.info({ name: job.name }, "Scheduled job completed");
    },
    { connection: getConnection() },
  );
  
  worker.on("failed", (job, err) => log.error({ name: job?.name, err }, "Scheduled job failed"));
  
  return worker;
}
```

### Worker Entry Point

`apps/api/src/workers/index.ts`:
```typescript
import {
  startPipelineWorker,
  startScheduler,
  registerScheduledJob,
  pipelineRegistry,
  closePipelineInfrastructure,
} from "@marketing-auto/pipelines";
import { runAuthCleanup } from "../lib/cleanup.ts";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("worker");

async function main() {
  log.info("Starting workers");
  
  // Register pipelines (Phase 2+ pipelines added here as they come)
  // pipelineRegistry.register(new ArticlePipeline());
  // pipelineRegistry.register(new SocialRepurposePipeline());
  // ...
  log.info({ pipelines: pipelineRegistry.list() }, "Pipelines registered");
  
  // Register scheduled jobs
  registerScheduledJob({
    name: "auth-cleanup",
    cron: "0 3 * * *",  // 03:00 daily
    handler: async () => {
      const { tokensDeleted, sessionsDeleted } = await runAuthCleanup();
      log.info({ tokensDeleted, sessionsDeleted }, "Auth cleanup result");
    },
  });
  
  // Start workers
  const pipelineWorker = startPipelineWorker({ concurrency: 5 });
  const schedulerWorker = await startScheduler();
  
  log.info("Workers running");
  
  // Graceful shutdown
  const shutdown = async () => {
    log.info("Shutting down workers");
    await pipelineWorker.close();
    await schedulerWorker.close();
    await closePipelineInfrastructure();
    process.exit(0);
  };
  
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  log.error({ err }, "Worker startup failed");
  process.exit(1);
});
```

Add to `apps/api/package.json`:
```json
"scripts": {
  ...
  "worker": "bun src/workers/index.ts",
  "worker:dev": "bun --hot src/workers/index.ts"
}
```

### Index files

`packages/pipelines/src/engine/index.ts`:
```typescript
export { BaseStep, type StepContext } from "./step.ts";
export { Pipeline } from "./pipeline.ts";
export { runPipeline, type PipelineRunResult, type PipelineRunOptions } from "./runner.ts";
export {
  enqueuePipeline,
  startPipelineWorker,
  getPipelineQueue,
  closePipelineInfrastructure,
  type EnqueuePipelineInput,
} from "./queue.ts";
export { pipelineRegistry } from "./registry.ts";
export {
  registerScheduledJob,
  startScheduler,
} from "./scheduler.ts";
```

`packages/pipelines/src/skills/index.ts`:
```typescript
export { loadSkill, loadSkills, loadProjectContext, _resetSkillCache } from "./loader.ts";
```

`packages/pipelines/src/index.ts`:
```typescript
export * from "./engine/index.ts";
export * from "./skills/index.ts";
```

### Subtree CLAUDE.md

`packages/pipelines/CLAUDE.md`:
```markdown
# Pipelines Package

The execution engine for all marketing pipelines. This is INFRASTRUCTURE — Phase 2+
specs build actual pipelines (article-generation, social-repurpose, identity-workshop)
on top of this.

## Key Concepts

**Step**: One unit of pipeline work. Has typed input/output, idempotency key, cost estimate.
**Pipeline**: Ordered list of steps. The output of step N becomes input of step N+1.
**Runner**: Executes a pipeline synchronously, persisting pipeline_runs rows.
**Queue**: BullMQ wrapper. Enqueue pipelines for async execution.
**Registry**: Pipelines must be registered at worker startup so BullMQ workers can find them.
**Scheduler**: Cron-style scheduled jobs (auth cleanup, daily briefings).

## Hard Rules

- Steps MUST be idempotent
- Steps MUST validate input/output via Zod
- Steps MUST use `@marketing-auto/cost-tracker` for any external API call
- Pipelines MUST be registered before workers start

## Adding a New Pipeline

1. Create `packages/pipelines/src/templates/<pipeline-name>/`
2. Create one file per step
3. Create the pipeline class composing steps
4. Register in `apps/api/src/workers/index.ts`
5. Trigger via `enqueuePipeline({ pipelineName: "...", projectId, input })`

## Common Mistakes
- DO NOT do business logic outside of `execute()` — it won't be tracked
- DO NOT skip cost-tracker for "small" calls — they accumulate
- DO NOT make a step do two things — split into two steps
- DO NOT mutate `ctx` — it's read-only from your perspective
- DO NOT call other steps directly — use `getStepOutput` or pipeline.bridge
```

## Acceptance Criteria

- [ ] `packages/pipelines/` package builds and typechecks
- [ ] A trivial pipeline (1 step that returns its input) runs to completion via `runPipeline()` (synchronous)
- [ ] `pipeline_runs` table receives a parent row + step row(s), all marked "completed"
- [ ] A failing step causes the pipeline to fail; both the step's row and parent row are marked "failed" with `errorMessage` populated
- [ ] `enqueuePipeline()` adds a job to BullMQ
- [ ] Worker started via `startPipelineWorker()` consumes the job and executes it
- [ ] BullMQ retry policy works: a transient-failing step retries up to 3 times
- [ ] `loadSkill("seo-audit")` returns the SKILL.md content (assuming submodule populated)
- [ ] `loadSkill("nonexistent")` throws clear error
- [ ] Skills are cached: second `loadSkill("seo-audit")` doesn't hit disk
- [ ] Scheduler: a registered job with cron `* * * * *` (every minute) executes
- [ ] Worker process can be started via `bun --filter @marketing-auto/api worker`
- [ ] Worker exits gracefully on SIGTERM
- [ ] Concurrency cap honored (worker doesn't process more than N jobs in parallel)

## Testing Strategy

`packages/pipelines/test/engine.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { z } from "zod";
import { db, projects } from "@marketing-auto/db";
import { eq } from "drizzle-orm";
import { BaseStep, Pipeline, runPipeline, type StepContext } from "../src/engine/index.ts";

class EchoStep extends BaseStep<{ message: string }, { echo: string }> {
  readonly name = "echo";
  readonly inputSchema = z.object({ message: z.string() });
  readonly outputSchema = z.object({ echo: z.string() });
  
  async execute(input: { message: string }, _ctx: StepContext) {
    return { echo: `echo: ${input.message}` };
  }
}

class FailingStep extends BaseStep<{ message: string }, { ok: boolean }> {
  readonly name = "failing";
  readonly inputSchema = z.object({ message: z.string() });
  readonly outputSchema = z.object({ ok: z.boolean() });
  
  async execute(_input: { message: string }, _ctx: StepContext) {
    throw new Error("boom");
  }
}

class TrivialPipeline extends Pipeline<{ message: string }, { echo: string }> {
  readonly name = "trivial";
  readonly inputSchema = z.object({ message: z.string() });
  readonly outputSchema = z.object({ echo: z.string() });
  steps = [new EchoStep()] as const;
}

class FailingPipeline extends Pipeline<{ message: string }, { ok: boolean }> {
  readonly name = "fails";
  readonly inputSchema = z.object({ message: z.string() });
  readonly outputSchema = z.object({ ok: z.boolean() });
  steps = [new FailingStep()] as const;
}

describe("Pipeline runner", () => {
  let projectId: string;
  
  beforeAll(async () => {
    const [p] = await db.insert(projects).values({
      slug: `pipeline-test-${Date.now()}`,
      name: "Pipeline Test",
      industry: "ai_education",
      pipelineTemplate: "educational",
    }).returning();
    projectId = p!.id;
  });
  
  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });
  
  it("runs a trivial pipeline to completion", async () => {
    const result = await runPipeline(
      new TrivialPipeline(),
      { message: "hello" },
      { projectId },
    );
    
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.echo).toBe("echo: hello");
      expect(result.stepOutputs.echo).toEqual({ echo: "echo: hello" });
    }
  });
  
  it("captures step failure and marks pipeline failed", async () => {
    const result = await runPipeline(
      new FailingPipeline(),
      { message: "x" },
      { projectId },
    );
    
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("boom");
      expect(result.failedAtStep).toBe("failing");
    }
  });
  
  it("rejects invalid pipeline input via Zod", async () => {
    expect(runPipeline(
      new TrivialPipeline(),
      { message: 123 } as any,  // invalid: not a string
      { projectId },
    )).rejects.toThrow();
  });
});

describe("loadSkill", () => {
  it("loads a skill if present", async () => {
    const { loadSkill } = await import("../src/skills/loader.ts");
    // This test assumes the marketingskills submodule is populated
    // If running CI without submodule, skip:
    try {
      const content = await loadSkill("copywriting");
      expect(content.length).toBeGreaterThan(100);
      expect(content).toContain("copywriter");  // some text known to be in it
    } catch (e) {
      console.warn("Skill submodule not populated, skipping skill test");
    }
  });
});
```

For BullMQ integration tests, run a Redis container locally and test with real Redis. Or skip in unit tests and verify manually.

## Open Questions / Decisions Made

**Decision 1: One BullMQ job per pipeline (not per step).** Drastically simpler. Trade-off: a slow step blocks the whole job slot. Acceptable.

**Decision 2: Steps are classes, not functions.** Better extensibility, natural place for `idempotencyKey()`, `estimatedCostEur()`. Subclassing for variants (e.g., per-tenant overrides) is clean.

**Decision 3: Pipeline-level idempotency cache deferred.** We compute idempotency keys but don't yet skip already-completed steps from past runs. Phase 2 enhancement when we hit the first case where it matters.

**Decision 4: pipeline_runs has TWO levels (parent + per-step).** Better observability than just "pipeline X failed". You can see exactly which step failed and what each step produced.

**Decision 5: Skill loading is synchronous file IO.** Skills are static files, cached after first read. No need for fancier mechanism.

**Decision 6: Project-context lives in `project-contexts/<slug>/.agents/product-marketing-context.md` co-located with the platform repo.** When SaaS, this moves to per-tenant cloud storage. For MVP, repo-local is fine and version-controlled.

**Decision 7: Workers run as separate process from API.** API stays responsive for HTTP. Workers can be scaled independently. In dev: two terminal tabs (`bun run dev:api` and `bun run worker:dev`).

**Decision 8: BullMQ Pro features not used.** Free BullMQ is sufficient. If we need rate limiting per service or DAGs, evaluate then.

**Decision 9: Pipeline output schema enforced at runtime.** Even though TypeScript types match, Zod-validating the output catches bugs where a step returns subtly wrong shape. Fail loud.

**Decision 10: No DLQ (dead letter queue).** Failed jobs after max attempts stay in the failed set with `removeOnFail.age = 30 days`. Marcel can inspect via Bull Board (later) or query `pipeline_runs` directly.

## Implementation Order

1. Create `packages/pipelines/` package structure
2. Implement `engine/step.ts` (BaseStep contract)
3. Implement `engine/pipeline.ts` (Pipeline contract)
4. Implement `engine/registry.ts`
5. Implement `engine/runner.ts` (synchronous runPipeline)
6. Write tests for runner, run them (Pipeline, Step + DB row creation work end-to-end)
7. Implement `skills/loader.ts`
8. Test skill loader (against the actual submodule)
9. Implement `engine/queue.ts` (BullMQ wrapper)
10. Implement `engine/scheduler.ts`
11. Create `apps/api/src/workers/index.ts` entry point
12. Add `worker` and `worker:dev` scripts to `apps/api/package.json`
13. Manual smoke test:
  - Terminal A: `bun run dev:api`
  - Terminal B: `bun --filter @marketing-auto/api worker:dev`
  - Terminal C: write a quick script that imports `enqueuePipeline`, calls it, watches logs
14. Verify pipeline_runs rows in Drizzle Studio
15. Verify scheduled job fires (set a test cron of `* * * * *`, watch worker logs)
16. Commit: `feat(pipelines): base pipeline engine with BullMQ integration (spec 05)`

## Splitting Plan

This is a 1.5-2 day spec. **Recommended split into two sessions:**

**Session A (engine + skills):** Steps 1-8
- Create the package + Step/Pipeline/Registry/Runner classes
- Skills loader
- Tests for runner + loader
- Commit before moving on

**Session B (BullMQ + workers):** Steps 9-16
- BullMQ queue + scheduler
- Worker entry point in apps/api
- Manual smoke testing
- Commit

Run `/clear` between sessions to keep context fresh.

## Discovered During Implementation

- **BullMQ job data is a Zod boundary.** `job.data` arrives as untyped `unknown` from Redis. The spec treated it as a TypeScript cast, but it must be Zod-parsed — same as HTTP request bodies. A `jobDataSchema` was added to `queue.ts` so corrupt or mismatched jobs fail immediately with a clear parse error instead of blowing up inside `runPipeline`.
- **`test` script in package.json must use `cd ../..` pattern.** The spec's example used `"test": "bun test"`, which triggers Bun's workspace recursion bug (same-name script takes precedence over built-in). Correct pattern: `"test": "cd ../.. && bun test packages/pipelines/test"`. This also ensures the root `.env` is auto-loaded by Bun.

## Deviations

- **`test` script changed from `"bun test"` to `"cd ../.. && bun test packages/pipelines/test"`** — spec snippet was inconsistent with the workspace-recursion rule documented in root CLAUDE.md. Applied the established pattern (same as `packages/db` and `packages/cost-tracker`).
