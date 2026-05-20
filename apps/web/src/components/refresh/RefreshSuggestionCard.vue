<template>
  <div class="suggestion-card">
    <div class="card-main">
      <div class="card-info">
        <span :class="['source-chip', `source-chip--${suggestion.source}`]">
          {{ $t(`refresh.source.${suggestion.source}`) as string }}
        </span>
        <span
          v-if="suggestion.source === 'quality' && suggestion.qualityFindings"
          :class="['rec-chip', `rec-chip--${suggestion.qualityFindings.overallRecommendation}`]"
        >
          {{ $t(`refresh.recommendation.${suggestion.qualityFindings.overallRecommendation}`) as string }}
        </span>
        <h3 class="card-title">{{ suggestion.articleTitle ?? suggestion.articleSlug }}</h3>
        <p class="card-reasoning">{{ suggestion.reasoning }}</p>
      </div>

      <div class="card-actions">
        <button
          v-if="suggestion.source === 'quality' && suggestion.qualityFindings"
          class="action-btn action-btn--ghost"
          @click="$emit('view-findings', suggestion)"
        >
          {{ $t("refresh.actions.viewFindings") as string }}
        </button>
        <button
          class="action-btn action-btn--primary"
          :disabled="refreshing"
          @click="$emit('refresh', suggestion.articleId)"
        >
          {{ $t("refresh.actions.refresh") as string }}
          <span class="cost-hint mono">~€0.40</span>
        </button>
        <button
          v-if="suggestion.source === 'time'"
          class="action-btn action-btn--ghost"
          :disabled="analyzing"
          @click="$emit('analyze-quality', suggestion.articleId)"
        >
          {{ $t("refresh.actions.analyzeOne") as string }}
          <span class="cost-hint mono">~€0.03</span>
        </button>
        <button
          class="action-btn action-btn--ghost"
          :disabled="markingRefreshed"
          @click="$emit('mark-refreshed', suggestion.articleId)"
        >
          {{ $t("refresh.actions.markRefreshed") as string }}
        </button>
        <button
          class="action-btn action-btn--ghost"
          @click="$emit('dismiss', suggestion.id)"
        >
          {{ $t("refresh.actions.dismiss") as string }}
        </button>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import type { RefreshSuggestion } from "src/composables/useRefreshSuggestions";

export default defineComponent({
  name: "RefreshSuggestionCard",

  props: {
    suggestion: {
      type: Object as PropType<RefreshSuggestion>,
      required: true,
    },
    markingRefreshed: {
      type: Boolean,
      default: false,
    },
    refreshing: {
      type: Boolean,
      default: false,
    },
    analyzing: {
      type: Boolean,
      default: false,
    },
  },

  emits: ["mark-refreshed", "dismiss", "view-findings", "refresh", "analyze-quality"],
});
</script>

<style scoped>
.suggestion-card {
  background: var(--bg-glass, rgba(255,255,255,0.04));
  border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
  border-radius: var(--radius-md, 8px);
  padding: 14px 16px;
  transition: border-color 0.15s var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

@media (hover: hover) and (pointer: fine) {
  .suggestion-card:hover {
    border-color: rgba(255,255,255,0.14);
  }
}

.card-main {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.card-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-reasoning {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.source-chip {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 20px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  align-self: flex-start;
}

.source-chip--time {
  background: color-mix(in oklch, #818cf8 12%, transparent);
  color: #818cf8;
  border: 1px solid color-mix(in oklch, #818cf8 25%, transparent);
}

.source-chip--quality {
  background: color-mix(in oklch, #34d399 12%, transparent);
  color: #34d399;
  border: 1px solid color-mix(in oklch, #34d399 25%, transparent);
}

.rec-chip {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 20px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  align-self: flex-start;
}

.rec-chip--refresh-now {
  background: color-mix(in oklch, #ef4444 12%, transparent);
  color: #ef4444;
  border: 1px solid color-mix(in oklch, #ef4444 25%, transparent);
}

.rec-chip--refresh-soon {
  background: color-mix(in oklch, #f59e0b 12%, transparent);
  color: #f59e0b;
  border: 1px solid color-mix(in oklch, #f59e0b 25%, transparent);
}

.rec-chip--no-action {
  background: color-mix(in oklch, #22c55e 12%, transparent);
  color: #22c55e;
  border: 1px solid color-mix(in oklch, #22c55e 25%, transparent);
}

.card-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}

.action-btn {
  font-size: 12px;
  font-family: inherit;
  padding: 5px 12px;
  border-radius: var(--radius-sm, 6px);
  cursor: pointer;
  transition: background 0.15s var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
              opacity 0.15s var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
  white-space: nowrap;
}

.action-btn--primary {
  background: var(--accent-primary, #6366f1);
  color: #fff;
  border: none;
}

@media (hover: hover) and (pointer: fine) {
  .action-btn--primary:hover:not(:disabled) {
    background: color-mix(in oklch, var(--accent-primary, #6366f1) 80%, white);
  }
}

.action-btn--ghost {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border-subtle, rgba(255,255,255,0.1));
}

@media (hover: hover) and (pointer: fine) {
  .action-btn--ghost:hover {
    background: var(--bg-glass, rgba(255,255,255,0.04));
  }
}

.action-btn:active:not(:disabled) {
  transform: scale(0.97);
  transition-duration: 160ms;
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.cost-hint {
  font-size: 10px;
  opacity: 0.7;
  margin-left: 4px;
}

@media (max-width: 767px) {
  .card-main {
    flex-direction: column;
  }

  .card-actions {
    flex-direction: row;
    flex-wrap: wrap;
    width: 100%;
  }

  .action-btn {
    min-height: 44px;
    flex: 1;
  }
}
</style>
