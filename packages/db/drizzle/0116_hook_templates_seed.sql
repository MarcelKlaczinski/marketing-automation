-- Spec 65.4 — Hook-Library seed for Family B format-types.
--
-- 60 hooks total: 3 Family-B format-types × 2 languages × 10 hooks each.
-- Toolwiki project-id resolved via subquery; if the project does not exist
-- (e.g. on a fresh non-Toolwiki tenant) the migration is a no-op.
--
-- Variable substitution at use-time via apps/api/src/lib/hook-library/render-hook.ts:
--   "Ich habe meinen {profession}-Job verloren — wegen {tool}"
--      + {profession: "Texter", tool: "Claude"}
--      → "Ich habe meinen Texter-Job verloren — wegen Claude"
--
-- Each pattern uses ASCII placeholders only (`{profession}`, `{tool}`, …) to
-- stay grep-able. The `variables` jsonb mirrors the placeholders the pattern
-- actually contains; the Hook-Picker tests this contract.
--
-- Marcel-review checkpoint: edit the (pattern, language, variables) tuples
-- before merge. The dataset is intentionally inline so it's reviewable in
-- one diff.

INSERT INTO hook_templates (project_id, format_type, pattern, language, variables, is_active)
SELECT
  p.id,
  v.format_type,
  v.pattern,
  v.language,
  v.variables::jsonb,
  TRUE
