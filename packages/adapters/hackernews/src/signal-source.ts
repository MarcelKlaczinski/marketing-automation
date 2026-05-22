import { z } from "zod";
import { createLogger } from "@marketing-auto/shared";
import type { ExternalSignalSource, RawSignal, SignalSourceContext } from "@marketing-auto/pipelines";
import { searchHnByDate, type HnHit } from "./client.ts";

const log = createLogger("adapter:hackernews");

// Algolia HN degrades sharply with OR-syntax: 5-term ORs return ≤3 hits even
// in a 30-day window, while single-keyword queries hit the 50-hit page cap on
// popular terms (verified Spec 63.9 diagnose 2026-05-22). Use single words and
// short multi-word phrases; deduplicate by objectID across queries.
const DEFAULT_QUERIES = [
  "AI",
  "LLM",
  "GPT",
  "Claude",
  "Gemini",
  "OpenAI",
  "Anthropic",
  "agentic",
  "agent",
  "MCP",
  "RAG",
  "embeddings",
  "open source LLM",
  "AI safety",
  "hallucination",
  "context window",
  "diffusion",
  "Copilot",
  "Cursor",
];

const _InputSchema = z.object({
  queries:     z.array(z.string().min(1)).default(DEFAULT_QUERIES),
  hitsPerPage: z.number().int().min(1).max(100).default(50),
  minPoints:   z.number().int().min(0).default(3),
  maxAgeDays:  z.number().int().min(1).max(365).default(30),
});

type Input = z.infer<typeof _InputSchema>;

// Cast: resolves _input variance mismatch for .default() fields under exactOptionalPropertyTypes.
const InputSchema = _InputSchema as z.ZodType<Input>;

export class HackerNewsSignalSource implements ExternalSignalSource<Input> {
  readonly source = "hackernews" as const;
  readonly inputSchema = InputSchema;

  async fetch(input: Input, ctx: SignalSourceContext): Promise<RawSignal[]> {
    const parsed = this.inputSchema.parse(input);
    const sinceUnixSeconds = Math.floor((Date.now() - parsed.maxAgeDays * 86_400_000) / 1000);
    log.info(
      { projectId: ctx.projectId, queryCount: parsed.queries.length, maxAgeDays: parsed.maxAgeDays, sinceUnixSeconds },
      "fetching HN hits",
    );

    const results = await Promise.allSettled(
      parsed.queries.map((q) => searchHnByDate(q, parsed.hitsPerPage, sinceUnixSeconds)),
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
