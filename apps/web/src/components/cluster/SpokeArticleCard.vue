<template>
  <div
    class="spoke-article-card"
    :class="[`spoke-status-${article.status}`, { 'spoke-failed': isFailed }]"
    role="button"
    tabindex="0"
    @click="$emit('click')"
    @keydown.enter="$emit('click')"
  >
    <div class="spoke-head">
      <span class="spoke-role mono">{{ article.role ?? article.locale ?? "—" }}</span>
      <span :class="['spoke-badge', `badge-${article.status}`]">
        {{ statusLabel }}
      </span>
    </div>

    <p class="spoke-title">{{ article.title ?? "—" }}</p>

    <div class="spoke-foot">
      <span class="spoke-locale mono">{{ article.locale }}</span>

      <!-- Running indicator -->
      <span v-if="isRunning" class="spoke-running mono">
        {{ $t("clusters.detail.running") as string }}
      </span>

      <!-- Per-spoke retry button for failed runs -->
      <button
        v-if="isFailed && failedRunId"
        class="retry-btn"
        :aria-label="$t('clusters.detail.retrySpoke') as string"
        @click.stop="$emit('retry', failedRunId)"
      >
        {{ $t("clusters.detail.retrySpoke") as string }}
      </button>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import type { PropType } from "vue";
import type { ClusterArticleStub, ClusterPipelineRun } from "src/types/ui";

const STATUS_KEY: Record<string, string> = {
  proposed: "articles.status.proposed",
  approved: "articles.status.approved",
  generating: "articles.status.generating",
  outline_review: "articles.status.outline_review",
  drafting: "articles.status.drafting",
  final_review: "articles.status.final_review",
  schema_extending: "articles.status.schema_extending",
  ready_to_publish: "articles.status.ready_to_publish",
  validating: "articles.status.validating",
  published: "articles.status.published",
  blocked_by_pagespeed: "articles.status.blocked_by_pagespeed",
  failed: "articles.status.failed",
  rejected: "articles.status.rejected",
};

export default defineComponent({
  name: "SpokeArticleCard",

  props: {
    article: {
      type: Object as PropType<ClusterArticleStub>,
      required: true,
    },
    pipelineRun: {
      type: Object as PropType<ClusterPipelineRun | null>,
      default: null,
    },
  },

  emits: ["click", "retry"],

  computed: {
    statusLabel(): string {
      const key = STATUS_KEY[this.article.status];
      return key ? (this.$t(key) as string) : this.article.status;
    },
    isFailed(): boolean {
      return this.article.status === "failed" || this.pipelineRun?.status === "failed";
    },
    isRunning(): boolean {
      return (
        this.pipelineRun?.status === "running" ||
        ["generating", "drafting", "outline_review", "validating", "schema_extending"].includes(
          this.article.status,
        )
      );
    },
    failedRunId(): string | null {
      return this.pipelineRun?.status === "failed" ? this.pipelineRun.id : null;
    },
  },
});
</script>

<style scoped>
.spoke-article-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: border-color 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

@media (hover: hover) and (pointer: fine) {
  .spoke-article-card:hover {
    border-color: var(--border-medium);
  }
}

.spoke-article-card:active {
  transform: scale(0.97);
  transition: transform 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.spoke-failed {
  border-color: rgba(239, 68, 68, 0.3);
}

.spoke-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.spoke-role {
  font-size: 9px;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.spoke-badge {
  font-size: 9px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 6px;
}

.badge-published { background: rgba(34, 197, 94, 0.15); color: #4ade80; }
.badge-failed, .badge-blocked_by_pagespeed { background: rgba(239, 68, 68, 0.15); color: #f87171; }
.badge-generating, .badge-drafting, .badge-validating, .badge-schema_extending {
  background: rgba(59, 130, 246, 0.15); color: #60a5fa;
}
.badge-final_review, .badge-outline_review, .badge-approved {
  background: rgba(234, 179, 8, 0.15); color: #fbbf24;
}
.badge-proposed, .badge-rejected, .badge-ready_to_publish {
  background: rgba(255, 255, 255, 0.06); color: var(--text-tertiary);
}

.spoke-title {
  font-size: 12px;
  color: var(--text-primary);
  margin: 0;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.spoke-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-top: 2px;
}

.spoke-locale {
  font-size: 9px;
  color: var(--text-tertiary);
}

.spoke-running {
  font-size: 9px;
  color: #60a5fa;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.retry-btn {
  font-size: 10px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.1);
  color: #f87171;
  cursor: pointer;
  transition: background 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
  min-height: 24px;
}

@media (hover: hover) and (pointer: fine) {
  .retry-btn:hover {
    background: rgba(239, 68, 68, 0.2);
  }
}

@media (max-width: 767px) {
  .retry-btn {
    min-height: 44px;
    padding: 0 12px;
  }
}
</style>
