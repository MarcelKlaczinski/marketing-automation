<template>
  <div class="article-tools-page">
    <header class="page-header">
      <h1 class="page-title">{{ $t("articleTools.title") as string }}</h1>
      <p class="page-description">{{ $t("articleTools.description") as string }}</p>
    </header>

    <nav class="tools-tabs">
      <button
        class="tab"
        :class="{ 'tab-active': activeTab === 'generate' }"
        @click="activeTab = 'generate'"
      >
        {{ $t("articleTools.tabs.generate") as string }}
      </button>
      <button
        class="tab"
        :class="{ 'tab-active': activeTab === 'manual' }"
        @click="activeTab = 'manual'"
      >
        {{ $t("articleTools.tabs.manual") as string }}
      </button>
    </nav>

    <ArticleGenerateTab v-if="activeTab === 'generate'" />
    <ArticleManualTriggersTab v-else />
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import ArticleGenerateTab from "src/components/article-tools/ArticleGenerateTab.vue";
import ArticleManualTriggersTab from "src/components/article-tools/ArticleManualTriggersTab.vue";

export default defineComponent({
  name: "ArticleToolsPage",

  components: { ArticleGenerateTab, ArticleManualTriggersTab },

  data: () => ({
    activeTab: "generate" as "generate" | "manual",
  }),
});
</script>

<style scoped>
.article-tools-page {
  display: flex;
  flex-direction: column;
  gap: 0;
  height: 100%;
  overflow-y: auto;
}

.page-header {
  padding: 24px 32px 0;
}

.page-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 4px;
}

.page-description {
  font-size: 13px;
  color: var(--text-tertiary);
  margin: 0;
}

.tools-tabs {
  display: flex;
  gap: 4px;
  padding: 16px 32px 0;
  border-bottom: 1px solid var(--border-subtle);
}

.tab {
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition:
    color 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
    border-color 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
  margin-bottom: -1px;
}

@media (hover: hover) and (pointer: fine) {
  .tab:not(.tab-active):hover {
    color: var(--text-primary);
  }
}

.tab-active {
  color: var(--accent-primary, #7c5cff);
  border-bottom-color: var(--accent-primary, #7c5cff);
}
</style>
