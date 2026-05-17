<template>
  <div
    class="refresh-card"
    role="button"
    tabindex="0"
    @click="onNavigate"
    @keydown.enter="onNavigate"
  >
    <div class="card-info">
      <div class="card-row">
        <span v-if="candidate.collection" class="card-tag mono">{{ candidate.collection }}</span>
        <span v-if="candidate.locale" class="card-locale mono">{{ candidate.locale }}</span>
        <StalenessBadge :days="candidate.daysSinceLastUpdate" />
      </div>

      <h3 class="card-title">{{ candidate.title ?? candidate.slug }}</h3>

      <div class="card-meta mono">
        <span>{{ $t("refresh.lastUpdated") as string }}: {{ relativeTime(candidate.updatedAt) }}</span>
      </div>
    </div>

    <div class="card-actions">
      <GlassButton variant="primary" size="sm" @click.stop="$emit('trigger')">
        {{ $t("refresh.actions.refresh") as string }}
        <span class="cost-hint mono">~€0.40</span>
      </GlassButton>
      <GlassButton variant="ghost" size="sm" @click.stop="$emit('dismiss')">
        {{ $t("refresh.actions.dismiss") as string }}
      </GlassButton>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import type { RefreshCandidate } from "src/composables/useRefreshCandidates";
import GlassButton from "src/components/ui/GlassButton.vue";
import StalenessBadge from "./StalenessBadge.vue";

export default defineComponent({
  name: "RefreshCandidateCard",

  components: { GlassButton, StalenessBadge },

  emits: ["trigger", "dismiss"],

  props: {
    candidate: { type: Object as PropType<RefreshCandidate>, required: true },
  },

  methods: {
    onNavigate(): void {
      const slug = this.$route.params.slug as string;
      void this.$router.push(`/projects/${slug}/articles/${this.candidate.id}`);
    },

    relativeTime(iso: string): string {
      const diff = Date.now() - new Date(iso).getTime();
      const mins = Math.floor(diff / 60_000);
      if (mins < 2) return this.$t("forms.justNow") as string;
      if (mins < 60) return this.$t("forms.minutesAgo", { n: mins }, mins) as string;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return this.$t("forms.hoursAgo", { n: hrs }, hrs) as string;
      const days = Math.floor(hrs / 24);
      return this.$t("forms.daysAgo", { n: days }, days) as string;
    },
  },
});
</script>

<style scoped>
.refresh-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
              border-color 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

@media (hover: hover) and (pointer: fine) {
  .refresh-card:hover {
    background: var(--bg-glass-hover, rgba(255, 255, 255, 0.05));
    border-color: var(--border-medium, rgba(255, 255, 255, 0.12));
  }
}

.card-info {
  flex: 1;
  min-width: 0;
}

.card-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  flex-wrap: wrap;
}

.card-tag, .card-locale {
  font-size: 10px;
  color: var(--text-tertiary);
  padding: 1px 5px;
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
}

.card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-meta {
  font-size: 11px;
  color: var(--text-tertiary);
}

.card-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}

.cost-hint {
  font-size: 10px;
  opacity: 0.7;
  margin-left: 4px;
}

@media (max-width: 767px) {
  .refresh-card {
    flex-direction: column;
  }

  .card-actions {
    flex-direction: row;
    width: 100%;
  }
}
</style>
