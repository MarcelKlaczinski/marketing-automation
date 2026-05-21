-- Spec 63.5: per-project diversity-modifier knobs for the planner's
-- Floor + Overage + Social-post selectors. Stored as numeric(4,3) so the
-- granularity of the sliders (0.001) is preserved end-to-end.
--
-- diversity_threshold ∈ [0, 1]
--   Cosine-similarity above which the linear malus begins. 0 = malus applies
--   to any non-zero similarity. 1 = effectively off (no malus ever).
--
-- diversity_malus_weight ∈ [0, 2]
--   Linear malus slope above the threshold. 0 = off-switch (existing FIFO /
--   score-only behaviour). Values > 1 push near-duplicates clearly below
--   moderately-different briefs in score-units; the upper bound 2 keeps the
--   slider knobby without being a footgun.
--
-- Both default to 0.5 — the "moderate diversity, half-weight malus" baseline
-- from Spec 63.5 §3.1. Marcel tunes via SettingsPlannerPage.

ALTER TABLE "project_planner_config"
  ADD COLUMN IF NOT EXISTS "diversity_threshold"    numeric(4,3) NOT NULL DEFAULT 0.5
    CHECK ("diversity_threshold"    >= 0 AND "diversity_threshold"    <= 1),
  ADD COLUMN IF NOT EXISTS "diversity_malus_weight" numeric(4,3) NOT NULL DEFAULT 0.5
    CHECK ("diversity_malus_weight" >= 0 AND "diversity_malus_weight" <= 2);

COMMENT ON COLUMN "project_planner_config"."diversity_threshold"
  IS 'Cosine-similarity above which the diversity malus begins (0..1). Default 0.5.';
COMMENT ON COLUMN "project_planner_config"."diversity_malus_weight"
  IS 'Linear malus slope above the threshold (0..2). 0 = diversity off. Default 0.5.';
