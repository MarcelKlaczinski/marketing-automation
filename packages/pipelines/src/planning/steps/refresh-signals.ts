// Spec 62.4 Step 2: refresh external signals before snapshot.
//
// Wraps `refreshSignalsForProject` from packages/planner. The adapter
// fetchers + readCreds callback are injected by the route handler at
// pipeline-trigger time (62.3 DI pattern). The step itself stays
// framework-agnostic — it just calls the wired callbacks.

import {
  refreshSignalsForProject,
  type SignalFetcher,
  type SignalRefreshResult,
} from "@marketing-auto/planner";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";

export const refreshSignalsInputSchema = z.object({
  projectId: z.string().uuid(),
});
type Input = z.infer<typeof refreshSignalsInputSchema>;

export const refreshSignalsOutputSchema = z.object({
  signalRefreshResult: z.unknown(),
});
type Output = z.infer<typeof refreshSignalsOutputSchema>;

export interface RefreshSignalsDeps {
  fetchers: Partial<Record<"producthunt" | "hackernews" | "vendor_rss" | "reddit" | "github", SignalFetcher>>;
  readCreds: (service: string) => Promise<Record<string, string>>;
  force?: boolean;
}

export class RefreshSignalsStep extends BaseStep<Input, Output> {
  readonly name = "refresh-signals";
  readonly inputSchema = refreshSignalsInputSchema;
  readonly outputSchema = refreshSignalsOutputSchema;

  constructor(private readonly deps: RefreshSignalsDeps) {
    super();
  }

  async execute(input: Input, _ctx: StepContext): Promise<Output> {
    const result: SignalRefreshResult = await refreshSignalsForProject({
      projectId: input.projectId,
      force: this.deps.force ?? false,
      fetchers: this.deps.fetchers,
      readCreds: this.deps.readCreds,
    });
    return { signalRefreshResult: result };
  }
}
