import { z } from "zod";
import { createLogger } from "@marketing-auto/shared";
import type { ExternalSignalSource, RawSignal, SignalSourceContext } from "@marketing-auto/pipelines";
import { searchHnByDate, type HnHit } from "./client.ts";

const log = createLogger("adapter:hackernews");

const _InputSchema = z.object({
  query:       z.string().default('ai OR llm OR claude OR gpt OR "generative ai"'),
  hitsPerPage: z.number().int().min(1).max(100).default(50),
  minPoints:   z.number().int().min(0).default(20),
});

type Input = z.infer<typeof _InputSchema>;

// Cast: resolves _input variance mismatch for .default() fields under exactOptionalPropertyTypes.
const InputSchema = _InputSchema as z.ZodType<Input>;

export class HackerNewsSignalSource implements ExternalSignalSource<Input> {
  readonly source = "hackernews" as const;
  readonly inputSchema = InputSchema;

  async fetch(input: Input, ctx: SignalSourceContext): Promise<RawSignal[]> {
    const parsed = this.inputSchema.parse(input);
    log.info({ projectId: ctx.projectId, query: parsed.query }, "fetching HN hits");

    const hits = await searchHnByDate(parsed.query, parsed.hitsPerPage);

    const filtered = hits.filter(
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

    log.info({ rawCount: hits.length, filteredCount: signals.length }, "fetched HN signals");
    return signals;
  }
}
