import { z } from "zod";
import { createLogger } from "@marketing-auto/shared";
import type { ExternalSignalSource, RawSignal, SignalSourceContext } from "@marketing-auto/pipelines";
import { fetchAccessToken, createProductHuntClient, POSTS_BY_TOPIC_QUERY, type PhPost } from "./client.ts";

const log = createLogger("adapter:producthunt");

const _InputSchema = z.object({
  topic: z.string().default("artificial-intelligence"),
  first: z.number().int().min(1).max(50).default(20),
});

type Input = z.infer<typeof _InputSchema>;

// Cast: .parse() always returns Input; cast resolves _input variance under exactOptionalPropertyTypes.
const InputSchema = _InputSchema as z.ZodType<Input>;

export class ProductHuntSignalSource implements ExternalSignalSource<Input> {
  readonly source = "producthunt" as const;
  readonly inputSchema = InputSchema;

  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
  ) {}

  async fetch(input: Input, ctx: SignalSourceContext): Promise<RawSignal[]> {
    const parsed = this.inputSchema.parse(input);

    const accessToken = await fetchAccessToken(this.apiKey, this.apiSecret);
    const client = createProductHuntClient(accessToken);

    log.info({ projectId: ctx.projectId, topic: parsed.topic }, "fetching PH posts");

    const response = await client.request<{
      posts: { edges: Array<{ node: PhPost }> };
    }>(POSTS_BY_TOPIC_QUERY, { topic: parsed.topic, first: parsed.first });

    const signals: RawSignal[] = response.posts.edges.map(({ node: p }) => {
      const summary = [p.tagline, p.description].filter(Boolean).join("\n\n");
      const author  = p.user?.name ?? p.makers[0]?.name;
      return {
        source:      "producthunt" as const,
        externalId:  p.id,
        title:       p.name,
        publishedAt: new Date(p.createdAt),
        rawPayload:  p as unknown as Record<string, unknown>,
        metrics:     { votes: p.votesCount, comments: p.commentsCount },
        ...(p.url    && { url: p.url }),
        ...(summary  && { summary }),
        ...(author   && { author }),
      };
    });

    log.info({ count: signals.length }, "fetched PH signals");
    return signals;
  }
}
