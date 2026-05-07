<template>
  <div class="cluster-card">
    <div class="cluster-card__header">
      <InlineEdit
        :value="cluster.name"
        :max-length="200"
        class="cluster-card__name"
        @save="onRenameName"
      />

      <q-btn flat dense round icon="more_vert" size="sm">
        <q-menu>
          <q-list dense>
            <q-item clickable v-close-popup @click="$emit('move-articles', cluster)">
              <q-item-section avatar>
                <q-icon name="swap_horiz" />
              </q-item-section>
              <q-item-section>{{ $t('clusters.actions.moveArticles') }}</q-item-section>
            </q-item>
            <q-item clickable v-close-popup @click="$emit('move', { id: cluster.id, direction: 'up' })">
              <q-item-section avatar>
                <q-icon name="arrow_upward" />
              </q-item-section>
              <q-item-section>{{ $t('clusters.actions.moveUp') }}</q-item-section>
            </q-item>
            <q-item clickable v-close-popup @click="$emit('move', { id: cluster.id, direction: 'down' })">
              <q-item-section avatar>
                <q-icon name="arrow_downward" />
              </q-item-section>
              <q-item-section>{{ $t('clusters.actions.moveDown') }}</q-item-section>
            </q-item>
            <q-item v-if="availablePillars.length > 0" clickable>
              <q-item-section avatar>
                <q-icon name="account_tree" />
              </q-item-section>
              <q-item-section>{{ $t('clusters.actions.changePillar') }}</q-item-section>
              <q-item-section side>
                <q-icon name="chevron_right" />
              </q-item-section>
              <q-menu anchor="top end" self="top start">
                <q-list dense>
                  <q-item
                    v-for="otherPillar in availablePillars"
                    :key="otherPillar.id"
                    clickable
                    v-close-popup
                    @click="$emit('change-pillar', { id: cluster.id, pillarId: otherPillar.id })"
                  >
                    <q-item-section>{{ otherPillar.name }}</q-item-section>
                  </q-item>
                </q-list>
              </q-menu>
            </q-item>
            <q-separator />
            <q-item clickable v-close-popup class="text-negative" @click="$emit('delete', cluster)">
              <q-item-section avatar>
                <q-icon name="delete" />
              </q-item-section>
              <q-item-section>{{ $t('clusters.actions.delete') }}</q-item-section>
            </q-item>
          </q-list>
        </q-menu>
      </q-btn>
    </div>

    <div class="cluster-card__stats">
      <span class="stat">
        <q-icon name="article" size="14px" />
        {{ cluster.articleCount }} {{ $t('clusters.fields.articles') }}
      </span>
      <span class="stat">
        <q-icon name="star" size="14px" />
        {{ cluster.cornerstoneCount }} {{ $t('clusters.fields.cornerstones') }}
      </span>
    </div>

    <div v-if="cluster.primaryKeyword" class="cluster-card__keyword">
      <q-icon name="search" size="12px" class="q-mr-xs" />
      <code>{{ cluster.primaryKeyword }}</code>
    </div>

    <div v-if="cluster.pillarArticleTitle" class="cluster-card__pillar-article">
      <q-icon name="bookmark" size="12px" class="q-mr-xs" />
      <span>
        {{ $t('clusters.fields.pillarArticle') }}:
        <strong>{{ cluster.pillarArticleTitle }}</strong>
      </span>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import type { Cluster } from 'src/stores/clusters';
import type { Pillar } from 'src/stores/pillars';
import InlineEdit from 'src/components/common/InlineEdit.vue';

export default defineComponent({
  name: 'ClusterCard',

  components: { InlineEdit },

  props: {
    cluster: { type: Object as PropType<Cluster>, required: true },
    allClusters: { type: Array as PropType<Cluster[]>, required: true },
    allPillars: { type: Array as PropType<Pillar[]>, required: true },
    isFirst: { type: Boolean, default: false },
    isLast: { type: Boolean, default: false },
  },

  emits: ['rename', 'delete', 'move', 'change-pillar', 'move-articles'],

  computed: {
    availablePillars(): Pillar[] {
      return this.allPillars.filter((p) => p.id !== this.cluster.pillarId);
    },
  },

  methods: {
    onRenameName(name: string): void {
      this.$emit('rename', {
        id: this.cluster.id,
        name,
        primaryKeyword: this.cluster.primaryKeyword,
      });
    },
  },
});
</script>

<style lang="scss" scoped>
.cluster-card {
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 6px;
  padding: 12px;
  background: var(--q-grey-1, #fafafa);

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.02);
  }
}

.cluster-card__header {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

.cluster-card__name {
  flex-grow: 1;
  font-weight: 500;
  font-size: 14px;
}

.cluster-card__stats {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  margin-bottom: 6px;
}

.stat {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.cluster-card__keyword {
  font-size: 11px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  display: flex;
  align-items: center;
  margin-top: 4px;

  code {
    background: rgba(0, 0, 0, 0.05);
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 10.5px;

    body.body--dark & {
      background: rgba(255, 255, 255, 0.05);
    }
  }
}

.cluster-card__pillar-article {
  font-size: 11px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.6));
  display: flex;
  align-items: center;
  margin-top: 4px;
  padding: 4px 0;
  border-top: 1px dashed var(--q-grey-3, #e0e0e0);

  body.body--dark & {
    border-top-color: rgba(255, 255, 255, 0.08);
  }
}
</style>
