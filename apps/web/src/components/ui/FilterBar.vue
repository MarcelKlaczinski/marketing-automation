<template>
  <div class="filter-bar">
    <div class="filter-search">
      <svg class="search-icon" width="14" height="14" viewBox="0 0 16 16" fill="none">
        <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" stroke-width="1.5" />
        <path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
      <input
        v-model="localSearch"
        type="text"
        class="search-input"
        :placeholder="$t('common.search')"
        @input="onSearchInput"
      />
      <KbdShortcut v-if="!localSearch" keys="/" />
    </div>

    <div v-if="availableFilters.length" class="filter-chips">
      <FilterChip
        v-for="filter in availableFilters"
        :key="filter.key"
        :label="filter.label"
        :value="activeFilters[filter.key] ?? ''"
        :options="filter.options"
        @change="onFilterChange(filter.key, $event)"
      />
    </div>

    <div class="filter-actions">
      <GlassButton v-if="hasActiveFilters" variant="ghost" @click="clearAll">
        {{ $t("common.clearFilters") }}
      </GlassButton>
      <slot name="actions" />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import FilterChip from "./FilterChip.vue";
import KbdShortcut from "./KbdShortcut.vue";
import GlassButton from "./GlassButton.vue";

interface FilterOption {
  value: string;
  label: string;
}

interface FilterDefinition {
  key: string;
  label: string;
  options: FilterOption[];
}

export default defineComponent({
  name: "FilterBar",

  components: { FilterChip, KbdShortcut, GlassButton },

  emits: ["update:filters", "update:search"],

  props: {
    availableFilters: {
      type: Array as PropType<FilterDefinition[]>,
      default: () => [],
    },
    activeFilters: {
      type: Object as PropType<Record<string, string>>,
      default: () => ({}),
    },
    search: { type: String, default: "" },
  },

  data: () => ({
    localSearch: "",
    debounceTimer: null as ReturnType<typeof setTimeout> | null,
  }),

  computed: {
    hasActiveFilters(): boolean {
      return (
        Object.values(this.activeFilters).some((v) => !!v) ||
        this.localSearch.length > 0
      );
    },
  },

  watch: {
    search: {
      immediate: true,
      handler(val: string): void {
        this.localSearch = val;
      },
    },
  },

  methods: {
    onSearchInput(): void {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.$emit("update:search", this.localSearch);
      }, 300);
    },
    onFilterChange(key: string, value: string): void {
      const updated = { ...this.activeFilters };
      if (value) {
        updated[key] = value;
      } else {
        delete updated[key];
      }
      this.$emit("update:filters", updated);
    },
    clearAll(): void {
      this.localSearch = "";
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.$emit("update:search", "");
      this.$emit("update:filters", {});
    },
  },
});
</script>

<style scoped>
.filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-glass);
  flex-wrap: wrap;
}

.filter-search {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 160px;
  padding: 6px 10px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  background: rgba(255, 255, 255, 0.04);
  transition: border-color var(--transition-base, 200ms cubic-bezier(0.4, 0, 0.2, 1));
}

.filter-search:focus-within {
  border-color: var(--accent-primary);
}

.search-icon {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
}

.search-input::placeholder {
  color: var(--text-tertiary);
}

.filter-chips {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.filter-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}
</style>
