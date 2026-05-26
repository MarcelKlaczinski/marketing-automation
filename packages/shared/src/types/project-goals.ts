import { z } from "zod";
import { starTrendConfigSchema, trendScoreWeightsSchema } from "./project-config.ts";

/**
 * Spec 62.2: content-type discriminator for project_goals rows.
 *
 * Extensible — add new entries as new content types are introduced. Stored as plain text
 * at the DB layer (62.0a Lesson D12 — no pgEnum), so adding a value here is a code-only
 * change with no migration.
 */
// Spec 64.1: `cluster_spoke` splits `cluster` along the cluster_action axis.
// `cluster`        = create_new (inline cluster:full-plan, €4.20 hub + spokes)
// `cluster_spoke`  = append_to_existing (article:blog under brief.clusterId, €1.06)
// Plan-Goals get separate min/max so Marcel controls the create_new vs append mix.
//
// Spec 65.5: `recurring_content` is the bucket for briefs emitted by the
// `recurring_content_definitions` cron coordinator (one brief per fired
// definition, social-first per `output_targets` default `{article:false,
// social:true}`). The brief's `recurring_metadata` typed-bucket carries the
// definitionId + frozen formatType + formatConfig — the executor uses those
// to dispatch (`article:social-image` for social, `article:blog` for article).
export const CONTENT_TYPES = [
  "cluster",
  "cluster_spoke",
  "comparison",
  "social_post",
  "ki_wissen",
  "recurring_content",
] as const;
export const contentTypeSchema = z.enum(CONTENT_TYPES);
export type ContentType = z.infer<typeof contentTypeSchema>;

/** per_day = "in the daily average"; per_week = "over the calendar week". */
export const CADENCE_UNITS = ["per_day", "per_week"] as const;
export const cadenceUnitSchema = z.enum(CADENCE_UNITS);
export type CadenceUnit = z.infer<typeof cadenceUnitSchema>;

/**
 * One goal row. `maxCount` is the cap for overage (NULL = uncapped except by global budget).
 * `minCount === 0` is allowed and means "explicitly no floor for this type" (Planner will
 * still consider it for signal-driven overage).
 */
export const projectGoalSchema = z
  .object({
    id: z.string().uuid().optional(),
    contentType: contentTypeSchema,
    cadenceUnit: cadenceUnitSchema,
    minCount: z.number().int().min(0),
    maxCount: z.number().int().min(0).nullable(),
    isActive: z.boolean().default(true),
    note: z.string().max(2000).nullable().optional(),
  })
  .refine((g) => g.maxCount === null || g.maxCount >= g.minCount, {
    message: "maxCount must be >= minCount or null",
    path: ["maxCount"],
  });
export type ProjectGoalInput = z.infer<typeof projectGoalSchema>;

/** PUT /goals body — full replace; server diffs against active rows. */
export const putProjectGoalsPayloadSchema = z.object({
  goals: z.array(projectGoalSchema).max(50),
});
export type PutProjectGoalsPayload = z.infer<typeof putProjectGoalsPayloadSchema>;

/** PATCH /goals/:goalId — partial update of one row. */
export const patchProjectGoalPayloadSchema = z
  .object({
    cadenceUnit: cadenceUnitSchema.optional(),
    minCount: z.number().int().min(0).optional(),
    maxCount: z.number().int().min(0).nullable().optional(),
    isActive: z.boolean().optional(),
    note: z.string().max(2000).nullable().optional(),
  })
  .refine(
    (p) =>
      p.maxCount === undefined ||
      p.maxCount === null ||
      p.minCount === undefined ||
      p.maxCount >= p.minCount,
    { message: "maxCount must be >= minCount or null", path: ["maxCount"] }
  );
export type PatchProjectGoalPayload = z.infer<typeof patchProjectGoalPayloadSchema>;

/** Sub-budget map; keys must be valid content types. */
export const perTypeMaxEurSchema = z.record(contentTypeSchema, z.number().positive());
export type PerTypeMaxEur = z.infer<typeof perTypeMaxEurSchema>;

/** PUT /planner-config — full upsert (any missing field is taken as default). */
export const projectPlannerConfigSchema = z.object({
  weeklyBudgetEur: z.number().positive(),
  perTypeMaxEur: perTypeMaxEurSchema.nullable().optional(),
  topNSignalsAllowedOverage: z.number().int().min(0).default(3),
  maxOveragePerSignal: z.number().int().min(0).default(1),
  // Spec 62.7: per-project weekly cron trigger for PlanWeekPipeline.
  // dayOfWeek follows JS Date.getUTCDay() — 0=Sunday..6=Saturday. The pattern
  // `0 <hourUtc> * * <dayOfWeek>` is derived in upsertProjectPlannerConfig.
  cronEnabled: z.boolean().default(false),
  cronDayOfWeek: z.number().int().min(0).max(6).default(0),
  cronHourUtc: z.number().int().min(0).max(23).default(18),
  // Spec 63.3b: per-project weekly cron trigger for discoverComparisonPairs().
  // Default Sunday 06:00 UTC (12h before the planner cron) — OFF by default.
  comparisonCronEnabled: z.boolean().default(false),
  comparisonCronDayOfWeek: z.number().int().min(0).max(6).default(0),
  comparisonCronHourUtc: z.number().int().min(0).max(23).default(6),
  // Spec 63.4: per-project cron trigger for the trend-synthesizer. Unlike the
  // two above, dayOfWeek is nullable — null means daily ("0 H * * *"),
  // 0..6 means weekly ("0 H * * DOW"). Default daily 01:00 UTC.
  trendSynthCronEnabled: z.boolean().default(false),
  trendSynthCronDayOfWeek: z.number().int().min(0).max(6).nullable().default(null),
  trendSynthCronHourUtc: z.number().int().min(0).max(23).default(1),
  // Spec 63.5: planner topic-diversity modifier. Stored as numeric(4,3) on
  // the DB side; the API takes / returns JS numbers and the helper coerces
  // at the boundary. Both default to 0.5 (moderate diversity, half-weight).
  diversityThreshold: z.number().min(0).max(1).default(0.5),
  diversityMalusWeight: z.number().min(0).max(2).default(0.5),
  // Spec 64.19 / Phase D: per-project override for trend-score weights.
  // Stored as JSONB on project_planner_config (migration 0104). Partial —
  // unset knobs fall back to score.ts W constant. `null` clears the column.
  trendScoreWeights: trendScoreWeightsSchema.nullable().optional(),
  // Spec 64.21: per-project override for star-trend detection knobs.
  // Stored as JSONB on project_planner_config (migration 0111). Partial —
  // unset knobs fall back to DEFAULT_STAR_TREND_CONFIG. `null` clears.
  starTrendConfig: starTrendConfigSchema.nullable().optional(),
});
export type ProjectPlannerConfigInput = z.infer<typeof projectPlannerConfigSchema>;
