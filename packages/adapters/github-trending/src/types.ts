import { z } from "zod";

export const rawGitHubRepoSchema = z.object({
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
  open_issues_count: z.number(),
  archived: z.boolean(),
  created_at: z.string(),
  pushed_at: z.string(),
  license: z
    .object({ spdx_id: z.string().nullable() })
    .nullable()
    .optional(),
});

export type RawGitHubRepo = z.infer<typeof rawGitHubRepoSchema>;

export const searchResponseSchema = z.object({
  total_count: z.number(),
  incomplete_results: z.boolean(),
  items: z.array(rawGitHubRepoSchema),
});

export type GitHubSearchResponse = z.infer<typeof searchResponseSchema>;
