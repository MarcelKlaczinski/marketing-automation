<template>
  <div class="social-tab">
    <!-- Generate form -->
    <GlassCard variant="strong" class="generate-form">
      <header class="form-header">
        <h2 class="form-title">{{ $t("social.tabs.generate") as string }}</h2>
      </header>

      <div class="locale-section">
        <div class="locale-label">{{ $t("social.generation.locales.label") as string }}</div>
        <div class="locale-options">
          <label
            v-for="loc in targetLocales"
            :key="loc"
            class="locale-option"
            :class="{ 'locale-option--selected': selectedLocales.includes(loc) }"
          >
            <input
              type="checkbox"
              class="locale-checkbox"
              :value="loc"
              :checked="selectedLocales.includes(loc)"
              @change="toggleLocale(loc)"
            />
            <span class="locale-flag">{{ localeFlag(loc) }}</span>
            <span class="locale-name">{{ loc }}</span>
          </label>
        </div>

        <button
          v-if="targetLocales.length > 1"
          class="select-all-btn"
          @click="selectAll"
        >
          {{ $t("social.generation.locales.selectAll") as string }}
        </button>

        <div class="cost-hint" :class="{ 'cost-hint--warning': selectedLocales.length === 0 }">
          <template v-if="selectedLocales.length === 0">
            {{ $t("social.generation.locales.none") as string }}
          </template>
          <template v-else>
            {{ costHint }}
          </template>
        </div>
      </div>

      <div class="form-actions">
        <GlassButton
          variant="primary"
          :disabled="selectedLocales.length === 0 || generating"
          :loading="generating"
          @click="onGenerate"
        >
          {{ $t("social.generate") as string }}
        </GlassButton>
      </div>
    </GlassCard>

    <!-- Render history -->
    <div class="history-section">
      <h3 class="history-title">{{ $t("social.history.label") as string }}</h3>

      <LoadingShimmer v-if="isLoading" variant="card" :count="2" />

      <EmptyState
        v-else-if="!posts.length"
        :title="$t('social.historyEmpty') as string"
      />

      <div v-else class="history-groups">
        <div
          v-for="group in groupedPosts"
          :key="group.locale"
          class="locale-group"
        >
          <div class="locale-group-header">
            <span class="locale-flag">{{ localeFlag(group.locale) }}</span>
            <span class="locale-group-label">
              {{
                $t("social.history.localeGroupHeader", {
                  locale: group.locale,
                  slides: group.posts[0]?.totalSlides ?? 0,
                }) as string
              }}
            </span>
          </div>

          <div class="post-list">
            <div
              v-for="post in group.posts"
              :key="post.id"
              class="post-entry"
            >
              <div class="post-row" :class="`post-${post.status}`">
                <div class="post-meta">
                  <span class="post-status-dot" :class="`dot-${post.status}`" />
                  <span class="post-status mono">{{ statusLabel(post.status) }}</span>
                  <span class="post-date mono">{{ formatDate(post.createdAt) }}</span>
                  <span v-if="post.costEur != null" class="post-cost mono">
                    €{{ parseFloat(post.costEur).toFixed(3) }}
                  </span>
                </div>
                <div class="post-actions">
                  <GlassButton
                    v-if="postSlideUrls(post).length > 0"
                    variant="ghost"
                    size="sm"
                    @click="toggleSlides(post.id)"
                  >
                    {{ expandedPostId === post.id ? $t("social.slidesHide") as string : $t("social.slidesView") as string }}
                  </GlassButton>
                  <GlassButton
                    v-if="postSlideUrls(post).length > 0"
                    variant="ghost"
                    size="sm"
                    :loading="downloadingId === post.id"
                    @click="onDownload(post.id)"
                  >
                    {{ $t("social.download") as string }}
                  </GlassButton>
                </div>
              </div>

              <div v-if="expandedPostId === post.id && postSlideUrls(post).length > 0" class="slide-strip">
                <img
                  v-for="(url, idx) in postSlideUrls(post)"
                  :key="idx"
                  :src="url"
                  :alt="($t('social.slideAlt', { n: idx + 1 }) as string)"
                  class="slide-thumb"
                  loading="lazy"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { apiGet, apiPost } from "src/lib/api";
