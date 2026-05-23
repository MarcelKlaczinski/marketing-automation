/**
 * Spec multi-domain-evolution S4.4 — Per-tenant LLM-prompt variables.
 *
 * Replaces 9 hardcoded "toolwiki.ai" / "AI tool wiki" / "AI/ML tools" /
 * "German AI tools niche" / "KI-Tools" strings across the article + social-
 * image + trend-discovery pipelines with project-resolved values.
 *
 * Resolution chain:
 *   1. `projects.domain` (real DB column) → `domain` (e.g. "toolwiki.ai")
 *   2. `projects.targetNiche` (real DB column) → keyed lookup into
 *      `NICHE_PROMPT_VARS` for the niche-specific labels + scope strings
 *   3. Fallback: Toolwiki defaults when `targetNiche` is null/unknown
 *      (preserves zero-regression for Toolwiki without requiring a backfill)
 *
 * Byte-equivalence for Toolwiki is the hard contract — every Toolwiki
 * value below resolves to the legacy hardcoded substring captured in
 * `__tests__/snapshots/baseline-toolwiki-prompts.json`. Adding a new
 * tenant = add one entry to NICHE_PROMPT_VARS keyed by the tenant's
 * `targetNiche` column value.
 */
import { db, eq, projects } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("pipelines:tenant-prompt-vars");

/**
 * Per-niche variable bundle injected into LLM prompts. All fields are
 * REQUIRED — partial niche maps are a deliberate type-error to catch
 * forgotten translations when onboarding a new tenant.
 */
export interface TenantPromptVars {
  /** Bare hostname, e.g. "toolwiki.ai". From `projects.domain`. */
  domain: string;
  /**
   * Article-prompt scope label, e.g. "an AI tool wiki" (Toolwiki) or
   * "ein Balkonkraftwerk-Affiliate-Magazin" (BK). Injected after the
   * domain in lead sentences like "an article for ${domain} — ${nicheArticle}".
   */
  nicheArticle: string;
  /**
   * Niche-scope description for the SCOPE-CHECK guard rails. Toolwiki:
   * "AI/ML tools, AI features, AI concepts, or AI use cases". BK might be
   * "Balkonkraftwerke, Solarmodule, Wechselrichter, Speicher, Installation".
   */
  nicheContentScope: string;
  /**
   * Short scope label used in shorter sentences ("primarily about ${nicheScopeShort}").
   * Toolwiki: "AI/ML". BK: "Balkonkraftwerk-Themen".
   */
  nicheScopeShort: string;
  /**
   * Comma-separated example items for whitelist-style scope guards.
   * Toolwiki: "ChatGPT, Claude, Midjourney, Cursor". BK: "Anker SOLIX, EcoFlow PowerStream".
   */
  nicheExampleEntities: string;
  /**
   * Knowledge-collection-specific niche label used in ki-wissen prompts.
   * Toolwiki: "knowledge pillar". BK: "Ratgeber-Pillar".
   */
  knowledgePillarLabel: string;
  /**
   * Comparison-collection scope label. Toolwiki: "2-4 named AI tools".
   * BK: "2-4 Produkte".
   */
  comparisonEntityLabel: string;
  /**
   * Social-image editor scope, e.g. "comparison-grid-4 Instagram slide" — the
   * sub-noun used in "You are an editor for ${domain}. Create content for
   * a ${socialEditorNiche}." Today identical across tenants but kept here
   * so future tenants can localize.
   */
  socialEditorScope: string;
  /**
   * Niche descriptor for the Instagram hook-prompt templates. Toolwiki:
   * "German AI tools niche". BK: "German balcony-solar niche".
   */
  socialHookNiche: string;
  /**
   * Fallback German keyword used in hookEngine.ts when `article.primaryKeyword`
   * is null + the hook template needs a single noun. Toolwiki: "KI-Tools".
   * BK: "Balkonkraftwerke".
   */
  nicheGermanKeyword: string;
}

