<template>
  <span class="inline-edit">
    <input
      v-if="editing"
      ref="inputEl"
      v-model="draft"
      :maxlength="maxLength"
      :class="['inline-edit__input', { 'inline-edit__input--invalid': !isValid }]"
      type="text"
      @blur="onBlur"
      @keydown.enter.prevent="onConfirm"
      @keydown.escape.prevent="onCancel"
    />
    <span
      v-else
      class="inline-edit__display"
      tabindex="0"
      @click="onActivate"
      @keydown.enter="onActivate"
    >
      {{ value }}
      <q-icon name="edit" size="11px" class="inline-edit__icon" />
    </span>
  </span>
</template>

<script lang="ts">
import { defineComponent, nextTick } from 'vue';

export default defineComponent({
  name: 'InlineEdit',

  props: {
    value: { type: String, required: true },
    maxLength: { type: Number, default: 200 },
    minLength: { type: Number, default: 2 },
  },

  emits: ['save'],

  data() {
    return {
      editing: false,
      draft: '',
    };
  },

  computed: {
    isValid(): boolean {
      const trimmed = this.draft.trim();
      return trimmed.length >= this.minLength && trimmed.length <= this.maxLength;
    },
  },

  methods: {
    async onActivate(): Promise<void> {
      this.draft = this.value;
      this.editing = true;
      await nextTick();
      const input = this.$refs.inputEl as HTMLInputElement | undefined;
      if (input) {
        input.focus();
        input.select();
      }
    },

    onBlur(): void {
      this.onConfirm();
    },

    onConfirm(): void {
      const trimmed = this.draft.trim();
      if (!this.isValid) {
        this.editing = false;
        return;
      }
      if (trimmed !== this.value) {
        this.$emit('save', trimmed);
      }
      this.editing = false;
    },

    onCancel(): void {
      this.editing = false;
      this.draft = '';
    },
  },
});
</script>

<style lang="scss" scoped>
.inline-edit {
  display: inline-flex;
  align-items: center;
}

.inline-edit__display {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: text;
  padding: 2px 4px;
  margin: -2px -4px;
  border-radius: 4px;
  outline: none;

  &:hover,
  &:focus {
    background: rgba(0, 0, 0, 0.04);

    body.body--dark & {
      background: rgba(255, 255, 255, 0.04);
    }

    .inline-edit__icon {
      opacity: 0.6;
    }
  }
}

.inline-edit__icon {
  opacity: 0;
  transition: opacity 0.15s;
}

.inline-edit__input {
  font: inherit;
  color: inherit;
  background: var(--q-card-bg, #fff);
  border: 1.5px solid var(--q-primary);
  border-radius: 4px;
  padding: 1px 4px;
  outline: none;
  min-width: 100px;

  body.body--dark & {
    background: rgba(0, 0, 0, 0.3);
  }

  &--invalid {
    border-color: var(--q-negative);
  }
}
</style>
