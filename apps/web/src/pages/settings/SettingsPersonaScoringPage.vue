<template>
  <div class="ps-page">
    <header class="page-header">
      <h1 class="page-title">{{ $t("settings.personaScoring.title") as string }}</h1>
      <p class="page-description">{{ $t("settings.personaScoring.description") as string }}</p>
    </header>

    <div v-if="loading" class="state-banner">
      {{ $t("settings.personaScoring.loading") as string }}
    </div>
    <div v-else-if="loadError" class="state-banner error" role="alert">
      {{ $t("settings.personaScoring.loadError") as string }}
    </div>

    <section v-else class="stats-row">
      <div class="stat">
        <div class="stat-value">{{ stats?.totalTools ?? 0 }}</div>
        <div class="stat-label">{{ $t("settings.personaScoring.stats.totalTools") as string }}</div>
      </div>
      <div class="stat">
        <div class="stat-value">{{ stats?.completeTools ?? 0 }}</div>
        <div class="stat-label">{{ $t("settings.personaScoring.stats.complete") as string }}</div>
      </div>
      <div class="stat">
        <div class="stat-value">{{ stats?.pendingTools ?? 0 }}</div>
        <div class="stat-label">{{ $t("settings.personaScoring.stats.pending") as string }}</div>
      </div>
      <div class="stat">
        <div class="stat-value">{{ stats?.freshWindowDays ?? 0 }}</div>
        <div class="stat-label">
          {{ $t("settings.personaScoring.stats.freshWindow", { days: stats?.freshWindowDays ?? 0 }) as string }}
        </div>
      </div>
    </section>

    <section v-if="!loading && stats" class="per-persona">
      <h2 class="section-title">{{ $t("settings.personaScoring.perPersona.heading") as string }}</h2>
      <ul class="persona-list">
        <li v-for="persona in stats.personasUsed" :key="persona" class="persona-row">
          <div class="persona-name mono">{{ persona }}</div>
          <div class="persona-progress">
            <div
              class="persona-bar"
              :style="{ width: progressPct(persona) + '%' }"
            />
          </div>
          <div class="persona-count mono">
            {{ $t("settings.personaScoring.perPersona.column", { count: freshCountFor(persona), total: stats?.totalTools ?? 0 }) as string }}
          </div>
        </li>
      </ul>
    </section>

    <section class="backfill-card">
      <h2 class="section-title">{{ $t("settings.personaScoring.backfill.cardTitle") as string }}</h2>
      <p class="card-hint">{{ $t("settings.personaScoring.backfill.cardHint") as string }}</p>

      <div class="backfill-controls">
        <label class="checkbox-row">
          <input v-model="force" type="checkbox" />
          <span>{{ $t("settings.personaScoring.backfill.force") as string }}</span>
        </label>
        <p class="control-hint">{{ $t("settings.personaScoring.backfill.forceHint") as string }}</p>

        <label class="number-row">
          <span class="number-label">{{ $t("settings.personaScoring.backfill.limitLabel") as string }}</span>
          <input v-model.number="limit" type="number" min="1" max="500" class="number-input" />
        </label>
        <p class="control-hint">{{ $t("settings.personaScoring.backfill.limitHint") as string }}</p>

        <div class="action-row">
          <q-btn
            outline
            color="white"
            :label="$t('settings.personaScoring.backfill.dryRun') as string"
            :disable="running"
            @click="runBackfill(false)"
          />
          <q-btn
            color="primary"
            :label="$t('settings.personaScoring.backfill.apply') as string"
            :disable="running"
            @click="runBackfill(true)"
          />
        </div>

        <div v-if="running" class="state-banner">
          {{ $t("settings.personaScoring.backfill.running") as string }}
        </div>

        <div v-if="lastResult" class="state-banner result">
          <div v-if="lastResult.dryRun">
            {{ $t("settings.personaScoring.backfill.successDry", { n: lastResult.candidatesBeforeRun }) as string }}
          </div>
          <div v-else>
            {{
              $t("settings.personaScoring.backfill.successApply", {
                written: lastResult.scoresWritten,
                processed: lastResult.totalProcessed,
              }) as string
            }}
            <span v-if="lastResult.errors.length > 0" class="error-suffix">
              {{ $t("settings.personaScoring.backfill.partialErrors", { errors: lastResult.errors.length }) as string }}
            </span>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { apiGet, apiPost } from "src/lib/api";

interface PersonaStats {
  totalTools: number;
  completeTools: number;
  pendingTools: number;
  perPersona: Record<string, { freshCount: number }>;
  personasUsed: readonly string[];
  freshWindowDays: number;
}

interface BackfillResult {
  projectSlug: string;
  candidatesBeforeRun: number;
  totalProcessed: number;
  bySource: { llm: number; skipped: number; failed: number };
  scoresWritten: number;
  errors: Array<{ toolId: string; error: string }>;
  dryRun: boolean;
}

