<template>
  <FormSection
    :title="$t('settings.signalSources.sources.github.configTitle') as string"
    :dirty="form.dirty.value"
    :saving="form.saving.value"
    @save="onSave"
    @cancel="form.cancel"
  >
    <FormField :label="$t('settings.signalSources.sources.github.topics') as string">
      <StringListEditor
        :model-value="form.formData.value.topics"
        :placeholder="$t('settings.signalSources.sources.github.topicsPlaceholder') as string"
        @update:model-value="(v: string[]) => { form.formData.value.topics = v; }"
      />
    </FormField>

    <div class="form-row">
      <FormField :label="$t('settings.signalSources.sources.github.timeWindowDays') as string">
        <FormInput
          :model-value="form.formData.value.timeWindowDays"
          type="number"
          inputmode="numeric"
          @update:model-value="(v: string) => { form.formData.value.timeWindowDays = v; }"
        />
      </FormField>

      <FormField :label="$t('settings.signalSources.sources.github.minStarsNew') as string">
        <FormInput
          :model-value="form.formData.value.minStarsNew"
          type="number"
          inputmode="numeric"
          @update:model-value="(v: string) => { form.formData.value.minStarsNew = v; }"
        />
      </FormField>

      <FormField :label="$t('settings.signalSources.sources.github.minStarsEstablished') as string">
        <FormInput
          :model-value="form.formData.value.minStarsEstablished"
          type="number"
          inputmode="numeric"
          @update:model-value="(v: string) => { form.formData.value.minStarsEstablished = v; }"
        />
      </FormField>

      <FormField :label="$t('settings.signalSources.sources.github.maxAgeDays') as string">
        <FormInput
          :model-value="form.formData.value.maxAgeDays"
          type="number"
          inputmode="numeric"
          @update:model-value="(v: string) => { form.formData.value.maxAgeDays = v; }"
        />
      </FormField>
    </div>

    <FormField
      :label="$t('settings.signalSources.sources.github.cronPattern') as string"
      :helper="$t('settings.signalSources.sources.github.cronPatternHelper') as string"
    >
      <FormInput
        :model-value="form.formData.value.cronPattern"
        @update:model-value="(v: string) => { form.formData.value.cronPattern = v; }"
      />
    </FormField>
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

interface GitHubFormData {
  topics: string[];
  timeWindowDays: string;
  minStarsNew: string;
  minStarsEstablished: string;
  maxAgeDays: string;
  cronPattern: string;
}

interface GitHubConfigRaw {
  topics?: string[];
  timeWindowDays?: number;
  minStarsNew?: number;
  minStarsEstablished?: number;
  maxAgeDays?: number;
  cronPattern?: string;
}

export default defineComponent({
  name: "GitHubConfigEditor",

  components: { FormSection, FormField, FormInput, StringListEditor },

  emits: ["saved"],

  props: {
    config: { type: Object as PropType<GitHubConfigRaw | null>, default: null },
    projectSlug: { type: String, required: true },
  },

  setup(props, { emit }) {
    const form = useSectionForm<GitHubFormData, void>({
      initialData: () => ({
        topics: props.config?.topics ?? [],
        timeWindowDays: String(props.config?.timeWindowDays ?? 7),
        minStarsNew: String(props.config?.minStarsNew ?? 20),
        minStarsEstablished: String(props.config?.minStarsEstablished ?? 500),
        maxAgeDays: String(props.config?.maxAgeDays ?? 14),
        cronPattern: props.config?.cronPattern ?? "0 3 * * *",
      }),
      onSave: async (data) => {
        await apiPatch(`/projects/${props.projectSlug}/signal-sources/github`, {
          topics: data.topics,
          timeWindowDays: parseInt(data.timeWindowDays, 10) || 1,
          minStarsNew: parseInt(data.minStarsNew, 10) || 0,
          minStarsEstablished: parseInt(data.minStarsEstablished, 10) || 0,
          maxAgeDays: parseInt(data.maxAgeDays, 10) || 1,
          cronPattern: data.cronPattern,
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
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 12px;
}
</style>
