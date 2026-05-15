import { z } from "zod";
import { createLogger } from "@marketing-auto/shared";
import type { ExternalSignalSource, RawSignal, SignalSourceContext } from "@marketing-auto/pipelines";
import { searchHnByDate, type HnHit } from "./client.ts";

const log = createLogger("adapter:hackernews");

// Algolia HN silently returns 0 hits for queries with 7+ OR terms.
// Use multiple short queries (≤5 OR terms each) and deduplicate by objectID.
const DEFAULT_QUERIES = [
  'ai OR llm OR gpt OR claude OR gemini',
  'midjourney OR "stable diffusion" OR flux OR sora OR runway',
  'cursor OR copilot OR devin OR codeium',
  'openai OR anthropic OR huggingface OR replicate',
];

const _InputSchema = z.object({
  queries:     z.array(z.string().min(1)).default(DEFAULT_QUERIES),
  hitsPerPage: z.number().int().min(1).max(100).default(50),
  minPoints:   z.number().int().min(0).default(5),
});

type Input = z.infer<typeof _InputSchema>;

// Cast: resolves _input variance mismatch for .default() fields under exactOptionalPropertyTypes.
const InputSchema = _InputSchema as z.ZodType<Input>;

export class HackerNewsSignalSource implements ExternalSignalSource<Input> {
  readonly source = "hackernews" as const;
  readonly inputSchema = InputSchema;

  async fetch(input: Input, ctx: SignalSourceContext): Promise<RawSignal[]> {
    const parsed = this.inputSchema.parse(input);
    log.info({ projectId: ctx.projectId, queryCount: parsed.queries.length }, "fetching HN hits");

    const results = await Promise.allSettled(
      parsed.queries.map((q) => searchHnByDate(q, parsed.hitsPerPage)),
    );

    const seen = new Set<string>();
    const allHits: HnHit[] = [];
    for (const [i, res] of results.entries()) {
      if (res.status === "fulfilled") {
        for (const hit of res.value) {
          if (!seen.has(hit.objectID)) {
            seen.add(hit.objectID);
            allHits.push(hit);
          }
        }
      } else {
        log.warn({ query: parsed.queries[i], err: res.reason }, "HN query failed, skipping");
      }
    }

    const filtered = allHits.filter(
      (h) =>
        (h.points ?? 0) >= parsed.minPoints &&
        (h.title ?? h.story_title) &&
        (h.url ?? h.story_url),
    );

    const signals: RawSignal[] = filtered.map((h: HnHit) => {
      const url = h.url ?? h.story_url;
      return {
        source:      "hackernews" as const,
        externalId:  h.objectID,
        title:       (h.title ?? h.story_title)!,
        author:      h.author,
        publishedAt: new Date(h.created_at),
        rawPayload:  h as unknown as Record<string, unknown>,
        metrics:     { points: h.points ?? 0, comments: h.num_comments ?? 0 },
        ...(url && { url }),
      };
    });

    log.info({ rawCount: allHits.length, filteredCount: signals.length }, "fetched HN signals");
    return signals;
  }
}