FROM projects p
CROSS JOIN (VALUES
  -- ─── story_arc_clickbait DE (10) ────────────────────────────────────────
  ('story_arc_clickbait', 'Ich habe meinen {profession}-Job verloren — wegen {tool}', 'de', '["profession","tool"]'),
  ('story_arc_clickbait', '{tool} hat mich als {profession} ersetzt — und ich bin frei', 'de', '["profession","tool"]'),
  ('story_arc_clickbait', 'Warum ich {tool} eigentlich danken sollte — als ehemaliger {profession}', 'de', '["profession","tool"]'),
  ('story_arc_clickbait', 'Vor {tool} war ich {profession}. Heute mache ich etwas anderes', 'de', '["profession","tool"]'),
  ('story_arc_clickbait', 'Mein letzter Tag als {profession}: {tool} hat alles verändert', 'de', '["profession","tool"]'),
  ('story_arc_clickbait', 'Niemand wollte mich als {profession} hören — bis {tool} kam', 'de', '["profession","tool"]'),
  ('story_arc_clickbait', 'Ich habe meine {profession}-Ausbildung abgebrochen wegen {tool}', 'de', '["profession","tool"]'),
  ('story_arc_clickbait', '{tool} hat mir als {profession} mehr beigebracht als 5 Jahre Berufserfahrung', 'de', '["profession","tool"]'),
  ('story_arc_clickbait', 'Warum jeder {profession} {tool} hassen sollte — und heimlich nutzt', 'de', '["profession","tool"]'),
  ('story_arc_clickbait', 'Mein Chef hat mich gefeuert. {tool} hat mir den nächsten Job verschafft', 'de', '["profession","tool"]'),

  -- ─── story_arc_clickbait EN (10) ────────────────────────────────────────
  ('story_arc_clickbait', 'I lost my {profession} job because of {tool}', 'en', '["profession","tool"]'),
  ('story_arc_clickbait', '{tool} replaced me as a {profession} — and set me free', 'en', '["profession","tool"]'),
  ('story_arc_clickbait', 'Why I should thank {tool} — as a former {profession}', 'en', '["profession","tool"]'),
  ('story_arc_clickbait', 'Before {tool} I was a {profession}. Now I do something else', 'en', '["profession","tool"]'),
  ('story_arc_clickbait', 'My last day as a {profession}: {tool} changed everything', 'en', '["profession","tool"]'),
  ('story_arc_clickbait', 'Nobody listened to me as a {profession} — until {tool} arrived', 'en', '["profession","tool"]'),
  ('story_arc_clickbait', 'I dropped out of my {profession} training because of {tool}', 'en', '["profession","tool"]'),
  ('story_arc_clickbait', '{tool} taught me more as a {profession} than 5 years on the job', 'en', '["profession","tool"]'),
  ('story_arc_clickbait', 'Why every {profession} should hate {tool} — and secretly uses it', 'en', '["profession","tool"]'),
  ('story_arc_clickbait', 'My boss fired me. {tool} landed me the next gig', 'en', '["profession","tool"]'),

  -- ─── lifestyle_listicle DE (10) ─────────────────────────────────────────
  ('lifestyle_listicle', '5 Wege, wie {tool} deinen {lifeArea} verändert', 'de', '["tool","lifeArea"]'),
  ('lifestyle_listicle', 'So nutze ich {tool} jeden Tag in meinem {lifeArea}', 'de', '["tool","lifeArea"]'),
  ('lifestyle_listicle', '{lifeArea} mit {tool}: 7 Hacks, die wirklich funktionieren', 'de', '["tool","lifeArea"]'),
  ('lifestyle_listicle', 'Mein {lifeArea} vor und nach {tool} — der Unterschied', 'de', '["tool","lifeArea"]'),
  ('lifestyle_listicle', 'Diese {tool}-Tricks haben meinen {lifeArea} gerettet', 'de', '["tool","lifeArea"]'),
  ('lifestyle_listicle', '{lifeArea}-Hacks, die niemand mit {tool} kombiniert', 'de', '["tool","lifeArea"]'),
  ('lifestyle_listicle', 'Wie {tool} meinen {lifeArea} um die Hälfte beschleunigt', 'de', '["tool","lifeArea"]'),
  ('lifestyle_listicle', '{tool} im {lifeArea}: Was ich nach 30 Tagen gelernt habe', 'de', '["tool","lifeArea"]'),
  ('lifestyle_listicle', 'Der {lifeArea}-Workflow, den ich nur mit {tool} schaffe', 'de', '["tool","lifeArea"]'),
  ('lifestyle_listicle', '{lifeArea} ohne {tool}? Geht nicht mehr — hier ist warum', 'de', '["tool","lifeArea"]'),

  -- ─── lifestyle_listicle EN (10) ─────────────────────────────────────────
  ('lifestyle_listicle', '5 ways {tool} changes your {lifeArea}', 'en', '["tool","lifeArea"]'),
  ('lifestyle_listicle', 'How I use {tool} every day in my {lifeArea}', 'en', '["tool","lifeArea"]'),
  ('lifestyle_listicle', '{lifeArea} with {tool}: 7 hacks that actually work', 'en', '["tool","lifeArea"]'),
  ('lifestyle_listicle', 'My {lifeArea} before and after {tool} — the difference', 'en', '["tool","lifeArea"]'),
  ('lifestyle_listicle', 'These {tool} tricks saved my {lifeArea}', 'en', '["tool","lifeArea"]'),
  ('lifestyle_listicle', '{lifeArea} hacks nobody combines with {tool}', 'en', '["tool","lifeArea"]'),
  ('lifestyle_listicle', 'How {tool} cut my {lifeArea} time in half', 'en', '["tool","lifeArea"]'),
  ('lifestyle_listicle', '{tool} in {lifeArea}: what I learned after 30 days', 'en', '["tool","lifeArea"]'),
  ('lifestyle_listicle', 'The {lifeArea} workflow I only manage with {tool}', 'en', '["tool","lifeArea"]'),
  ('lifestyle_listicle', '{lifeArea} without {tool}? Not anymore — here is why', 'en', '["tool","lifeArea"]'),

  -- ─── opinion_recommendation DE (10) ─────────────────────────────────────
  ('opinion_recommendation', 'Warum jeder {tool} Premium haben sollte', 'de', '["tool"]'),
  ('opinion_recommendation', '{tool} Pro hat sich für mich gelohnt — hier ist warum', 'de', '["tool"]'),
  ('opinion_recommendation', 'Die unterschätzte Wahrheit über {tool}', 'de', '["tool"]'),
  ('opinion_recommendation', '{tool}: Mein ehrliches Urteil nach einem Jahr', 'de', '["tool"]'),
  ('opinion_recommendation', 'Hot take: {tool} ist deutlich besser als alle sagen', 'de', '["tool"]'),
  ('opinion_recommendation', 'Warum ich {tool} jedem empfehle — auch wenn ich es nicht müsste', 'de', '["tool"]'),
  ('opinion_recommendation', '{tool} kostet — und genau das ist der Punkt', 'de', '["tool"]'),
  ('opinion_recommendation', 'Spar dir die Alternativen: nimm direkt {tool}', 'de', '["tool"]'),
  ('opinion_recommendation', 'Ich habe {tool} verteidigt — und hier ist meine Begründung', 'de', '["tool"]'),
  ('opinion_recommendation', 'Wenn du dich für {tool} entscheidest, mach es richtig', 'de', '["tool"]'),

  -- ─── opinion_recommendation EN (10) ─────────────────────────────────────
  ('opinion_recommendation', 'Why everyone should have {tool} Premium', 'en', '["tool"]'),
  ('opinion_recommendation', '{tool} Pro paid off for me — here is why', 'en', '["tool"]'),
  ('opinion_recommendation', 'The underrated truth about {tool}', 'en', '["tool"]'),
  ('opinion_recommendation', '{tool}: my honest verdict after a year', 'en', '["tool"]'),
  ('opinion_recommendation', 'Hot take: {tool} is significantly better than everyone says', 'en', '["tool"]'),
  ('opinion_recommendation', 'Why I recommend {tool} — even when I do not have to', 'en', '["tool"]'),
  ('opinion_recommendation', '{tool} costs money — and that is the whole point', 'en', '["tool"]'),
  ('opinion_recommendation', 'Skip the alternatives: go straight to {tool}', 'en', '["tool"]'),
  ('opinion_recommendation', 'I defended {tool} — and here is my reasoning', 'en', '["tool"]'),
  ('opinion_recommendation', 'If you go with {tool}, do it right', 'en', '["tool"]')
) AS v(format_type, pattern, language, variables)
WHERE p.slug = 'toolwiki';