export default defineComponent({
  name: "SettingsPersonaScoringPage",

  data: () => ({
    stats: null as PersonaStats | null,
    loading: true,
    loadError: false,
    running: false,
    force: false,
    limit: null as number | null,
    lastResult: null as BackfillResult | null,
  }),

  computed: {
    slug(): string {
      return this.$route.params.slug as string;
    },
  },

  mounted() {
    void this.loadStats();
  },

  methods: {
    async loadStats(): Promise<void> {
      this.loading = true;
      this.loadError = false;
      try {
        const data = await apiGet<PersonaStats>(
          `/projects/${this.slug}/persona-scoring/stats`,
        );
        this.stats = data;
      } catch (err) {
        this.loadError = true;
        // biome-ignore lint/suspicious/noConsoleLog: dev diagnostic
        if (import.meta.env.DEV) console.warn("[persona-scoring] loadStats failed", err);
      } finally {
        this.loading = false;
      }
    },

    freshCountFor(persona: string): number {
      return this.stats?.perPersona[persona]?.freshCount ?? 0;
    },

    progressPct(persona: string): number {
      if (!this.stats || this.stats.totalTools === 0) return 0;
      const fresh = this.freshCountFor(persona);
      return Math.min(100, Math.round((fresh / this.stats.totalTools) * 100));
    },

    async runBackfill(apply: boolean): Promise<void> {
      this.running = true;
      this.lastResult = null;
      try {
        const body: { apply: boolean; force?: boolean; limit?: number } = { apply };
        if (this.force) body.force = true;
        if (this.limit !== null && this.limit > 0) body.limit = this.limit;

        const result = await apiPost<BackfillResult>(
          `/projects/${this.slug}/persona-scoring/backfill`,
          body,
        );
        this.lastResult = result;

        this.$q.notify({
          type: apply ? "positive" : "info",
          message: apply
            ? (this.$t("settings.personaScoring.backfill.successApply", {
                written: result.scoresWritten,
                processed: result.totalProcessed,
              }) as string)
            : (this.$t("settings.personaScoring.backfill.successDry", {
                n: result.candidatesBeforeRun,
              }) as string),
        });

        // Re-fetch stats after apply (dry-run doesn't change DB state).
        if (apply) {
          await this.loadStats();
        }
      } catch (err) {
        this.$q.notify({
          type: "negative",
          message: (this.$t("settings.personaScoring.backfill.failed") as string) +
            (err instanceof Error ? `: ${err.message}` : ""),
        });
      } finally {
        this.running = false;
      }
    },
  },
});
</script>

<style scoped>
.ps-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4, 24px);
  max-width: 960px;
  padding-bottom: var(--space-7, 48px);
}

.page-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.page-title {
  font-size: 1.75rem;
  font-weight: 700;
  margin: 0;
}
.page-description {
  color: rgba(255, 255, 255, 0.65);
  margin: 0;
  max-width: 64ch;
}

.stats-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
}
.stat {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.stat-value {
  font-size: 2rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.stat-label {
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.55);
}

.section-title {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0 0 12px 0;
}

.per-persona {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 16px;
}
.persona-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.persona-row {
  display: grid;
  grid-template-columns: 140px 1fr 80px;
  align-items: center;
  gap: 12px;
  padding: 6px 0;
}
.persona-name {
  font-size: 0.9rem;
}
.persona-progress {
  height: 6px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 3px;
  overflow: hidden;
}
.persona-bar {
  height: 100%;
  background: var(--brand-color, oklch(64% 0.16 248));
  transition: width 250ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}
.persona-count {
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.55);
  text-align: right;
}
.mono {
  font-family: var(--font-family-mono, "JetBrains Mono", monospace);
}

.backfill-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 20px;
}
.card-hint {
  color: rgba(255, 255, 255, 0.65);
  margin: 0 0 16px 0;
  max-width: 64ch;
}
.backfill-controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.checkbox-row,
.number-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.number-label {
  min-width: 180px;
}
.number-input {
  width: 100px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  padding: 6px 10px;
  color: white;
}
.control-hint {
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.5);
  margin: -4px 0 4px 0;
}

.action-row {
  display: flex;
  gap: 12px;
  margin-top: 8px;
}

.state-banner {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 12px 14px;
  color: rgba(255, 255, 255, 0.75);
  font-size: 0.9rem;
}
.state-banner.error {
  background: oklch(35% 0.10 25 / 25%);
  border-color: oklch(60% 0.18 25);
  color: oklch(80% 0.10 25);
}
.state-banner.result {
  background: oklch(35% 0.10 145 / 20%);
  border-color: oklch(60% 0.15 145);
}
.error-suffix {
  display: block;
  margin-top: 4px;
  color: oklch(75% 0.15 60);
}

@media (max-width: 767px) {
  .persona-row {
    grid-template-columns: 1fr;
    gap: 4px;
  }
  .persona-count {
    text-align: left;
  }
}
</style>
