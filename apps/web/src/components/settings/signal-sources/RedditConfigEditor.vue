<template>
  <FormSection
    :title="$t('settings.signalSources.sources.reddit.configTitle') as string"
    :dirty="form.dirty.value"
    :saving="form.saving.value"
    @save="onSave"
    @cancel="form.cancel"
  >
    <FormField :label="$t('settings.signalSources.sources.reddit.subreddits') as string">
      <StringListEditor
        :model-value="form.formData.value.subreddits"
        :placeholder="$t('settings.signalSources.sources.reddit.subredditsPlaceholder') as string"
        @update:model-value="(v: string[]) => { form.formData.value.subreddits = v; }"
      />
    </FormField>

    <div class="form-row">
      <FormField :label="$t('settings.signalSources.sources.reddit.sortMode') as string">
        <FormSelect
          :model-value="form.formData.value.sortMode"
          @update:model-value="(v: string) => { form.formData.value.sortMode = v; }"
        >
          <option value="top">{{ $t("settings.signalSources.sources.reddit.sortMode.top") as string }}</option>
          <option value="hot">{{ $t("settings.signalSources.sources.reddit.sortMode.hot") as string }}</option>
          <option value="new">{{ $t("settings.signalSources.sources.reddit.sortMode.new") as string }}</option>
        </FormSelect>
      </FormField>

      <FormField :label="$t('settings.signalSources.sources.reddit.timeWindow') as string">
        <FormSelect
          :model-value="form.formData.value.timeWindow"
          @update:model-value="(v: string) => { form.formData.value.timeWindow = v; }"
        >
          <option value="day">{{ $t("settings.signalSources.sources.reddit.timeWindow.day") as string }}</option>
          <option value="week">{{ $t("settings.signalSources.sources.reddit.timeWindow.week") as string }}</option>
          <option value="month">{{ $t("settings.signalSources.sources.reddit.timeWindow.month") as string }}</option>
        </FormSelect>
      </FormField>
    </div>

    <div class="form-row">
      <FormField :label="$t('settings.signalSources.sources.reddit.minUpvotes') as string">
        <FormInput
          :model-value="form.formData.value.minUpvotes"
          type="number"
          inputmode="numeric"
          @update:model-value="(v: string) => { form.formData.value.minUpvotes = v; }"
        />
      </FormField>

      <FormField :label="$t('settings.signalSources.sources.reddit.minComments') as string">
        <FormInput
          :model-value="form.formData.value.minComments"
          type="number"
          inputmode="numeric"
          @update:model-value="(v: string) => { form.formData.value.minComments = v; }"
        />
      </FormField>

      <FormField :label="$t('settings.signalSources.sources.reddit.maxAgeDays') as string">
        <FormInput
          :model-value="form.formData.value.maxAgeDays"
          type="number"
          inputmode="numeric"
          @update:model-value="(v: string) => { form.formData.value.maxAgeDays = v; }"
        />
      </FormField>
    </div>

    <FormField
      :label="$t('settings.signalSources.sources.reddit.cronPattern') as string"
      :helper="$t('settings.signalSources.sources.reddit.cronPatternHelper') as string"
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
import FormSelect from "src/components/forms/FormSelect.vue";
import StringListEditor from "src/components/settings/StringListEditor.vue";
import { useSectionForm } from "src/composables/useSectionForm";
import { apiPatch } from "src/lib/api";

interface RedditConfig {
  subreddits: string[];
  sortMode: string;
  timeWindow: string;
  minUpvotes: string;
  minComments: string;
  maxAgeDays: string;
  cronPattern: string;
}

interface RedditConfigRaw {
  subreddits?: string[];
  sortMode?: string;
  timeWindow?: string;
  minUpvotes?: number;
  minComments?: number;
  maxAgeDays?: number;
  cronPattern?: string;
}

export default defineComponent({
  name: "RedditConfigEditor",

  components: { FormSection, FormField, FormInput, FormSelect, StringListEditor },

  emits: ["saved"],

  props: {
    config: { type: Object as PropType<RedditConfigRaw | null>, default: null },
    projectSlug: { type: String, required: true },
  },

  setup(props, { emit }) {
    const form = useSectionForm<RedditConfig, void>({
      initialData: () => ({
        subreddits: props.config?.subreddits ?? [],
        sortMode: props.config?.sortMode ?? "top",
        timeWindow: props.config?.timeWindow ?? "week",
        minUpvotes: String(props.config?.minUpvotes ?? 50),
        minComments: String(props.config?.minComments ?? 10),
        maxAgeDays: String(props.config?.maxAgeDays ?? 7),
        cronPattern: props.config?.cronPattern ?? "30 2 * * *",
      }),
      onSave: async (data) => {
        await apiPatch(`/projects/${props.projectSlug}/signal-sources/reddit`, {
          subreddits: data.subreddits,
          sortMode: data.sortMode,
          timeWindow: data.timeWindow,
          minUpvotes: parseInt(data.minUpvotes, 10) || 0,
          minComments: parseInt(data.minComments, 10) || 0,
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
