<template>
  <q-dialog :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)">
    <div class="findings-modal">
      <div class="modal-header">
        <h3 class="modal-title">{{ articleTitle }}</h3>
        <button class="close-btn" @click="$emit('update:modelValue', false)">✕</button>
      </div>

      <div class="recommendation-row">
        <span :class="['rec-chip', `rec-chip--${recommendation}`]">
          {{ $t(`refresh.recommendation.${recommendation}`) as string }}
        </span>
        <span class="confidence-label">
          {{ $t("refresh.findings.confidenceLabel") as string }}:
          <span :class="['confidence-value', `confidence--${confidence}`]">
            {{ $t(`refresh.confidence.${confidence}`) as string }}
          </span>
        </span>
      </div>

      <!-- Outdated claims -->
      <div v-if="findings.outdatedClaims.length" class="findings-section">
        <h4 class="section-title">{{ $t("refresh.findings.outdatedClaims") as string }}</h4>
        <ul class="findings-list">
          <li v-for="(claim, i) in findings.outdatedClaims" :key="i" class="finding-item">
            <p class="finding-snippet mono">{{ claim.snippet }}</p>
            <p class="finding-reason">{{ claim.reason }}</p>
          </li>
        </ul>
      </div>

      <!-- Missing coverage -->
      <div v-if="findings.missingCoverage.length" class="findings-section">
        <h4 class="section-title">{{ $t("refresh.findings.missingCoverage") as string }}</h4>
        <ul class="findings-list findings-list--simple">
          <li v-for="(item, i) in findings.missingCoverage" :key="i" class="finding-simple">
            {{ item }}
          </li>
        </ul>
      </div>

      <!-- Stale references -->
      <div v-if="findings.staleReferences.length" class="findings-section">
        <h4 class="section-title">{{ $t("refresh.findings.staleReferences") as string }}</h4>
        <ul class="findings-list">
          <li v-for="(ref, i) in findings.staleReferences" :key="i" class="finding-item">
            <p class="finding-snippet mono">{{ ref.entity }}</p>
            <p class="finding-reason">{{ ref.note }}</p>
          </li>
        </ul>
      </div>

      <p
        v-if="!findings.outdatedClaims.length && !findings.missingCoverage.length && !findings.staleReferences.length"
        class="no-findings"
      >
        {{ $t("refresh.findings.noFindings") as string }}
      </p>
    </div>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import type { QualityFindings } from "src/composables/useRefreshSuggestions";

export default defineComponent({
  name: "QualityFindingsModal",

  props: {
    modelValue: {
      type: Boolean,
      required: true,
    },
    articleTitle: {
      type: String,
      default: "",
    },
    recommendation: {
      type: String as PropType<"refresh-now" | "refresh-soon" | "no-action">,
      required: true,
    },
    confidence: {
      type: String as PropType<"high" | "medium" | "low">,
      required: true,
    },
    findings: {
      type: Object as PropType<QualityFindings>,
      required: true,
    },
  },

  emits: ["update:modelValue"],
});
</script>

<style scoped>
.findings-modal {
  background: var(--bg-surface, #1a1a2e);
  border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
  border-radius: var(--radius-lg, 12px);
  padding: 24px;
  width: 540px;
  max-width: 95vw;
  max-height: 80vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.modal-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  line-height: 1.4;
}

.close-btn {
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  font-size: 14px;
  cursor: pointer;
  padding: 4px;
  line-height: 1;
  flex-shrink: 0;
}

.recommendation-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.rec-chip {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 20px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.rec-chip--refresh-now {
  background: color-mix(in oklch, #ef4444 15%, transparent);
  color: #ef4444;
  border: 1px solid color-mix(in oklch, #ef4444 30%, transparent);
}

.rec-chip--refresh-soon {
  background: color-mix(in oklch, #f59e0b 15%, transparent);
  color: #f59e0b;
  border: 1px solid color-mix(in oklch, #f59e0b 30%, transparent);
}

.rec-chip--no-action {
  background: color-mix(in oklch, #22c55e 15%, transparent);
  color: #22c55e;
  border: 1px solid color-mix(in oklch, #22c55e 30%, transparent);
}

.confidence-label {
  font-size: 12px;
  color: var(--text-tertiary);
}

.confidence-value {
  font-weight: 600;
}

.confidence--high { color: #22c55e; }
.confidence--medium { color: #f59e0b; }
.confidence--low { color: var(--text-secondary); }

.findings-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 0;
}

.findings-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.findings-list--simple {
  gap: 4px;
}

.finding-item {
  background: var(--bg-glass, rgba(255,255,255,0.04));
  border: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
  border-radius: var(--radius-sm, 6px);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.finding-snippet {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0;
}

.finding-reason {
  font-size: 12px;
  color: var(--text-tertiary);
  margin: 0;
}

.finding-simple {
  font-size: 13px;
  color: var(--text-secondary);
  padding-left: 12px;
  position: relative;
}

.finding-simple::before {
  content: "–";
  position: absolute;
  left: 0;
  color: var(--text-tertiary);
}

.no-findings {
  font-size: 13px;
  color: var(--text-tertiary);
  margin: 0;
  font-style: italic;
}

@media (max-width: 767px) {
  .findings-modal {
    padding: 16px;
  }
}
</style>
