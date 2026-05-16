<template>
  <div class="article-pills" :aria-label="$t('dashboard.clusters.pillsLabel') as string">
    <StatusPill
      v-for="(status, i) in pillStatuses"
      :key="i"
      :status="status"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import StatusPill from "src/components/ui/StatusPill.vue";
import type { ArticleGenerationStatus, ClusterArticleStub } from "src/types/ui";

/** Maps article DB status → pill display status */
function articleStatusToPill(status: string): ArticleGenerationStatus {
  if (status === "published" || status === "final_review") return "done";
  if (status === "failed") return "failed";
  if (status === "queued") return "queued";
  // Any in-progress state (draft, outline, review, schema, etc.)
  if (status !== "draft_requested") return "running";
  return "queued";
}

/**
 * A row of small status dots visualising per-article generation state.
 * Renders up to `totalSlots` pills — filled slots show live status,
 * empty slots show 'idle'. Used inside ClusterCard.
 */
export default defineComponent({
  name: "ClusterArticlePills",

  components: { StatusPill },

  props: {
    /** Hub article (null if not yet generated) */
    hubArticle: {
      type: Object as PropType<ClusterArticleStub | null>,
      default: null,
    },
    /** Spoke articles (may be partial) */
    spokeArticles: {
      type: Array as PropType<ClusterArticleStub[]>,
      default: () => [],
    },
    /** Expected total article count (hub + spokes × locales) */
    totalSlots: {
      type: Number,
      default: 12,
    },
  },

  computed: {
    pillStatuses(): ArticleGenerationStatus[] {
      const statuses: ArticleGenerationStatus[] = [];

      // Hub slot
      if (this.hubArticle) {
        statuses.push(articleStatusToPill(this.hubArticle.status));
      } else {
        statuses.push("idle");
      }

      // Spoke slots — each spoke may have DE + EN versions
      const spokes = this.spokeArticles;
      for (let i = 0; i < this.totalSlots - 1; i++) {
        const spoke = spokes[i];
        statuses.push(spoke ? articleStatusToPill(spoke.status) : "idle");
      }

      return statuses.slice(0, this.totalSlots);
    },
  },
});
</script>

<style scoped>
.article-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}
</style>
