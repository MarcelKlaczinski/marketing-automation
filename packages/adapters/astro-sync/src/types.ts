import { z } from "zod";

// ───── Project Astro repo config ─────────────────────────────────────────────

/** One author entry stored in `projects.astroRepo.authors` (optional). */
export const AstroRepoAuthorSchema = z.object({
  /** Slug that maps to `src/content/authors/<locale>/<slug>.mdx` */
  slug: z.string().min(1),
  name: z.string().min(1),
  /** Keywords that describe this author's subject-matter expertise. */
  expertise: z.array(z.string()).default([]),
});
export type AstroRepoAuthor = z.infer<typeof AstroRepoAuthorSchema>;

export const AstroRepoConfigSchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
  installationId: z.number().int().positive(),
  defaultBranch: z.string().default("main"),
  contentRoot: z.string().default("src/content"),
  assetsRoot: z.string().default("src/assets"),
  /** Local file-system path to the cloned repo (optional; for local-preview). */
  localPath: z.string().optional(),
  /**
   * Available content authors — loaded by DraftStep so the LLM can pick the best
   * match by topic expertise. Slugs must correspond to entries in
   * `src/content/authors/<locale>/`. Set via direct SQL or Drizzle Studio.
   */
  authors: z.array(AstroRepoAuthorSchema).optional(),
});
export type AstroRepoConfig = z.infer<typeof AstroRepoConfigSchema>;

// ───── Frontmatter discovered from Astro repo's content/config.ts ────────────

export const FrontmatterFieldSchema = z.object({
  name: z.string(),
  type: z.enum([
    "string",
    "number",
    "boolean",
    "date",
    "image",
    "string_array",
    "object_array",
    "object",
    "unknown",
  ]),
  required: z.boolean(),
  hasDefault: z.boolean(),
  // Populated for z.enum([...]) fields — lists the valid options
  enumValues: z.array(z.string()).optional(),
  // Human-readable shape description for object/object_array fields
  // e.g. "{ question: string, answer: string }" for faq items
  objectShape: z.string().optional(),
});
export type FrontmatterField = z.infer<typeof FrontmatterFieldSchema>;

// Spec 50: all collections extracted from content.config.ts
export const AstroCollectionSchemasSchema = z.record(z.array(FrontmatterFieldSchema));
export type AstroCollectionSchemas = z.infer<typeof AstroCollectionSchemasSchema>;

// ───── Sync result ────────────────────────────────────────────────────────────

export type SyncResult = {
  articleId: string;
  commitSha: string;
  filesCommitted: string[];
  bytesCommitted: number;
  pullRequestUrl: string | null;
};

// ───── Errors ─────────────────────────────────────────────────────────────────

export class AstroSyncError extends Error {
  constructor(
    message: string,
    public readonly stage:
      | "load"
      | "schema"
      | "image"
      | "render"
      | "commit"
      | "db_update"
      | "auth"
      | "config"
      | "stale_read",
    public readonly originalCause?: unknown
  ) {
    super(message);
    this.name = "AstroSyncError";
  }
}
