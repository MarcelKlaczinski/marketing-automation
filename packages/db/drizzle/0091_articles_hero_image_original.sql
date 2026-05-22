-- Spec 64.6c: store the original (non-WebP) hero image alongside the
-- canonical WebP. Set when @marketing-auto/adapter-image-webp performed a
-- conversion (input was PNG/JPEG/etc.). Stays NULL when:
--   - input was already WebP (no conversion happened), or
--   - the caller passed discardOriginal=true, or
--   - the row predates this migration and hasn't been processed by the
--     historical-backfill script (apps/api/src/scripts/convert-existing-heroes.ts).
--
-- The primary `hero_image_r2_key` always points at the WebP (final usable
-- image). This column is forensic / fallback-only — no application reads it
-- by default. Solves the Spec 64.6 / Discovery #14 "Gemini might return PNG
-- despite our outputFormat: 'webp' hint" footgun: now we always control the
-- final format ourselves.

ALTER TABLE "articles"
  ADD COLUMN IF NOT EXISTS "hero_image_original_r2_key" text NULL;

COMMENT ON COLUMN "articles"."hero_image_original_r2_key"
  IS 'Spec 64.6c: R2 key of the pre-conversion original image. NULL = no conversion or row predates 64.6c.';
