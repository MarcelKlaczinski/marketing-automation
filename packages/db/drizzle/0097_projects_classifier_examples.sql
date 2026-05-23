-- Spec multi-domain-evolution S4.4 site 9: per-project structured examples
-- for the trend-synthesizer's intent-classifier. Pre-S4.4 the 12 Spec-64.14
-- examples were hardcoded inside packages/pipelines/src/topic-sources/
-- trend-discovery/prompts.ts; this column moves them into per-project DB
-- state so new tenants can supply their own niche-specific classifier
-- evidence without code changes.
--
-- JSONB shape (typed via Drizzle `.$type<ClassifierExamples>()`):
--   {
--     knowledge?: {
--       counterExamples: Array<{title, reasonExcluded, correctIntent}>,
--       positiveExamples: Array<{title, reasonIncluded}>,
--     },
--     // future intent buckets layer on the same shape per-tenant
--   }
--
-- NULL value (the default) = fall back to the hardcoded Toolwiki defaults
-- in prompts.ts. This keeps the column purely additive — non-Toolwiki
-- tenants that don't set it get the same byte-identical output Toolwiki
-- produced before S4.4 (forward-compat path).
--
-- Type-only migration (D124). Toolwiki gets the 12 example seed in 0098.

ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "classifier_examples" jsonb;

COMMENT ON COLUMN "projects"."classifier_examples" IS
  'Spec multi-domain-evolution S4.4: per-project structured intent-classifier examples used by the trend-synthesizer prompt. NULL = fall back to Toolwiki-specific Spec-64.14 hardcoded defaults. JSONB shape: { [intent_key]: { counterExamples: [...], positiveExamples: [...] } }.';
