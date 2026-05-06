<template>
  <div class="markdown-editor">
    <!-- Toolbar -->
    <div class="markdown-editor__toolbar">
      <template v-for="item in toolbarItems" :key="item.id">
        <button
          class="toolbar-btn"
          type="button"
          :title="$t(item.i18nKey) + (item.shortcut ? ` (${formatShortcut(item.shortcut)})` : '')"
          :disabled="!editorView"
          @click="onToolbarClick(item)"
        >
          <q-icon :name="item.iconName" size="18px" />
        </button>
        <div v-if="item.dividerAfter" class="toolbar-divider" />
      </template>
    </div>

    <!-- Tabs -->
    <div class="markdown-editor__tabs">
      <button
        :class="['tab-btn', { 'tab-btn--active': mode === 'edit' }]"
        type="button"
        @click="mode = 'edit'"
      >
        <q-icon name="edit" size="14px" class="q-mr-xs" />
        {{ $t('markdownEditor.editTab') }}
      </button>
      <button
        :class="['tab-btn', { 'tab-btn--active': mode === 'preview' }]"
        type="button"
        @click="mode = 'preview'"
      >
        <q-icon name="visibility" size="14px" class="q-mr-xs" />
        {{ $t('markdownEditor.previewTab') }}
      </button>
      <button
        :class="['tab-btn', { 'tab-btn--active': mode === 'split' }]"
        type="button"
        @click="mode = 'split'"
      >
        <q-icon name="splitscreen" size="14px" class="q-mr-xs" />
        {{ $t('markdownEditor.splitTab') }}
      </button>
    </div>

    <!-- Body -->
    <div
      :class="['markdown-editor__body', `markdown-editor__body--${mode}`]"
      :style="{ height: `${height}px` }"
    >
      <div v-if="mode === 'edit' || mode === 'split'" class="markdown-editor__editor-pane">
        <Codemirror
          v-model="localValue"
          :extensions="extensions"
          :style="{ height: '100%' }"
          @ready="onCmReady"
          @change="onChange"
        />
      </div>
      <div
        v-if="mode === 'preview' || mode === 'split'"
        class="markdown-editor__preview markdown-body"
        v-html="rendered"
      />
    </div>

    <!-- Link Dialog -->
    <q-dialog v-model="linkDialogOpen">
      <q-card style="min-width: 360px;">
        <q-card-section>
          <div class="text-h6">{{ $t('markdownEditor.linkDialog.title') }}</div>
        </q-card-section>
        <q-card-section class="q-gutter-md">
          <q-input
            v-model="linkDialog.text"
            outlined
            dense
            :label="$t('markdownEditor.linkDialog.text') as string"
            autofocus
          />
          <q-input
            v-model="linkDialog.url"
            outlined
            dense
            :label="$t('markdownEditor.linkDialog.url') as string"
            :placeholder="$t('markdownEditor.linkDialog.urlPlaceholder') as string"
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat :label="$t('common.cancel') as string" v-close-popup />
          <q-btn
            color="primary"
            :label="$t('markdownEditor.linkDialog.insert') as string"
            :disable="!linkDialog.url"
            @click="confirmLinkInsert"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Table Dialog -->
    <q-dialog v-model="tableDialogOpen">
      <q-card style="min-width: 320px;">
        <q-card-section>
          <div class="text-h6">{{ $t('markdownEditor.tableDialog.title') }}</div>
        </q-card-section>
        <q-card-section class="q-gutter-md">
          <q-input
            v-model.number="tableDialog.rows"
            outlined
            dense
            type="number"
            :min="1"
            :max="20"
            :label="$t('markdownEditor.tableDialog.rows') as string"
            autofocus
          />
          <q-input
            v-model.number="tableDialog.cols"
            outlined
            dense
            type="number"
            :min="1"
            :max="10"
            :label="$t('markdownEditor.tableDialog.cols') as string"
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat :label="$t('common.cancel') as string" v-close-popup />
          <q-btn
            color="primary"
            :label="$t('markdownEditor.tableDialog.insert') as string"
            @click="confirmTableInsert"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script lang="ts">
import { defineComponent, markRaw } from 'vue';
import { Codemirror } from 'vue-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, historyKeymap, history } from '@codemirror/commands';
import { marked } from 'marked';
import {
  TOOLBAR_ITEMS,
  insertLink,
  insertTable,
  type ToolbarItem,
} from './markdown-editor-toolbar-config';

