<template>
  <div class="q-gutter-md">
    <!-- Cluster summary -->
    <q-card flat bordered>
      <q-card-section>
        <div class="text-subtitle2 q-mb-sm">{{ $t('clusters.create.clusterSummary') }}</div>
        <div class="field-row">
          <span class="text-caption text-grey-7">{{ $t('clusters.create.clusterName') }}</span>
          <span class="text-weight-medium">{{ proposal.cluster_name }}</span>
        </div>
        <div class="field-row q-mt-xs">
          <span class="text-caption text-grey-7">{{ $t('clusters.create.primaryKeyword') }}</span>
          <span>{{ proposal.primary_keyword }}</span>
        </div>
        <div v-if="effectiveIntents.length" class="field-row q-mt-xs">
          <span class="text-caption text-grey-7">{{ $t('clusters.create.intentTaxonomy') }}</span>
          <div class="row q-gutter-xs">
            <q-badge v-for="intent in effectiveIntents" :key="intent" color="primary" outline>
              {{ intent }}
            </q-badge>
          </div>
        </div>
      </q-card-section>
    </q-card>

    <!-- Pillar summary -->
    <q-card flat bordered>
      <q-card-section>
        <div class="text-subtitle2 q-mb-sm">{{ $t('clusters.create.pillarSummary') }}</div>
        <div class="field-row">
          <span class="text-caption text-grey-7">{{ $t('clusters.create.pillarTitle') }}</span>
          <span class="text-weight-medium">{{ proposal.pillar_title }}</span>
        </div>
        <div class="field-row q-mt-xs">
          <span class="text-caption text-grey-7">{{ $t('clusters.create.pillarSlug') }}</span>
          <code class="text-caption">{{ proposal.pillar_slug }}</code>
        </div>
        <div class="field-row q-mt-xs">
          <span class="text-caption text-grey-7">{{ $t('clusters.create.pillarMeta') }}</span>
          <span class="text-caption text-grey-8">{{ proposal.pillar_meta }}</span>
        </div>
        <div class="q-mt-sm">
          <div class="text-caption text-grey-7 q-mb-xs">{{ $t('clusters.create.pillarOutline') }}</div>
          <ol class="q-pl-md q-ma-none">
            <li v-for="(section, i) in proposal.pillar_outline" :key="i" class="text-caption">
              {{ section }}
            </li>
          </ol>
        </div>
      </q-card-section>
    </q-card>

    <!-- Brief summary -->
    <q-card v-if="briefTitle" flat bordered>
      <q-card-section>
        <div class="text-subtitle2 q-mb-sm">{{ $t('clusters.create.briefSummary') }}</div>
        <div class="field-row">
          <span class="text-caption text-grey-7">{{ $t('trends.detail.suggestedTitle') }}</span>
          <span>{{ briefTitle }}</span>
        </div>
        <div class="field-row q-mt-xs">
          <span class="text-caption text-grey-7">{{ $t('clusters.create.spokeIntent') }}</span>
          <q-badge color="blue" outline>{{ proposal.spoke_intent_for_originating_brief }}</q-badge>
        </div>
      </q-card-section>
    </q-card>

    <!-- Generate mode selector -->
    <div>
      <div class="text-caption text-grey-7 q-mb-sm">{{ $t('clusters.create.generateMode') }}</div>
      <q-btn-toggle
        :model-value="generateMode"
        toggle-color="primary"
        no-caps
        :options="[
          { label: $t('clusters.create.generateModeQueue'), value: 'queue' },
          { label: $t('clusters.create.generateModeNow'), value: 'now' },
        ]"
        @update:model-value="$emit('update:generateMode', $event)"
      />
    </div>

    <!-- Create button -->
    <q-btn
      unelevated
      no-caps
      color="primary"
      icon="hub"
      size="md"
      :label="creating ? $t('clusters.create.creating') as string : $t('clusters.create.createButton') as string"
      :loading="creating"
      @click="$emit('create')"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";

interface ClusterProposal {
  cluster_name: string;
  primary_keyword: string;
  description: string;
  intent_taxonomy_override: string[] | null;
  pillar_title: string;
  pillar_slug: string;
  pillar_meta: string;
  pillar_outline: string[];
  spoke_intent_for_originating_brief: string;
  reasoning: string;
}

export default defineComponent({
  name: "ClusterCreateConfirm",

  props: {
    proposal: {
      type: Object as PropType<ClusterProposal>,
      required: true,
    },
    briefTitle: { type: String, default: "" },
    generateMode: { type: String as PropType<"queue" | "now">, default: "queue" },
    creating: { type: Boolean, default: false },
  },

  emits: ["update:generateMode", "create"],

  computed: {
    effectiveIntents(): string[] {
      return this.proposal.intent_taxonomy_override ?? [];
    },
  },
});
</script>

<style scoped>
.field-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
</style>
