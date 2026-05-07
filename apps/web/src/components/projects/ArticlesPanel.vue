<template>
  <div class="articles-panel">
    <div class="articles-panel__toolbar">
      <div class="view-toggle">
        <button
          :class="['toggle-btn', { 'toggle-btn--active': groupBy === 'pillar' }]"
          type="button"
          @click="setGroupBy('pillar')"
        >
          <q-icon name="account_tree" size="14px" class="q-mr-xs" />
          {{ $t('articles.toolbar.byPillar') }}
        </button>
        <button
          :class="['toggle-btn', { 'toggle-btn--active': groupBy === 'cluster' }]"
          type="button"
          @click="setGroupBy('cluster')"
        >
          <q-icon name="hub" size="14px" class="q-mr-xs" />
          {{ $t('articles.toolbar.byCluster') }}
        </button>
      </div>

      <q-btn
        flat
        dense
        icon="account_tree"
        size="sm"
        :label="$t('clusters.actions.manage') as string"
        :to="{ name: 'project-clusters', params: { slug } }"
        class="q-mr-sm"
      />

      <q-space />

      <div class="article-count">
        {{ $t('articles.toolbar.totalCount', { count: articles.length }) }}
      </div>
    </div>

    <div v-if="articlesStore.loading && articles.length === 0" class="text-center q-pa-xl">
      <q-spinner size="3em" color="primary" />
    </div>

    <div v-else-if="articles.length === 0" class="text-center q-pa-xl">
      <q-icon name="article" size="64px" color="grey-5" />
      <p class="text-body1 q-mt-md text-grey-7">{{ $t('articles.empty') }}</p>
      <p class="text-caption text-grey-7">{{ $t('articles.emptyHint') }}</p>
    </div>

    <div v-else class="kanban">
      <ArticleKanbanLane
        v-for="lane in lanes"
        :key="lane.id"
        :lane="lane"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { LocalStorage } from "quasar";
import ArticleKanbanLane from "src/components/articles/ArticleKanbanLane.vue";
import { type ArticleListItem, useArticlesStore } from "src/stores/articles";
import { defineComponent } from "vue";

type GroupBy = "pillar" | "cluster";

interface KanbanLane {
  id: string;
  type: GroupBy;
  pillarName?: string | null;
  clusterName?: string | null;
  articles: ArticleListItem[];
}

const STORAGE_KEY_GROUP_BY = "articles.groupBy";

export default defineComponent({
  name: "ArticlesPanel",

  components: { ArticleKanbanLane },

  props: {
    slug: { type: String, required: true },
  },

  setup() {
    return { articlesStore: useArticlesStore() };
  },

  data: () => ({
    groupBy:
      (LocalStorage.getItem(STORAGE_KEY_GROUP_BY) as GroupBy | null) ?? ("pillar" as GroupBy),
  }),

  computed: {
    articles(): ArticleListItem[] {
      return this.articlesStore.byProject[this.slug] ?? [];
    },

    lanes(): KanbanLane[] {
      if (this.groupBy === "pillar") {
        return this.computeLanesByPillar();
      }
      return this.computeLanesByCluster();
    },
  },

  async created() {
    await this.articlesStore.fetchForProject(this.slug);
  },

  methods: {
    setGroupBy(value: GroupBy): void {
      this.groupBy = value;
      LocalStorage.set(STORAGE_KEY_GROUP_BY, value);
    },

    computeLanesByPillar(): KanbanLane[] {
      const byPillarThenCluster = new Map<
        string,
        {
          pillarName: string | null;
          pillarPosition: number;
          clusters: Map<string, { name: string | null; articles: ArticleListItem[] }>;
        }
      >();

      for (const article of this.articles) {
        const pillarKey = article.pillarId ?? "__no_pillar__";
        if (!byPillarThenCluster.has(pillarKey)) {
          byPillarThenCluster.set(pillarKey, {
            pillarName: article.pillarName,
            pillarPosition: article.pillarPosition ?? 9999,
            clusters: new Map(),
          });
        }
        const pillarBucket = byPillarThenCluster.get(pillarKey)!;
        const clusterKey = article.clusterId ?? "__no_cluster__";
        if (!pillarBucket.clusters.has(clusterKey)) {
          pillarBucket.clusters.set(clusterKey, { name: article.clusterName, articles: [] });
        }
        pillarBucket.clusters.get(clusterKey)?.articles.push(article);
      }

      const lanes: KanbanLane[] = [];
      const sortedPillars = Array.from(byPillarThenCluster.entries()).sort(
        (a, b) => a[1].pillarPosition - b[1].pillarPosition
      );

      for (const [pillarKey, pillarBucket] of sortedPillars) {
        const sortedClusters = Array.from(pillarBucket.clusters.entries()).sort((a, b) =>
          (a[1].name ?? "zzz").localeCompare(b[1].name ?? "zzz")
        );
        for (const [clusterKey, clusterBucket] of sortedClusters) {
          lanes.push({
            id: `${pillarKey}::${clusterKey}`,
            type: "pillar",
            pillarName: pillarBucket.pillarName,
            clusterName: clusterBucket.name,
            articles: clusterBucket.articles,
          });
        }
      }
      return lanes;
    },

    computeLanesByCluster(): KanbanLane[] {
      const byCluster = new Map<
        string,
        { clusterName: string | null; articles: ArticleListItem[] }
      >();
      for (const article of this.articles) {
        const clusterKey = article.clusterId ?? "__no_cluster__";
        if (!byCluster.has(clusterKey)) {
          byCluster.set(clusterKey, { clusterName: article.clusterName, articles: [] });
        }
        byCluster.get(clusterKey)?.articles.push(article);
      }

      const sorted = Array.from(byCluster.entries()).sort((a, b) =>
        (a[1].clusterName ?? "zzz").localeCompare(b[1].clusterName ?? "zzz")
      );
      return sorted.map(([key, bucket]) => ({
        id: key,
        type: "cluster" as const,
        clusterName: bucket.clusterName,
        articles: bucket.articles,
      }));
    },
  },
});
</script>

<style lang="scss" scoped>
.articles-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.articles-panel__toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--q-grey-2, #f0f0f0);
  margin-bottom: 16px;

  body.body--dark & {
    border-bottom-color: rgba(255, 255, 255, 0.06);
  }
}

.view-toggle {
  display: inline-flex;
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 6px;
  padding: 2px;

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }
}

.toggle-btn {
  background: none;
  border: none;
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.65));
  transition: all 0.15s;

  &:hover {
    color: var(--q-primary);
  }

  &--active {
    background: var(--q-primary);
    color: white;

    &:hover {
      color: white;
    }
  }
}

.article-count {
  font-size: 13px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
}

.kanban {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
