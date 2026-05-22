<template>
  <q-dialog v-model="isOpen" @hide="onHide">
    <div class="bulk-approve-modal">
      <h2 class="modal-title">{{ $t("briefs.bulk.confirmTitle") as string }}</h2>

      <!--
        Spec 64.17: pre-flight summary. Renders the cluster-assignment
        eligibility breakdown before the user submits, so we don't ship 22
        briefs into the bulk handler when 5 will get skipped silently.
      -->
      <div v-if="preflightLoading" class="preflight-row preflight-row--loading">
        <q-spinner size="14px" />
        <span>{{ $t("briefs.bulk.preflightLoading") as string }}</span>
      </div>

      <div v-else-if="preflightError" class="preflight-row preflight-row--error">
        {{ preflightError }}
      </div>

      <div v-else-if="preflight" class="preflight-row">
        <div class="preflight-total">
          {{ $t("briefs.bulk.preflightTotal", { n: preflight.totalMatched }) as string }}
        </div>
        <div class="preflight-breakdown">
          <span class="preflight-eligible">
            {{ $t("briefs.bulk.preflightEligible", { n: activeEligible }) as string }}
          </span>
          <span v-if="activeNeedsCluster > 0" class="preflight-needs-cluster">
            ·
            {{ $t("briefs.bulk.preflightNeedsCluster", { n: activeNeedsCluster }) as string }}
          </span>
        </div>
      </div>

      <p v-else class="modal-description">
        {{ $t("briefs.bulk.confirmDescription", { count: 0 }) as string }}
      </p>

      <!-- Spec 63.6: dispatch picker — 'plan' (default, safer) vs 'immediate' (override). -->
      <div class="dispatch-selector" role="radiogroup" :aria-label="$t('briefs.bulkApprove.dispatchLabel') as string">
        <label class="dispatch-option" :class="{ 'dispatch-active': dispatch === 'plan' }">
          <input type="radio" v-model="dispatch" value="plan" class="dispatch-radio" />
          <div class="dispatch-content">
            <span class="dispatch-label">{{ $t("briefs.bulkApprove.plan") as string }}</span>
            <span class="dispatch-hint">{{ $t("briefs.bulkApprove.planHint") as string }}</span>
          </div>
        </label>
        <label class="dispatch-option" :class="{ 'dispatch-active': dispatch === 'immediate' }">
          <input type="radio" v-model="dispatch" value="immediate" class="dispatch-radio" />
          <div class="dispatch-content">
            <span class="dispatch-label">{{ $t("briefs.bulkApprove.immediate") as string }}</span>
            <span class="dispatch-hint dispatch-hint--warn">
              {{ $t("briefs.bulkApprove.immediateHint") as string }}
            </span>
          </div>
        </label>
      </div>

      <div class="modal-actions">
        <GlassButton variant="ghost" :disabled="processing" @click="close">
          {{ $t("common.cancel") as string }}
        </GlassButton>
        <GlassButton
          :variant="dispatch === 'immediate' ? 'secondary' : 'primary'"
          :loading="processing"
          :disabled="submitDisabled"
          @click="confirm"
        >
          {{ submitLabel }}
        </GlassButton>
      </div>
    </div>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import type { PropType } from "vue";
import GlassButton from "src/components/ui/GlassButton.vue";
import { useProjectStore } from "src/stores/project";
import { apiPost } from "src/lib/api";

export type Dispatch = "plan" | "immediate";

/**
 * Mirrors the backend `bulkBriefSelectorSchema` discriminated union
 * (apps/api/src/lib/brief-bulk-selector.ts). Parent builds this via
 * `buildBulkSelectorPayload()` and hands it to both this modal AND the
 * bulk-approve POST.
 */
export type BulkBriefSelectorPayload =
  | { briefIds: string[] }
  | {
      filter: {
        section: "pending" | "in-flight" | "done" | "all";
        source?: string[];
        readiness?: "ready" | "unready" | "plan_ready" | "all";
      };
      excludeIds?: string[];
    };

type PreflightResponse = {
  reQueried: boolean;
  totalMatched: number;
  plan: { eligible: number; needsCluster: number };
  immediate: { eligible: number; needsCluster: number };
};

