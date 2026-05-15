import { z } from "zod";
import type { TopicBriefInsert } from "@marketing-auto/db";

/**
 * A TopicSource produces TopicBriefs.
 *
 * Implementations MAY use the Pipeline framework internally (Gap Analysis does)
 * or call external APIs directly (Trend adapters in 54.4 will). The interface
 * is intentionally minimal: one method, one return type.
 *
 * Sources MUST NOT persist briefs — the caller (route, worker, import step)
 * owns the transaction so that dual-write atomicity is preserved.
 */
export interface TopicSource<Input = unknown> {
  readonly source: TopicBriefInsert["source"];
  readonly inputSchema: z.ZodType<Input>;

  /**
   * Produce zero or more TopicBriefs from the given input.
   *
   * - MUST NOT persist briefs. The caller decides when/how to persist.
   * - SHOULD be idempotent: same input → equivalent briefs (modulo timestamps).
   * - MAY return an empty array if nothing qualifies.
   */
  emit(input: Input, ctx: TopicSourceContext): Promise<TopicBriefInsert[]>;
}

export interface TopicSourceContext {
  readonly projectId: string;
  readonly pipelineRunId?: string;
}
