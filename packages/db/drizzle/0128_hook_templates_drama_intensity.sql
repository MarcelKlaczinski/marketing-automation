-- Spec 65.14 — Hook-Library Mode-Switch
--
-- Adds `drama_intensity` to `hook_templates` so the 65.4 Hook-Picker can
-- filter the LRU pool by output-target. Three-tier taxonomy:
--
--   - 'subtle'     → SEO-safe, complies with Spec 64.16 drama-ban
--                    (no "RIP …", "killed", "destroyed", "End It" phrasing).
--                    Default for existing 60 hooks seeded by migration 0116.
--   - 'moderate'   → mild drama (number-driven, year-anchor patterns).
--   - 'aggressive' → full drama (contrarian "RIP X", curator-confidence
--                    "I tested N. Only K survived.").
--
-- Picker policy (apps/api/src/lib/hook-library/pick-hook.ts):
--   - outputTargets includes 'social' → all three intensities allowed
--   - outputTargets is article-only   → only 'subtle' allowed
--
-- Default `'subtle'` preserves Spec 64.16 invariant on backfill: existing
-- 60 generic hooks (Spec 65.4) are by-text actually subtle, and any new
-- INSERT without an explicit intensity column gets the SEO-safe value.

ALTER TABLE hook_templates
  ADD COLUMN drama_intensity TEXT NOT NULL DEFAULT 'subtle'
  CHECK (drama_intensity IN ('subtle', 'moderate', 'aggressive'));

-- Read-path index: the picker queries `(formatType, language, isActive)`
-- with optional `dramaIntensity IN (...)` filter. Most lookups will request
-- ALL three intensities (social), so a dedicated intensity-keyed partial
-- index isn't worth maintaining. The existing `idx_hook_templates_format_type`
-- already narrows to (formatType, language) WHERE isActive=TRUE.
