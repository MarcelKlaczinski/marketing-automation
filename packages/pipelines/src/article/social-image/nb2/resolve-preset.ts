/**
 * Spec 65.16 — Shared helper for the 3-tier preset cascade.
 *
 * Called from both `StageFamilyBImagesStep` (to drive the NB2 prompt) AND
 * `RenderSlidesStep` (to plumb into the Family-B render snapshot so future
 * text-overlay tokens match the NB2 image). Resolving in two places is
 * cheaper than ad-hoc passing through pipeline state — the resolution is
 * 2 indexed DB lookups (projects + recurring_content_definitions), both
 * already cached by Drizzle's connection pool.
 *
 * Tier priority (later wins):
 *   1. project.socialImageStylePreset             (NOT NULL DEFAULT)
 *   2. definition.socialImageStylePresetOverride  (nullable)
 *   3. recurring.formatConfig.imageStylePreset    (content-level choice)
 *
 * Pure mechanical resolution — no side effects, no LLM calls.
 */
import {
  DEFAULT_PRESET_KEY,
  isPresetKey,
  type PresetKey,
} from "@marketing-auto/social/presets/catalog";
import { db, eq, projects, recurringContentDefinitions } from "@marketing-auto/db";

export interface ResolvePresetForArticleInput {
  projectId: string;
  /** From `articles.domain_extras.recurring.definitionId`. Optional — null for ad-hoc renders. */
  definitionId?: string | null;
  /** From `articles.domain_extras.recurring.formatConfig.imageStylePreset`. */
  contentLevelChoice?: string | null;
}

export async function resolvePresetForArticle(
  input: ResolvePresetForArticleInput,
): Promise<PresetKey> {
  // Content-level explicit choice wins.
  if (
    typeof input.contentLevelChoice === "string" &&
    isPresetKey(input.contentLevelChoice)
  ) {
    return input.contentLevelChoice;
  }

  // Definition override second.
  if (input.definitionId) {
    const [defRow] = await db
      .select({
        override: recurringContentDefinitions.socialImageStylePresetOverride,
      })
      .from(recurringContentDefinitions)
      .where(eq(recurringContentDefinitions.id, input.definitionId))
      .limit(1);
    if (defRow?.override && isPresetKey(defRow.override)) {
      return defRow.override;
    }
  }

  // Project default last.
  const [projectRow] = await db
    .select({ socialImageStylePreset: projects.socialImageStylePreset })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);
  if (projectRow?.socialImageStylePreset && isPresetKey(projectRow.socialImageStylePreset)) {
    return projectRow.socialImageStylePreset;
  }

  // Defensive — should never trigger (DB CHECK enforces valid values).
  return DEFAULT_PRESET_KEY;
}
