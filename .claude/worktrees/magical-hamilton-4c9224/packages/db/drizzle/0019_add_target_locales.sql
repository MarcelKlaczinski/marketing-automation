ALTER TABLE "projects"
  ADD COLUMN "target_locales" jsonb NOT NULL DEFAULT '["de-DE"]';

-- Set bilingual locale for toolwiki (DE + EN)
UPDATE "projects"
  SET "target_locales" = '["de-DE", "en-US"]'::jsonb
  WHERE slug = 'toolwiki';
