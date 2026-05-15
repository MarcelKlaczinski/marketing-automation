<template>
  <div class="q-gutter-md">
    <!-- Cluster name -->
    <q-input
      v-model="local.cluster_name"
      outlined
      :label="$t('clusters.create.clusterName') as string"
      :hint="$t('clusters.create.clusterNameHint') as string"
      :rules="[v => (v && v.length >= 2 && v.length <= 100) || $t('clusters.validation.nameTooShort') as string]"
      maxlength="100"
      counter
      lazy-rules
      @update:model-value="onNameChange"
    />

    <!-- Primary keyword -->
    <q-input
      v-model="local.primary_keyword"
      outlined
      :label="$t('clusters.create.primaryKeyword') as string"
      :hint="$t('clusters.create.primaryKeywordHint') as string"
      :rules="[v => (v && v.length >= 2 && v.length <= 100) || $t('clusters.validation.nameTooShort') as string]"
      maxlength="100"
      counter
      lazy-rules
    />

    <!-- Description -->
    <q-input
      v-model="local.description"
      outlined
      type="textarea"
      :label="$t('clusters.create.description') as string"
      :hint="$t('clusters.create.descriptionHint') as string"
      maxlength="500"
      counter
      rows="3"
    />

    <!-- Intent taxonomy override -->
    <div>
      <div class="text-caption text-grey-7 q-mb-xs">{{ $t('clusters.create.intentTaxonomy') }}</div>
      <div class="text-caption text-grey-6 q-mb-sm">{{ $t('clusters.create.intentTaxonomyHint') }}</div>
      <div class="row q-gutter-xs q-mb-sm">
        <q-chip
          v-for="(intent, idx) in effectiveIntents"
          :key="intent"
          removable
          color="primary"
          text-color="white"
          size="sm"
          @remove="removeIntent(idx)"
        >
          {{ intent }}
        </q-chip>
      </div>
      <q-input
        v-model="newIntentInput"
        outlined
        dense
        :placeholder="$t('clusters.create.intentTaxonomyHint') as string"
        @keydown.enter.prevent="addIntent"
      >
        <template #append>
          <q-btn flat dense icon="add" @click="addIntent" />
        </template>
      </q-input>
      <q-checkbox
        v-model="useProjectDefault"
        :label="$t('clusters.create.useProjectDefault') as string"
        class="q-mt-sm"
        @update:model-value="onUseProjectDefaultChange"
      />
    </div>

    <!-- Spoke intent for originating brief -->
    <q-select
      v-model="local.spoke_intent_for_originating_brief"
      outlined
      :label="$t('clusters.create.spokeIntent') as string"
      :hint="$t('clusters.create.spokeIntentHint') as string"
      :options="effectiveIntents"
      :rules="[v => !!v || 'Required']"
      emit-value
      map-options
    />
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";

interface ClusterShapeLocal {
  cluster_name: string;
  primary_keyword: string;
  description: string;
  intent_taxonomy_override: string[] | null;
  spoke_intent_for_originating_brief: string;
}

export default defineComponent({
  name: "ClusterShapeForm",

  props: {
    modelValue: {
      type: Object as PropType<ClusterShapeLocal>,
      required: true,
    },
    projectDefaultIntents: {
      type: Array as PropType<string[]>,
      default: () => [],
    },
  },

  emits: ["update:modelValue"],

  data() {
    return {
      local: { ...this.modelValue } as ClusterShapeLocal,
      newIntentInput: "",
      useProjectDefault: this.modelValue.intent_taxonomy_override === null,
    };
  },

  computed: {
    effectiveIntents(): string[] {
      if (this.useProjectDefault || !this.local.intent_taxonomy_override) {
        return this.projectDefaultIntents;
      }
      return this.local.intent_taxonomy_override;
    },
  },

  watch: {
    modelValue: {
      deep: true,
      handler(v: ClusterShapeLocal) {
        this.local = { ...v };
        this.useProjectDefault = v.intent_taxonomy_override === null;
      },
    },
    local: {
      deep: true,
      handler() {
        this.$emit("update:modelValue", { ...this.local });
      },
    },
  },

  methods: {
    onNameChange(val: string | number | null): void {
      // auto-derive slug hint for pillar (not exposed here — handled in PillarSpecForm)
      void val;
    },

    addIntent(): void {
      const trimmed = this.newIntentInput.trim();
      if (!trimmed) return;
      const current = this.local.intent_taxonomy_override ?? [];
      if (current.includes(trimmed)) return;
      this.local.intent_taxonomy_override = [...current, trimmed];
      this.useProjectDefault = false;
      this.newIntentInput = "";
    },

    removeIntent(idx: number): void {
      const current = this.local.intent_taxonomy_override ?? [...this.projectDefaultIntents];
      const updated = current.filter((_, i) => i !== idx);
      this.local.intent_taxonomy_override = updated.length > 0 ? updated : null;
    },

    onUseProjectDefaultChange(val: boolean): void {
      if (val) {
        this.local.intent_taxonomy_override = null;
      } else {
        this.local.intent_taxonomy_override = [...this.projectDefaultIntents];
      }
    },
  },
});
</script>
