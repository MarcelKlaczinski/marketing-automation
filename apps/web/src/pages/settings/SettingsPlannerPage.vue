<template>
  <div class="settings-planner-page">
    <h1 class="page-title">{{ $t("settings.planner.title") as string }}</h1>
    <p class="page-description">{{ $t("settings.planner.description") as string }}</p>

    <!-- Section D: Validation banner — kept at top so users see status while editing -->
    <section
      v-if="validation"
      class="validation-banner"
      :class="bannerClass"
    >
      <div v-if="!validation.valid">
        <h3 class="banner-heading banner-error">
          {{ $t("settings.planner.validation.errorsHeading") as string }}
        </h3>
        <ul class="banner-list">
          <li v-for="err in validation.errors" :key="err.code">
            {{ errorMessage(err.code) }}
          </li>
        </ul>
      </div>
      <div v-else>
        <h3 class="banner-heading banner-valid">
          {{ $t("settings.planner.validation.validHeading") as string }}
        </h3>
        <p v-if="validation.estimatedWeeklyFloorEur != null">
          {{
            $t("settings.planner.validation.validBody", {
              floorEur: validation.estimatedWeeklyFloorEur.toFixed(2),
            }) as string
          }}
        </p>
      </div>
      <div v-if="validation.warnings.length > 0" class="banner-warnings">
        <h4 class="banner-heading banner-warning">
          {{ $t("settings.planner.validation.warningsHeading") as string }}
        </h4>
        <ul class="banner-list">
          <li v-for="w in validation.warnings" :key="w.code">
            {{ warningMessage(w.code) }}
          </li>
        </ul>
      </div>
    </section>
    <p v-else-if="validating" class="banner-loading">
      {{ $t("settings.planner.validation.loading") as string }}
    </p>

    <!-- Section A + B: Goals -->
    <section class="form-card">
      <h2 class="section-title">{{ $t("settings.planner.goalsSection.title") as string }}</h2>
      <p class="section-description">
        {{ $t("settings.planner.goalsSection.description") as string }}
      </p>

      <p v-if="goals.length === 0" class="empty-text">
        {{ $t("settings.planner.goalsSection.empty") as string }}
      </p>

      <table v-else class="goals-table">
        <thead>
          <tr>
            <th>{{ $t("settings.planner.fields.contentType") as string }}</th>
            <th>{{ $t("settings.planner.fields.cadenceUnit") as string }}</th>
            <th>{{ $t("settings.planner.fields.minCount") as string }}</th>
            <th>{{ $t("settings.planner.fields.maxCount") as string }}</th>
            <th>{{ $t("settings.planner.fields.note") as string }}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="(goal, idx) in goals" :key="idx">
            <td>
              <select v-model="goal.contentType" class="input">
                <option
                  v-for="ct in contentTypeOptions(idx)"
                  :key="ct"
                  :value="ct"
                >
                  {{ $t(`settings.planner.contentTypes.${ct}`) as string }}
                </option>
              </select>
            </td>
            <td>
              <select v-model="goal.cadenceUnit" class="input">
                <option value="per_day">
                  {{ $t("settings.planner.cadenceUnits.per_day") as string }}
                </option>
                <option value="per_week">
                  {{ $t("settings.planner.cadenceUnits.per_week") as string }}
                </option>
              </select>
            </td>
            <td>
              <input
                v-model.number="goal.minCount"
                type="number"
                min="0"
                step="1"
                class="input input-narrow"
              />
            </td>
            <td>
              <input
                v-model="goal.maxCountInput"
                type="number"
                min="0"
                step="1"
                class="input input-narrow"
                :placeholder="$t('settings.planner.cadenceUnits.per_week') as string"
              />
            </td>
            <td>
              <input
                v-model="goal.noteInput"
                type="text"
                class="input"
                maxlength="200"
              />
            </td>
            <td>
              <button
                type="button"
                class="btn-link-danger"
                :aria-label="$t('settings.planner.goalsSection.remove') as string"
                @click="removeGoal(idx)"
              >
                ✕
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <button
        type="button"
        class="btn-secondary"
        :disabled="cannotAddGoal"
        @click="addGoal"
      >
        + {{ $t("settings.planner.goalsSection.add") as string }}
      </button>
    </section>

    <!-- Section C: Planner config -->
    <section class="form-card">
      <h2 class="section-title">{{ $t("settings.planner.configSection.title") as string }}</h2>
      <p class="section-description">
        {{ $t("settings.planner.configSection.description") as string }}
      </p>

      <div class="config-grid">
        <label class="field">
          <span class="field-label">
            {{ $t("settings.planner.configSection.weeklyBudgetLabel") as string }}
          </span>
          <input
            v-model.number="config.weeklyBudgetEur"
            type="number"
            min="0"
            step="0.5"
            class="input"
          />
        </label>

        <label class="field">
          <span class="field-label">
            {{ $t("settings.planner.configSection.topNLabel") as string }}
          </span>
          <input
            v-model.number="config.topNSignalsAllowedOverage"
            type="number"
            min="0"
            step="1"
            class="input"
          />
        </label>

        <label class="field">
          <span class="field-label">
            {{ $t("settings.planner.configSection.maxOverageLabel") as string }}
          </span>
          <input
            v-model.number="config.maxOveragePerSignal"
            type="number"
            min="0"
            step="1"
            class="input"
          />
        </label>
      </div>

      <details class="per-type-block">
        <summary class="field-label">
          {{ $t("settings.planner.configSection.perTypeLabel") as string }}
        </summary>
        <p class="section-description">
          {{ $t("settings.planner.configSection.perTypeHelp") as string }}
        </p>
        <div class="per-type-grid">
          <label
            v-for="ct in allContentTypes"
            :key="ct"
            class="field"
          >
            <span class="field-label">
              {{ $t(`settings.planner.contentTypes.${ct}`) as string }}
            </span>
            <input
              v-model="perTypeInputs[ct]"
              type="number"
              min="0"
              step="0.5"
              class="input input-narrow"
            />
          </label>
        </div>
      </details>
    </section>

    <div class="actions">
      <button
        type="button"
        class="btn-primary"
        :disabled="saving"
        @click="saveAll"
      >
        {{ saving ? $t("settings.planner.saving") as string : $t("settings.planner.saveAll") as string }}
      </button>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { Notify } from "quasar";
