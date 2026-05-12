import { z } from "zod";

// ───── Project Astro repo config ─────────────────────────────────────────────

export const AstroRepoConfigSchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
  installationId: z.number().int().positive(),
  defaultBranch: z.string().default("main"),
  contentRoot: z.string().default("src/content"),
  assetsRoot: z.string().default("src/assets"),
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