export default defineComponent({
  name: 'MarkdownEditor',

  components: { Codemirror },

  props: {
    modelValue: { type: String, default: '' },
    height: { type: Number, default: 320 },
  },

  emits: ['update:modelValue', 'blur'],

  data() {
    const isDark = document.body.classList.contains('body--dark');

    const baseTheme = EditorView.theme({
      '&': {
        fontSize: '14px',
        height: '100%',
      },
      '.cm-content': {
        fontFamily: '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
      },
      '.cm-scroller': {
        lineHeight: '1.55',
        overflow: 'auto',
      },
      '.cm-editor': {
        height: '100%',
      },
      '.cm-editor.cm-focused': {
        outline: 'none',
      },
    });

    const toolbarKeymap = TOOLBAR_ITEMS.filter((it) => it.shortcut).map((it) => ({
      key: it.shortcut!,
      run: (view: EditorView) => {
        const dispatch = (kind: 'table' | 'link') => {
          // data() properties aren't in scope at keymap-build time; cast is safe — these keys are defined in the return below
          if (kind === 'link') (this as unknown as { linkDialogOpen: boolean }).linkDialogOpen = true;
          if (kind === 'table') (this as unknown as { tableDialogOpen: boolean }).tableDialogOpen = true;
        };
        return it.action(view, dispatch);
      },
    }));

    return {
      mode: 'edit' as 'edit' | 'preview' | 'split',
      localValue: this.modelValue,
      editorView: null as EditorView | null,
      toolbarItems: TOOLBAR_ITEMS,
      linkDialogOpen: false,
      tableDialogOpen: false,
      linkDialog: { text: '', url: '' },
      tableDialog: { rows: 3, cols: 3 },
      isMac: /Mac|iPod|iPhone|iPad/.test(navigator.platform),
      extensions: markRaw([
        markdown(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...toolbarKeymap]),
        baseTheme,
        EditorView.lineWrapping,
        ...(isDark ? [oneDark] : []),
      ]),
    };
  },

  computed: {
    rendered(): string {
      const r = marked.parse(this.localValue);
      return typeof r === 'string' ? r : '';
    },
  },

  watch: {
    modelValue(newVal: string): void {
      if (newVal !== this.localValue) {
        this.localValue = newVal;
      }
    },
  },

  methods: {
    formatShortcut(shortcut: string): string {
      const modKey = this.isMac ? 'Cmd' : 'Ctrl';
      return shortcut.replace('Mod', modKey).replace('-', '+').toUpperCase();
    },

    onChange(value: string): void {
      this.localValue = value;
      this.$emit('update:modelValue', value);
    },

    onCmReady(payload: { view: EditorView }): void {
      this.editorView = markRaw(payload.view) as EditorView;
      payload.view.dom.addEventListener('blur', () => {
        this.$emit('blur');
      }, true);
    },

    onToolbarClick(item: ToolbarItem): void {
      if (!this.editorView) return;
      // markRaw prevents deep proxying at runtime, but Vue's reactive typing still wraps the stored value
      const view = this.editorView as unknown as EditorView;
      item.action(view, (kind) => {
        if (kind === 'link') {
          const selected = view.state.sliceDoc(
            view.state.selection.main.from,
            view.state.selection.main.to,
          );
          this.linkDialog.text = selected;
          this.linkDialog.url = '';
          this.linkDialogOpen = true;
        }
        if (kind === 'table') {
          this.tableDialogOpen = true;
        }
      });
    },

    confirmLinkInsert(): void {
      if (!this.editorView) return;
      // same markRaw proxy-typing issue as onToolbarClick
      insertLink(this.editorView as unknown as EditorView, this.linkDialog.text, this.linkDialog.url);
      this.linkDialogOpen = false;
      this.linkDialog = { text: '', url: '' };
    },

    confirmTableInsert(): void {
      if (!this.editorView) return;
      const rows = Math.max(1, Math.min(20, this.tableDialog.rows));
      const cols = Math.max(1, Math.min(10, this.tableDialog.cols));
      // same markRaw proxy-typing issue as onToolbarClick
      insertTable(this.editorView as unknown as EditorView, rows, cols);
      this.tableDialogOpen = false;
    },
  },
});
</script>

