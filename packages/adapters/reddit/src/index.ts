import { z } from "zod";
import { createLogger } from "@marketing-auto/shared";
import type { ExternalSignalSource, RawSignal, SignalSourceContext } from "@marketing-auto/pipelines";
import { getAccessToken, fetchSubredditPosts, RedditApiError } from "./client.ts";
import type { RedditCredentials } from "./client.ts";
import type { RawRedditPost } from "./types.ts";

export type { RedditCredentials } from "./client.ts";

const log = createLogger("adapter:reddit");

// ─── Input schema ─────────────────────────────────────────────────────────────

const _InputSchema = z.object({
  subreddits: z.array(z.string().min(1)).default([
    "LocalLLaMA",
    "MachineLearning",
    "ChatGPT",
    "ClaudeAI",
    "SaaS",
    "InternetIsBeautiful",
    "SideProject",
    "PromptEngineering",
    "StableDiffusion",
  ]),
  sortMode: z.enum(["top", "hot", "new"]).default("top"),
  timeWindow: z.enum(["day", "week", "month"]).default("week"),
  minUpvotes: z.number().int().min(0).default(50),
  minComments: z.number().int().min(0).default(10),
  maxAgeDays: z.number().int().positive().default(7),
  limit: z.number().int().min(1).max(100).default(100),
  credentials: z.object({
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
    userAgent: z.string().min(1),
  }),
});

type Input = z.infer<typeof _InputSchema>;
const InputSchema = _InputSchema as z.ZodType<Input>;

// ─── Normalization ────────────────────────────────────────────────────────────

function normalizePost(post: RawRedditPost, input: Input): RawSignal | null {
  // Filter NSFW and stickied
  if (post.over_18 || post.stickied) return null;

  // Filter by engagement thresholds
  if (post.score < input.minUpvotes) return null;
  if (post.num_comments < input.minComments) return null;

  // Filter by age
  const ageDays = (Date.now() - post.created_utc * 1000) / (1000 * 60 * 60 * 24);
  if (ageDays > input.maxAgeDays) return null;

  const isLinkPost = !post.is_self;
  const url = isLinkPost ? post.url : `https://reddit.com${post.permalink}`;
  const permalink = `https://reddit.com${post.permalink}`;

  // Truncate self-text to 5000 chars max
  const selfText = post.is_self && post.selftext ? post.selftext.slice(0, 5000) : null;

  const signal: RawSignal = {
    source: "reddit",
    externalId: `t3_${post.id}`,
    title: post.title,
    url,
    ...(selfText ? { summary: selfText } : {}),
    author: post.author,
    publishedAt: new Date(post.created_utc * 1000),
    rawPayload: {
      subreddit: post.subreddit,
      permalink,
      isLinkPost,
      upvoteRatio: post.upvote_ratio,
      awards: post.total_awards_received,
    },
    metrics: {
      upvotes: post.score,
      comments: post.num_comments,
    },
  };

  return signal;
}

// ─── RedditSignalSource ───────────────────────────────────────────────────────

export class RedditSignalSource implements ExternalSignalSource<Input> {
  readonly source = "reddit" as const;
  readonly inputSchema = InputSchema;

  async fetch(input: Input, ctx: SignalSourceContext): Promise<RawSignal[]> {
    const parsed = this.inputSchema.parse(input);
    const creds: RedditCredentials = parsed.credentials;

    let token: string;
    try {
      token = await getAccessToken(creds);
    } catch (err) {
      log.error({ projectId: ctx.projectId, err }, "Reddit OAuth failed");
      throw err;
    }

    const signals: RawSignal[] = [];
    let rateLimitRemaining = Infinity;

    for (const subreddit of parsed.subreddits) {
      try {
        const result = await fetchSubredditPosts({
          subreddit,
          sortMode: parsed.sortMode,
          timeWindow: parsed.timeWindow,
          limit: parsed.limit,
          token,
          userAgent: creds.userAgent,
        });

        rateLimitRemaining = Math.min(rateLimitRemaining, result.rateLimitRemaining);

        if (rateLimitRemaining < 10) {
          log.warn(
            { projectId: ctx.projectId, subreddit, rateLimitRemaining },
            "Reddit rate limit low",
          );
        }

        for (const post of result.posts) {
          const signal = normalizePost(post, parsed);
          if (signal) signals.push(signal);
        }
      } catch (err) {
        if (err instanceof RedditApiError && err.status === 429) {
          log.warn(
            { projectId: ctx.projectId, subreddit, err: err.message },
            "Reddit rate limited — skipping subreddit",
          );
        } else {
          log.warn(
            { projectId: ctx.projectId, subreddit, err },
            "Reddit subreddit fetch failed — skipping",
          );
        }
      }
    }

    log.info(
      {
        projectId: ctx.projectId,
        subreddits: parsed.subreddits.length,
        signalsCollected: signals.length,
        rateLimitRemaining,
      },
      "Reddit signal collection complete",
    );

    return signals;
  }
}
