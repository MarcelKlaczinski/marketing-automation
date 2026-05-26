/**
 * Spec 65.9 — End-Slide selector for recurring-content briefs.
 *
 * Two-strategy fallback (the spec considered a Layer-0 `fixed` strategy but
 * `recurring_content_definitions` has no `fixedEndSlideId` column yet; add it
 * in V1.5 if Marcel needs hard-pinning):
 *
 *   - **Strategy 1 — Definition pool:** when `definition.endSlidePool` is
 *     non-empty, filter `end_slide_definitions` to those IDs (active +
 *     project-scoped) → LRU within pool. If the pool resolves to zero active
 *     candidates (orphan IDs, all soft-deleted), fall through to Strategy 2
 *     instead of throwing — pool-rot shouldn't break brief generation.
 *
 *   - **Strategy 2 — Format-type defaults:** read
 *     `FORMAT_TYPES[formatType].defaultEndSlides` (Spec 65.4 registry) and
 *     filter the project's active `end_slide_definitions` to those types.
 *     LRU among them. Throws when the project has no active definitions
 *     matching ANY of the registry's default types — that's a configuration
 *     bug a Marcel-side migration must fix (the 0121 seed addresses it for
 *     Toolwiki).
 *
 * **LRU implementation** uses `listRecentTemplateUsage` (Spec 65.1 +
 * `template_usage_log.end_slide_type`) per definition. The picker drops
 * candidates whose **type** appears in the recent slice, then returns the
 * first remaining. Tie-break: declaration order from the DB (createdAt ASC,
 * already enforced by `listEndSlideDefinitions`). Cold-start fallback when
 * every type was recently used: return `candidates[0]` — preserves declared
 * order so the seed-row order acts as a deterministic backup.
 *
 * Project-scope safety: `definition.projectId` must match `input.projectId` or
 * the helper throws. Mirrors the multi-tenant guard in `pickHook` /
 * `pickToolsForBrief`.
 */
import {
  type EndSlideDefinition,
  type RecurringContentDefinition,
  listEndSlideDefinitions,
  listRecentTemplateUsage,
} from "@marketing-auto/db";
import { FORMAT_TYPES, createLogger } from "@marketing-auto/shared";

const log = createLogger("recurring-content:select-end-slide");

export type EndSlideSelectedVia = "lru-within-pool" | "format-type-default";

export interface SelectedEndSlide {
  endSlideDefinitionId: string;
  endSlideType: string;
  /** Raw jsonb config — pipeline consumers parse via END_SLIDE_CONFIG_SCHEMAS[type]. */
  config: Record<string, unknown>;
  /** Display name from the DB row — useful for audit logs + planner UI. */
  name: string;
  selectedVia: EndSlideSelectedVia;
  reasoning: string;
}

export interface SelectEndSlideInput {
  definition: RecurringContentDefinition;
  projectId: string;
}

export class NoEligibleEndSlidesError extends Error {
  readonly formatType: string;
  readonly attemptedTypes: string[];
  constructor(formatType: string, attemptedTypes: string[]) {
    super(
      `No active end_slide_definitions match defaultEndSlides for format-type '${formatType}': [${attemptedTypes.join(", ")}]`,
    );
    this.name = "NoEligibleEndSlidesError";
    this.formatType = formatType;
    this.attemptedTypes = attemptedTypes;
  }
}

/**
 * Pure LRU pick: drops candidates whose `type` is in `recentlyUsedTypes`,
 * returns the first remaining. Cold-start fallback to `candidates[0]` when
 * everything has been used recently.
 *
 * Exported for unit-test coverage of the pick logic without touching DB.
 */
export function pickLruEndSlide(
  candidates: EndSlideDefinition[],
  recentlyUsedTypes: Set<string>,
): EndSlideDefinition {
  if (candidates.length === 0) {
    throw new Error("pickLruEndSlide: candidates array unexpectedly empty");
  }
  const fresh = candidates.find((c) => !recentlyUsedTypes.has(c.type));
  return fresh ?? (candidates[0] as EndSlideDefinition);
}

