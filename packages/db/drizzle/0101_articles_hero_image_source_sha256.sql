-- Spec 000 (Hero-Image-Mirror): content-hash tracking for source hero images
-- in the Astro repo. Populated by MirrorHeroImagesStep on every RepoImportPipeline
-- run; the hash is computed over the raw source bytes (pre-WebP-conversion) so it
-- is authoritative for "what does the repo file currently contain".
--
-- Used for:
--   - In-run dedup: DE+EN siblings that share a hero file get one upload.
--   - Cross-run dedup: a re-import re-uses the R2 asset of any prior article
--     (same project) whose source matched this hash.
--   - Refresh-whitelist: UpsertArticlesStep overwrites the four hero_image_*
--     columns ONLY when the new hash differs from the stored one. Editor swaps
--     a file in the repo → next import detects the new hash → R2 re-upload +
--     all hero columns updated atomically.
--
-- Partial index keeps lookups cheap (most rows will be NULL until backfilled).
-- Cross-project lookups are NEVER allowed — the multi-tenant invariant must
-- hold for hero assets too, so consumers always filter by `project_id` first.

ALTER TABLE "articles"
  ADD COLUMN IF NOT EXISTS "hero_image_source_sha256" text NULL;

CREATE INDEX IF NOT EXISTS "articles_hero_image_source_sha256_idx"
  ON "articles" ("hero_image_source_sha256")
  WHERE "hero_image_source_sha256" IS NOT NULL;

COMMENT ON COLUMN "articles"."hero_image_source_sha256"
  IS 'Spec 000: SHA-256 (hex) over the raw source hero bytes from the Astro repo. NULL = never mirrored.';