export default defineComponent({
  name: "BulkApproveModal",

  components: { GlassButton },

  props: {
    modelValue: { type: Boolean, required: true },
    /**
     * Spec 64.17: source-of-truth selector for this approval session. Same
     * shape as the backend body. The modal posts THIS to bulk-preflight,
     * and re-emits it on `@confirm` so the parent's POST stays consistent.
     */
    selector: {
      type: Object as PropType<BulkBriefSelectorPayload>,
      required: true,
    },
    processing: { type: Boolean, default: false },
  },

  emits: ["update:modelValue", "confirm"],

  data: () => ({
    // Spec 63.6: default to 'plan' — the safer path that respects the Budget Gate.
    dispatch: "plan" as Dispatch,
    preflight: null as PreflightResponse | null,
    preflightLoading: false,
    preflightError: "" as string,
  }),

  computed: {
    isOpen: {
      get(): boolean {
        return this.modelValue;
      },
      set(val: boolean): void {
        this.$emit("update:modelValue", val);
      },
    },
    activeEligible(): number {
      if (!this.preflight) return 0;
      return this.dispatch === "immediate"
        ? this.preflight.immediate.eligible
        : this.preflight.plan.eligible;
    },
    activeNeedsCluster(): number {
      if (!this.preflight) return 0;
      return this.dispatch === "immediate"
        ? this.preflight.immediate.needsCluster
        : this.preflight.plan.needsCluster;
    },
    submitDisabled(): boolean {
      if (this.processing || this.preflightLoading) return true;
      // Soft-fail: preflight transient failures (timeout, server load) are
      // permitted so the user isn't blocked. The bulk-approve handler re-checks
      // cluster eligibility per-brief at dispatch time, so skipped counts in
      // the result remain accurate even when this preflight was missed.
      if (!this.preflight) return false;
      return this.activeEligible === 0;
    },
    submitLabel(): string {
      const n = this.preflight ? this.activeEligible : null;
      if (n !== null) {
        const key =
          this.dispatch === "immediate"
            ? "briefs.bulkApprove.submitImmediateN"
            : "briefs.bulkApprove.submitPlanN";
        return this.$t(key, { n }) as string;
      }
      return this.dispatch === "immediate"
        ? (this.$t("briefs.bulkApprove.immediate") as string)
        : (this.$t("briefs.bulkApprove.plan") as string);
    },
  },

  watch: {
    modelValue: {
      immediate: true,
      handler(open: boolean): void {
        if (open) {
          void this.runPreflight();
        }
      },
    },
  },

  methods: {
    close(): void {
      this.isOpen = false;
    },
    confirm(): void {
      // `mode` is still emitted for back-compat with the existing handler signature;
      // the bulk-approve endpoint accepts assist/auto independently from dispatch.
      this.$emit("confirm", { dispatch: this.dispatch, mode: "assist" as const });
    },
    onHide(): void {
      this.dispatch = "plan";
      this.preflight = null;
      this.preflightError = "";
    },
    async runPreflight(): Promise<void> {
      const slug = useProjectStore().currentSlug;
      if (!slug) {
        this.preflightError = this.$t("briefs.bulk.preflightError") as string;
        return;
      }
      this.preflightLoading = true;
      this.preflightError = "";
      this.preflight = null;
      try {
        this.preflight = await apiPost<PreflightResponse>(
          `/projects/${slug}/briefs/bulk-preflight-cluster-check`,
          this.selector,
        );
      } catch (err) {
        // Soft-fail: keep the submit button enabled so the parent's server-side
        // bulk-approve still works. Surface the error visually but don't block.
        this.preflightError =
          err instanceof Error ? err.message : (this.$t("briefs.bulk.preflightError") as string);
      } finally {
        this.preflightLoading = false;
      }
    },
  },
});
</script>

<style scoped>
.bulk-approve-modal {
  background: var(--bg-surface);
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-lg);
  padding: 24px;
  width: 440px;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.modal-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.modal-description {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.5;
}

.preflight-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: var(--bg-overlay);
  border: 1px solid var(--border-subtle);
}

.preflight-row--loading {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-secondary);
}

.preflight-row--error {
  border-color: var(--warn-fg, #d97706);
  color: var(--warn-fg, #d97706);
  font-size: 13px;
}

.preflight-total {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.preflight-breakdown {
  font-size: 12px;
  color: var(--text-secondary);
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.preflight-eligible {
  color: var(--accent-primary);
  font-weight: 600;
}

.preflight-needs-cluster {
  color: var(--warn-fg, #d97706);
}

.dispatch-selector {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dispatch-option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: border-color 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.dispatch-active {
  border-color: var(--accent-primary);
  background: rgba(var(--accent-primary-rgb, 99, 102, 241), 0.06);
}

.dispatch-radio {
  accent-color: var(--accent-primary);
  width: 16px;
  height: 16px;
  margin-top: 2px;
  flex-shrink: 0;
}

.dispatch-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dispatch-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.dispatch-hint {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.4;
}

.dispatch-hint--warn {
  color: var(--warn-fg, #d97706);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
