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
        <template #header-actions>
          <GlassButton
            v-if="project?.astroRepo"
            variant="ghost"
            size="sm"
            :loading="importInFlight"
            @click="onTriggerImport"
          >
            {{ $t('settings.project.astro.triggerImport') as string }}
          </GlassButton>
        </template>
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

      <!-- Section 7: Social Media -->
      <FormSection
        :title="$t('settings.project.social.title')"
        :description="$t('settings.project.social.description')"
        :dirty="socialForm.dirty.value"
        :saving="socialForm.saving.value"
        :last-saved-at="socialForm.lastSavedAt.value ?? ''"
        @save="socialForm.save()"
        @cancel="socialForm.cancel()"
      >
        <FormField
          :label="$t('social.settings.autoRenderLocales.label')"
          :helper="$t('social.settings.autoRenderLocales.hint')"
        >
          <div class="radio-group">
            <label class="radio-row">
              <input
                type="radio"
                value="one"
                v-model="socialForm.formData.value.socialAutoRenderLocales"
                class="radio-input"
              />
              <span>{{ $t("social.settings.autoRenderLocales.one") as string }}</span>
            </label>
            <label class="radio-row">
              <input
                type="radio"
                value="all"
                v-model="socialForm.formData.value.socialAutoRenderLocales"
                class="radio-input"
              />
              <span>{{ $t("social.settings.autoRenderLocales.all") as string }}</span>
            </label>
          </div>
        </FormField>
      </FormSection>

      <!-- Section 8: Discovery automation -->
      <FormSection
        :title="$t('settings.discovery.title')"
        :description="$t('settings.discovery.description')"
        :dirty="discoveryForm.dirty.value"
        :saving="discoveryForm.saving.value"
        :last-saved-at="discoveryForm.lastSavedAt.value ?? ''"
        @save="discoveryForm.save()"
        @cancel="discoveryForm.cancel()"
      >
        <!-- Trends cron -->
        <div class="discovery-row">
          <div class="discovery-row-info">
            <h4 class="discovery-row-title">{{ $t("settings.discovery.trends.title") }}</h4>
            <p class="discovery-row-desc">{{ $t("settings.discovery.trends.description") }}</p>
            <CronStatusDisplay
              v-if="cronStatus"
              :status="cronStatus.trendsSynthesizer"
              :triggering="trendsTriggeringInFlight"
              @trigger="onTriggerCron('trends_synthesizer')"
            />
          </div>
          <label class="toggle-switch">
            <input
              type="checkbox"
              v-model="discoveryForm.formData.value.trendsCronEnabled"
            />
            <span class="toggle-slider" />
          </label>
        </div>

        <!-- Refresh cron -->
        <div class="discovery-row">
          <div class="discovery-row-info">
            <h4 class="discovery-row-title">{{ $t("settings.discovery.refresh.title") }}</h4>
            <p class="discovery-row-desc">{{ $t("settings.discovery.refresh.description") }}</p>
            <CronStatusDisplay
              v-if="cronStatus"
              :status="cronStatus.refreshDetector"
              :triggering="refreshTriggeringInFlight"
              @trigger="onTriggerCron('refresh_detector')"
            />
          </div>
          <label class="toggle-switch">
            <input
              type="checkbox"
              v-model="discoveryForm.formData.value.refreshCronEnabled"
            />
            <span class="toggle-slider" />
          </label>
        </div>

        <!-- Quality analysis cron -->
        <div class="discovery-row">
          <div class="discovery-row-info">
            <h4 class="discovery-row-title">{{ $t("settings.discovery.qualityAnalysis.title") }}</h4>
            <p class="discovery-row-desc">{{ $t("settings.discovery.qualityAnalysis.description") }}</p>
            <CronStatusDisplay
              v-if="cronStatus && cronStatus.qualityAnalysis"
              :status="cronStatus.qualityAnalysis"
              :triggering="qualityAnalysisTriggeringInFlight"
              @trigger="onTriggerCron('quality_analysis')"
            />
          </div>
          <label class="toggle-switch">
            <input
              type="checkbox"
              v-model="discoveryForm.formData.value.qualityAnalysisCronEnabled"
            />
            <span class="toggle-slider" />
          </label>
        </div>

        <!-- Staleness threshold -->
        <FormField
          :label="$t('settings.discovery.refresh.thresholdLabel')"
          :helper="$t('settings.discovery.refresh.thresholdHelper')"
        >
          <FormInput
            v-model="discoveryForm.formData.value.refreshStalenessThresholdDays"
            type="number"
            inputmode="numeric"
            min="7"
            max="365"
            autocomplete="off"
          />
        </FormField>

        <!-- Auto-approve gaps -->
        <div class="discovery-row">
          <div class="discovery-row-info">
            <h4 class="discovery-row-title">{{ $t("settings.discovery.autoApproveGaps.title") }}</h4>
            <p class="discovery-row-desc">{{ $t("settings.discovery.autoApproveGaps.description") }}</p>
            <p class="discovery-warning">{{ $t("settings.discovery.autoApproveGaps.warning") }}</p>
          </div>
          <label class="toggle-switch">
            <input
              type="checkbox"
              v-model="discoveryForm.formData.value.autoApproveGaps"
            />
            <span class="toggle-slider" />
          </label>
        </div>
      </FormSection>

      <!-- Section 9: Template Overrides -->
      <TemplateOverridesSection :slug="($route.params.slug as string)" />
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
import GlassButton from "src/components/ui/GlassButton.vue";
import CronStatusDisplay from "src/components/settings/CronStatusDisplay.vue";
import TemplateOverridesSection from "src/components/settings/TemplateOverridesSection.vue";
import { useSettingsProjectPage } from "src/composables/useSettingsProjectPage";
import { apiPost } from "src/lib/api";

