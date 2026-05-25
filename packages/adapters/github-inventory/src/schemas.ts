/**
 * Spec 64.20: Zod schemas for the GitHub-API endpoints used by the inventory adapter.
 * All schemas are tolerant — extra fields ignored (the GitHub API returns ~80 fields
 * per repo; we pick the subset we map into `GithubInventoryMetadata`).
 */
import { z } from "zod";

/** `GET /repos/{owner}/{repo}` */
export const rawRepoSchema = z.object({
  id: z.number(),
  name: z.string(),
  full_name: z.string(),
  html_url: z.string(),
  description: z.string().nullable(),
  homepage: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  topics: z.array(z.string()).optional(),
  stargazers_count: z.number(),
  forks_count: z.number(),
  watchers_count: z.number(),
  open_issues_count: z.number().optional(),
  archived: z.boolean().optional(),
  default_branch: z.string(),
  created_at: z.string(),
  pushed_at: z.string(),
  license: z
    .object({ spdx_id: z.string().nullable() })
    .nullable()
    .optional(),
});
export type RawRepo = z.infer<typeof rawRepoSchema>;

/** `GET /repos/{owner}/{repo}/releases/latest` — returns 404 when no releases exist. */
export const rawReleaseSchema = z.object({
  tag_name: z.string(),
  name: z.string().nullable().optional(),
  published_at: z.string(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
});
export type RawRelease = z.infer<typeof rawReleaseSchema>;

/**
 * `GET /repos/{owner}/{repo}/contents/{path}` — for SKILL.md detection.
 * GitHub returns either a single file (path = file) or an array (path = dir).
 * We always query the file path so the single-file shape is what we expect.
 */
export const rawContentFileSchema = z.object({
  type: z.literal("file"),
  name: z.string(),
  path: z.string(),
  /** Base64-encoded when type=file. */
  content: z.string(),
  encoding: z.literal("base64"),
  sha: z.string(),
  size: z.number(),
});
export type RawContentFile = z.infer<typeof rawContentFileSchema>;

/** `GET /rate_limit` */
export const rawRateLimitSchema = z.object({
  resources: z.object({
    core: z.object({
      limit: z.number(),
      remaining: z.number(),
      reset: z.number(), // unix seconds
    }),
  }),
});
export type RawRateLimit = z.infer<typeof rawRateLimitSchema>;

/**
 * `GET /search/repositories?q=...` — Spec 64.20 follow-up A2 (Auto-Discovery).
 * Returns the GitHub search-API response shape; items array carries one
 * `rawRepoSchema`-compatible row per match. We re-use `rawRepoSchema` for
 * the items because Search-API entries have the same field set as
 * `/repos/{owner}/{repo}` (a subset, but rawRepoSchema is tolerant of
 * extras + has all fields Search-API returns).
 */
export const rawSearchResponseSchema = z.object({
  total_count: z.number(),
  incomplete_results: z.boolean(),
  items: z.array(rawRepoSchema),
});
export type RawSearchResponse = z.infer<typeof rawSearchResponseSchema>;
