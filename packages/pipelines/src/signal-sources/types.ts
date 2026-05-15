import { z } from "zod";
import type { ExternalSignalSource as ExternalSignalSourceValue } from "@marketing-auto/db";

/**
 * Plain data returned by any signal source.
 * The caller (BullMQ worker) owns persistence — adapters never write to DB.
 */
export type RawSignal = {
  source: ExternalSignalSourceValue;
  externalId: string;
  title: string;
  url?: string;
  summary?: string;
  author?: string;
  publishedAt?: Date;
  rawPayload: Record<string, unknown>;
  metrics?: Record<string, number>;
};

const _RawSignalSchema = z.object({
  source: z.enum([
    "producthunt",
    "hackernews",
    "vendor_rss",
    "reddit",
    "github",
    "dataforseo_trends",
  ]),
  externalId:  z.string().min(1),
  title:       z.string().min(1).max(500),
  url:         z.string().url().optional(),
  summary:     z.string().max(5000).optional(),
  author:      z.string().max(200).optional(),
  publishedAt: z.date().optional(),
  rawPayload:  z.record(z.string(), z.unknown()),
  metrics:     z.record(z.string(), z.number()).optional(),
});

// Cast: safe because .parse() always returns RawSignal;
// the cast only resolves the _input variance mismatch under exactOptionalPropertyTypes.
export const RawSignalSchema = _RawSignalSchema as z.ZodType<RawSignal>;

export interface SignalSourceContext {
  readonly projectId: string;
  readonly correlationId?: string;
}

/**
 * Contract for all external signal fetchers.
 *
 * Rules:
 * - MUST NOT persist — return plain RawSignal[], caller persists in a transaction
 * - MUST set `source` to a stable enum value matching ExternalSignalSourceValue
 * - MUST set `externalId` to the source's stable per-entity ID (dedup key)
 * - SHOULD be idempotent: running twice in a window produces equivalent signals
 * - MAY return [] if nothing was found
 */
export interface ExternalSignalSource<Input = unknown> {
  readonly source: ExternalSignalSourceValue;
  readonly inputSchema: z.ZodType<Input>;
  fetch(input: Input, ctx: SignalSourceContext): Promise<RawSignal[]>;
}
