<template>
  <PhaseShell
    :current-phase="5"
    :title="$t('coldStart.phases.confirm.title') as string"
    :description="$t('coldStart.phases.confirm.description') as string"
    :busy="finalizing"
    :advance-label="$t('coldStart.phases.confirm.launch') as string"
    @advance="onLaunch"
    @back="back()"
  >
    <div class="confirm-summary">
      <!-- Basics -->
      <section class="summary-section">
        <h3 class="summary-section-title">
          {{ $t("coldStart.phases.confirm.basics") as string }}
        </h3>
        <dl class="summary-list">
          <dt>{{ $t("coldStart.phases.basics.fields.name") as string }}</dt>
          <dd>{{ draft?.name || notSet }}</dd>
          <dt>{{ $t("coldStart.phases.basics.fields.domain") as string }}</dt>
          <dd>{{ draft?.domain || notSet }}</dd>
          <dt>{{ $t("coldStart.phases.basics.fields.industry") as string }}</dt>
          <dd>{{ draft?.industry || notSet }}</dd>
          <dt>{{ $t("coldStart.phases.basics.fields.targetLocales") as string }}</dt>
          <dd>{{ localeDisplay }}</dd>
        </dl>
      </section>

      <!-- Brand -->
      <section v-if="draft?.brandTokens" class="summary-section">
        <h3 class="summary-section-title">
          {{ $t("coldStart.phases.confirm.brand") as string }}
        </h3>
        <div class="brand-preview">
          <div
            class="brand-swatch"
            :style="{ background: draft.brandTokens.colors?.primary }"
            :title="draft.brandTokens.colors?.primary"
          />
          <div
            class="brand-swatch"
            :style="{ background: draft.brandTokens.colors?.secondary }"
            :title="draft.brandTokens.colors?.secondary"
          />
          <span v-if="draft.brandTokens.typography?.headingFont" class="brand-font mono text-dim">
            {{ draft.brandTokens.typography.headingFont }}
          </span>
        </div>
      </section>

      <!-- Pillars -->
      <section v-if="draft?.pillars?.length" class="summary-section">
        <h3 class="summary-section-title">
          {{ $t("coldStart.phases.confirm.pillars") as string }}
        </h3>
        <ul class="summary-tag-list">
          <li v-for="pillar in draft.pillars" :key="pillar.id ?? pillar.name" class="summary-tag">
            {{ pillar.name }}
          </li>
        </ul>
      </section>

      <!-- Authors -->
      <section v-if="draft?.authors?.length" class="summary-section">
        <h3 class="summary-section-title">
          {{ $t("coldStart.phases.confirm.authors") as string }}
        </h3>
        <ul class="summary-tag-list">
          <li v-for="author in draft.authors" :key="author.slug ?? author.name" class="summary-tag">
            {{ author.name }}
          </li>
        </ul>
      </section>

      <!-- Cost estimate -->
      <section class="summary-section cost-section">
        <h3 class="summary-section-title">
          {{ $t("coldStart.phases.confirm.cost.title") as string }}
        </h3>
        <p class="cost-desc">
          {{ $t("coldStart.phases.confirm.cost.description") as string }}
        </p>
        <div class="cost-grid">
          <div class="cost-item">
            <label>{{ $t("coldStart.phases.confirm.cost.initialPillars") as string }}</label>
            <span class="mono">~€{{ initialCostEstimate.toFixed(2) }}</span>
          </div>
          <div class="cost-item">
            <label>{{ $t("coldStart.phases.confirm.cost.firstMonth") as string }}</label>
            <span class="mono">~€{{ monthlyCostEstimate.toFixed(2) }}</span>
          </div>
        </div>
      </section>
    </div>
  </PhaseShell>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useColdStartDraft } from "src/composables/useColdStartDraft";
import PhaseShell from "src/components/cold-start/PhaseShell.vue";

export default defineComponent({
  name: "ColdStartPhase5Confirm",

  components: { PhaseShell },

  setup() {
    return useColdStartDraft();
  },

  computed: {
    notSet(): string {
      return this.$t("common.notSet") as string;
    },
    localeDisplay(): string {
      return (this.draft?.targetLocales ?? []).join(", ").toUpperCase() || this.notSet;
    },
    initialCostEstimate(): number {
      // ~€3.99 per pillar cluster generation (based on Spec 54.12 cost data)
      const pillarCount = this.draft?.pillars?.length ?? 3;
      return pillarCount * 3.99;
    },
    monthlyCostEstimate(): number {
      // 8 articles/month at ~€0.39 + 4 trend briefs at ~€0.15
      return 8 * 0.39 + 4 * 0.15;
    },
  },

  methods: {
    async onLaunch(): Promise<void> {
      try {
        await this.finalize();
        // Router navigation handled by useColdStartDraft finalize onSuccess
      } catch (err) {
        this.$q.notify({
          type: "negative",
          message:
            err instanceof Error
              ? err.message
              : (this.$t("coldStart.errors.launchFailed") as string),
        });
      }
    },
  },
});
</script>

<style scoped>
.confirm-summary {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.summary-section {
  padding: 16px 0;
  border-bottom: 1px solid var(--border-subtle);
}

.summary-section:last-child {
  border-bottom: none;
}

.summary-section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 0 0 12px;
}

.summary-list {
  display: grid;
  grid-template-columns: max-content 1fr;
  column-gap: 16px;
  row-gap: 6px;
  font-size: 13px;
}

.summary-list dt {
  color: var(--text-tertiary);
  font-weight: 500;
}

.summary-list dd {
  color: var(--text-primary);
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.brand-preview {
  display: flex;
  align-items: center;
  gap: 8px;
}

.brand-swatch {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.brand-font {
  font-size: 12px;
}

.summary-tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.summary-tag {
  padding: 4px 12px;
  background: var(--bg-glass-strong);
  border: 1px solid var(--border-subtle);
  border-radius: 20px;
  font-size: 12px;
  color: var(--text-primary);
}

.cost-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0 0 12px;
}

.cost-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cost-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
}

.cost-item label {
  color: var(--text-secondary);
}

.cost-item span {
  color: var(--text-primary);
  font-weight: 600;
}

.cost-section {
  background: rgba(124, 92, 255, 0.04);
  border-radius: var(--radius-md);
  padding: 16px;
  margin-top: 4px;
  border-top: none !important;
  border: 1px solid rgba(124, 92, 255, 0.1);
}
</style>