export async function selectEndSlideForRecurringBrief(
  input: SelectEndSlideInput,
): Promise<SelectedEndSlide> {
  const { definition, projectId } = input;

  // Multi-tenant guard (mirrors pickToolsForBrief / pickHook).
  if (definition.projectId !== projectId) {
    throw new Error(
      `selectEndSlideForRecurringBrief: definition.projectId (${definition.projectId}) does not match input.projectId (${projectId})`,
    );
  }

  // Load all active end-slide-definitions ONCE — both strategies filter from
  // the same set so a single DB call suffices.
  const allActive = await listEndSlideDefinitions({
    projectId,
    includeInactive: false,
  });

  // ── Strategy 1: definition pool ──────────────────────────────────────────
  if (definition.endSlidePool && definition.endSlidePool.length > 0) {
    const poolIds = new Set(definition.endSlidePool);
    const inPool = allActive.filter((e) => poolIds.has(e.id));

    if (inPool.length > 0) {
      const recentTypes = await loadRecentlyUsedEndSlideTypes(
        definition.id,
        inPool.length,
      );
      const picked = pickLruEndSlide(inPool, recentTypes);
      return {
        endSlideDefinitionId: picked.id,
        endSlideType: picked.type,
        config: picked.config,
        name: picked.name,
        selectedVia: "lru-within-pool",
        reasoning: `LRU within definition.endSlidePool (${inPool.length} active candidates)`,
      };
    }

    log.warn(
      {
        definitionId: definition.id,
        poolSize: definition.endSlidePool.length,
        activeMatches: 0,
      },
      "definition.endSlidePool resolved to 0 active candidates — falling through to format-type defaults",
    );
  }

  // ── Strategy 2: format-type defaults ────────────────────────────────────
  const formatTypeDef = FORMAT_TYPES[definition.formatType];
  if (!formatTypeDef) {
    throw new Error(
      `selectEndSlideForRecurringBrief: format-type '${definition.formatType}' is not in FORMAT_TYPES registry`,
    );
  }
  const defaultTypes = formatTypeDef.defaultEndSlides;
  if (defaultTypes.length === 0) {
    throw new Error(
      `selectEndSlideForRecurringBrief: format-type '${definition.formatType}' has empty defaultEndSlides`,
    );
  }

  const defaultTypeSet = new Set(defaultTypes);
  const eligibleByDefault = allActive.filter((e) => defaultTypeSet.has(e.type));

  if (eligibleByDefault.length === 0) {
    throw new NoEligibleEndSlidesError(definition.formatType, defaultTypes);
  }

  const recentTypes = await loadRecentlyUsedEndSlideTypes(
    definition.id,
    eligibleByDefault.length,
  );
  const picked = pickLruEndSlide(eligibleByDefault, recentTypes);

  return {
    endSlideDefinitionId: picked.id,
    endSlideType: picked.type,
    config: picked.config,
    name: picked.name,
    selectedVia: "format-type-default",
    reasoning: `LRU among format-type defaultEndSlides [${defaultTypes.join(", ")}] (${eligibleByDefault.length} active candidates)`,
  };
}

/**
 * Load the most-recent `endSlideType` values from `template_usage_log` for
 * this definition. Used to skip recently-rendered types. We pull
 * `candidatesLength` entries so even when every candidate has been used at
 * some point, the picker can still find a fresh one if at least one TYPE
 * outside the recent window survives.
 *
 * NULL endSlideType values (pre-65.9 rows + manual log writes that skip the
 * field) are filtered out so they don't accidentally block a type from being
 * picked.
 */
async function loadRecentlyUsedEndSlideTypes(
  definitionId: string,
  candidatesLength: number,
): Promise<Set<string>> {
  // Keep at least one slot uncovered: same idiom as `select-template.ts`'s
  // `limit: Math.max(eligible.length - 1, 1)`. Ensures we never block every
  // type for a definition with only 1-2 candidates.
  const limit = Math.max(candidatesLength - 1, 1);
  const recent = await listRecentTemplateUsage({
    recurringDefinitionId: definitionId,
    limit,
  });
  const types = new Set<string>();
  for (const row of recent) {
    if (row.endSlideType) types.add(row.endSlideType);
  }
  return types;
}
