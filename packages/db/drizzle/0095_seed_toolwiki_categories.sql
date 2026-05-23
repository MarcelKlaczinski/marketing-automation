-- Spec multi-domain-evolution S3.2: seed Toolwiki content_categories.
-- Source: /Users/marcelklaczinski/WebstormProjects/ki-wissensraum-neu/src/lib/url-slugs.ts
-- (URL_SLUG_MAP — the authoritative slug↔urlSlug mapping for the Toolwiki
-- Astro repo). Branch B Sprint 3 will adopt this seed as the single source
-- of truth and migrate `URL_SLUG_MAP` lookups to query content_categories
-- instead.
--
-- Idempotent via ON CONFLICT on (project_id, scope, slug). Safe to re-run.
-- Migration is type-clean from 0094 (D124 — type-migration + seed-migration
-- separated). Per Marcel-decision 2026-05-23 the Toolwiki tenant is the
-- only project that gets seeded here; future tenants register their own
-- taxonomy via a new seed migration when they onboard.
--
-- Slug semantics:
--   - `slug` is locale-neutral (e.g. `audio-music` for tools, German label
--     slugified via Astro's `slugifyCategory` for blog/ki-wissen — preserves
--     current URL routing without breaking SEO).
--   - `translations.<locale>.urlSlug` is the locale-specific URL fragment.
--     Tool top-level + subcategory urlSlugs match URL_SLUG_MAP verbatim.
--     Blog urlSlugs are identical across DE/EN (current Astro behaviour;
--     `slugifyCategory(label)` is locale-invariant for the 6 enum values).
--     Ki-wissen urlSlugs are German for DE (current) + locale-neutral
--     English for EN (forward-compat for Branch B's Phase-1-E3 fix that
--     drops the German-in-EN-files wart).
--   - `translations.<locale>.label` is the human-readable display string.
--     For blog/ki-wissen DE = current Astro enum value; EN = the natural
--     English translation Branch B will adopt.

DO $$
DECLARE
  v_project_id uuid;
