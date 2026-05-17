<template>
  <div class="settings-project">
    <h1 class="page-title">{{ $t("settings.project.title") }}</h1>

    <div v-if="isLoading" class="page-loading">
      <span class="mono">{{ $t("common.loading") }}</span>
    </div>

    <template v-else>
      <!-- Section 1: Basics -->
      <FormSection
        :title="$t('settings.project.basics.title')"
        :description="$t('settings.project.basics.description')"
        :dirty="basicsForm.dirty.value"
        :saving="basicsForm.saving.value"
        :last-saved-at="basicsForm.lastSavedAt.value ?? ''"
        @save="basicsForm.save()"
        @cancel="basicsForm.cancel()"
      >
        <FormField :label="$t('settings.project.fields.name')" required>
          <FormInput v-model="basicsForm.formData.value.name" autocomplete="off" />
        </FormField>

        <FormField
          :label="$t('settings.project.fields.domain')"
          :helper="$t('settings.project.fields.domainHelper')"
        >
          <FormInput
            v-model="basicsForm.formData.value.domain"
            placeholder="example.com"
            inputmode="url"
            autocomplete="off"
          />
        </FormField>

        <FormField :label="$t('settings.project.fields.industry')">
          <FormSelect v-model="basicsForm.formData.value.industry">
            <option value="ai_education">{{ $t("industries.ai_education") }}</option>
            <option value="automotive_dealer">{{ $t("industries.automotive_dealer") }}</option>
            <option value="renewable_affiliate">{{ $t("industries.renewable_affiliate") }}</option>
            <option value="music_school">{{ $t("industries.music_school") }}</option>
            <option value="other">{{ $t("industries.other") }}</option>
          </FormSelect>
        </FormField>
      </FormSection>

      <!-- Section 2: Marketing Context -->
      <FormSection
        :title="$t('settings.project.marketing.title')"
        :description="$t('settings.project.marketing.description')"
        :dirty="marketingForm.dirty.value"
        :saving="marketingForm.saving.value"
        :last-saved-at="marketingForm.lastSavedAt.value ?? ''"
        @save="marketingForm.save()"
        @cancel="marketingForm.cancel()"
      >
        <FormField
          :label="$t('settings.project.fields.marketingContextMd')"
          :helper="$t('settings.project.fields.marketingContextMdHelper')"
        >
          <FormTextarea
            v-model="marketingForm.formData.value.marketingContextMd"
            :rows="12"
          />
        </FormField>
      </FormSection>

      <!-- Section 3: Cost limits -->
      <FormSection
        :title="$t('settings.project.costLimits.title')"
        :description="$t('settings.project.costLimits.description')"
        :dirty="costForm.dirty.value"
        :saving="costForm.saving.value"
        :last-saved-at="costForm.lastSavedAt.value ?? ''"
        @save="costForm.save()"
        @cancel="costForm.cancel()"
      >
        <FormField
          :label="$t('settings.project.fields.monthlyBudget')"
          :helper="$t('settings.project.fields.monthlyBudgetHelper')"
        >
          <FormInput
            v-model="costForm.formData.value.monthlyBudgetEur"
            type="number"
            inputmode="decimal"
            step="0.01"
            min="0"
            autocomplete="off"
          />
        </FormField>

        <FormField
          :label="$t('settings.project.fields.alertThreshold')"
          :helper="$t('settings.project.fields.alertThresholdHelper')"
        >
          <FormInput
            v-model="costForm.formData.value.alertThresholdPercent"
            type="number"
            inputmode="numeric"
            min="0"
            max="100"
            autocomplete="off"
          />
        </FormField>
      </FormSection>

      <!-- Section 4: Astro repo -->
      <FormSection
        :title="$t('settings.project.astro.title')"
        :description="$t('settings.project.astro.description')"
        :dirty="astroForm.dirty.value"
        :saving="astroForm.saving.value"
        :last-saved-at="astroForm.lastSavedAt.value ?? ''"
        @save="astroForm.save()"
        @cancel="astroForm.cancel()"
      >
        <div v-if="project?.astroRepo" class="repo-info mono">
          {{ project.astroRepo.owner }}/{{ project.astroRepo.name }}
        </div>
        <div v-else class="repo-unconfigured">{{ $t("settings.project.astro.notConfigured") }}</div>

        <FormField :label="$t('settings.project.fields.astroDefaultBranch')">
          <FormInput
            v-model="astroForm.formData.value.defaultBranch"
            :disabled="!project?.astroRepo"
            autocomplete="off"
          />
        </FormField>

        <FormField
          :label="$t('settings.project.fields.astroLocalPath')"
          :helper="$t('settings.project.fields.astroLocalPathHelper')"
        >
          <FormInput
            v-model="astroForm.formData.value.localPath"
            :disabled="!project?.astroRepo"
            placeholder="/Users/you/repos/my-astro-site"
            autocomplete="off"
          />
        </FormField>
      </FormSection>

      <!-- Section 5: PageSpeed thresholds -->
      <FormSection
        :title="$t('settings.project.pagespeed.title')"
        :description="$t('settings.project.pagespeed.description')"
        :dirty="pagespeedForm.dirty.value"
        :saving="pagespeedForm.saving.value"
        :last-saved-at="pagespeedForm.lastSavedAt.value ?? ''"
        @save="pagespeedForm.save()"
        @cancel="pagespeedForm.cancel()"
      >
        <FormField :label="$t('settings.project.fields.minPerformance')">
          <FormInput
            v-model="pagespeedForm.formData.value.minPerformance"
            type="number"
            inputmode="numeric"
            min="0"
            max="100"
            autocomplete="off"
          />
        </FormField>

        <FormField :label="$t('settings.project.fields.minSeo')">
          <FormInput
            v-model="pagespeedForm.formData.value.minSeo"
            type="number"
            inputmode="numeric"
            min="0"
            max="100"
            autocomplete="off"
          />
        </FormField>
      </FormSection>

      <!-- Section 6: Translation auto-trigger -->
      <FormSection
        :title="$t('settings.project.translation.title')"
        :description="$t('settings.project.translation.description')"
        :dirty="translationForm.dirty.value"
        :saving="translationForm.saving.value"
        :last-saved-at="translationForm.lastSavedAt.value ?? ''"
        @save="translationForm.save()"
        @cancel="translationForm.cancel()"
      >
        <FormField :helper="$t('settings.project.fields.translationAutoTriggerHelper')">
          <label class="checkbox-row">
            <input
              type="checkbox"
              v-model="translationForm.formData.value.translationAutoTrigger"
              class="checkbox-input"
            />
            <span>{{ $t("settings.project.fields.translationAutoTrigger") }}</span>
          </label>
        </FormField>
      </FormSection>
    </template>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useRoute } from "vue-router";
import FormSection from "src/components/forms/FormSection.vue";
import FormField from "src/components/forms/FormField.vue";
import FormInput from "src/components/forms/FormInput.vue";
import FormSelect from "src/components/forms/FormSelect.vue";
import FormTextarea from "src/components/forms/FormTextarea.vue";
import { useSettingsProjectPage } from "src/composables/useSettingsProjectPage";

export default defineComponent({
  name: "SettingsProjectPage",

  components: {
    FormSection,
    FormField,
    FormInput,
    FormSelect,
    FormTextarea,
  },

  setup() {
    const route = useRoute();
    const slug = route.params.slug as string;
    return useSettingsProjectPage(slug);
  },
});
</script>

<style scoped>
.settings-project {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 8px;
}

.page-loading {
  padding: 40px 0;
  color: var(--text-tertiary);
  font-size: 13px;
}

.repo-info {
  font-size: 12px;
  color: var(--text-secondary);
  padding: 6px 10px;
  background: var(--bg-glass);
  border-radius: var(--radius-sm);
  margin-bottom: 12px;
}

.repo-unconfigured {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-bottom: 12px;
}

.checkbox-row {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  font-size: 14px;
  color: var(--text-primary);
}

.checkbox-input {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: var(--accent-primary);
}
</style>
