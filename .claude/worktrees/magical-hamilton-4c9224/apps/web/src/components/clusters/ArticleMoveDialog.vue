<template>
  <q-dialog
    :model-value="modelValue"
    persistent
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <q-card style="min-width: 600px; max-width: 720px;">
      <q-card-section>
        <div class="text-h6">{{ $t('clusters.dialogs.moveArticles') }}</div>
        <div v-if="fromCluster" class="text-caption text-grey-7 q-mt-xs">
          {{ $t('clusters.dialogs.moveArticlesFrom', { name: fromCluster.name }) }}
        </div>
      </q-card-section>

      <q-separator />

      <q-card-section v-if="loading" class="text-center q-pa-xl">
        <q-spinner size="2em" color="primary" />
      </q-card-section>

      <q-card-section v-else-if="clusterArticles.length === 0" class="text-center q-pa-xl">
        <p class="text-body2 text-grey-7">{{ $t('clusters.dialogs.noArticlesInCluster') }}</p>
      </q-card-section>

      <q-card-section v-else>
        <div class="article-list">
          <label
            v-for="article in clusterArticles"
            :key="article.id"
            class="article-row"
          >
            <q-checkbox v-model="selected" :val="article.id" />
            <span class="article-row__title">{{ article.title || article.cornerstoneKeyword }}</span>
            <span v-if="article.cornerstoneSpecId" class="article-row__cornerstone-badge">
              {{ $t('articles.card.cornerstone') }}
            </span>
          </label>
        </div>

        <q-separator class="q-my-md" />

        <q-select
          v-model="targetClusterId"
          :options="targetOptions"
          emit-value
          map-options
          outlined
          dense
          :label="$t('clusters.dialogs.moveTo')"
        />
      </q-card-section>

      <q-separator />

      <q-card-actions align="right">
        <q-btn flat :label="$t('common.cancel') as string" v-close-popup />
        <q-btn
          color="primary"
          :label="$t('clusters.dialogs.moveSelectedCount', { count: selected.length }) as string"
          :disable="selected.length === 0 || targetClusterId === undefined"
          @click="onConfirm"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import { type ArticleListItem, useArticlesStore } from "src/stores/articles";
import type { Cluster } from "src/stores/clusters";
import { type PropType, defineComponent } from "vue";

export default defineComponent({
  name: "ArticleMoveDialog",

  props: {
    modelValue: { type: Boolean, default: false },
    slug: { type: String, required: true },
    fromCluster: { type: Object as PropType<Cluster | null>, default: null },
    allClusters: { type: Array as PropType<Cluster[]>, required: true },
  },

  emits: ["update:modelValue", "confirm"],

  setup() {
    return { articlesStore: useArticlesStore() };
  },

  data() {
    return {
      selected: [] as string[],
      targetClusterId: undefined as string | null | undefined,
      loading: false,
    };
  },

  computed: {
    clusterArticles(): ArticleListItem[] {
      if (!this.fromCluster) return [];
      const all = this.articlesStore.byProject[this.slug] ?? [];
      return all.filter((a) => a.clusterId === this.fromCluster!.id);
    },

    targetOptions(): Array<{ label: string; value: string | null }> {
      const otherClusters = this.allClusters.filter((c) => c.id !== this.fromCluster?.id);
      return [
        { label: this.$t("clusters.dialogs.uncategorized") as string, value: null },
        ...otherClusters.map((c) => ({
          label: `${c.pillarName ? c.pillarName + " › " : ""}${c.name}`,
          value: c.id,
        })),
      ];
    },
  },

  watch: {
    modelValue(open: boolean): void {
      if (open) {
        this.selected = [];
        this.targetClusterId = undefined;
        if (this.articlesStore.byProject[this.slug] === undefined) {
          this.loading = true;
          void this.articlesStore.fetchForProject(this.slug).finally(() => {
            this.loading = false;
          });
        }
      }
    },
  },

  methods: {
    onConfirm(): void {
      if (!this.fromCluster || this.selected.length === 0 || this.targetClusterId === undefined)
        return;
      this.$emit("confirm", {
        fromClusterId: this.fromCluster.id,
        articleIds: this.selected,
        toClusterId: this.targetClusterId,
      });
    },
  },
});
</script>

<style lang="scss" scoped>
.article-list {
  max-height: 320px;
  overflow-y: auto;
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 6px;

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }
}

.article-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  border-bottom: 1px solid var(--q-grey-2, #f0f0f0);

  &:last-child {
    border-bottom: none;
  }

  body.body--dark & {
    border-bottom-color: rgba(255, 255, 255, 0.06);
  }

  &:hover {
    background: rgba(0, 0, 0, 0.03);

    body.body--dark & {
      background: rgba(255, 255, 255, 0.03);
    }
  }
}

.article-row__title {
  flex-grow: 1;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.article-row__cornerstone-badge {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: rgba(63, 81, 181, 0.1);
  color: var(--q-primary);
  padding: 2px 6px;
  border-radius: 999px;
  font-weight: 600;
}
</style>
