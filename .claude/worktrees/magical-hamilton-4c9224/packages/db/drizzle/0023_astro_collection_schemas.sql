-- Spec 50: Store Astro content collection frontmatter schemas per project.
-- Extracted during astro:repo-import runs from the Astro repo's content.config.ts.
-- Keyed by collection name ("blog", "ki-wissen", etc.) → FrontmatterFieldDescriptor[].
ALTER TABLE "projects" ADD COLUMN "astro_collection_schemas" jsonb;