import { apiGet, apiPut } from "src/lib/api";

type ContentType = "cluster" | "comparison" | "social_post" | "ki_wissen";
type CadenceUnit = "per_day" | "per_week";

interface GoalRow {
  contentType: ContentType;
  cadenceUnit: CadenceUnit;
  minCount: number;
  maxCountInput: string; // "" = null/uncapped
  noteInput: string;
}

interface ConfigState {
  weeklyBudgetEur: number;
  topNSignalsAllowedOverage: number;
  maxOveragePerSignal: number;
}

interface FetchedGoal {
  id: string;
  contentType: ContentType;
  cadenceUnit: CadenceUnit;
  minCount: number;
  maxCount: number | null;
  note: string | null;
}

interface FetchedConfig {
  weeklyBudgetEur: string;
  topNSignalsAllowedOverage: number;
  maxOveragePerSignal: number;
  perTypeMaxEur: Record<string, number> | null;
}

interface ValidationIssue {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  estimatedWeeklyFloorEur: number | null;
}

const ALL_CONTENT_TYPES: ContentType[] = [
  "cluster",
  "comparison",
  "social_post",
  "ki_wissen",
];

export default defineComponent({
  name: "SettingsPlannerPage",

  data: () => ({
    goals: [] as GoalRow[],
    config: {
      weeklyBudgetEur: 50,
      topNSignalsAllowedOverage: 3,
      maxOveragePerSignal: 1,
    } as ConfigState,
    perTypeInputs: {
      cluster: "",
      comparison: "",
      social_post: "",
      ki_wissen: "",
    } as Record<ContentType, string>,
    validation: null as ValidationResult | null,
    validating: false,
    saving: false,
    allContentTypes: ALL_CONTENT_TYPES,
  }),

  computed: {
    projectSlug(): string {
      const raw = this.$route.params.slug;
      return Array.isArray(raw) ? raw[0] ?? "" : raw ?? "";
    },
    bannerClass(): Record<string, boolean> {
      if (!this.validation) return {};
      return {
        "banner-ok": this.validation.valid && this.validation.warnings.length === 0,
        "banner-warn":
          this.validation.valid && this.validation.warnings.length > 0,
        "banner-err": !this.validation.valid,
      };
    },
    cannotAddGoal(): boolean {
      // Block adding when all 4 content types are already covered.
      const used = new Set(this.goals.map((g) => g.contentType));
      return used.size >= ALL_CONTENT_TYPES.length;
    },
  },

  async mounted() {
    await this.reload();
  },

  methods: {
    contentTypeOptions(idx: number): ContentType[] {
      const used = new Set(
        this.goals
          .map((g, i) => (i === idx ? null : g.contentType))
          .filter((g): g is ContentType => g !== null)
      );
      return ALL_CONTENT_TYPES.filter((c) => !used.has(c));
    },
    async reload() {
      try {
        const [goals, config] = await Promise.all([
          apiGet<FetchedGoal[]>(`/projects/${this.projectSlug}/goals`),
          apiGet<FetchedConfig | null>(`/projects/${this.projectSlug}/planner-config`),
        ]);
        this.goals = goals.map((g) => ({
          contentType: g.contentType,
          cadenceUnit: g.cadenceUnit,
          minCount: g.minCount,
          maxCountInput: g.maxCount == null ? "" : String(g.maxCount),
          noteInput: g.note ?? "",
        }));
        if (config) {
          this.config.weeklyBudgetEur = parseFloat(config.weeklyBudgetEur);
          this.config.topNSignalsAllowedOverage = config.topNSignalsAllowedOverage;
          this.config.maxOveragePerSignal = config.maxOveragePerSignal;
          for (const ct of ALL_CONTENT_TYPES) {
            const v = config.perTypeMaxEur?.[ct];
            this.perTypeInputs[ct] = v == null ? "" : String(v);
          }
        }
        await this.runValidation();
      } catch (err) {
        Notify.create({
          type: "negative",
          message: (err as Error).message,
        });
      }
    },
    async runValidation() {
      this.validating = true;
      try {
        const result = await apiGet<ValidationResult>(
          `/projects/${this.projectSlug}/goals/validate`
        );
        this.validation = result;
      } catch (err) {
        Notify.create({
          type: "negative",
          message: (err as Error).message,
        });
      } finally {
        this.validating = false;
      }
    },
    addGoal() {
      const available = this.contentTypeOptions(-1);
      if (available.length === 0) return;
      this.goals.push({
        contentType: available[0]!,
        cadenceUnit: "per_week",
        minCount: 1,
        maxCountInput: "",
        noteInput: "",
      });
    },
    removeGoal(idx: number) {
      if (!globalThis.confirm(this.$t("settings.planner.confirmDelete") as string)) return;
      this.goals.splice(idx, 1);
    },
    async saveAll() {
      this.saving = true;
      try {
        const goalsPayload = this.goals.map((g) => {
          const maxCountTrim = g.maxCountInput.trim();
          const maxCount =
            maxCountTrim === "" ? null : Number.parseInt(maxCountTrim, 10);
          const noteTrim = g.noteInput.trim();
          return {
            contentType: g.contentType,
            cadenceUnit: g.cadenceUnit,
            minCount: g.minCount,
            maxCount: Number.isFinite(maxCount) ? maxCount : null,
            ...(noteTrim === "" ? {} : { note: noteTrim }),
          };
        });

        const perTypeMaxEur: Record<string, number> = {};
        for (const ct of ALL_CONTENT_TYPES) {
          const raw = this.perTypeInputs[ct].trim();
          if (raw === "") continue;
          const n = Number.parseFloat(raw);
          if (Number.isFinite(n) && n > 0) perTypeMaxEur[ct] = n;
        }

        await Promise.all([
          apiPut(`/projects/${this.projectSlug}/goals`, { goals: goalsPayload }),
          apiPut(`/projects/${this.projectSlug}/planner-config`, {
            weeklyBudgetEur: this.config.weeklyBudgetEur,
            topNSignalsAllowedOverage: this.config.topNSignalsAllowedOverage,
            maxOveragePerSignal: this.config.maxOveragePerSignal,
            perTypeMaxEur:
              Object.keys(perTypeMaxEur).length === 0 ? null : perTypeMaxEur,
          }),
        ]);

        Notify.create({
          type: "positive",
          message: this.$t("settings.planner.saved") as string,
        });
        await this.reload();
      } catch (err) {
        Notify.create({
          type: "negative",
          message: this.$t("settings.planner.saveError") as string + " — " + (err as Error).message,
        });
      } finally {
        this.saving = false;
      }
    },
    errorMessage(code: string): string {
      const key = `settings.planner.errorCodes.${code}`;
      const translated = this.$t(key) as string;
      // If translation lookup falls back to the key itself (no entry), use the validation result's message.
      if (translated === key) {
        const fromResult = this.validation?.errors.find((e) => e.code === code);
        return fromResult?.message ?? code;
      }
      return translated;
    },
    warningMessage(code: string): string {
      const key = `settings.planner.warningCodes.${code}`;
      const translated = this.$t(key) as string;
      if (translated === key) {
        const fromResult = this.validation?.warnings.find((w) => w.code === code);
        return fromResult?.message ?? code;
      }
      return translated;
    },
  },
});
</script>

