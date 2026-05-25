-- Spec 65.2 follow-up — Brandfetch brand pages typically expose 3 colors per
-- brand (primary vivid + dark accent + light tint). V1 schema only had
-- primary_color + secondary_color, so the tint variant was being dropped.
-- Adding a third nullable slot keeps the data shape simple (vs a jsonb
-- palette array) and the rendering side has three direct columns to read.
--
-- Marcel-decision 2026-05-25: "+1 tertiary_color Spalte" over JSONB palette
-- or 2-color status quo.

ALTER TABLE tool_brand_assets
  ADD COLUMN tertiary_color text;
