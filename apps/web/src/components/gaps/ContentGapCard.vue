<template>
  <div class="gap-card" :class="`gap-type-${gap.gapType}`">
    <div class="gap-header">
      <GapTypeBadge :type="gap.gapType" />
      <PriorityBadge :priority="gap.priority" />
    </div>

    <div class="gap-content">
      <h4 class="gap-title">
        {{ gap.metadata?.suggestedTitle ?? defaultTitle }}
      </h4>

      <div v-if="gap.metadata?.suggestedCornerstoneKeyword" class="gap-keyword mono">
        {{ gap.metadata.suggestedCornerstoneKeyword }}
      </div>

      <div v-if="discoveredKeywords.length" class="gap-keywords">
        <span
          v-for="kw in discoveredKeywords"
          :key="kw"
          class="kw-chip mono"
        >{{ kw }}</span>
      </div>

      <p v-if="gap.metadata?.suggestedMetaDescription" class="gap-meta">
        {{ gap.metadata.suggestedMetaDescription }}
      </p>
    </div>

    <div class="gap-actions">
      <GlassButton
        v-if="!gap.metadata?.suggestedTitle"
        variant="secondary"
        size="sm"
        :loading="suggesting"
        @click.stop="$emit('suggest')"
      >
        {{ $t("clusters.gaps.suggest") as string }}
        <span class="cost-hint mono">~€0.01</span>
      </GlassButton>

      <template v-else-if="!autoApproveEnabled">
        <GlassButton
          variant="primary"
          size="sm"
          :loading="generating"
          @click.stop="$emit('generate')"
        >
          {{ $t("clusters.gaps.generate") as string }}
          <span class="cost-hint mono">~€0.39</span>
        </GlassButton>
      </template>

      <div v-else class="auto-approved-note">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="2,6 5,9 10,3" />
        </svg>
        {{ $t("clusters.gaps.autoApproved") as string }}
      </div>

      <GlassButton
        variant="ghost"
        size="sm"
        @click.stop="$emit('dismiss')"
      >
        {{ $t("clusters.gaps.dismiss") as string }}
      </GlassButton>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import type { ContentGap } from "src/composables/useClusterGaps";
import GlassButton from "src/components/ui/GlassButton.vue";
import GapTypeBadge from "./GapTypeBadge.vue";
import PriorityBadge from "./PriorityBadge.vue";

const DEFAULT_TITLES: Record<string, string> = {
  missing_hub: "clusters.gapType.missing_hub",
  missing_spoke_type: "clusters.gapType.missing_spoke_type",
  missing_translation: "clusters.gapType.missing_translation",
  cluster_too_small: "clusters.gapType.cluster_too_small",
};

export default defineComponent({
  name: "ContentGapCard",

  components: { GlassButton, GapTypeBadge, PriorityBadge },

  emits: ["suggest", "generate", "dismiss"],

  props: {
    gap: { type: Object as PropType<ContentGap>, required: true },
    autoApproveEnabled: { type: Boolean, default: false },
    suggesting: { type: Boolean, default: false },
    generating: { type: Boolean, default: false },
  },

  computed: {
    defaultTitle(): string {
      const key = DEFAULT_TITLES[this.gap.gapType];
      return key ? (this.$t(key) as string) : this.gap.gapType;
    },

    discoveredKeywords(): string[] {
      return (this.gap.metadata?.discoveredKeywords ?? []).slice(0, 4);
    },
  },
});
</script>

<style scoped>
.gap-card {
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: border-color 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.gap-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.gap-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 4px;
  line-height: 1.35;
}

.gap-keyword {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-bottom: 4px;
}

.gap-keywords {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 4px;
}

.kw-chip {
  font-size: 10px;
  padding: 2px 6px;
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  color: var(--text-tertiary);
}

.gap-meta {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.gap-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.cost-hint {
  font-size: 10px;
  opacity: 0.7;
  margin-left: 4px;
}

.auto-approved-note {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #10b981;
  font-weight: 500;
}
</style>
