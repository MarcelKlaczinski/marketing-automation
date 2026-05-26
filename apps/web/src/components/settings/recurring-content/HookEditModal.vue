<template>
  <q-dialog v-model="visible" persistent @hide="onClose">
    <q-card class="edit-card" dark>
      <q-card-section class="header">
        <h2 class="card-title">{{ titleLabel }}</h2>
      </q-card-section>

      <q-card-section class="body">
        <label class="field">
          <span class="label">{{ $t("recurringContent.hooks.edit.fields.formatType") as string }}</span>
          <select v-model="form.formatType" :disabled="!!hook" class="select-input">
            <option v-for="ft in formatTypes" :key="ft" :value="ft">
              {{ $t(`recurringContent.definitions.formatType.${ft}`) as string }}
            </option>
          </select>
        </label>

        <label class="field">
          <span class="label">{{ $t("recurringContent.hooks.edit.fields.language") as string }}</span>
          <select v-model="form.language" :disabled="!!hook" class="select-input">
            <option value="de">{{ $t("recurringContent.hooks.languageDe") as string }}</option>
            <option value="en">{{ $t("recurringContent.hooks.languageEn") as string }}</option>
          </select>
        </label>

        <label class="field">
          <span class="label">{{ $t("recurringContent.hooks.edit.fields.pattern") as string }}</span>
          <textarea
            v-model="form.pattern"
            class="pattern-input mono"
            rows="3"
            spellcheck="false"
          />
          <small class="hint">{{ $t("recurringContent.hooks.edit.fields.patternHint") as string }}</small>
        </label>

        <label class="field">
          <span class="label">{{ $t("recurringContent.hooks.edit.fields.variables") as string }}</span>
          <input v-model="form.variablesRaw" type="text" class="text-input" placeholder="tool, profession" />
          <small class="hint">{{ $t("recurringContent.hooks.edit.fields.variablesHint") as string }}</small>
        </label>

        <section class="preview">
          <div class="preview-heading">
            {{ $t("recurringContent.hooks.edit.previewHeading") as string }}
          </div>
          <div class="preview-output mono">{{ renderedPreview }}</div>
          <small class="hint">{{ $t("recurringContent.hooks.edit.previewHint") as string }}</small>
        </section>

        <label class="checkbox-row">
          <input v-model="form.isActive" type="checkbox" />
          <span>{{ $t("recurringContent.hooks.edit.fields.isActive") as string }}</span>
        </label>
      </q-card-section>

      <q-card-actions class="actions" align="right">
        <q-btn flat :label="$t('recurringContent.hooks.edit.cancel') as string" @click="onClose" />
        <q-btn
          color="primary"
          :loading="saving"
          :disable="saving"
          :label="$t('recurringContent.hooks.edit.save') as string"
          @click="save"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import { apiPatch, apiPost } from "src/lib/api";

interface HookTemplate {
  id: string;
  formatType: string;
  pattern: string;
  language: "de" | "en";
  variables: string[];
  isActive: boolean;
}

export default defineComponent({
  name: "HookEditModal",

  props: {
    slug: { type: String, required: true },
    hook: { type: Object as PropType<HookTemplate | null>, default: null },
    formatTypes: { type: Array as PropType<string[]>, required: true },
    defaultFormatType: { type: String, default: "story_arc_clickbait" },
    defaultLanguage: { type: String as PropType<"de" | "en">, default: "de" },
  },

  emits: ["close", "saved"],

  data() {
    const h = this.hook;
    return {
      visible: true,
      saving: false,
      form: {
        formatType: h?.formatType ?? this.defaultFormatType,
        language: h?.language ?? this.defaultLanguage,
        pattern: h?.pattern ?? "",
        variablesRaw: (h?.variables ?? []).join(", "),
        isActive: h?.isActive ?? true,
      },
    };
  },

  computed: {
    titleLabel(): string {
      return this.hook
        ? (this.$t("recurringContent.hooks.edit.titleEdit") as string)
        : (this.$t("recurringContent.hooks.edit.titleCreate") as string);
    },
    /**
     * Pure-substitution preview mirrors `renderHook` from
     * `apps/api/src/lib/hook-library/render-hook.ts`. Sample values from i18n
     * keep it locale-aware without an LLM round-trip.
     */
    renderedPreview(): string {
      const samples = (this.$t("recurringContent.hooks.samples") as unknown) as Record<
        string,
        string
      >;
      let rendered = this.form.pattern;
      const placeholders = this.form.pattern.matchAll(
        /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g,
      );
      for (const m of placeholders) {
        const name = m[1];
        if (!name) continue;
        const value = samples[name] ?? `<${name}>`;
        rendered = rendered.replaceAll(`{${name}}`, value);
      }
      return rendered;
    },
  },

  methods: {
    onClose(): void {
      this.visible = false;
      this.$emit("close");
    },

    async save(): Promise<void> {
      this.saving = true;
      try {
        const variables = this.form.variablesRaw
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        if (this.hook) {
          await apiPatch(`/projects/${this.slug}/hooks/${this.hook.id}`, {
            pattern: this.form.pattern,
            variables,
            isActive: this.form.isActive,
          });
        } else {
          await apiPost(`/projects/${this.slug}/hooks`, {
            formatType: this.form.formatType,
            language: this.form.language,
            pattern: this.form.pattern,
            variables,
            isActive: this.form.isActive,
          });
        }
        this.$q.notify({
          type: "positive",
          message: this.$t("recurringContent.hooks.edit.saveSuccess") as string,
        });
        this.$emit("saved");
      } catch (err) {
        this.$q.notify({
          type: "negative",
          message: this.$t("recurringContent.hooks.edit.saveFailed") as string,
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
.text-input, .select-input, .pattern-input {
  background: var(--bg-glass-strong);
  color: var(--text-primary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  font-size: 13px;
}
.pattern-input {
  resize: vertical;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12px;
}
.hint { font-size: 11px; color: var(--text-tertiary); }
.checkbox-row { display: flex; align-items: center; gap: 8px; font-size: 13px; }

.preview {
  background: var(--bg-glass-strong);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 12px;
}
.preview-heading { font-size: 12px; color: var(--text-secondary); margin-bottom: 6px; }
.preview-output {
  color: var(--text-primary);
  font-size: 14px;
  margin-bottom: 4px;
  min-height: 1.5em;
}
.actions { padding: 14px 20px; border-top: 1px solid var(--border-subtle); }
.mono { font-family: var(--font-mono, ui-monospace, monospace); }
</style>
