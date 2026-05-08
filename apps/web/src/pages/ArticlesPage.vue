<template>
  <q-page padding>
    <q-tabs v-model="topTab" align="left" class="q-mb-md">
      <q-tab name="generated" :label="$t('articles.tabs.generated')" />
      <q-tab name="imported" :label="$t('articles.tabs.imported')" />
    </q-tabs>

    <q-tab-panels v-model="topTab" animated keep-alive>
      <q-tab-panel name="generated">
        <ArticlesPanel :slug="slug" />
      </q-tab-panel>

      <q-tab-panel name="imported">
        <ImportedArticlesPanel :slug="slug" />
      </q-tab-panel>
    </q-tab-panels>
  </q-page>
</template>

<script lang="ts">
import ArticlesPanel from "src/components/projects/ArticlesPanel.vue";
import ImportedArticlesPanel from "src/components/articles/ImportedArticlesPanel.vue";
import { defineComponent } from "vue";

export default defineComponent({
  name: "ArticlesPage",
  components: { ArticlesPanel, ImportedArticlesPanel },
  props: {
    slug: { type: String, required: true },
  },
  data: () => ({
    topTab: "generated" as "generated" | "imported",
  }),
});
</script>
