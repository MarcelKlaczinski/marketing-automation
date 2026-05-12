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
