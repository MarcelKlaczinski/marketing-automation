<template>
  <FormSelect
    :model-value="modelValue ?? ''"
    @update:model-value="$emit('update:modelValue', $event || null)"
  >
    <option value="">{{ $t("articleTools.generate.noCluster") as string }}</option>
    <option v-for="cluster in clusters" :key="cluster.id" :value="cluster.id">
      {{ cluster.name }}
    </option>
  </FormSelect>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useRoute } from "vue-router";
import FormSelect from "src/components/forms/FormSelect.vue";
import { apiGet } from "src/lib/api";

interface ClusterOption {
  id: string;
  name: string;
}

export default defineComponent({
  name: "ClusterPicker",

  components: { FormSelect },

  props: {
    modelValue: { type: String, default: null },
  },

  emits: ["update:modelValue"],

  setup() {
    const route = useRoute();
    return { slug: route.params.slug as string };
  },

  data: () => ({
    clusters: [] as ClusterOption[],
  }),

  mounted() {
    void this.fetchClusters();
  },

  methods: {
    async fetchClusters(): Promise<void> {
      try {
        const data = await apiGet<ClusterOption[]>(`/projects/${this.slug}/clusters`);
        this.clusters = data;
      } catch {
        // clusters list is optional — leave empty on error
      }
    },
  },
});
</script>
