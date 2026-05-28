-- Spec 65.14 — V1.6 winner-hook seed (5-pattern aditya-style hook pool).
--
-- Adds ~66 new hooks for the 3 Family-B format-types × DE+EN, distributed
-- per the §3.2 pattern-density table. Each hook is tagged with its
-- `drama_intensity` so the 65.4 picker can pre-filter by output-target:
--
--   - moderate   → Number-driven, Tier-anchor, Year-anchor (engagement
--                  patterns, not Spec-64.16-banned drama-words)
--   - aggressive → Contrarian ("RIP {established}", "Vergiss X"),
--                  Curator-confidence ("I tested N. Only K survived.")
--
-- Existing 60 hooks from migration 0116 stay classified `subtle` (Spec 64.16
-- compliant, available for SEO-mode output-targets).
--
-- Variable-pool per format-type (matches what brief-generators populate):
--
--   story_arc_clickbait :  profession, tool, painPoint?, established?, n?
--   lifestyle_listicle  :  tool, lifeArea, persona, n, k, painPoint?, established?
--   opinion_recommendation: tool, stance, painPoint?, established?, n?
--
-- `established` is optional per pattern — picker drops hooks needing
-- `established` when the definition's format_config.competitorTool is unset.
--
-- Density per §3.2 (HIGH=3, medium=2, low=1):
--
--   Pattern             story_arc  lifestyle  opinion
--   Number-driven       low(1)     HIGH(3)    medium(2)
--   Tier-anchor         low(1)     medium(2)  HIGH(3)
--   Year-anchor         medium(2)  HIGH(3)    medium(2)
--   Contrarian          HIGH(3)    low(1)     HIGH(3)
--   Curator-confidence  medium(2)  medium(2)  HIGH(3)
--
--   Per locale: 9 + 11 + 13 = 33    Total: 66 (2 locales)
--
-- Toolwiki project-id resolved via subquery; no-op for tenants where the
-- project doesn't exist. Marcel-review checkpoint: edit any (pattern,
-- language, variables, drama_intensity) tuple before merge.

INSERT INTO hook_templates (project_id, format_type, pattern, language, variables, drama_intensity, is_active)
SELECT
  p.id,
  v.format_type,
  v.pattern,
  v.language,
  v.variables::jsonb,
  v.drama_intensity,
  TRUE
