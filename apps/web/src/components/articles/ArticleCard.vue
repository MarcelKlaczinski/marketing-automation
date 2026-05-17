<template>
  <GlassCard
    class="article-card"
    :class="{ 'card-selected': selected }"
    hoverable
    :selected="selected"
    tag="button"
    @click="$emit('select', article.id)"
  >
    <div class="card-inner">
      <div class="card-row">
        <span class="card-tag mono">{{ article.collection ?? "—" }}</span>
        <StalenessBadge
          v-if="article.needsRefresh && article.daysSinceLastUpdate != null"
          :days="article.daysSinceLastUpdate"
        />
        <span :class="['card-status', `status-${statusVariant}`]">{{ statusLabel }}</span>
      </div>

      <h3 class="card-title">{{ article.title ?? article.cornerstoneKeyword ?? article.slug }}</h3>

      <div class="card-bottom">
        <div class="card-meta mono">
          <span v-if="article.wordCount">{{ article.wordCount }}w</span>
          <span v-if="article.wordCount" class="sep">·</span>
          <span class="card-time">{{ relativeTime }}</span>
        </div>

        <div class="locale-chips">
          <button
            class="locale-chip locale-chip-current"
            :title="article.locale?.toUpperCase() ?? '?'"
            @click.stop="$emit('select', article.id)"
          >
            {{ article.locale?.toUpperCase() ?? "—" }}
          </button>
          <button
            v-if="sibling"
            class="locale-chip locale-chip-sibling"
            :title="sibling.locale?.toUpperCase() ?? '?'"
            @click.stop="$emit('select', sibling.id)"
          >
            {{ sibling.locale?.toUpperCase() ?? "—" }}
          </button>
        </div>
      </div>
    </div>
  </GlassCard>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import GlassCard from "src/components/ui/GlassCard.vue";
import StalenessBadge from "src/components/refresh/StalenessBadge.vue";

interface ArticleStub {
  id: string;
  slug: string;
  title: string | null;
  cornerstoneKeyword: string | null;
  collection: string | null;
  locale: string | null;
  status: string;
  wordCount: number | null;
  updatedAt: string | Date;
  needsRefresh?: boolean;
  daysSinceLastUpdate?: number | null;
}

interface ArticleSibling {
  id: string;
  locale: string | null;
  status: string;
}

const STATUS_VARIANT_MAP: Record<string, string> = {
  proposed: "idle",
  approved: "queued",
  generating: "running",
  outline_review: "queued",
  drafting: "running",
  final_review: "queued",
  published: "completed",
  failed: "failed",
};

const STATUS_LABEL_MAP: Record<string, string> = {
  proposed: "Proposed",
  approved: "Approved",
  generating: "Generating",
  outline_review: "Outline",
  drafting: "Drafting",
  final_review: "Review",
  schema_extending: "Schema",
  ready_to_publish: "Ready",
  validating: "Validating",
  published: "Published",
  blocked_by_pagespeed: "Blocked",
  failed: "Failed",
  rejected: "Rejected",
};

function formatRelative(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export default defineComponent({
  name: "ArticleCard",

  components: { GlassCard, StalenessBadge },

  emits: {
    select: (_id: string) => true,
  },

  props: {
    article: { type: Object as PropType<ArticleStub>, required: true },
    sibling: { type: Object as PropType<ArticleSibling | null>, default: null },
    selected: { type: Boolean, default: false },
  },

  computed: {
    statusVariant(): string {
      return STATUS_VARIANT_MAP[this.article.status] ?? "idle";
    },
    statusLabel(): string {
      return STATUS_LABEL_MAP[this.article.status] ?? this.article.status;
    },
    relativeTime(): string {
      return formatRelative(this.article.updatedAt);
    },
  },
});
</script>

<style scoped>
.article-card {
  display: block;
  width: 100%;
  text-align: left;
  padding: 12px 14px;
  cursor: pointer;
  border-radius: var(--radius-md);
}

.card-selected {
  border-color: var(--accent-primary);
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

.card-tag,
.card-locale {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.card-status {
  margin-left: auto;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 8px;
}

.status-running { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
.status-queued  { background: rgba(234, 179, 8, 0.15); color: #fbbf24; }
.status-completed { background: rgba(34, 197, 94, 0.15); color: #4ade80; }
.status-failed  { background: rgba(239, 68, 68, 0.15); color: #f87171; }
.status-idle    { background: rgba(255, 255, 255, 0.06); color: var(--text-tertiary); }

.card-title {
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

.card-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.card-meta {
  font-size: 10px;
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  gap: 4px;
}

.sep {
  color: var(--border-medium);
}

.locale-chips {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.locale-chip {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 10px;
  border: 1px solid var(--border-subtle);
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-tertiary);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: background 120ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
              color 120ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.locale-chip-current {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
}

@media (hover: hover) and (pointer: fine) {
  .locale-chip:hover {
    background: var(--accent-primary);
    color: #fff;
    border-color: var(--accent-primary);
  }
}
</style>
