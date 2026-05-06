<template>
  <div class="markdown-editor">
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

    <div
      :class="['markdown-editor__body', `markdown-editor__body--${mode}`]"
      :style="{ height: `${height}px` }"
    >
      <Codemirror
        v-if="mode === 'edit' || mode === 'split'"
        v-model="localValue"
        :extensions="extensions"
        :style="{ height: '100%' }"
        @ready="onCmReady"
        @change="onChange"
      />
      <div
        v-if="mode === 'preview' || mode === 'split'"
        class="markdown-editor__preview markdown-body"
        v-html="rendered"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, markRaw } from 'vue';
import { Codemirror } from 'vue-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import { marked } from 'marked';

export default defineComponent({
  name: 'MarkdownEditor',

  components: { Codemirror },

  props: {
    modelValue: { type: String, default: '' },
    height: { type: Number, default: 320 },
  },

  emits: ['update:modelValue', 'blur'],

  data() {
    const baseTheme = EditorView.theme({
      '&': { fontSize: '14px' },
      '.cm-content': {
        fontFamily: '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
      },
      '.cm-scroller': { lineHeight: '1.55' },
    });

    return {
      mode: 'edit' as 'edit' | 'preview' | 'split',
      localValue: this.modelValue,
      extensions: markRaw([
        markdown(),
        baseTheme,
        EditorView.lineWrapping,
        ...(document.body.classList.contains('body--dark') ? [oneDark] : []),
      ]),
    };
  },

  computed: {
    rendered(): string {
      const result = marked.parse(this.localValue);
      return typeof result === 'string' ? result : '';
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
    onChange(value: string): void {
      this.localValue = value;
      this.$emit('update:modelValue', value);
    },

    onCmReady(payload: { view: EditorView }): void {
      payload.view.dom.addEventListener(
        'blur',
        () => { this.$emit('blur'); },
        true,
      );
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

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
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

.markdown-editor__body {
  display: grid;

  &--edit,
  &--preview {
    grid-template-columns: 1fr;
  }

  &--split {
    grid-template-columns: 1fr 1fr;
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
}
</style>
