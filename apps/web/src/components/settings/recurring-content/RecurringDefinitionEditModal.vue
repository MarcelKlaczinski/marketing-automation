<template>
  <q-dialog v-model="visible" persistent @hide="onClose">
    <q-card class="edit-card" dark>
      <q-card-section class="header">
        <h2 class="card-title">
          {{ titleLabel }}
        </h2>
      </q-card-section>

      <q-card-section class="body">
        <label class="field">
          <span class="label">{{ $t("recurringContent.definitions.create.fields.name") as string }}</span>
          <input v-model="form.name" type="text" class="text-input" maxlength="120" />
          <small class="hint">{{ $t("recurringContent.definitions.create.fields.nameHint") as string }}</small>
        </label>

        <label class="field">
          <span class="label">{{ $t("recurringContent.definitions.create.fields.formatType") as string }}</span>
          <select v-model="form.formatType" class="select-input">
            <option v-for="ft in formatTypes" :key="ft.key" :value="ft.key">
              {{ $t(`recurringContent.definitions.formatType.${ft.key}`) as string }}
              ·
              {{ $t(`recurringContent.definitions.family.${ft.family}`) as string }}
            </option>
          </select>
          <small class="hint">{{ $t("recurringContent.definitions.create.fields.formatTypeHint") as string }}</small>
        </label>

        <label class="field">
          <span class="label">{{ $t("recurringContent.definitions.create.fields.frequency") as string }}</span>
          <input v-model="form.frequency" type="text" class="text-input" />
          <small class="hint">{{ $t("recurringContent.definitions.create.fields.frequencyHint") as string }}</small>
        </label>

        <label class="field">
          <span class="label">{{ $t("recurringContent.definitions.create.fields.nextRunAt") as string }}</span>
          <input v-model="form.nextRunAt" type="datetime-local" class="text-input" />
        </label>

        <div class="field-row">
          <label class="checkbox-row">
            <input v-model="form.outputTargetsArticle" type="checkbox" />
            <span>{{ $t("recurringContent.definitions.create.fields.outputTargetsArticle") as string }}</span>
          </label>
          <label class="checkbox-row">
            <input v-model="form.outputTargetsSocial" type="checkbox" />
            <span>{{ $t("recurringContent.definitions.create.fields.outputTargetsSocial") as string }}</span>
          </label>
        </div>

        <label class="field">
          <span class="label">{{ $t("recurringContent.definitions.create.fields.templateStrategy") as string }}</span>
          <select v-model="form.templateSelectionStrategy" class="select-input">
            <option value="fixed">{{ $t("recurringContent.definitions.templateStrategy.fixed") as string }}</option>
            <option value="lru">{{ $t("recurringContent.definitions.templateStrategy.lru") as string }}</option>
            <option value="llm-picks">{{ $t("recurringContent.definitions.templateStrategy.llm-picks") as string }}</option>
            <option value="latest">{{ $t("recurringContent.definitions.templateStrategy.latest") as string }}</option>
          </select>
          <small class="hint">{{ $t("recurringContent.definitions.create.fields.templateStrategyHint") as string }}</small>
        </label>

        <label v-if="form.templateSelectionStrategy === 'fixed'" class="field">
          <span class="label">{{ $t("recurringContent.definitions.create.fields.fixedTemplateKey") as string }}</span>
          <select v-model="form.fixedTemplateKey" class="select-input">
            <option v-for="tpl in eligibleTemplates" :key="tpl" :value="tpl">
              {{ tpl }}
            </option>
          </select>
        </label>

        <label class="field">
          <span class="label">{{ $t("recurringContent.definitions.create.fields.endSlideStrategy") as string }}</span>
          <select v-model="form.endSlideStrategy" class="select-input">
            <option value="rotation">{{ $t("recurringContent.definitions.endSlideStrategy.rotation") as string }}</option>
          </select>
          <small class="hint">{{ $t("recurringContent.definitions.create.fields.endSlideStrategyHint") as string }}</small>
        </label>

        <div class="field">
          <span class="label">{{ $t("recurringContent.definitions.create.fields.endSlidePool") as string }}</span>
          <q-select
            v-model="form.endSlidePool"
            :options="endSlideOptions"
            :loading="loadingEndSlides"
            multiple
            use-chips
            use-input
            emit-value
            map-options
            dense
            outlined
            dark
            input-debounce="0"
            :placeholder="$t('recurringContent.definitions.create.fields.endSlidePoolPlaceholder') as string"
          />
          <small class="hint">{{ $t("recurringContent.definitions.create.fields.endSlidePoolHint") as string }}</small>
        </div>

        <label class="field">
          <span class="label">{{ $t("recurringContent.definitions.create.fields.formatConfig") as string }}</span>
          <textarea
            v-model="form.formatConfigJson"
            class="json-input mono"
            rows="8"
            spellcheck="false"
          />
          <small class="hint">{{ $t("recurringContent.definitions.create.fields.formatConfigHint") as string }}</small>
          <small v-if="jsonError" class="hint error">{{ jsonError }}</small>

          <details class="schema-block">
            <summary>{{ $t("recurringContent.definitions.create.formatConfigSchemaHeading") as string }}</summary>
            <pre class="schema-sample mono">{{ schemaSample }}</pre>
          </details>
        </label>

        <label class="checkbox-row">
          <input v-model="form.isActive" type="checkbox" />
          <span>{{ $t("recurringContent.definitions.create.fields.isActive") as string }}</span>
        </label>
      </q-card-section>

      <q-card-actions class="actions" align="right">
        <q-btn flat :label="$t('recurringContent.definitions.create.cancel') as string" @click="onClose" />
        <q-btn
          color="primary"
          :loading="saving"
          :disable="saving || !!jsonError"
          :label="saving ? ($t('recurringContent.definitions.create.saving') as string) : ($t('recurringContent.definitions.create.save') as string)"
          @click="save"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import { apiGet, apiPatch, apiPost } from "src/lib/api";

