<template>
  <div class="filter-chip" :class="{ 'chip-active': !!value }">
    <button class="chip-label" @click="toggle">
      {{ label }}
      <span v-if="value" class="chip-value">{{ currentLabel }}</span>
      <svg class="chip-chevron" :class="{ open: isOpen }" width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <Teleport to="body">
      <div v-if="isOpen" class="chip-backdrop" @click="isOpen = false" />
      <div v-if="isOpen" class="chip-dropdown" :style="dropdownStyle">
        <button
          class="chip-option"
          :class="{ 'option-active': !value }"
          @click="select('')"
        >
          {{ $t("common.all") }}
        </button>
        <button
          v-for="opt in options"
          :key="opt.value"
          class="chip-option"
          :class="{ 'option-active': value === opt.value }"
          @click="select(opt.value)"
        >
          {{ opt.label }}
        </button>
      </div>
    </Teleport>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";

interface FilterOption {
  value: string;
  label: string;
}

export default defineComponent({
  name: "FilterChip",

  emits: ["change"],

  props: {
    label: { type: String, required: true },
    value: { type: String, default: "" },
    options: { type: Array as PropType<FilterOption[]>, required: true },
  },

  data: () => ({
    isOpen: false,
    dropdownStyle: {} as Record<string, string>,
  }),

  computed: {
    currentLabel(): string {
      return this.options.find((o) => o.value === this.value)?.label ?? this.value;
    },
  },

  methods: {
    toggle(e: MouseEvent): void {
      if (!this.isOpen) {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        this.dropdownStyle = {
          top: `${rect.bottom + 6}px`,
          left: `${rect.left}px`,
        };
      }
      this.isOpen = !this.isOpen;
    },
    select(value: string): void {
      this.$emit("change", value);
      this.isOpen = false;
    },
  },
});
</script>

<style scoped>
.filter-chip {
  position: relative;
  display: inline-flex;
}

.chip-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border-radius: 20px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-glass);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: background var(--transition-base, 200ms cubic-bezier(0.4, 0, 0.2, 1)),
              border-color var(--transition-base, 200ms cubic-bezier(0.4, 0, 0.2, 1));
  white-space: nowrap;
}

@media (hover: hover) and (pointer: fine) {
  .chip-label:hover {
    background: var(--bg-glass-hover);
    border-color: var(--border-medium);
  }
}

.chip-active .chip-label {
  border-color: var(--accent-primary);
  background: rgba(124, 92, 255, 0.1);
  color: var(--accent-primary);
}

.chip-value {
  font-weight: 600;
}

.chip-chevron {
  transition: transform 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
  flex-shrink: 0;
}

.chip-chevron.open {
  transform: rotate(180deg);
}

.chip-backdrop {
  position: fixed;
  inset: 0;
  z-index: 999;
}

.chip-dropdown {
  position: fixed;
  z-index: 1000;
  min-width: 140px;
  padding: 4px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-soft);
  background: var(--bg-overlay);
  backdrop-filter: var(--blur-glass);
  -webkit-backdrop-filter: var(--blur-glass);
  box-shadow: var(--shadow-elevated);
}

.chip-option {
  display: block;
  width: 100%;
  padding: 7px 10px;
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: background 120ms;
}

@media (hover: hover) and (pointer: fine) {
  .chip-option:hover {
    background: var(--bg-glass-hover);
    color: var(--text-primary);
  }
}

.option-active {
  color: var(--accent-primary);
  font-weight: 600;
}
</style>