FROM projects p
CROSS JOIN (VALUES
  -- ────────────────────────────────────────────────────────────────────────
  -- story_arc_clickbait  (9 per locale)
  -- ────────────────────────────────────────────────────────────────────────
  -- Number-driven (low: 1)
  ('story_arc_clickbait', '{n} Gründe warum {tool} jeden {profession} ersetzt', 'de', '["n","tool","profession"]', 'moderate'),
  ('story_arc_clickbait', '{n} reasons why {tool} replaces every {profession}', 'en', '["n","tool","profession"]', 'moderate'),

  -- Tier-anchor (low: 1) — pseudo-tier for single-tool stories
  ('story_arc_clickbait', 'Schlechte {profession}: viele. Gute {profession}: wenige. {profession} mit {tool}: unschlagbar.', 'de', '["profession","tool"]', 'moderate'),
  ('story_arc_clickbait', 'Bad {profession}s: many. Good {profession}s: few. {profession}s with {tool}: unbeatable.', 'en', '["profession","tool"]', 'moderate'),

  -- Year-anchor (medium: 2)
  ('story_arc_clickbait', 'Warum 2026 das Jahr ist, in dem {tool} jeden {profession} ablöst', 'de', '["tool","profession"]', 'moderate'),
  ('story_arc_clickbait', '2026 ist das Jahr, in dem ich als {profession} {tool} statt Kollegen frage', 'de', '["profession","tool"]', 'moderate'),
  ('story_arc_clickbait', 'Why 2026 is the year {tool} replaces every {profession}', 'en', '["tool","profession"]', 'moderate'),
  ('story_arc_clickbait', '2026 is the year I as a {profession} ask {tool} instead of coworkers', 'en', '["profession","tool"]', 'moderate'),

  -- Contrarian (HIGH: 3)
  ('story_arc_clickbait', 'RIP {established}: warum jeder {profession} jetzt {tool} nutzt', 'de', '["established","profession","tool"]', 'aggressive'),
  ('story_arc_clickbait', 'Vergiss {established}. {tool} hat meinen {profession}-Alltag komplett umgekrempelt.', 'de', '["established","tool","profession"]', 'aggressive'),
  ('story_arc_clickbait', 'Ich war 10 Jahre {profession} — bis {tool} kam und alles änderte', 'de', '["profession","tool"]', 'aggressive'),
  ('story_arc_clickbait', 'RIP {established}: why every {profession} uses {tool} now', 'en', '["established","profession","tool"]', 'aggressive'),
  ('story_arc_clickbait', 'Forget {established}. {tool} completely flipped my {profession} workflow.', 'en', '["established","tool","profession"]', 'aggressive'),
  ('story_arc_clickbait', 'I was a {profession} for 10 years — until {tool} came and changed everything', 'en', '["profession","tool"]', 'aggressive'),

  -- Curator-confidence (medium: 2)
  ('story_arc_clickbait', 'Ich habe {n} KI-Tools für {profession} getestet. Nur {tool} überlebte.', 'de', '["n","profession","tool"]', 'aggressive'),
  ('story_arc_clickbait', '6 Monate als {profession} mit {tool}: hier ist die ehrliche Bilanz', 'de', '["profession","tool"]', 'aggressive'),
  ('story_arc_clickbait', 'I tested {n} AI tools as a {profession}. Only {tool} survived.', 'en', '["n","profession","tool"]', 'aggressive'),
  ('story_arc_clickbait', '6 months as a {profession} with {tool}: here is the honest verdict', 'en', '["profession","tool"]', 'aggressive'),

  -- ────────────────────────────────────────────────────────────────────────
  -- lifestyle_listicle  (11 per locale)
  -- ────────────────────────────────────────────────────────────────────────
  -- Number-driven (HIGH: 3)
  ('lifestyle_listicle', '{n} Wege wie {tool} {painPoint} in deinem {lifeArea} killt', 'de', '["n","tool","painPoint","lifeArea"]', 'moderate'),
  ('lifestyle_listicle', '{n} KI-Tools die dein {lifeArea} um die Hälfte beschleunigen', 'de', '["n","lifeArea"]', 'moderate'),
  ('lifestyle_listicle', '{n} {tool}-Hacks die jeder {persona} kennen sollte', 'de', '["n","tool","persona"]', 'moderate'),
  ('lifestyle_listicle', '{n} ways {tool} kills {painPoint} in your {lifeArea}', 'en', '["n","tool","painPoint","lifeArea"]', 'moderate'),
  ('lifestyle_listicle', '{n} AI tools that cut your {lifeArea} time in half', 'en', '["n","lifeArea"]', 'moderate'),
  ('lifestyle_listicle', '{n} {tool} hacks every {persona} should know', 'en', '["n","tool","persona"]', 'moderate'),

  -- Tier-anchor (medium: 2)
  ('lifestyle_listicle', 'Schlechte {lifeArea}-Tools: überall. Gute: wenige. {tool}: spielt in eigener Liga.', 'de', '["lifeArea","tool"]', 'moderate'),
  ('lifestyle_listicle', 'Free: nicht genug. Günstig: zu wenig. {tool}: macht meinen {lifeArea} möglich.', 'de', '["tool","lifeArea"]', 'moderate'),
  ('lifestyle_listicle', 'Bad {lifeArea} tools: everywhere. Good ones: few. {tool}: plays in its own league.', 'en', '["lifeArea","tool"]', 'moderate'),
  ('lifestyle_listicle', 'Free: not enough. Cheap: too little. {tool}: makes my {lifeArea} possible.', 'en', '["tool","lifeArea"]', 'moderate'),

  -- Year-anchor (HIGH: 3)
  ('lifestyle_listicle', '{n} KI-Tools für {lifeArea} die du 2026 wirklich brauchst', 'de', '["n","lifeArea"]', 'moderate'),
  ('lifestyle_listicle', '{lifeArea} 2026: {n} Tools die deinen Workflow auf das nächste Level heben', 'de', '["lifeArea","n"]', 'moderate'),
  ('lifestyle_listicle', 'Mein {lifeArea}-Stack 2026: {n} Tools, ohne die nichts mehr läuft', 'de', '["lifeArea","n"]', 'moderate'),
  ('lifestyle_listicle', '{n} AI tools for {lifeArea} you actually need in 2026', 'en', '["n","lifeArea"]', 'moderate'),
  ('lifestyle_listicle', '{lifeArea} in 2026: {n} tools that take your workflow to the next level', 'en', '["lifeArea","n"]', 'moderate'),
  ('lifestyle_listicle', 'My {lifeArea} stack for 2026: {n} tools I cannot live without', 'en', '["lifeArea","n"]', 'moderate'),

  -- Contrarian (low: 1)
  ('lifestyle_listicle', 'RIP {established}: warum {tool} dein {lifeArea} jetzt besser macht', 'de', '["established","tool","lifeArea"]', 'aggressive'),
  ('lifestyle_listicle', 'RIP {established}: why {tool} makes your {lifeArea} better now', 'en', '["established","tool","lifeArea"]', 'aggressive'),

  -- Curator-confidence (medium: 2)
  ('lifestyle_listicle', 'Ich habe {n} Tools für {lifeArea} getestet. Nur {k} überlebten.', 'de', '["n","lifeArea","k"]', 'aggressive'),
  ('lifestyle_listicle', '90 Tage {lifeArea} mit {tool}: was wirklich besser wurde', 'de', '["lifeArea","tool"]', 'aggressive'),
  ('lifestyle_listicle', 'I tested {n} tools for {lifeArea}. Only {k} survived.', 'en', '["n","lifeArea","k"]', 'aggressive'),
  ('lifestyle_listicle', '90 days of {lifeArea} with {tool}: what actually got better', 'en', '["lifeArea","tool"]', 'aggressive'),

  -- ────────────────────────────────────────────────────────────────────────
  -- opinion_recommendation  (13 per locale)
  -- ────────────────────────────────────────────────────────────────────────
  -- Number-driven (medium: 2)
  ('opinion_recommendation', '{n} Gründe warum {tool} jeden Cent wert ist', 'de', '["n","tool"]', 'moderate'),
  ('opinion_recommendation', '{n} Dinge die ich an {tool} liebe — und ein Deal-Breaker', 'de', '["n","tool"]', 'moderate'),
  ('opinion_recommendation', '{n} reasons {tool} is worth every cent', 'en', '["n","tool"]', 'moderate'),
  ('opinion_recommendation', '{n} things I love about {tool} — and one deal-breaker', 'en', '["n","tool"]', 'moderate'),

  -- Tier-anchor (HIGH: 3)
  ('opinion_recommendation', 'Gratis: nicht genug. Günstig: zu wenig. {tool}: alles.', 'de', '["tool"]', 'moderate'),
  ('opinion_recommendation', 'Anfänger: lite. Pro: solide. {tool}: spielt in eigener Liga.', 'de', '["tool"]', 'moderate'),
  ('opinion_recommendation', 'Ok-Tools: viele. Gute Tools: einige. {tool}: einer von drei, die ich täglich nutze.', 'de', '["tool"]', 'moderate'),
  ('opinion_recommendation', 'Free: not enough. Cheap: too little. {tool}: everything.', 'en', '["tool"]', 'moderate'),
  ('opinion_recommendation', 'Starter: lite. Pro: solid. {tool}: plays in its own league.', 'en', '["tool"]', 'moderate'),
  ('opinion_recommendation', 'Ok tools: many. Good tools: a few. {tool}: one of three I use daily.', 'en', '["tool"]', 'moderate'),

  -- Year-anchor (medium: 2)
  ('opinion_recommendation', 'Warum {tool} dein wichtigster KI-Kauf 2026 ist', 'de', '["tool"]', 'moderate'),
  ('opinion_recommendation', 'Meine ehrliche {tool}-Bilanz 2026 — nach 6 Monaten täglicher Nutzung', 'de', '["tool"]', 'moderate'),
  ('opinion_recommendation', 'Why {tool} is your most important AI buy in 2026', 'en', '["tool"]', 'moderate'),
  ('opinion_recommendation', 'My honest {tool} verdict 2026 — after 6 months of daily use', 'en', '["tool"]', 'moderate'),

  -- Contrarian (HIGH: 3)
  ('opinion_recommendation', 'Vergiss {established}. {tool} ist das Tool, das ich jedem empfehle.', 'de', '["established","tool"]', 'aggressive'),
  ('opinion_recommendation', 'RIP {established}: warum ich seit Monaten nur noch {tool} nutze', 'de', '["established","tool"]', 'aggressive'),
  ('opinion_recommendation', 'Alle reden über {established}. Ich rede über {tool} — hier ist warum.', 'de', '["established","tool"]', 'aggressive'),
  ('opinion_recommendation', 'Forget {established}. {tool} is the one I recommend to everyone.', 'en', '["established","tool"]', 'aggressive'),
  ('opinion_recommendation', 'RIP {established}: why I have only used {tool} for months', 'en', '["established","tool"]', 'aggressive'),
  ('opinion_recommendation', 'Everyone talks about {established}. I talk about {tool} — here is why.', 'en', '["established","tool"]', 'aggressive'),

  -- Curator-confidence (HIGH: 3)
  ('opinion_recommendation', 'Ich habe {n} KI-Tools getestet. {tool} ist mein einziger Pick.', 'de', '["n","tool"]', 'aggressive'),
  ('opinion_recommendation', 'Mein {tool}-Test war brutal ehrlich. Hier ist warum es trotzdem gewonnen hat.', 'de', '["tool"]', 'aggressive'),
  ('opinion_recommendation', 'Von {n} getesteten Tools sind {tool} und 2 weitere übrig geblieben', 'de', '["n","tool"]', 'aggressive'),
  ('opinion_recommendation', 'I tested {n} AI tools. {tool} is my only pick.', 'en', '["n","tool"]', 'aggressive'),
  ('opinion_recommendation', 'My {tool} test was brutally honest. Here is why it still won.', 'en', '["tool"]', 'aggressive'),
  ('opinion_recommendation', 'Of {n} tools I tested, {tool} and 2 others are still in my stack', 'en', '["n","tool"]', 'aggressive')
) AS v(format_type, pattern, language, variables, drama_intensity)
WHERE p.slug = 'toolwiki'
  AND NOT EXISTS (
    SELECT 1 FROM hook_templates h
    WHERE h.project_id = p.id
      AND h.format_type = v.format_type
      AND h.language = v.language
      AND h.pattern = v.pattern
  );