interface EndSlideOption {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
}

interface FormatTypeInfo {
  key: string;
  family: "A" | "B";
  eligibleTemplates: string[];
  needsHooks: boolean;
  defaultEndSlides: string[];
}

interface RecurringDefinition {
  id: string;
  name: string;
  formatType: string;
  formatConfig: Record<string, unknown>;
  frequency: string;
  nextRunAt: string;
  outputTargets: { article: boolean; social: boolean };
  templateSelectionStrategy: "fixed" | "lru" | "llm-picks" | "latest";
  fixedTemplateKey: string | null;
  endSlideStrategy: string;
  endSlidePool: string[];
  isActive: boolean;
}

/**
 * Sample format-config snippets shown under the JSON editor as a "starter
 * template" so Marcel doesn't need to remember every field's name. These are
 * intentionally light (3-4 lines each) — the canonical Zod schemas live in
 * `packages/shared/src/format-types/` and surface their full errors on save.
 */
/**
 * Module-level helper because `data()` may not call component methods
 * (root CLAUDE.md DO-NOT — methods aren't attached when `data()` runs).
 * Returns the parsed JSON sample for `formatType`, or `{}` on unknown / parse
 * fail. Also used by the `watch:` block where pulling a method off `this`
 * would work but the module-level form keeps the call sites symmetric.
 */