BEGIN
  SELECT id INTO v_project_id FROM projects WHERE slug = 'toolwiki' LIMIT 1;
  IF v_project_id IS NULL THEN
    RAISE NOTICE 'S3.2 seed: project slug=toolwiki not found, skipping seed';
    RETURN;
  END IF;

  ----------------------------------------------------------------------------
  -- 7 tool top-level categories — URL_SLUG_MAP.toolCategories
  ----------------------------------------------------------------------------
  INSERT INTO content_categories (project_id, slug, scope, translations) VALUES
    (v_project_id, 'audio-music', 'tool',
      '{"de":{"label":"Audio & Musik","urlSlug":"audio-musik"},"en":{"label":"Audio & Music","urlSlug":"audio-music"}}'::jsonb),
    (v_project_id, 'images-graphics', 'tool',
      '{"de":{"label":"Bilder & Grafik","urlSlug":"bilder-grafik"},"en":{"label":"Images & Graphics","urlSlug":"images-graphics"}}'::jsonb),
    (v_project_id, 'business-productivity', 'tool',
      '{"de":{"label":"Business & Produktivität","urlSlug":"business-produktivitaet"},"en":{"label":"Business & Productivity","urlSlug":"business-productivity"}}'::jsonb),
    (v_project_id, 'marketing-seo', 'tool',
      '{"de":{"label":"Marketing & SEO","urlSlug":"marketing-seo"},"en":{"label":"Marketing & SEO","urlSlug":"marketing-seo"}}'::jsonb),
    (v_project_id, 'coding-development', 'tool',
      '{"de":{"label":"Programmierung & Entwicklung","urlSlug":"programmierung-entwicklung"},"en":{"label":"Coding & Development","urlSlug":"coding-development"}}'::jsonb),
    (v_project_id, 'text-language', 'tool',
      '{"de":{"label":"Text & Sprache","urlSlug":"text-sprache"},"en":{"label":"Text & Language","urlSlug":"text-language"}}'::jsonb),
    (v_project_id, 'video-animation', 'tool',
      '{"de":{"label":"Video & Animation","urlSlug":"video-animation"},"en":{"label":"Video & Animation","urlSlug":"video-animation"}}'::jsonb)
  ON CONFLICT (project_id, scope, slug) DO NOTHING;

  ----------------------------------------------------------------------------
  -- 13 tool subcategories — URL_SLUG_MAP.toolSubcategories
  -- parent_slug column links each subcategory to its top-level (S3.3
  -- validator-helper will enforce the FK semantics at app layer).
  ----------------------------------------------------------------------------
  INSERT INTO content_categories (project_id, slug, scope, parent_slug, translations) VALUES
    (v_project_id, 'music-generation', 'tool', 'audio-music',
      '{"de":{"label":"Musikgenerierung","urlSlug":"musikgenerierung"},"en":{"label":"Music Generation","urlSlug":"music-generation"}}'::jsonb),
    (v_project_id, 'voice-synthesis', 'tool', 'audio-music',
      '{"de":{"label":"Sprachsynthese","urlSlug":"sprachsynthese"},"en":{"label":"Voice Synthesis","urlSlug":"voice-synthesis"}}'::jsonb),
    (v_project_id, 'ai-agents', 'tool', 'business-productivity',
      '{"de":{"label":"AI Agents","urlSlug":"ai-agents"},"en":{"label":"AI Agents","urlSlug":"ai-agents"}}'::jsonb),
    (v_project_id, 'knowledge-management', 'tool', 'business-productivity',
      '{"de":{"label":"Wissensmanagement","urlSlug":"wissensmanagement"},"en":{"label":"Knowledge Management","urlSlug":"knowledge-management"}}'::jsonb),
    (v_project_id, 'presentation', 'tool', 'business-productivity',
      '{"de":{"label":"Präsentation","urlSlug":"praesentation"},"en":{"label":"Presentation","urlSlug":"presentation"}}'::jsonb),
    (v_project_id, 'code-assistants', 'tool', 'coding-development',
      '{"de":{"label":"Code-Assistenten","urlSlug":"code-assistenten"},"en":{"label":"Code Assistants","urlSlug":"code-assistants"}}'::jsonb),
    (v_project_id, 'image-generation', 'tool', 'images-graphics',
      '{"de":{"label":"Bildgenerierung","urlSlug":"bildgenerierung"},"en":{"label":"Image Generation","urlSlug":"image-generation"}}'::jsonb),
    (v_project_id, 'content-creation', 'tool', 'marketing-seo',
      '{"de":{"label":"Content-Erstellung","urlSlug":"content-erstellung"},"en":{"label":"Content Creation","urlSlug":"content-creation"}}'::jsonb),
    (v_project_id, 'chatbots-assistants', 'tool', 'text-language',
      '{"de":{"label":"Chatbots & Sprachassistenten","urlSlug":"chatbots-sprachassistenten"},"en":{"label":"Chatbots & Assistants","urlSlug":"chatbots-assistants"}}'::jsonb),
    (v_project_id, 'research', 'tool', 'text-language',
      '{"de":{"label":"Recherche","urlSlug":"recherche"},"en":{"label":"Research","urlSlug":"research"}}'::jsonb),
    (v_project_id, 'translation', 'tool', 'text-language',
      '{"de":{"label":"Übersetzung","urlSlug":"uebersetzung"},"en":{"label":"Translation","urlSlug":"translation"}}'::jsonb),
    (v_project_id, 'avatar-voice', 'tool', 'video-animation',
      '{"de":{"label":"Avatar & Voice","urlSlug":"avatar-voice"},"en":{"label":"Avatar & Voice","urlSlug":"avatar-voice"}}'::jsonb),
    (v_project_id, 'video-generation', 'tool', 'video-animation',
      '{"de":{"label":"Videogenerierung","urlSlug":"videogenerierung"},"en":{"label":"Video Generation","urlSlug":"video-generation"}}'::jsonb)
  ON CONFLICT (project_id, scope, slug) DO NOTHING;

  ----------------------------------------------------------------------------
  -- 6 blog categories — German labels are the canonical Astro enum values
  -- (preserves current URL routing via slugifyCategory(label)). Both DE and
  -- EN urlSlugs identical because today's Astro uses the German label-slug
  -- for both locales (Phase-1 §1 Befund). EN labels are forward-compat for
  -- Branch B's eventual locale-neutral migration.
  ----------------------------------------------------------------------------
  INSERT INTO content_categories (project_id, slug, scope, translations) VALUES
    (v_project_id, 'guides-und-tutorials', 'blog',
      '{"de":{"label":"Guides & Tutorials","urlSlug":"guides-und-tutorials"},"en":{"label":"Guides & Tutorials","urlSlug":"guides-und-tutorials"}}'::jsonb),
    (v_project_id, 'tool-reviews', 'blog',
      '{"de":{"label":"Tool-Reviews","urlSlug":"tool-reviews"},"en":{"label":"Tool Reviews","urlSlug":"tool-reviews"}}'::jsonb),
    (v_project_id, 'vergleiche', 'blog',
      '{"de":{"label":"Vergleiche","urlSlug":"vergleiche"},"en":{"label":"Comparisons","urlSlug":"vergleiche"}}'::jsonb),
    (v_project_id, 'trends-und-zukunft', 'blog',
      '{"de":{"label":"Trends & Zukunft","urlSlug":"trends-und-zukunft"},"en":{"label":"Trends & Future","urlSlug":"trends-und-zukunft"}}'::jsonb),
    (v_project_id, 'praxis-und-use-cases', 'blog',
      '{"de":{"label":"Praxis & Use Cases","urlSlug":"praxis-und-use-cases"},"en":{"label":"Practice & Use Cases","urlSlug":"praxis-und-use-cases"}}'::jsonb),
    (v_project_id, 'ethik-und-recht', 'blog',
      '{"de":{"label":"Ethik & Recht","urlSlug":"ethik-und-recht"},"en":{"label":"Ethics & Law","urlSlug":"ethik-und-recht"}}'::jsonb)
  ON CONFLICT (project_id, scope, slug) DO NOTHING;

  ----------------------------------------------------------------------------
  -- 5 ki-wissen knowledge categories — German labels are today's Astro enum
  -- (Phase-1 §E3 noted German labels live in EN files too — known wart).
  -- This seed introduces EN labels + EN urlSlugs that Branch B can adopt to
  -- fix the wart in its own Sprint 3 (locale-neutral EN urlSlugs ready).
  ----------------------------------------------------------------------------
  INSERT INTO content_categories (project_id, slug, scope, translations) VALUES
    (v_project_id, 'grundlagen', 'knowledge',
      '{"de":{"label":"Grundlagen","urlSlug":"grundlagen"},"en":{"label":"Fundamentals","urlSlug":"fundamentals"}}'::jsonb),
    (v_project_id, 'technik', 'knowledge',
      '{"de":{"label":"Technik","urlSlug":"technik"},"en":{"label":"Technology","urlSlug":"technology"}}'::jsonb),
    (v_project_id, 'ethik-und-recht', 'knowledge',
      '{"de":{"label":"Ethik & Recht","urlSlug":"ethik-und-recht"},"en":{"label":"Ethics & Law","urlSlug":"ethics-law"}}'::jsonb),
    (v_project_id, 'praxis', 'knowledge',
      '{"de":{"label":"Praxis","urlSlug":"praxis"},"en":{"label":"Practice","urlSlug":"practice"}}'::jsonb),
    (v_project_id, 'zukunft', 'knowledge',
      '{"de":{"label":"Zukunft","urlSlug":"zukunft"},"en":{"label":"Future","urlSlug":"future"}}'::jsonb)
  ON CONFLICT (project_id, scope, slug) DO NOTHING;
END $$;
