<template>
  <div class="pipeline-json-editor">
    <div ref="editorEl" class="json-editor" :class="{ 'read-only': readOnly }" />
    <div v-if="parseError && !readOnly" class="json-error">
      {{ $t("runs.actions.schemaInvalid") as string }}
    </div>
  </div>
</template>

<script lang="ts">
import { json as cmJson } from "@codemirror/lang-json";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, basicSetup } from "codemirror";
import { type PropType, defineComponent, markRaw } from "vue";

/**
 * Reusable CodeMirror JSON editor for step input/output/prompt inspection.
 * Pattern mirrors BrandTokensJsonEditor.vue (Spec 60.0) but read-only by default.
 *
 * `editor` is stored as a markRaw-wrapped EditorView; we cast at every call site
 * because Vue's reactive proxy is structurally incompatible with EditorView even
 * through markRaw (CodeMirror reads private state internals).
 */
export default defineComponent({
  name: "PipelineJsonEditor",

  props: {
    modelValue: { type: String, required: true },
    readOnly: { type: Boolean, default: false },
    minHeight: { type: Number, default: 200 },
    /** When true, the editor is parsed as JSON; otherwise it's treated as free text. */
    jsonMode: { type: Boolean, default: true },
    /** Optional Zod-like validator. Receives the parsed JSON; returns true or an error message. */
    validate: {
      type: Function as unknown as PropType<((value: unknown) => true | string) | null>,
      default: null,
    },
  },

  emits: ["update:modelValue", "parse-error"],

  data: () => ({
    editor: null as ReturnType<typeof markRaw> | null,
    parseError: false,
  }),

  watch: {
    modelValue(next: string) {
      const view = this.editor as unknown as EditorView | null;
      if (!view) return;
      if (view.state.doc.toString() === next) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
      });
    },
    readOnly() {
      // Re-init so the editable extension flips correctly.
      this.initEditor(this.modelValue);
    },
  },

  mounted() {
    this.initEditor(this.modelValue);
  },

  beforeUnmount() {
    (this.editor as unknown as EditorView | null)?.destroy();
  },

  methods: {
    initEditor(doc: string): void {
      (this.editor as unknown as EditorView | null)?.destroy();
      const extensions = [
        basicSetup,
        oneDark,
        EditorView.editable.of(!this.readOnly),
        EditorView.theme({
          "&": {
            fontSize: "12px",
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            minHeight: `${this.minHeight}px`,
          },
          ".cm-content": { padding: "12px" },
          ".cm-focused": { outline: "none" },
          ".cm-scroller": { overflow: "auto", maxHeight: "60vh" },
        }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || this.readOnly) return;
          const next = update.state.doc.toString();
          if (this.jsonMode) {
            try {
              const parsed = JSON.parse(next);
              if (this.validate) {
                const res = this.validate(parsed);
                this.parseError = res !== true;
                if (res !== true) this.$emit("parse-error", res);
              } else {
                this.parseError = false;
              }
            } catch {
              this.parseError = true;
              this.$emit("parse-error", "invalid_json");
            }
          } else {
            this.parseError = false;
          }
          this.$emit("update:modelValue", next);
        }),
      ];
      if (this.jsonMode) extensions.splice(1, 0, cmJson());

      const state = EditorState.create({ doc, extensions });
      const editorEl = this.$refs.editorEl as HTMLElement | undefined;
      if (!editorEl) return;
      this.editor = markRaw(new EditorView({ state, parent: editorEl }));
    },
  },
});
</script>

<style scoped>
.pipeline-json-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.json-editor {
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.json-editor.read-only :deep(.cm-editor) {
  opacity: 0.92;
}

.json-error {
  font-size: 12px;
  color: var(--color-error, #e53e3e);
}
</style>