function defaultConfigForFormatType(formatType: string): Record<string, unknown> {
  const raw = SCHEMA_SAMPLES[formatType];
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const SCHEMA_SAMPLES: Record<string, string> = {
  top_n_comparison: `{
  "topN": 5,
  "categorySlug": "llm",
  "excludeRecentlyUsed": true
}`,
  head_to_head: `{
  "toolAId": "<uuid>",
  "toolBId": "<uuid>",
  "angleHint": "pricing-focused"
}`,
  story_arc_clickbait: `{
  "toolToFeature": "<tool-uuid>",
  "professionPool": ["Texter", "Designer", "Entwickler"],
  "narrativeAngle": "loss-and-recovery",
  "toneIntensity": "medium"
}`,
  lifestyle_listicle: `{
  "lifeArea": "Alltag",
  "itemCount": 5,
  "toolFilter": { "categorySlugs": ["productivity"] }
}`,
  opinion_recommendation: `{
  "recommendedToolId": "<tool-uuid>",
  "opinionStance": "enthusiastic",
  "affiliateAngle": false
}`,
};

export default defineComponent({
  name: "RecurringDefinitionEditModal",

  props: {
    slug: { type: String, required: true },
    definition: {
      type: Object as PropType<RecurringDefinition | null>,
      default: null,
    },
    formatTypes: {
      type: Array as PropType<FormatTypeInfo[]>,
      required: true,
    },
  },

  emits: ["close", "saved"],

  data() {
    const def = this.definition;
    const initialFormatType =
      def?.formatType ?? this.formatTypes[0]?.key ?? "top_n_comparison";
    const initialConfig =
      def?.formatConfig ?? defaultConfigForFormatType(initialFormatType);
    return {
      visible: true,
      saving: false,
      jsonError: null as string | null,
      availableEndSlides: [] as EndSlideOption[],
      loadingEndSlides: false,
      form: {
        name: def?.name ?? "",
        formatType: initialFormatType,
        frequency: def?.frequency ?? "weekly",
        nextRunAt: def
          ? new Date(def.nextRunAt).toISOString().slice(0, 16)
          : new Date(Date.now() + 60_000).toISOString().slice(0, 16),
        outputTargetsArticle: def?.outputTargets.article ?? false,
        outputTargetsSocial: def?.outputTargets.social ?? true,
        templateSelectionStrategy: def?.templateSelectionStrategy ?? "lru",
        fixedTemplateKey: def?.fixedTemplateKey ?? null,
        endSlideStrategy: def?.endSlideStrategy ?? "rotation",
        endSlidePool: def?.endSlidePool ?? [],
        formatConfigJson: JSON.stringify(initialConfig, null, 2),
        isActive: def?.isActive ?? true,
      },
    };
  },

  computed: {
    titleLabel(): string {
      return this.definition
        ? (this.$t("recurringContent.definitions.create.titleEdit") as string)
        : (this.$t("recurringContent.definitions.create.title") as string);
    },
    selectedFormatTypeInfo(): FormatTypeInfo | null {
      return this.formatTypes.find((f) => f.key === this.form.formatType) ?? null;
    },
    eligibleTemplates(): string[] {
      return this.selectedFormatTypeInfo?.eligibleTemplates ?? [];
    },
    schemaSample(): string {
      return (
        SCHEMA_SAMPLES[this.form.formatType] ??
        '{\n  // permissive fallback — see packages/shared/src/format-types\n}'
      );
    },
    endSlideOptions(): Array<{ label: string; value: string }> {
      // Sort by type, then name, so similar end-slides cluster together in the dropdown.
      // Inactive rows stay selectable so re-opening an old definition doesn't silently drop a known-but-disabled pick.
      const sorted = [...this.availableEndSlides].sort(
        (a, b) =>
          a.type.localeCompare(b.type) || a.name.localeCompare(b.name),
      );
      return sorted.map((es) => {
        const inactiveSuffix = es.isActive
          ? ""
          : ` (${this.$t("recurringContent.definitions.endSlideOption.inactive") as string})`;
        return {
          label: `${es.name} · ${es.type}${inactiveSuffix}`,
          value: es.id,
        };
      });
    },
  },

  mounted() {
    void this.loadEndSlides();
  },

  watch: {
    "form.formatType": function (newType: string, oldType: string) {
      // When user switches format-type during create, swap the JSON sample.
      // Don't clobber existing JSON during edit (their current config may
      // still be valid for the new type or they may want to migrate manually).
      if (!this.definition && newType !== oldType) {
        const sample = defaultConfigForFormatType(newType);
        this.form.formatConfigJson = JSON.stringify(sample, null, 2);
      }
    },
    "form.formatConfigJson": function () {
      this.validateJson();
    },
  },

  methods: {
    async loadEndSlides(): Promise<void> {
      this.loadingEndSlides = true;
      try {
        const res = await apiGet<{ endSlides: EndSlideOption[] }>(
          `/projects/${this.slug}/end-slides?includeInactive=true`,
        );
        this.availableEndSlides = res.endSlides;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "load_failed";
        this.$q.notify({
          type: "negative",
          message: this.$t(
            "recurringContent.definitions.create.endSlidesLoadFailed",
          ) as string,
          caption: msg,
        });
      } finally {
        this.loadingEndSlides = false;
      }
    },

    validateJson(): boolean {
      try {
        JSON.parse(this.form.formatConfigJson);
        this.jsonError = null;
        return true;
      } catch {
        this.jsonError = this.$t(
          "recurringContent.definitions.create.formatConfigJsonInvalid",
        ) as string;
        return false;
      }
    },

    onClose(): void {
      this.visible = false;
      this.$emit("close");
    },

    async save(): Promise<void> {
      if (!this.validateJson()) return;
      this.saving = true;
      try {
        const formatConfig = JSON.parse(this.form.formatConfigJson) as Record<
          string,
          unknown
        >;
        const endSlidePool = this.form.endSlidePool;
        const payload: Record<string, unknown> = {
          name: this.form.name,
          formatType: this.form.formatType,
          formatConfig,
          frequency: this.form.frequency,
          nextRunAt: new Date(this.form.nextRunAt).toISOString(),
          outputTargets: {
            article: this.form.outputTargetsArticle,
            social: this.form.outputTargetsSocial,
          },
          templateSelectionStrategy: this.form.templateSelectionStrategy,
          endSlideStrategy: this.form.endSlideStrategy,
          endSlidePool,
          isActive: this.form.isActive,
        };
        if (
          this.form.templateSelectionStrategy === "fixed" &&
          this.form.fixedTemplateKey
        ) {
          payload.fixedTemplateKey = this.form.fixedTemplateKey;
        }

        if (this.definition) {
          await apiPatch(
            `/projects/${this.slug}/recurring-content/definitions/${this.definition.id}`,
            payload,
          );
        } else {
          await apiPost(
            `/projects/${this.slug}/recurring-content/definitions`,
            payload,
          );
        }

        this.$q.notify({
          type: "positive",
          message: this.$t(
            "recurringContent.definitions.create.saveSuccess",
          ) as string,
        });
        this.$emit("saved");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "save_failed";
        this.$q.notify({
          type: "negative",
          message: this.$t(
            "recurringContent.definitions.create.saveFailed",
          ) as string,
          caption: msg,
        });
      } finally {
        this.saving = false;
      }
    },
  },
});
</script>

<style scoped>
.edit-card {
  width: min(640px, 96vw);
  max-height: 90vh;
  overflow-y: auto;
}
.header {
  border-bottom: 1px solid var(--border-subtle);
}
.card-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}
.body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.field-row {
  display: flex;
  gap: 20px;
}
.label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}
.text-input,
.select-input,
.json-input {
  background: var(--bg-glass-strong);
  color: var(--text-primary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  font-size: 13px;
}
.json-input {
  resize: vertical;
  min-height: 120px;
}
.mono {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12px;
}
.hint {
  font-size: 11px;
  color: var(--text-tertiary);
}
.hint.error {
  color: var(--color-danger, #e44);
}
.checkbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.schema-block {
  margin-top: 6px;
  font-size: 12px;
}
.schema-block summary {
  cursor: pointer;
  color: var(--text-secondary);
}
.schema-sample {
  background: var(--bg-base);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 10px;
  margin-top: 6px;
  white-space: pre;
  overflow-x: auto;
  color: var(--text-secondary);
}
.actions {
  padding: 14px 20px;
  border-top: 1px solid var(--border-subtle);
}
</style>
