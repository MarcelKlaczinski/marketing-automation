<template>
  <GlassCard class="brief-card" hoverable tag="div" @click="onClick">
    <div class="card-inner">
      <div class="card-row">
        <input
          v-if="selectable"
          type="checkbox"
          class="brief-checkbox"
          :checked="selected"
          :aria-label="$t('briefs.selectBrief')"
          @click.stop="$emit('toggle-select')"
          @change.stop
        />
        <span class="brief-source mono">{{ sourceLabel }}</span>
        <span v-if="trendScore" class="brief-score mono">{{ trendScore }}</span>
        <span :class="['brief-status', `status-${statusVariant}`]">{{ statusLabel }}</span>
      </div>

      <h3 class="brief-title">{{ brief.topicTitle }}</h3>

      <div class="brief-meta mono">
        <span v-if="brief.primaryKeyword">{{ brief.primaryKeyword }}</span>
        <span v-if="brief.primaryKeyword" class="sep">·</span>
        <span>{{ relativeTime }}</span>
      </div>
    </div>
  </GlassCard>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import GlassCard from "src/components/ui/GlassCard.vue";

interface BriefStub {
  id: string;
  topicTitle: string;
  primaryKeyword: string | null;
  source: string;
  approvalStatus: string;
  clusterAction: string | null;
  trendMetadata: { trendScore?: number } | null;
  createdAt: string | Date;
}

const STATUS_LABEL_MAP: Record<string, string> = {
  pending: "briefs.approvalStatus.pending",
  approved: "briefs.approvalStatus.approved",
  auto_approved: "briefs.approvalStatus.auto_approved",
  routed: "briefs.approvalStatus.routed",
  rejected: "briefs.approvalStatus.rejected",
  superseded: "briefs.approvalStatus.superseded",
};

const STATUS_VARIANT_MAP: Record<string, string> = {
  pending: "idle",
  approved: "queued",
  auto_approved: "queued",
  routed: "running",
  rejected: "failed",
  superseded: "failed",
};

function formatRelative(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default defineComponent({
  name: "BriefCard",

  components: { GlassCard },

  emits: ["toggle-select", "select"],

  props: {
    brief: { type: Object as PropType<BriefStub>, required: true },
    selectable: { type: Boolean, default: false },
    selected: { type: Boolean, default: false },
  },

  computed: {
    trendScore(): number | null {
      return this.brief.trendMetadata?.trendScore ?? null;
    },
    sourceLabel(): string {
      return this.$t(`briefs.source.${this.brief.source}`) as string;
    },
    statusLabel(): string {
      const key = STATUS_LABEL_MAP[this.brief.approvalStatus];
      return key ? (this.$t(key) as string) : this.brief.approvalStatus;
    },
    statusVariant(): string {
      return STATUS_VARIANT_MAP[this.brief.approvalStatus] ?? "idle";
    },
    relativeTime(): string {
      return formatRelative(this.brief.createdAt);
    },
  },

  methods: {
    onClick(): void {
      this.$emit("select");
    },
  },
});
</script>

<style scoped>
.brief-card {
  padding: 12px 14px;
  cursor: pointer;
}

.card-inner {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.card-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.brief-checkbox {
  width: 15px;
  height: 15px;
  accent-color: var(--accent-primary);
  flex-shrink: 0;
  cursor: pointer;
}

.brief-source {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.brief-score {
  font-size: 10px;
  font-weight: 700;
  color: var(--accent-secondary);
  background: rgba(16, 185, 129, 0.12);
  padding: 1px 5px;
  border-radius: 6px;
}

.brief-status {
  margin-left: auto;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 8px;
}

.status-idle    { background: rgba(255, 255, 255, 0.06); color: var(--text-tertiary); }
.status-queued  { background: rgba(234, 179, 8, 0.15); color: #fbbf24; }
.status-running { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
.status-failed  { background: rgba(239, 68, 68, 0.15); color: #f87171; }

.brief-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.4;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  margin: 0;
}

.brief-meta {
  font-size: 10px;
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  gap: 4px;
}

.sep {
  color: var(--border-medium);
}
</style>
