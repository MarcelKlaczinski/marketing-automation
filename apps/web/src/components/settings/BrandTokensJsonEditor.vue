<template>
  <div class="brand-tokens-json-editor">
    <p class="json-description">{{ $t("settings.brandTokens.advancedDescription") as string }}</p>

    <div class="editor-wrap">
      <div ref="editorEl" class="json-editor" />
    </div>

    <div v-if="parseError" class="json-error">
      {{ $t("settings.brandTokens.jsonInvalid") as string }}
    </div>

    <div class="json-actions">
      <GlassButton
        v-if="isDirty"
        variant="ghost"
        size="sm"
        @click="onCancel"
      >
        {{ $t("common.cancel") as string }}
      </GlassButton>
      <GlassButton
        variant="primary"
        size="sm"
        :disabled="!isDirty || parseError"
        :loading="saving"
        @click="onSave"
      >
        {{ $t("common.save") as string }}
      </GlassButton>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, markRaw } from "vue";
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { json } from "@codemirror/lang-json";
import { oneDark } from "@codemirror/theme-one-dark";
import { apiGet, apiPatch } from "src/lib/api";
import { useRoute } from "vue-router";
import { useQueryClient } from "@tanstack/vue-query";
import GlassButton from "src/components/ui/GlassButton.vue";

export default defineComponent({
  name: "BrandTokensJsonEditor",

  components: { GlassButton },

  emits: ["saved"],

  setup() {
    const route = useRoute();
    const queryClient = useQueryClient();
    return { slug: route.params.slug as string, queryClient };
  },

  data: () => ({
    // markRaw prevents Vue from making EditorView reactive — breaks CodeMirror internals
    editor: null as ReturnType<typeof markRaw> | null,
    currentValue: "{}",
    originalValue: "{}",
    parseError: false,
    saving: false,
  }),

  computed: {
    isDirty(): boolean {
      return this.currentValue !== this.originalValue;
    },
  },

  mounted() {
    void this.loadAndInit();
  },

  beforeUnmount() {
    // Cast needed: markRaw proxy is structurally incompatible with EditorView
    (this.editor as unknown as EditorView | null)?.destroy();
  },

  methods: {
    async loadAndInit(): Promise<void> {
      const resp = await apiGet<{ tokens: Record<string, unknown>; defaults: Record<string, unknown> }>(
        `/projects/${this.slug}/brand-tokens`,
      );
      const doc = JSON.stringify(resp.tokens, null, 2);
      this.originalValue = doc;
      this.currentValue = doc;
      this.initEditor(doc);
    },

    initEditor(doc: string): void {
      (this.editor as unknown as EditorView | null)?.destroy();

      const self = this;
      const state = EditorState.create({
        doc,
        extensions: [
          basicSetup,
          json(),
          oneDark,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              self.currentValue = update.state.doc.toString();
              try {
                JSON.parse(self.currentValue);
                self.parseError = false;
              } catch {
                self.parseError = true;
              }
            }
          }),
          EditorView.theme({
            "&": {
              height: "100%",
              fontSize: "12px",
              fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            },
            ".cm-content": { padding: "16px" },
            ".cm-focused": { outline: "none" },
            ".cm-scroller": { overflow: "auto" },
          }),
        ],
      });

      const editorEl = this.$refs.editorEl as HTMLElement | undefined;
      if (!editorEl) return;

      this.editor = markRaw(new EditorView({ state, parent: editorEl }));
    },

    resetEditorContent(doc: string): void {
      const view = this.editor as unknown as EditorView | null;
      if (!view) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: doc },
      });
    },

    onCancel(): void {
      this.resetEditorContent(this.originalValue);
      this.currentValue = this.originalValue;
      this.parseError = false;
    },

    async onSave(): Promise<void> {
      if (!this.isDirty || this.parseError) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(this.currentValue);
      } catch {
        this.parseError = true;
        return;
      }
      this.saving = true;
      try {
        await apiPatch(`/projects/${this.slug}/brand-tokens`, {
          tokens: parsed,
        });
        this.originalValue = this.currentValue;
        await this.queryClient.invalidateQueries({
          queryKey: ["brand-tokens", this.slug],
        });
        this.$emit("saved");
      } finally {
        this.saving = false;
      }
    },
  },
});
</script>

<style scoped>
.brand-tokens-json-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.json-description {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
}

.editor-wrap {
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  overflow: hidden;
  min-height: 400px;
}

.json-editor {
  height: 400px;
}

.json-error {
  font-size: 12px;
  color: var(--color-error, #e53e3e);
  padding: 4px 0;
}

.json-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>
