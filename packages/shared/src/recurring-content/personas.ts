/**
 * Spec 65.1 — Default personas for the Theme 65 recurring-content system.
 *
 * Per Marcel-Decision Q5, personas are project-scoped (see
 * `tool_persona_scores` composite PK). This list is the *seed* — 65.3
 * backfill scripts INSERT one row per (tool × project × persona) at onboarding.
 * Projects may add custom personas later; this constant is only the v1
 * default-set for fresh-tenant bootstrap.
 *
 * Adding a persona here does NOT retroactively seed existing tenants — that
 * requires a project-level "rescore-for-new-persona" command (out of scope
 * for 65.1).
 */
export const DEFAULT_PERSONAS = [
  "beginners",
  "students",
  "parents",
  "seniors",
  "solopreneurs",
  "marketers",
  "developers",
  "designers",
  "teachers",
  "creators",
] as const;

export type DefaultPersona = (typeof DEFAULT_PERSONAS)[number];
