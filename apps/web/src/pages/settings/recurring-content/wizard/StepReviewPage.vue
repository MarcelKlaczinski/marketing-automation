<template>
  <WizardStepShell
    :step-number="4"
    :title="$t('recurringContent.wizard.review.title') as string"
    :description="$t('recurringContent.wizard.review.description') as string"
    :busy="creating"
    :can-advance="!creating"
    :advance-label="$t('recurringContent.wizard.review.create') as string"
    @back="onBack"
    @advance="onCreate"
  >
    <dl class="review-list">
      <div class="review-row">
        <dt>{{ $t("recurringContent.wizard.review.name") as string }}</dt>
        <dd>{{ d.name || "—" }}</dd>
      </div>
      <div class="review-row">
        <dt>{{ $t("recurringContent.wizard.review.formatType") as string }}</dt>
        <dd class="mono">{{ d.formatType }}</dd>
      </div>
      <div class="review-row">
        <dt>{{ $t("recurringContent.wizard.review.frequency") as string }}</dt>
        <dd class="mono">{{ d.frequency }}</dd>
      </div>
      <div class="review-row">
        <dt>{{ $t("recurringContent.wizard.review.outputTargets") as string }}</dt>
        <dd>{{ outputLabel }}</dd>
      </div>
      <div class="review-row">
        <dt>{{ $t("recurringContent.wizard.review.locales") as string }}</dt>
        <dd>{{ d.targetLocales.join(", ").toUpperCase() }}</dd>
      </div>
      <div class="review-row">
        <dt>{{ $t("recurringContent.wizard.review.autoApprove") as string }}</dt>
        <dd>{{ autoApproveLabel }}</dd>
      </div>
      <div class="review-row">
        <dt>{{ $t("recurringContent.wizard.review.config") as string }}</dt>
        <dd>
          <pre class="config-preview">{{ configPreview }}</pre>
        </dd>
      </div>
    </dl>

    <div v-if="submitError" class="state-banner error" role="alert">
      {{ submitError }}
    </div>
  </WizardStepShell>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { apiPost } from "src/lib/api";
import WizardStepShell from "src/components/settings/recurring-content/wizard/WizardStepShell.vue";
import { useRecurringWizardDraftStore } from "src/stores/recurring-wizard-draft";

interface CreatedDefinitionResponse {
  definition: { id: string };
}

export default defineComponent({
  name: "StepReviewPage",

  components: { WizardStepShell },

  data: () => ({
    creating: false,
    submitError: "",
  }),

  computed: {
    slug(): string {
      const v = this.$route.params.slug;
      return Array.isArray(v) ? (v[0] ?? "") : v ?? "";
    },
    store() {
      return useRecurringWizardDraftStore();
    },
    d() {
      return this.store.draft;
    },
    configPreview(): string {
      return JSON.stringify(this.d.formatConfig ?? {}, null, 2);
    },
    outputLabel(): string {
      const parts: string[] = [];
      if (this.d.outputTargets.article) {
        parts.push(this.$t("recurringContent.wizard.schedule.outputArticle") as string);
      }
      if (this.d.outputTargets.social) {
        parts.push(this.$t("recurringContent.wizard.schedule.outputSocial") as string);
      }
      return parts.join(" + ");
    },
    autoApproveLabel(): string {
      if (this.d.autoApproveOverride === null) {
        return this.$t("recurringContent.wizard.schedule.autoApproveInherit") as string;
      }
      return this.d.autoApproveOverride
        ? (this.$t("recurringContent.wizard.schedule.autoApproveOn") as string)
        : (this.$t("recurringContent.wizard.schedule.autoApproveOff") as string);
    },
  },

  mounted() {
    if (!this.d.formatType) {
      void this.$router.replace({ name: "wizard-step-format-type", params: { slug: this.slug } });
    }
  },

  methods: {
    onBack(): void {
      void this.$router.push({ name: "wizard-step-schedule", params: { slug: this.slug } });
    },

    async onCreate(): Promise<void> {
      this.submitError = "";
      this.creating = true;
      try {
        const body: Record<string, unknown> = {
          name: this.d.name.trim(),
          formatType: this.d.formatType,
          formatConfig: this.d.formatConfig,
          frequency: this.d.frequency,
          outputTargets: this.d.outputTargets,
          templateSelectionStrategy: this.d.templateSelectionStrategy,
          autoApproveOverride: this.d.autoApproveOverride,
          isActive: true,
        };
        if (this.d.fixedTemplateKey) {
          body.fixedTemplateKey = this.d.fixedTemplateKey;
        }
        const result = await apiPost<CreatedDefinitionResponse>(
          `/projects/${this.slug}/recurring-content/definitions`,
          body,
        );
        this.store.clearDraft();
        this.$q.notify({
          type: "positive",
          message: this.$t("recurringContent.wizard.review.createSuccess") as string,
        });
        void this.$router.push({
          name: "settings-recurring-content-detail",
          params: { slug: this.slug, id: result.definition.id },
        });
      } catch (err) {
        this.submitError = err instanceof Error
          ? err.message
          : (this.$t("recurringContent.wizard.review.createError") as string);
      } finally {
        this.creating = false;
      }
    },
  },
});
</script>

<style scoped>
.review-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
}
.review-row {
  display: grid;
  grid-template-columns: 180px 1fr;
  gap: 12px;
  align-items: start;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-subtle);
}
.review-row:last-child {
  border-bottom: none;
}
.review-row dt {
  color: var(--text-tertiary);
  font-size: 13px;
}
.review-row dd {
  margin: 0;
  color: var(--text-primary);
  font-size: 14px;
}
.mono {
  font-family: ui-monospace, "JetBrains Mono", "Menlo", monospace;
  font-size: 13px;
}
.config-preview {
  margin: 0;
  background: var(--surface-strong);
  border-radius: 6px;
  padding: 10px;
  font-family: ui-monospace, "JetBrains Mono", "Menlo", monospace;
  font-size: 12px;
  white-space: pre-wrap;
}
.state-banner {
  padding: 12px;
  border-radius: 8px;
  background: var(--surface-strong);
  font-size: 13px;
}
.state-banner.error {
  color: var(--text-error);
  background: color-mix(in oklch, var(--text-error) 12%, transparent);
}
</style>
