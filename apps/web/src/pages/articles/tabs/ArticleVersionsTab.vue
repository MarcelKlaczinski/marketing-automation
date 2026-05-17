<template>
  <div class="versions-tab">
    <LoadingShimmer v-if="isPending" variant="card" :count="3" />
    <EmptyState
      v-else-if="!versions.length"
      :title="$t('articles.versionsTab.noVersions') as string"
    />
    <div v-else class="versions-list">
      <div
        v-for="v in versions"
        :key="v.id"
        class="version-row"
      >
        <div class="version-num mono">v{{ v.versionNumber }}</div>
        <div class="version-info">
          <span class="version-reason">
            {{ v.changeReason ?? $t("articles.versionsTab.noReason") }}
          </span>
          <span class="version-meta mono">
            {{ v.wordCount ? `${v.wordCount}w · ` : "" }}{{ formatDate(v.createdAt) }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { apiGet } from "src/lib/api";
import LoadingShimmer from "src/components/ui/LoadingShimmer.vue";
import EmptyState from "src/components/ui/EmptyState.vue";
import type { ArticleVersionEntry } from "src/types/ui";

export default defineComponent({
  name: "ArticleVersionsTab",

  components: { LoadingShimmer, EmptyState },

  props: {
    articleId: { type: String, required: true },
  },

  setup(props) {
    // Component remounts when articleId prop changes (child route navigation),
    // so a static query key is sufficient — no computed() needed here.
    const { data, isPending } = useQuery({
      queryKey: ["article-versions", props.articleId],
      queryFn: () =>
        apiGet<{ versions: ArticleVersionEntry[] }>(
          `/articles/${props.articleId}/versions`,
        ),
    });
    return { data, isPending };
  },

  computed: {
    versions(): ArticleVersionEntry[] {
      return (this.data as { versions: ArticleVersionEntry[] } | undefined)?.versions ?? [];
    },
  },

  methods: {
    formatDate(iso: string): string {
      const d = new Date(iso);
      const diffMs = Date.now() - d.getTime();
      const mins = Math.floor(diffMs / 60_000);
      if (mins < 60) return `${mins}m ago`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `${hrs}h ago`;
      return `${Math.floor(hrs / 24)}d ago`;
    },
  },
});
</script>

<style scoped>
.versions-tab {
  padding: 16px;
}

.versions-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.version-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 14px;
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
}

.version-num {
  font-size: 11px;
  color: var(--text-tertiary);
  min-width: 28px;
  padding-top: 1px;
}

.version-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.version-reason {
  font-size: 13px;
  color: var(--text-primary);
}

.version-meta {
  font-size: 10px;
  color: var(--text-tertiary);
}
</style>