export default defineComponent({
  name: "SettingsProjectPage",

  components: {
    FormSection,
    FormField,
    FormInput,
    FormSelect,
    FormTextarea,
    GlassButton,
    CronStatusDisplay,
    TemplateOverridesSection,
  },

  setup() {
    const route = useRoute();
    const slug = route.params.slug as string;
    // Returns all form sections including socialForm
    return useSettingsProjectPage(slug);
  },

  data: () => ({
    trendsTriggeringInFlight: false,
    refreshTriggeringInFlight: false,
    qualityAnalysisTriggeringInFlight: false,
    importInFlight: false,
  }),

  methods: {
    async onTriggerImport(): Promise<void> {
      const slug = (this.$route.params.slug as string);
      this.importInFlight = true;
      try {
        await apiPost(`/projects/${slug}/astro-import`);
        this.$q.notify({ type: "positive", message: this.$t("settings.project.astro.importStarted") as string });
      } catch {
        this.$q.notify({ type: "negative", message: this.$t("settings.project.astro.importError") as string });
      } finally {
        this.importInFlight = false;
      }
    },

    async onTriggerCron(jobType: "trends_synthesizer" | "refresh_detector" | "quality_analysis"): Promise<void> {
      if (jobType === "trends_synthesizer") this.trendsTriggeringInFlight = true;
      else if (jobType === "refresh_detector") this.refreshTriggeringInFlight = true;
      else this.qualityAnalysisTriggeringInFlight = true;
      try {
        await this.triggerCron(jobType);
      } finally {
        if (jobType === "trends_synthesizer") this.trendsTriggeringInFlight = false;
        else if (jobType === "refresh_detector") this.refreshTriggeringInFlight = false;
        else this.qualityAnalysisTriggeringInFlight = false;
      }
    },
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

.checkbox-row,
.radio-row {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  font-size: 14px;
  color: var(--text-primary);
}

.radio-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.radio-input {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: var(--accent-primary);
}

.checkbox-input {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: var(--accent-primary);
}

/* Discovery section */
.discovery-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
}

.discovery-row:last-of-type {
  border-bottom: none;
}

.discovery-row-info {
  flex: 1;
  min-width: 0;
}

.discovery-row-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 4px;
}

.discovery-row-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0 0 4px;
}

.discovery-warning {
  font-size: 12px;
  color: var(--color-warning, #f59e0b);
  margin: 4px 0 0;
}

/* Toggle switch */
.toggle-switch {
  position: relative;
  display: inline-flex;
  width: 40px;
  height: 22px;
  flex-shrink: 0;
  cursor: pointer;
  margin-top: 2px;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
  position: absolute;
}

.toggle-slider {
  position: absolute;
  inset: 0;
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
  border-radius: 11px;
  transition: background 0.2s var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.toggle-slider::before {
  content: "";
  position: absolute;
  width: 16px;
  height: 16px;
  left: 2px;
  top: 2px;
  background: var(--text-tertiary);
  border-radius: 50%;
  transition: transform 0.2s var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
              background 0.2s var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.toggle-switch input:checked + .toggle-slider {
  background: color-mix(in oklch, var(--accent-primary) 20%, transparent);
  border-color: var(--accent-primary);
}

.toggle-switch input:checked + .toggle-slider::before {
  transform: translateX(18px);
  background: var(--accent-primary);
}

@media (max-width: 767px) {
  .toggle-switch {
    width: 48px;
    height: 28px;
    border-radius: 14px;
  }

  .toggle-slider::before {
    width: 20px;
    height: 20px;
  }

  .toggle-switch input:checked + .toggle-slider::before {
    transform: translateX(20px);
  }
}
</style>
