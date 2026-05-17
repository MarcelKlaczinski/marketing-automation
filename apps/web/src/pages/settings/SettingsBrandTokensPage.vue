<template>
  <div class="settings-brand-tokens-page">
    <div class="page-header">
      <h1 class="page-title">{{ $t("settings.brandTokens.title") as string }}</h1>
      <div class="header-actions">
        <button
          class="mode-toggle"
          :class="{ active: mode === 'form' }"
          @click="mode = 'form'"
        >
          {{ $t("settings.brandTokens.formMode") as string }}
        </button>
        <button
          class="mode-toggle"
          :class="{ active: mode === 'json' }"
          @click="mode = 'json'"
        >
          {{ $t("settings.brandTokens.advancedMode") as string }}
        </button>
      </div>
    </div>

    <BrandTokensFormEditor v-if="mode === 'form'" :key="formKey" />
    <BrandTokensJsonEditor v-else :key="jsonKey" @saved="onJsonSaved" />
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import BrandTokensFormEditor from "src/components/settings/BrandTokensFormEditor.vue";
import BrandTokensJsonEditor from "src/components/settings/BrandTokensJsonEditor.vue";

export default defineComponent({
  name: "SettingsBrandTokensPage",

  components: { BrandTokensFormEditor, BrandTokensJsonEditor },

  data: () => ({
    mode: "form" as "form" | "json",
    formKey: 0,
    jsonKey: 0,
  }),

  methods: {
    onJsonSaved(): void {
      // Force re-mount of form editor so it re-fetches updated tokens
      this.formKey += 1;
    },
  },
});
</script>

<style scoped>
.settings-brand-tokens-page {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.page-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.header-actions {
  display: flex;
  gap: 4px;
  background: var(--surface-secondary, rgba(255, 255, 255, 0.05));
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  padding: 3px;
}

.mode-toggle {
  padding: 5px 14px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  background: none;
  border: none;
  border-radius: calc(var(--radius-md) - 2px);
  cursor: pointer;
  transition:
    background 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
    color 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.mode-toggle.active {
  background: var(--surface-primary, rgba(255, 255, 255, 0.1));
  color: var(--text-primary);
}

@media (hover: hover) and (pointer: fine) {
  .mode-toggle:not(.active):hover {
    color: var(--text-primary);
    background: var(--surface-primary, rgba(255, 255, 255, 0.05));
  }
}
</style>
