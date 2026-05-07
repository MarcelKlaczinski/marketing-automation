<template>
  <div class="pillar-section">
    <div class="pillar-section__header">
      <q-icon name="account_tree" size="20px" color="primary" class="q-mr-sm" />
      <InlineEdit
        :value="pillar.name"
        :max-length="120"
        class="pillar-section__name"
        @save="onRenameName"
      />
      <span class="pillar-section__count">
        {{ pillar.clusterCount }} {{ $t('clusters.fields.clusters') }}
      </span>

      <q-space />

      <q-btn
        flat
        dense
        icon="arrow_upward"
        :disable="isFirst"
        size="sm"
        @click="$emit('move', { id: pillar.id, direction: 'up' })"
      >
        <q-tooltip>{{ $t('clusters.actions.moveUp') }}</q-tooltip>
      </q-btn>
      <q-btn
        flat
        dense
        icon="arrow_downward"
        :disable="isLast"
        size="sm"
        @click="$emit('move', { id: pillar.id, direction: 'down' })"
      >
        <q-tooltip>{{ $t('clusters.actions.moveDown') }}</q-tooltip>
      </q-btn>

      <q-btn flat dense icon="more_vert" size="sm">
        <q-menu>
          <q-list>
            <q-item clickable v-close-popup @click="onEditDescription">
              <q-item-section avatar>
                <q-icon name="description" />
              </q-item-section>
              <q-item-section>{{ $t('clusters.actions.editDescription') }}</q-item-section>
            </q-item>
            <q-separator />
            <q-item clickable v-close-popup class="text-negative" @click="$emit('delete', pillar)">
              <q-item-section avatar>
                <q-icon name="delete" />
              </q-item-section>
              <q-item-section>{{ $t('clusters.actions.delete') }}</q-item-section>
            </q-item>
          </q-list>
        </q-menu>
      </q-btn>
    </div>

    <p v-if="pillar.description" class="pillar-section__description">
      {{ pillar.description }}
    </p>

    <div class="pillar-section__clusters">
      <ClusterCard
        v-for="(cluster, idx) in clusters"
        :key="cluster.id"
        :cluster="cluster"
        :all-clusters="allClusters"
        :all-pillars="allPillars"
        :is-first="idx === 0"
        :is-last="idx === clusters.length - 1"
        @rename="(p) => $emit('cluster-rename', p)"
        @delete="(c) => $emit('cluster-delete', c)"
        @move="(p) => $emit('cluster-move', p)"
        @change-pillar="(p) => $emit('cluster-change-pillar', p)"
        @move-articles="(c) => $emit('cluster-move-articles', c)"
      />

      <button class="add-cluster-btn" @click="$emit('cluster-create', pillar.id)">
        <q-icon name="add" size="18px" />
        {{ $t('clusters.actions.newCluster') }}
      </button>
    </div>

    <q-dialog v-model="descriptionDialogOpen">
      <q-card style="min-width: 480px;">
        <q-card-section>
          <div class="text-h6">{{ $t('clusters.dialogs.editPillarDescription') }}</div>
        </q-card-section>
        <q-card-section>
          <q-input
            v-model="descriptionDraft"
            outlined
            type="textarea"
            autogrow
            :label="$t('clusters.fields.description')"
            :hint="$t('clusters.fields.descriptionHint')"
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat :label="$t('common.cancel') as string" v-close-popup />
          <q-btn
            color="primary"
            :label="$t('common.save') as string"
            @click="confirmDescription"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script lang="ts">
import InlineEdit from "src/components/common/InlineEdit.vue";
import type { Cluster } from "src/stores/clusters";
import type { Pillar } from "src/stores/pillars";
import { type PropType, defineComponent } from "vue";
import ClusterCard from "./ClusterCard.vue";

export default defineComponent({
  name: "PillarSection",

  components: { InlineEdit, ClusterCard },

  props: {
    pillar: { type: Object as PropType<Pillar>, required: true },
    clusters: { type: Array as PropType<Cluster[]>, required: true },
    allClusters: { type: Array as PropType<Cluster[]>, required: true },
    allPillars: { type: Array as PropType<Pillar[]>, required: true },
    isFirst: { type: Boolean, default: false },
    isLast: { type: Boolean, default: false },
    slug: { type: String, required: true },
  },

  emits: [
    "rename",
    "delete",
    "move",
    "cluster-create",
    "cluster-rename",
    "cluster-delete",
    "cluster-move",
    "cluster-change-pillar",
    "cluster-move-articles",
  ],

  data() {
    return {
      descriptionDialogOpen: false,
      descriptionDraft: "",
    };
  },

  methods: {
    onRenameName(name: string): void {
      this.$emit("rename", { id: this.pillar.id, name, description: this.pillar.description });
    },

    onEditDescription(): void {
      this.descriptionDraft = this.pillar.description ?? "";
      this.descriptionDialogOpen = true;
    },

    confirmDescription(): void {
      this.$emit("rename", {
        id: this.pillar.id,
        name: this.pillar.name,
        description: this.descriptionDraft.trim() || null,
      });
      this.descriptionDialogOpen = false;
    },
  },
});
</script>

<style lang="scss" scoped>
.pillar-section {
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 8px;
  padding: 16px 20px;
  background: var(--q-card-bg, #fff);

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }
}

.pillar-section__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.pillar-section__name {
  font-size: 16px;
  font-weight: 600;
  flex-grow: 0;
}

.pillar-section__count {
  font-size: 12px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  margin-left: 8px;
}

.pillar-section__description {
  font-size: 13px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.7));
  margin: 0 0 12px;
}

.pillar-section__clusters {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.add-cluster-btn {
  border: 1.5px dashed var(--q-grey-4, #ccc);
  background: none;
  border-radius: 6px;
  padding: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 13px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  min-height: 100px;
  transition: all 0.15s;

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.15);
  }

  &:hover {
    border-color: var(--q-primary);
    color: var(--q-primary);
  }
}
</style>
