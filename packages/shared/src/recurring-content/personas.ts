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
  "solopreneurs",
  "marketers",
  "developers",
  "designers",
  "teachers",
  "creators",
  "writers",
  "translators",
  "musicians",
  "craftsmen",
  "consultants",
  "researchers",
] as const;

export type DefaultPersona = (typeof DEFAULT_PERSONAS)[number];

/**
 * Spec 65.3 — natural-language persona definitions used to seed the
 * persona-scoring LLM prompt. Output is bilingual: the prompt itself stays
 * English (per the root CLAUDE.md rule), but the definitions describe
 * German-language audience segments since Toolwiki is DE-first.
 *
 * BK and future tenants may override the persona list AND definitions via a
 * future per-project config; this constant is the v1 default-set.
 */
export const PERSONA_DEFINITIONS: Record<DefaultPersona, string> = {
  beginners:
    "People just starting with AI tools — no technical background, want simple UIs and clear onboarding.",
  students:
    "Pupils and university students using AI for learning, research, essays, and homework.",
  parents:
    "Parents using AI for family organisation, kids' activities, household planning, and everyday admin.",
  solopreneurs:
    "Freelancers and solo founders using AI as a productivity multiplier across writing, admin, sales, and ops.",
  marketers:
    "Marketing professionals using AI for content production, analytics, SEO, ad creative, and automation.",
  developers:
    "Software engineers using AI as a coding assistant, architecture sounding-board, and code-review partner.",
  designers:
    "Designers using AI for visual creation, ideation, asset generation, and design-system maintenance.",
  teachers:
    "Teachers and educators using AI for lesson prep, materials, feedback, and student-engagement ideas.",
  creators:
    "Content creators (video, audio, text) using AI for production, editing, scripting, and asset enrichment.",
  writers:
    "Authors, copywriters, and journalists using AI for drafting, editing, research, and style refinement.",
  translators:
    "Professional translators and localisation specialists using AI for translation drafts, glossaries, terminology checks, and post-editing of MT output.",
  musicians:
    "Musicians, producers, and DJs using AI for sound design, stem separation, mixing assistance, cover art, lyrics, and release promotion.",
  craftsmen:
    "Tradespeople and craftsmen (electricians, plumbers, carpenters, etc.) using AI for quote drafting, customer communication, documentation, photo-based estimating, and admin paperwork.",
  consultants:
    "Independent consultants and advisors using AI for research synthesis, slide preparation, client deliverables, and proposal writing.",
  researchers:
    "Academic and industry researchers using AI for literature reviews, data analysis, paper drafting, and structured note-taking.",
};
