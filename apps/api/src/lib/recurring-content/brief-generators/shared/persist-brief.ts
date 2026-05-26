/**
 * Spec 65.5 — INSERT a recurring-content brief into `topic_briefs`.
 *
 * Approval flow (Marcel-Decision §0): always `plan_pending` — Marcel reviews
 * every recurring brief before it lands as a `planned_item` in the next plan.
 * `recurring_metadata` carries the typed bucket (definitionId, runNumber,
 * frozen formatType + formatConfig, selectedTemplateKey, optional hookData).
 *
 * The brief is `clusterAction: 'standalone'` — recurring briefs are not
 * Spoke / cluster work and have no Hub anchor. `clusterId` stays NULL.
 */
import {
  db,
  type RecurringContentDefinition,
  type TopicBrief,
  topicBriefs,
  TopicBriefInsertSchema,
} from "@marketing-auto/db";

export interface PersistRecurringBriefInput {
  projectId: string;
  definition: RecurringContentDefinition;
  /** Free-text brief body — what the LLM generated for downstream article/social. */
  briefText: string;
  /** Headline shown in the planner card + brief detail view. */
  topicTitle: string;
  /** Tool IDs that landed in the brief (frozen at emit time). */
  toolIds: string[];
  /** Locale for the brief — drives the downstream article/social locale. */
  locale: "de" | "en";
  selectedTemplate: {
    templateKey: string;
    selectedVia: "fixed" | "lru" | "llm-rank";
    reasoning?: string;
  };
  /**
   * End-slide pick (Spec 65.9) — frozen into recurringMetadata.formatConfig so
   * the 65.7 renderer reads the same `{ type, config }` shape it would have
   * gotten from a fresh selector call at render time. Optional for back-compat
   * with any caller that may not yet have wired the selector (skipped on
   * Spec-65.5-only paths until 65.7 templates land).
   */
  selectedEndSlide?: {
    endSlideDefinitionId: string;
    endSlideType: string;
    config: Record<string, unknown>;
    name: string;
    selectedVia: "lru-within-pool" | "format-type-default";
  };
  /** Family B only — picked hook + render result. */
  hookData?: { hookId: string; pattern: string; rendered: string };
  runNumber: number;
  /** Tool IDs from the previous run of this definition (LRU bias for next run). */
  previousToolIds?: string[];
  /**
   * Spec 65.V1.5a Bridge #3 — shared UUID across sibling briefs from the
   * same multi-locale fire. Frozen into `recurring_metadata.runGroupId` so
   * downstream tooling can detect DE+EN twins. Optional for back-compat with
   * pre-bridge callers that emit a single brief per fire.
   */
  runGroupId?: string;
}

export async function persistRecurringBrief(
  input: PersistRecurringBriefInput,
): Promise<TopicBrief> {
  // Compose the frozen `format_config` snapshot — mirrors the definition row
  // plus the selected template + hook for downstream replay.
  // `formatConfig` is typed `Record<string, unknown>` via Drizzle `$type<>()`
  // — no cast needed.
  const frozenFormatConfig: Record<string, unknown> = {
    ...input.definition.formatConfig,
    outputTargets: input.definition.outputTargets,
    selectedTemplateKey: input.selectedTemplate.templateKey,
    selectedTemplateVia: input.selectedTemplate.selectedVia,
    ...(input.selectedTemplate.reasoning && {
      selectedTemplateReasoning: input.selectedTemplate.reasoning,
    }),
    ...(input.selectedEndSlide && {
      selectedEndSlide: {
        endSlideDefinitionId: input.selectedEndSlide.endSlideDefinitionId,
        type: input.selectedEndSlide.endSlideType,
        config: input.selectedEndSlide.config,
        name: input.selectedEndSlide.name,
        selectedVia: input.selectedEndSlide.selectedVia,
      },
    }),
    ...(input.hookData && { hookData: input.hookData }),
    toolIds: input.toolIds,
  };

  const insertCandidate = {
    projectId: input.projectId,
    source: "recurring" as const,
    topicTitle: input.topicTitle,
    locale: input.locale,
    clusterAction: "standalone" as const,
    approvalRequired: true,
    approvalStatus: "plan_pending" as const,
    suggestedMeta: input.briefText.slice(0, 280),
    recurringMetadata: {
      definitionId: input.definition.id,
      runNumber: input.runNumber,
      previousToolIds: input.previousToolIds ?? [],
      formatType: input.definition.formatType,
      formatConfig: frozenFormatConfig,
      // Bridge #3 multi-locale fan-out — only stamp when present so
      // single-locale fires keep producing the pre-bridge metadata shape.
      ...(input.runGroupId !== undefined && { runGroupId: input.runGroupId }),
      ...(input.locale === "de" || input.locale === "en"
        ? { targetLocale: input.locale }
        : {}),
    },
  };

  // Run through the canonical insert schema to enforce superRefine
  // invariants (source='recurring' ⇔ recurringMetadata != null + nothing
  // else). The parse also strips undefined fields the Drizzle insert can't
  // handle under `exactOptionalPropertyTypes`.
  const parsed = TopicBriefInsertSchema.parse(insertCandidate);

  type DrizzleInsert = typeof topicBriefs.$inferInsert;
  const row = Object.fromEntries(
    Object.entries(parsed).filter(([, v]) => v !== undefined),
  ) as DrizzleInsert;

  const inserted = await db
    .insert(topicBriefs)
    .values(row)
    .returning();
  const persisted = inserted[0];
  if (!persisted) {
    throw new Error("persistRecurringBrief: INSERT returned no row");
  }
  return persisted;
}
