<template>
  <FormSection
    :title="$t('settings.signalSources.sources.hackernews.configTitle') as string"
    :dirty="form.dirty.value"
    :saving="form.saving.value"
    @save="onSave"
    @cancel="form.cancel"
  >
    <FormField :label="$t('settings.signalSources.sources.hackernews.queries') as string">
      <StringListEditor
        :model-value="form.formData.value.queries"
        :placeholder="$t('settings.signalSources.sources.hackernews.queriesPlaceholder') as string"
        @update:model-value="(v: string[]) => { form.formData.value.queries = v; }"
      />
    </FormField>

    <div class="form-row">
      <FormField :label="$t('settings.signalSources.sources.hackernews.hitsPerPage') as string">
        <FormInput
          :model-value="form.formData.value.hitsPerPage"
          type="number"
          inputmode="numeric"
          @update:model-value="(v: string) => { form.formData.value.hitsPerPage = v; }"
        />
      </FormField>

      <FormField :label="$t('settings.signalSources.sources.hackernews.minPoints') as string">
        <FormInput
          :model-value="form.formData.value.minPoints"
          type="number"
          inputmode="numeric"
          @update:model-value="(v: string) => { form.formData.value.minPoints = v; }"
        />
      </FormField>
    </div>
  </FormSection>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import FormSection from "src/components/forms/FormSection.vue";
import FormField from "src/components/forms/FormField.vue";
import FormInput from "src/components/forms/FormInput.vue";
import StringListEditor from "src/components/settings/StringListEditor.vue";
import { useSectionForm } from "src/composables/useSectionForm";
import { apiPatch } from "src/lib/api";

interface HNFormData {
  queries: string[];
  hitsPerPage: string;
  minPoints: string;
}

interface HNConfigRaw {
  queries?: string[];
  hitsPerPage?: number;
  minPoints?: number;
}

export default defineComponent({
  name: "HackerNewsConfigEditor",

  components: { FormSection, FormField, FormInput, StringListEditor },

  emits: ["saved"],

  props: {
    config: { type: Object as PropType<HNConfigRaw | null>, default: null },
    projectSlug: { type: String, required: true },
  },

  setup(props, { emit }) {
    const form = useSectionForm<HNFormData, void>({
      initialData: () => ({
        queries: props.config?.queries ?? [],
        hitsPerPage: String(props.config?.hitsPerPage ?? 50),
        minPoints: String(props.config?.minPoints ?? 5),
      }),
      onSave: async (data) => {
        await apiPatch(`/projects/${props.projectSlug}/signal-sources/hackernews`, {
          queries: data.queries,
          hitsPerPage: parseInt(data.hitsPerPage, 10) || 1,
          minPoints: parseInt(data.minPoints, 10) || 0,
        });
        emit("saved");
      },
    });
    return { form };
  },

  watch: {
    config() {
      this.form.resetFromUpstream();
    },
  },

  methods: {
    onSave() {
      void this.form.save();
    },
  },
});
</script>

<style scoped>
.form-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
}
</style>