import GlassCard from "src/components/ui/GlassCard.vue";
import GlassButton from "src/components/ui/GlassButton.vue";
import LoadingShimmer from "src/components/ui/LoadingShimmer.vue";
import EmptyState from "src/components/ui/EmptyState.vue";
import { useProjectStore } from "src/stores/project";

interface ProjectInfo {
  targetLocales: string[];
}

interface SocialPostContent {
  slides?: Array<{ imageUrl: string }>;
}

interface SocialPost {
  id: string;
  locale: string;
  status: string;
  totalSlides: number;
  costEur: string | null;
  createdAt: string;
  content?: SocialPostContent | null;
}

interface LocaleGroup {
  locale: string;
  posts: SocialPost[];
}

const STATUS_LABEL_KEYS: Record<string, string> = {
  draft: "social.postStatus.draft",
  in_review: "social.postStatus.inReview",
  approved: "social.postStatus.approved",
  scheduled: "social.postStatus.scheduled",
  published: "social.postStatus.published",
  failed: "social.postStatus.failed",
  replaced: "social.postStatus.replaced",
};

export default defineComponent({
  name: "ArticleSocialTab",

  components: { GlassCard, GlassButton, LoadingShimmer, EmptyState },

  props: {
    articleId: { type: String, required: true },
  },

  setup(props) {
    const queryClient = useQueryClient();
    const projectStore = useProjectStore();

    const { data: postsData, isLoading } = useQuery({
      queryKey: ["article-social-posts", props.articleId],
      queryFn: () => apiGet<SocialPost[]>(`/articles/${props.articleId}/social-posts`),
    });

    const { data: projectData } = useQuery({
      queryKey: ["project-settings", projectStore.currentSlug],
      queryFn: () => apiGet<ProjectInfo>(`/projects/${projectStore.currentSlug}`),
      enabled: !!projectStore.currentSlug,
    });

    return { postsData, isLoading, projectData, queryClient, projectStore };
  },

  data: () => ({
    selectedLocales: [] as string[],
    generating: false,
    downloadingId: null as string | null,
    expandedPostId: null as string | null,
  }),

  computed: {
    posts(): SocialPost[] {
      return (this.postsData as SocialPost[] | undefined) ?? [];
    },

    targetLocales(): string[] {
      return (this.projectData as ProjectInfo | undefined)?.targetLocales ?? ["de-DE"];
    },

    groupedPosts(): LocaleGroup[] {
      const groups: Record<string, SocialPost[]> = {};
      for (const post of this.posts) {
        const loc = post.locale ?? "de-DE";
        if (!groups[loc]) groups[loc] = [];
        groups[loc]!.push(post);
      }
      return Object.entries(groups).map(([locale, posts]) => ({ locale, posts }));
    },

    costHint(): string {
      const count = this.selectedLocales.length;
      const cost = (0.028 * count).toFixed(2);
      const key = count === 1 ? "social.generation.locales.hint" : "social.generation.locales.hintPlural";
      return this.$t(key, { count, cost }) as string;
    },
  },

  watch: {
    targetLocales: {
      immediate: true,
      handler(locales: string[]) {
        if (this.selectedLocales.length === 0 && locales.length > 0) {
          this.selectedLocales = [locales[0]!];
        }
      },
    },
  },

  methods: {
    toggleLocale(loc: string): void {
      if (this.selectedLocales.includes(loc)) {
        this.selectedLocales = this.selectedLocales.filter((l) => l !== loc);
      } else {
        this.selectedLocales = [...this.selectedLocales, loc];
      }
    },

    selectAll(): void {
      this.selectedLocales = [...this.targetLocales];
    },

    localeFlag(locale: string): string {
      if (locale.startsWith("de")) return "🇩🇪";
      if (locale.startsWith("en-US")) return "🇺🇸";
      if (locale.startsWith("en-GB")) return "🇬🇧";
      if (locale.startsWith("en")) return "🇬🇧";
      return "🌐";
    },

    statusLabel(status: string): string {
      const key = STATUS_LABEL_KEYS[status];
      return key ? (this.$t(key) as string) : status;
    },

    formatDate(iso: string): string {
      const d = new Date(iso);
      return d.toLocaleString(this.$i18n.locale === "de" ? "de-DE" : "en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    },

    async onGenerate(): Promise<void> {
      if (this.selectedLocales.length === 0) return;
      this.generating = true;
      try {
        await apiPost(`/articles/${this.articleId}/social-posts/generate`, {
          format: "list_carousel",
          theme: "dark",
          variant: "stunning",
          locales: this.selectedLocales,
        });
        this.$q.notify({ type: "positive", message: this.$t("social.generating") as string });
        void this.queryClient.invalidateQueries({ queryKey: ["article-social-posts", this.articleId] });
      } catch (err) {
        this.$q.notify({
          type: "negative",
          message: err instanceof Error ? err.message : (this.$t("social.postStatus.failed") as string),
        });
      } finally {
        this.generating = false;
      }
    },

    postSlideUrls(post: SocialPost): string[] {
      return post.content?.slides?.map((s) => s.imageUrl) ?? [];
    },

    toggleSlides(postId: string): void {
      this.expandedPostId = this.expandedPostId === postId ? null : postId;
    },

    async onDownload(postId: string): Promise<void> {
      this.downloadingId = postId;
      try {
        const url = `/api/social-posts/${postId}/download-bundle`;
        const a = document.createElement("a");
        a.href = url;
        a.download = `social-post-${postId}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } finally {
        this.downloadingId = null;
      }
    },
  },
});
</script>

<style scoped>
.social-tab {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.generate-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
}

.form-header {
  margin-bottom: 4px;
}

.form-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.locale-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.locale-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.locale-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.locale-option {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md, 6px);
  cursor: pointer;
  transition:
    border-color 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
    background 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
  font-size: 13px;
  color: var(--text-secondary);
}

.locale-option--selected {
  border-color: var(--accent-primary, #7c5cff);
  background: color-mix(in oklch, var(--accent-primary, #7c5cff) 10%, transparent);
  color: var(--text-primary);
}

.locale-checkbox {
  display: none;
}

.locale-flag {
  font-size: 16px;
}

.locale-name {
  font-family: var(--font-mono, monospace);
}

.select-all-btn {
  align-self: flex-start;
  font-size: 12px;
  color: var(--accent-primary, #7c5cff);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
}

.cost-hint {
  font-size: 12px;
  color: var(--text-tertiary);
}

.cost-hint--warning {
  color: var(--color-warning, #f59e0b);
}

.form-actions {
  display: flex;
  justify-content: flex-end;
}

/* History */
.history-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.history-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.history-groups {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.locale-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.locale-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border-subtle);
}

.post-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.post-entry {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.post-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: var(--radius-sm, 4px);
  background: var(--surface-secondary, rgba(255, 255, 255, 0.03));
}

.slide-strip {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 4px 2px 8px;
  scrollbar-width: thin;
}

.slide-thumb {
  height: 160px;
  width: auto;
  border-radius: var(--radius-sm, 4px);
  flex-shrink: 0;
  object-fit: contain;
  background: var(--surface-tertiary, rgba(0, 0, 0, 0.2));
}

.post-meta {
  display: flex;
  align-items: center;
  gap: 10px;
}

.post-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot-draft, .dot-in_review { background: #f59e0b; }
.dot-approved, .dot-scheduled, .dot-published { background: #22c55e; }
.dot-failed { background: #ef4444; }
.dot-replaced { background: var(--text-tertiary); }

.post-status, .post-date, .post-cost {
  font-size: 12px;
  color: var(--text-secondary);
}

.post-actions {
  display: flex;
  gap: 6px;
}
</style>
