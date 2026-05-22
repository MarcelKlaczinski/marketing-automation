-- Spec 64.6b: per-project hero-image output-resolution toggle.
--
-- '0.5k' → 512px shortest-side (cheapest, ~$0.045 Flash)  -- "0.25MP"
-- '1k'   → 1024px (Toolwiki default, $0.067 Flash / $0.134 Pro)
-- '2k'   → 2048px (premium quality, $0.101 Flash / $0.134 Pro)
-- '4k'   → 4096px (print quality, $0.151 Flash / $0.240 Pro)
--
-- Resolution is sent to the Gemini Image API via
-- generationConfig.responseFormat.image.imageSize ("512"/"1K"/"2K"/"4K").
-- Pro tier does not support 0.5k — adapter falls back to 1k for Pro.

ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "image_generation_resolution" text NOT NULL DEFAULT '1k';

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_image_generation_resolution_check"
  CHECK ("image_generation_resolution" IN ('0.5k', '1k', '2k', '4k'));

COMMENT ON COLUMN "projects"."image_generation_resolution"
  IS 'Spec 64.6b: hero-image output resolution. Values: ''0.5k'' / ''1k'' (default) / ''2k'' / ''4k''. Maps to Gemini ResponseFormat.image.imageSize ("512" / "1K" / "2K" / "4K").';
