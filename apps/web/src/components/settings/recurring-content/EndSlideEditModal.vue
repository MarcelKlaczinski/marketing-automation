<template>
  <q-dialog v-model="visible" persistent @hide="onClose">
    <q-card class="edit-card" dark>
      <q-card-section class="header">
        <h2 class="card-title">{{ titleLabel }}</h2>
      </q-card-section>

      <q-card-section class="body">
        <label class="field">
          <span class="label">{{ $t("recurringContent.endSlides.edit.fields.name") as string }}</span>
          <input v-model="form.name" type="text" class="text-input" maxlength="120" />
        </label>

        <label class="field">
          <span class="label">
            {{ $t("recurringContent.endSlides.edit.fields.type") as string }}
            <small v-if="endSlide" class="hint inline">
              {{ $t("recurringContent.endSlides.edit.fields.typeImmutable") as string }}
            </small>
          </span>
          <select v-model="form.type" :disabled="!!endSlide" class="select-input">
            <option v-for="t in END_SLIDE_TYPE_KEYS" :key="t" :value="t">
              {{ $t(`recurringContent.endSlides.typeLabel.${t}`) as string }}
            </option>
          </select>
        </label>

        <label class="field">
          <span class="label">{{ $t("recurringContent.endSlides.edit.fields.config") as string }}</span>
          <textarea
            v-model="form.configJson"
            class="json-input mono"
            rows="6"
            spellcheck="false"
          />
          <small class="hint">{{ $t("recurringContent.endSlides.edit.fields.configHint") as string }}</small>
          <small v-if="jsonError" class="hint error">{{ jsonError }}</small>

          <details class="schema-block" open>
            <summary>{{ $t("recurringContent.endSlides.edit.schemaHeading") as string }}</summary>
            <pre class="schema-sample mono">{{ schemaSample }}</pre>
          </details>
        </label>

        <label class="checkbox-row">
          <input v-model="form.isActive" type="checkbox" />
          <span>{{ $t("recurringContent.endSlides.edit.fields.isActive") as string }}</span>
        </label>
      </q-card-section>

      <q-card-actions class="actions" align="right">
        <q-btn flat :label="$t('recurringContent.endSlides.edit.cancel') as string" @click="onClose" />
        <q-btn
          color="primary"
          :loading="saving"
          :disable="saving || !!jsonError"
          :label="$t('recurringContent.endSlides.edit.save') as string"
          @click="save"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import { apiPatch, apiPost } from "src/lib/api";

interface EndSlideDef {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  isActive: boolean;
}

/**
 * Mirrors `END_SLIDE_CONFIG_SCHEMAS` from `@marketing-auto/social/end-slide-components/types`
 * — kept inline in the web bundle so we don't pull the Remotion package in.
 * The backend Zod validation is the canonical source of truth; these samples
 * are only UI hints.
 */
const END_SLIDE_TYPE_KEYS = [
  "follow-cta",
  "comment-to-get",
  "link-in-bio",
  "tag-friend",
  "save-share-cta",
  "swipe-up",
  "quote-action",
] as const;

/**
 * Module-level helper for `data()`-time use (root CLAUDE.md DO-NOT — methods
 * aren't attached when `data()` runs). Pure read of SCHEMA_SAMPLES.
 */
