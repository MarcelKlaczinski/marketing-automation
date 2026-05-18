import { z } from "zod";

// ─── OAuth token response ─────────────────────────────────────────────────────

export const oauthTokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
  scope: z.string(),
});

// ─── Reddit post (raw API shape) ──────────────────────────────────────────────

export const rawRedditPostSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  permalink: z.string(),
  selftext: z.string().default(""),
  is_self: z.boolean(),
  author: z.string(),
  score: z.number().int(),
  upvote_ratio: z.number(),
  num_comments: z.number().int(),
  total_awards_received: z.number().int(),
  created_utc: z.number(),
  over_18: z.boolean(),
  stickied: z.boolean(),
  subreddit: z.string(),
});

export type RawRedditPost = z.infer<typeof rawRedditPostSchema>;

// ─── Subreddit listing response ───────────────────────────────────────────────

export const subredditListingResponseSchema = z.object({
  data: z.object({
    children: z.array(
      z.object({
        data: rawRedditPostSchema,
      }),
    ),
  }),
});