<style scoped>
.settings-planner-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.page-title {
  font-size: 22px;
  font-weight: 600;
  margin: 0;
}

.page-description {
  color: var(--text-secondary);
  margin: 0;
  font-size: 14px;
}

.validation-banner {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  background: var(--bg-glass-subtle);
}

.validation-banner.banner-err {
  border-color: var(--error, #c0392b);
  background: color-mix(in oklch, var(--error, #c0392b) 8%, transparent);
}
.validation-banner.banner-warn {
  border-color: var(--warning, #d4ac0d);
  background: color-mix(in oklch, var(--warning, #d4ac0d) 8%, transparent);
}
.validation-banner.banner-ok {
  border-color: var(--success, #1e8449);
  background: color-mix(in oklch, var(--success, #1e8449) 6%, transparent);
}

.banner-heading {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 4px;
}
.banner-error {
  color: var(--error, #c0392b);
}
.banner-warning {
  color: var(--warning, #b58105);
}
.banner-valid {
  color: var(--success, #1e8449);
}
.banner-list {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  color: var(--text-secondary);
}
.banner-warnings {
  margin-top: 12px;
}
.banner-loading {
  color: var(--text-tertiary);
  font-size: 13px;
}

.form-card {
  background: var(--bg-glass-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 16px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 4px;
}
.section-description {
  color: var(--text-secondary);
  font-size: 13px;
  margin: 0 0 12px;
}

.empty-text {
  color: var(--text-tertiary);
  font-size: 13px;
  margin: 8px 0 12px;
}

.goals-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 12px;
  font-size: 13px;
}
.goals-table th {
  text-align: left;
  font-weight: 500;
  color: var(--text-tertiary);
  padding: 4px 6px;
  font-size: 12px;
}
.goals-table td {
  padding: 4px 6px;
  vertical-align: middle;
}

.input {
  background: var(--bg-base);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  font-size: 13px;
  width: 100%;
  color: var(--text-primary);
}
.input-narrow {
  max-width: 90px;
}

.btn-secondary {
  background: var(--bg-glass-strong);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
  color: var(--text-primary);
  transition: background 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}
.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
@media (hover: hover) and (pointer: fine) {
  .btn-secondary:hover:not(:disabled) {
    background: var(--bg-glass-stronger, var(--bg-glass-strong));
  }
}

.btn-primary {
  background: var(--brand, #3b82f6);
  color: white;
  border: none;
  border-radius: var(--radius-sm);
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}
.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-link-danger {
  background: none;
  border: none;
  color: var(--error, #c0392b);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 4px 6px;
}

.config-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.field-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}

.per-type-block {
  margin-top: 8px;
  border-top: 1px solid var(--border-subtle);
  padding-top: 12px;
}
.per-type-block summary {
  cursor: pointer;
  font-weight: 500;
}
.per-type-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin-top: 8px;
}

.actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}

@media (max-width: 767px) {
  .goals-table {
    display: block;
    overflow-x: auto;
  }
  .btn-primary {
    width: 100%;
    min-height: 44px;
  }
}
</style>
