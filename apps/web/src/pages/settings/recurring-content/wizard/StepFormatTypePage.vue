<template>
  <WizardStepShell
    :step-number="1"
    :title="$t('recurringContent.wizard.formatType.title') as string"
    :description="$t('recurringContent.wizard.formatType.description') as string"
    :can-go-back="false"
    :can-advance="!!selectedKey"
    @advance="onAdvance"
  >
    <div v-if="loading" class="state-banner">{{ $t("common.loading") as string }}</div>
    <div v-else-if="loadError" class="state-banner error">{{ loadError }}</div>
    <div v-else class="card-grid">
      <button
        v-for="ft in formatTypes"
        :key="ft.key"
        :class="['format-card', { selected: selectedKey === ft.key }]"
        type="button"
        @click="selectedKey = ft.key"
      >
        <span class="card-family">
          {{ $t(`recurringContent.definitions.family.${ft.family}`) as string }}
        </span>
        <span class="card-title">{{ $t(`recurringContent.definitions.formatType.${ft.key}`) as string }}</span>
        <span class="card-desc">
          {{ $t(`recurringContent.wizard.formatType.descriptions.${ft.key}`, "") as string }}
        </span>
      </button>
    </div>
  </WizardStepShell>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { apiGet } from "src/lib/api";
import WizardStepShell from "src/components/settings/recurring-content/wizard/WizardStepShell.vue";
import { useRecurringWizardDraftStore } from "src/stores/recurring-wizard-draft";

interface FormatTypeInfo {
  key: string;
  family: "A" | "B";
  eligibleTemplates: string[];
  needsHooks: boolean;
  defaultEndSlides: string[];
}

export default defineComponent({
  name: "StepFormatTypePage",

  components: { WizardStepShell },

  data: () => ({
    formatTypes: [] as FormatTypeInfo[],
    loading: false,
    loadError: "",
    selectedKey: "" as string,
  }),

  computed: {
    slug(): string {
      const v = this.$route.params.slug;
      return Array.isArray(v) ? (v[0] ?? "") : v ?? "";
    },
    store() {
      return useRecurringWizardDraftStore();
    },
  },

  async mounted() {
    this.store.markStepReached(0);
    this.selectedKey = this.store.draft.formatType ?? "";
    await this.fetchFormatTypes();
  },

  methods: {
    async fetchFormatTypes() {
      this.loading = true;
      this.loadError = "";
      try {
        const res = await apiGet<{ formatTypes: FormatTypeInfo[] }>(
          `/projects/${this.slug}/recurring-content/definitions/format-types`,
        );
        this.formatTypes = res.formatTypes;
      } catch (err) {
        this.loadError = err instanceof Error
          ? err.message
          : (this.$t("recurringContent.wizard.formatType.loadError") as string);
      } finally {
        this.loading = false;
      }
    },

    onAdvance(): void {
      if (!this.selectedKey) return;
      // If user changed format-type, clear formatConfig so the per-format
      // form starts fresh — the previous format's schema is stale.
      const formatChanged = this.store.draft.formatType !== this.selectedKey;
      this.store.patchDraft({
        formatType: this.selectedKey,
        ...(formatChanged && { formatConfig: {} }),
      });
      this.store.markStepReached(1);
      void this.$router.push({ name: "wizard-step-config", params: { slug: this.slug } });
    },
  },
});
</script>

<style scoped>
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 14px;
}

.format-card {
  background: var(--surface-strong);
  border: 2px solid transparent;
  border-radius: 12px;
  padding: 16px 14px;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: inherit;
  font: inherit;
  transition:
    border-color 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
    background 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}
.format-card:hover {
  background: var(--surface-hover);
}
.format-card.selected {
  border-color: var(--brand-primary);
  background: color-mix(in oklch, var(--brand-primary) 12%, var(--surface-strong));
}

.card-family {
  font-size: 11px;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.card-title {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.card-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.4;
}

.state-banner {
  padding: 14px;
  border-radius: 8px;
  background: var(--surface-strong);
  color: var(--text-secondary);
  text-align: center;
}
.state-banner.error {
  color: var(--text-error);
  background: color-mix(in oklch, var(--text-error) 12%, transparent);
}
</style>
