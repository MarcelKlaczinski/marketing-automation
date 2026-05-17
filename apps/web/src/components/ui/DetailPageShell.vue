<template>
  <div class="detail-page-shell">
    <header class="detail-header">
      <button class="back-btn" @click="goBack">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M10 3L5 8L10 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        {{ $t("common.back") }}
      </button>

      <div v-if="$slots.eyebrow" class="detail-eyebrow">
        <slot name="eyebrow" />
      </div>

      <h1 class="detail-title">{{ title }}</h1>

      <div v-if="meta" class="detail-meta mono">{{ meta }}</div>

      <div v-if="$slots.actions" class="detail-actions">
        <slot name="actions" />
      </div>
    </header>

    <div v-if="$slots.subheader" class="detail-subheader">
      <slot name="subheader" />
    </div>

    <nav v-if="tabs.length > 0" class="detail-tabs" role="tablist">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ 'tab-active': activeTab === tab.key }"
        role="tab"
        :aria-selected="activeTab === tab.key"
        @click="$emit('change-tab', tab.key)"
      >
        {{ tab.label }}
        <span v-if="tab.count !== undefined" class="tab-count mono">{{ tab.count }}</span>
      </button>
    </nav>

    <main class="detail-body">
      <slot />
    </main>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";

interface Tab {
  key: string;
  label: string;
  count?: number;
}

export default defineComponent({
  name: "DetailPageShell",

  emits: ["change-tab"],

  props: {
    title: { type: String, default: "" },
    meta: { type: String, default: "" },
    tabs: { type: Array as PropType<Tab[]>, default: () => [] },
    activeTab: { type: String, default: "" },
    backRoute: { type: String, default: "" },
  },

  methods: {
    goBack(): void {
      if (this.backRoute) {
        this.$router.push(this.backRoute);
      } else {
        this.$router.back();
      }
    },
  },
});
</script>

<style scoped>
.detail-page-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.detail-header {
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-glass);
  flex-shrink: 0;
}

.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 0;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 11px;
  cursor: pointer;
  margin-bottom: 8px;
  transition: color var(--transition-base, 200ms cubic-bezier(0.4, 0, 0.2, 1));
}

@media (hover: hover) and (pointer: fine) {
  .back-btn:hover {
    color: var(--text-primary);
  }
}

.detail-eyebrow {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.detail-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.3;
  margin: 0 0 4px;
}

.detail-meta {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-bottom: 8px;
}

.detail-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.detail-subheader {
  flex-shrink: 0;
}

.detail-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-glass);
  padding: 0 16px;
  flex-shrink: 0;
  overflow-x: auto;
}

.tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  margin-bottom: -1px;
  transition: color var(--transition-base, 200ms cubic-bezier(0.4, 0, 0.2, 1)),
              border-color var(--transition-base, 200ms cubic-bezier(0.4, 0, 0.2, 1));
}

@media (hover: hover) and (pointer: fine) {
  .tab-btn:hover {
    color: var(--text-primary);
  }
}

.tab-btn.tab-active {
  color: var(--accent-primary);
  border-bottom-color: var(--accent-primary);
}

.tab-count {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-tertiary);
}

.detail-body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
</style>