function defaultConfigForEndSlideType(type: string): Record<string, unknown> {
  const raw = SCHEMA_SAMPLES[type];
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const SCHEMA_SAMPLES: Record<string, string> = {
  "follow-cta": `{
  "handle": "@toolwiki.ai",
  "customMessage": "Folge für mehr Tool-Tests"
}`,
  "comment-to-get": `{
  "keyword": "CLAUDE",
  "resourceTitle": "Claude Prompts Pack",
  "promptText": "Kommentiere CLAUDE"
}`,
  "link-in-bio": `{
  "description": "Vollständiger Vergleich auf toolwiki.ai",
  "url": "toolwiki.ai"
}`,
  "tag-friend": `{
  "prompt": "Wer braucht das?",
  "context": "Tagge jemanden aus deinem Team"
}`,
  "save-share-cta": `{
  "primaryAction": "save",
  "message": "Speichern für später"
}`,
  "swipe-up": `{
  "destination": "toolwiki.ai",
  "customMessage": "Mehr lesen"
}`,
  "quote-action": `{
  "quote": "Stop scrolling. Test es in 30 Sekunden.",
  "attribution": "— Marcel @ Toolwiki"
}`,
};

export default defineComponent({
  name: "EndSlideEditModal",

  props: {
    slug: { type: String, required: true },
    endSlide: { type: Object as PropType<EndSlideDef | null>, default: null },
  },

  emits: ["close", "saved"],

  data() {
    const es = this.endSlide;
    const initialType = es?.type ?? "follow-cta";
    return {
      visible: true,
      saving: false,
      jsonError: null as string | null,
      END_SLIDE_TYPE_KEYS,
      form: {
        name: es?.name ?? "",
        type: initialType,
        configJson: JSON.stringify(es?.config ?? defaultConfigForEndSlideType(initialType), null, 2),
        isActive: es?.isActive ?? true,
      },
    };
  },

  computed: {
    titleLabel(): string {
      return this.endSlide
        ? (this.$t("recurringContent.endSlides.edit.titleEdit") as string)
        : (this.$t("recurringContent.endSlides.edit.titleCreate") as string);
    },
    schemaSample(): string {
      return SCHEMA_SAMPLES[this.form.type] ?? "{}";
    },
  },

  watch: {
    "form.type": function (newType: string, oldType: string) {
      if (!this.endSlide && newType !== oldType) {
        this.form.configJson = JSON.stringify(defaultConfigForEndSlideType(newType), null, 2);
      }
    },
    "form.configJson": function () {
      this.validateJson();
    },
  },

  methods: {
    validateJson(): boolean {
      try {
        JSON.parse(this.form.configJson);
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
        const config = JSON.parse(this.form.configJson) as Record<string, unknown>;
        if (this.endSlide) {
          await apiPatch(`/projects/${this.slug}/end-slides/${this.endSlide.id}`, {
            name: this.form.name,
            config,
            isActive: this.form.isActive,
          });
        } else {
          await apiPost(`/projects/${this.slug}/end-slides`, {
            name: this.form.name,
            type: this.form.type,
            config,
            isActive: this.form.isActive,
          });
        }
        this.$q.notify({
          type: "positive",
          message: this.$t("recurringContent.endSlides.edit.saveSuccess") as string,
        });
        this.$emit("saved");
      } catch (err) {
        this.$q.notify({
          type: "negative",
          message: this.$t("recurringContent.endSlides.edit.saveFailed") as string,
          caption: err instanceof Error ? err.message : "",
        });
      } finally {
        this.saving = false;
      }
    },
  },
});
</script>

<style scoped>
.edit-card { width: min(560px, 96vw); }
.header { border-bottom: 1px solid var(--border-subtle); }
.card-title { margin: 0; font-size: 18px; font-weight: 600; }

.body { display: flex; flex-direction: column; gap: 14px; padding: 20px; }
.field { display: flex; flex-direction: column; gap: 4px; }
.label { font-size: 12px; font-weight: 500; color: var(--text-secondary); }
.hint.inline { margin-left: 6px; color: var(--text-tertiary); font-weight: 400; }
.text-input, .select-input, .json-input {
  background: var(--bg-glass-strong);
  color: var(--text-primary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  font-size: 13px;
}
.json-input { resize: vertical; min-height: 120px; font-family: var(--font-mono, ui-monospace, monospace); font-size: 12px; }
.hint { font-size: 11px; color: var(--text-tertiary); }
.hint.error { color: var(--color-danger, #e44); }
.checkbox-row { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.schema-block { margin-top: 6px; font-size: 12px; }
.schema-block summary { cursor: pointer; color: var(--text-secondary); }
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
.actions { padding: 14px 20px; border-top: 1px solid var(--border-subtle); }
.mono { font-family: var(--font-mono, ui-monospace, monospace); }
</style>