/**
 * Niche-keyed lookup. The key is `projects.targetNiche` (existing column
 * from Spec 56 niche-context.ts). Toolwiki's `targetNiche="ai-tool-wiki"`
 * is the only seeded value in production today.
 *
 * Adding a tenant = one entry here. Every field must be filled — TS catches
 * a forgotten one because the type is required-shape.
 */
const NICHE_PROMPT_VARS: Record<string, TenantPromptVars> = {
  "ai-tool-wiki": {
    domain: "toolwiki.ai",
    nicheArticle: "an AI tool wiki",
    nicheContentScope: "AI/ML tools, AI features, AI concepts, or AI use cases",
    nicheScopeShort: "AI/ML",
    nicheExampleEntities: "ChatGPT, Claude, Midjourney, Cursor",
    knowledgePillarLabel: "knowledge pillar",
    comparisonEntityLabel: "2-4 named AI tools",
    socialEditorScope: "comparison-grid-4 Instagram slide",
    // Spec multi-domain-evolution S4.4: matches the live core/social-hooks/
    // hookPrompt.ts string "for the AI tools niche". The legacy pipelines/
    // social-image/hookPrompt.ts had "German AI tools niche" but that file
    // is dead code (no consumers per grep) — the live path is core's.
    socialHookNiche: "AI tools niche",
    nicheGermanKeyword: "KI-Tools",
  },
  // BK + future tenants extend this map as they onboard. Until they do,
  // they fall through to the Toolwiki defaults via the fallback below.
};

/**
 * The fallback when `projects.targetNiche` is null or unknown. Returns the
 * Toolwiki defaults so legacy projects (industry='ai_education', niche-
 * unset) continue to produce byte-identical prompts.
 */
function fallbackPromptVars(domain: string): TenantPromptVars {
  const toolwiki = NICHE_PROMPT_VARS["ai-tool-wiki"];
  if (!toolwiki) {
    throw new Error(
      "ai-tool-wiki niche missing from NICHE_PROMPT_VARS — this is the fallback baseline",
    );
  }
  return { ...toolwiki, domain };
}

/**
 * Loads the tenant prompt variables for a project. `domain` always comes
 * from the live `projects.domain` column; niche-specific fields come from
 * NICHE_PROMPT_VARS keyed by `projects.targetNiche`.
 *
 * When the project row is not found (offline tests, malformed projectId,
 * race during deletion), the helper logs a warn and returns the Toolwiki
 * defaults with a synthetic "example.com" domain — better to ship a
 * Toolwiki-shaped prompt than to fail the whole pipeline at a non-LLM
 * data-load step. Production tenants always have a real row + domain.
 */
export async function loadTenantPromptVars(projectId: string): Promise<TenantPromptVars> {
  const [row] = await db
    .select({ domain: projects.domain, targetNiche: projects.targetNiche })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!row) {
    log.warn(
      { projectId },
      "[tenant-prompt-vars] project not found — falling back to Toolwiki defaults",
    );
    return fallbackPromptVars("example.com");
  }

  // `projects.domain` defaults to `${slug}.example.com` for fresh test
  // projects (per Spec 64.3 setup-step fallback); production tenants always
  // have a real domain set. Use the column verbatim.
  const domain = row.domain ?? "example.com";

  if (row.targetNiche && NICHE_PROMPT_VARS[row.targetNiche]) {
    return { ...NICHE_PROMPT_VARS[row.targetNiche]!, domain };
  }
  return fallbackPromptVars(domain);
}

/**
 * Sync test helper — returns the variables for a known niche without a DB
 * round-trip. Use ONLY in test fixtures + the trend-synthesizer's
 * regression-guard tests where the niche key is hardcoded.
 */
export function tenantPromptVarsForNiche(niche: string, domain: string): TenantPromptVars {
  if (NICHE_PROMPT_VARS[niche]) return { ...NICHE_PROMPT_VARS[niche]!, domain };
  return fallbackPromptVars(domain);
}