<style lang="scss" scoped>
.markdown-editor {
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 8px;
  overflow: hidden;
  background: var(--q-card-bg, #fff);
  display: flex;
  flex-direction: column;

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }
}

.markdown-editor__toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  padding: 4px 6px;
  gap: 2px;
  border-bottom: 1px solid var(--q-grey-3, #e0e0e0);
  background: var(--q-grey-1, #fafafa);

  body.body--dark & {
    border-bottom-color: rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.02);
  }
}

.toolbar-btn {
  background: none;
  border: none;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.7));
  display: inline-flex;
  align-items: center;
  justify-content: center;

  &:hover:not(:disabled) {
    background: rgba(0, 0, 0, 0.05);
    color: var(--q-primary);

    body.body--dark & {
      background: rgba(255, 255, 255, 0.06);
    }
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.toolbar-divider {
  width: 1px;
  height: 18px;
  background: var(--q-grey-3, #e0e0e0);
  margin: 0 4px;

  body.body--dark & {
    background: rgba(255, 255, 255, 0.1);
  }
}

.markdown-editor__tabs {
  display: flex;
  border-bottom: 1px solid var(--q-grey-3, #e0e0e0);
  background: var(--q-grey-1, #fafafa);

  body.body--dark & {
    border-bottom-color: rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.03);
  }
}

.tab-btn {
  background: none;
  border: none;
  padding: 10px 16px;
  font-size: 13px;
  cursor: pointer;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.65));
  border-bottom: 2px solid transparent;
  transition: all 0.15s;
  display: flex;
  align-items: center;

  &:hover {
    color: var(--q-primary);
  }

  &--active {
    color: var(--q-primary);
    border-bottom-color: var(--q-primary);
  }
}

/* Scroll fix: constrain the body height so CodeMirror scrolls internally */
.markdown-editor__body {
  display: grid;
  min-height: 0;
  flex: 1 1 auto;
  overflow: hidden;

  &--edit,
  &--preview {
    grid-template-columns: 1fr;
  }

  &--split {
    grid-template-columns: 1fr 1fr;
  }
}

.markdown-editor__editor-pane {
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;

  :deep(.v-codemirror) {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  :deep(.cm-editor) {
    flex: 1 1 auto;
    min-height: 0;
  }
}

.markdown-editor__preview {
  padding: 16px 24px;
  overflow-y: auto;
  border-left: 1px solid var(--q-grey-3, #e0e0e0);

  body.body--dark & {
    border-left-color: rgba(255, 255, 255, 0.06);
  }

  .markdown-editor__body--preview & {
    border-left: none;
  }
}

.markdown-body {
  font-family: -apple-system, system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.6;

  :deep(h1) { font-size: 22px; font-weight: 600; margin: 16px 0 8px; }
  :deep(h2) { font-size: 18px; font-weight: 600; margin: 14px 0 8px; }
  :deep(h3) { font-size: 16px; font-weight: 600; margin: 12px 0 6px; }
  :deep(p) { margin: 0 0 12px; }
  :deep(ul),
  :deep(ol) { margin: 0 0 12px; padding-left: 24px; }

  :deep(code) {
    background: rgba(0, 0, 0, 0.06);
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 13px;
    font-family: monospace;
  }

  :deep(pre) {
    background: rgba(0, 0, 0, 0.04);
    padding: 12px;
    border-radius: 6px;
    overflow-x: auto;
  }

  :deep(blockquote) {
    border-left: 3px solid var(--q-primary);
    padding-left: 12px;
    color: var(--q-text-secondary, rgba(0, 0, 0, 0.7));
    margin: 0 0 12px;
  }

  :deep(table) {
    border-collapse: collapse;
    margin: 0 0 12px;
    font-size: 13px;
  }

  :deep(th),
  :deep(td) {
    border: 1px solid var(--q-grey-3, #e0e0e0);
    padding: 6px 10px;
    text-align: left;

    body.body--dark & {
      border-color: rgba(255, 255, 255, 0.1);
    }
  }

  :deep(th) {
    background: var(--q-grey-1, #fafafa);
    font-weight: 600;

    body.body--dark & {
      background: rgba(255, 255, 255, 0.05);
    }
  }

  :deep(a) {
    color: var(--q-primary);
    text-decoration: none;

    &:hover { text-decoration: underline; }
  }
}
</style>
