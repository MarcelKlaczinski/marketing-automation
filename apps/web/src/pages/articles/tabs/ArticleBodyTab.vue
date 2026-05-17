<template>
  <div class="article-body-tab">
    <div class="body-toolbar">
      <div class="toolbar-info mono">
        <span>{{ wordCount }} {{ $t("articles.bodyEditor.words") as string }}</span>
        <span class="sep">·</span>
        <span>{{ charCount }} {{ $t("articles.bodyEditor.chars") as string }}</span>
        <span v-if="isDirty" class="dirty-dot" aria-hidden="true">●</span>
      </div>
      <div class="toolbar-actions">
        <GlassButton
          v-if="isDirty"
          variant="ghost"
          size="sm"
          @click="onCancel"
        >
          {{ $t("articles.bodyEditor.cancel") as string }}
        </GlassButton>
        <GlassButton
          variant="primary"
          size="sm"
          :disabled="!isDirty"
          :loading="saving"
          @click="onSave"
        >
          {{ $t("articles.bodyEditor.save") as string }}
        </GlassButton>
      </div>
    </div>

    <div class="body-editor-wrap">
      <div ref="editorEl" class="body-editor" />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, markRaw } from "vue";
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { apiPost } from "src/lib/api";
import GlassButton from "src/components/ui/GlassButton.vue";

export default defineComponent({
  name: "ArticleBodyTab",

  components: { GlassButton },

  emits: ["saved"],

  props: {
    articleId: { type: String, required: true },
    bodyMd: { type: String, default: null },
  },

  data: () => ({
    // markRaw prevents Vue from making the EditorView reactive, which would
    // break CodeMirror's internal state machine. Cast at call-site as needed.
    editor: null as ReturnType<typeof markRaw> | null,
    currentValue: "",
    originalValue: "",
    saving: false,
  }),

  computed: {
    isDirty(): boolean {
      return this.currentValue !== this.originalValue;
    },
    wordCount(): number {
      return this.currentValue.trim() === ""
        ? 0
        : this.currentValue.trim().split(/\s+/).length;
    },
    charCount(): number {
      return this.currentValue.length;
    },
  },

  watch: {
    articleId: {
      handler(): void {
        this.initEditor();
      },
    },
    bodyMd: {
      handler(newVal: string | null): void {
        // Re-init when prop arrives (initial load or article switch)
        const incoming = newVal ?? "";
        if (incoming !== this.originalValue) {
          this.originalValue = incoming;
          this.currentValue = incoming;
          this.resetEditorContent(incoming);
        }
      },
    },
  },

  mounted() {
    this.initEditor();
  },

  beforeUnmount() {
    // Cast needed: markRaw proxy is structurally incompatible with EditorView
    (this.editor as unknown as EditorView | null)?.destroy();
  },

  methods: {
    initEditor(): void {
      (this.editor as unknown as EditorView | null)?.destroy();

      const initialDoc = this.bodyMd ?? "";
      this.originalValue = initialDoc;
      this.currentValue = initialDoc;

      const self = this;
      const state = EditorState.create({
        doc: initialDoc,
        extensions: [
          basicSetup,
          markdown(),
          oneDark,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              self.currentValue = update.state.doc.toString();
            }
          }),
          EditorView.theme({
            "&": {
              height: "100%",
              fontSize: "13px",
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

      this.editor = markRaw(
        new EditorView({ state, parent: editorEl }),
      );
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
    },

    async onSave(): Promise<void> {
      if (!this.isDirty) return;
      this.saving = true;
      try {
        await apiPost(`/articles/${this.articleId}/body`, {
          bodyMd: this.currentValue,
          changeReason: "manual_edit",
        });
        this.originalValue = this.currentValue;
        this.$emit("saved");
      } finally {
        this.saving = false;
      }
    },
  },
});
</script>

<style scoped>
.article-body-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.body-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-glass);
  flex-shrink: 0;
}

.toolbar-info {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-tertiary);
}

.sep {
  color: var(--border-medium);
}

.dirty-dot {
  color: var(--accent-primary);
  margin-left: 4px;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.body-editor-wrap {
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

.body-editor {
  height: 100%;
}

/* Ensure CodeMirror fills its container */
.body-editor :deep(.cm-editor) {
  height: 100%;
}

.body-editor :deep(.cm-scroller) {
  height: 100%;
  overflow: auto;
}
</style>
