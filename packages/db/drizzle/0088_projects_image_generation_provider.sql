-- Spec 64.6: per-project hero-image provider toggle.
--
-- 'nano-banana-2' (default) → Google Gemini Image API via
-- @marketing-auto/adapter-nano-banana (better composition + no pseudo-script
-- artefacts compared with Flux 1.1 Pro at ~1.7x the per-image cost).
-- 'flux-1.1-pro'             → legacy @marketing-auto/adapter-replicate path,
-- retained as the explicit opt-out / fallback when the new adapter is
-- unconfigured for a given project.
--
-- Lives on projects (parallel to llm_mode, translation_auto_trigger,
-- auto_publish) rather than project_configurations.image_generation jsonb —
-- it's a single toggleable setting, not versioned config (Spec §3.4 review).

ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "image_generation_provider" text NOT NULL DEFAULT 'nano-banana-2';

COMMENT ON COLUMN "projects"."image_generation_provider"
  IS 'Spec 64.6: which adapter renders hero images. Values: ''nano-banana-2'' (default, Google Gemini), ''flux-1.1-pro'' (legacy Replicate).';
