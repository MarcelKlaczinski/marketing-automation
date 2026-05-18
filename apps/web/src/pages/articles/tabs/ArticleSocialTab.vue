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
                  <span v-if="post.renderStatus" class="render-chip" :class="`render-chip--${post.renderStatus}`">
                    <span v-if="post.renderStatus === 'rendering'" class="render-pulse" />
                    {{ renderStatusLabel(post.renderStatus) }}
                    <span
                      v-if="post.renderStatus === 'failed' && post.renderError"
                      class="render-error-hint"
                      :title="post.renderError.message"
                    >{{ $t("social.render.errorViewDetails") as string }}</span>
                  </span>
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
                  <GlassButton
                    v-if="canReRender(post)"
                    variant="ghost"
                    size="sm"
                    :loading="reRenderingIds.includes(post.id)"
                    @click="confirmReRender(post)"
                  >
                    {{ $t("social.reRender") as string }}
                    <q-tooltip>{{ $t("social.reRenderHint") as string }}</q-tooltip>
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
                  @click="openPreview(post, idx)"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ─── Instagram preview modal ─────────────────────────────────────────── -->
  <Teleport to="body">
    <div
      v-if="preview.open"
      class="ig-overlay"
      @click.self="closePreview"
      role="dialog"
      :aria-label="$t('social.preview') as string"
    >
      <div class="ig-modal">
        <!-- Phone shell -->
        <div class="ig-phone">
          <!-- Instagram top bar -->
          <div class="ig-header">
            <div class="ig-header-left">
              <div class="ig-avatar">TW</div>
              <div>
                <div class="ig-username">toolwiki.ai</div>
                <div class="ig-location">Instagram</div>
              </div>
            </div>
            <div class="ig-header-right">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
            </div>
          </div>

          <!-- Slide image -->
          <div class="ig-slide-wrap">
            <img
              v-if="preview.urls.length > 0"
              :src="preview.urls[preview.slideIdx]"
              class="ig-slide-img"
              :alt="($t('social.slideAlt', { n: preview.slideIdx + 1 }) as string)"
            />
            <!-- Dot pagination -->
            <div class="ig-dots">
              <span
                v-for="(_, i) in preview.urls"
                :key="i"
                class="ig-dot"
                :class="{ 'ig-dot--active': i === preview.slideIdx }"
              />
            </div>
            <!-- Prev / Next tap zones -->
            <button
              v-if="preview.slideIdx > 0"
              class="ig-nav ig-nav--prev"
              :aria-label="$t('social.prevSlide') as string"
              @click="preview.slideIdx--"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <button
              v-if="preview.slideIdx < preview.urls.length - 1"
              class="ig-nav ig-nav--next"
              :aria-label="$t('social.nextSlide') as string"
              @click="preview.slideIdx++"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>

          <!-- Action bar -->
          <div class="ig-actions">
            <div class="ig-actions-left">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </div>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </div>

          <!-- Caption (truncated) -->
          <div class="ig-caption">
            <span class="ig-caption-user">toolwiki.ai</span>
            {{ (preview.caption ?? "").slice(0, 120) }}{{ (preview.caption ?? "").length > 120 ? "…" : "" }}
            <span v-if="preview.hashtags && preview.hashtags.length" class="ig-hashtags">
              {{ preview.hashtags.join(" ") }}
            </span>
          </div>

          <!-- Slide counter -->
          <div class="ig-counter">{{ preview.slideIdx + 1 }} / {{ preview.urls.length }}</div>
        </div>

        <!-- Close button outside phone -->
        <button class="ig-close" @click="closePreview" :aria-label="$t('social.closePreview') as string">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
  </Teleport>
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
  caption?: string;
  hashtags?: string[];
}

interface SocialPost {
  id: string;
  locale: string;
  status: string;
  renderStatus?: string;
  renderError?: { code: string; message: string } | null;
  totalSlides: number;
  costEur: string | null;
  createdAt: string;
  content?: SocialPostContent | null;
}

interface LocaleGroup {
  locale: string;
  posts: SocialPost[];
}

const RENDER_STATUS_KEYS: Record<string, string> = {
  pending: "social.render.pending",
  rendering: "social.render.rendering",
  rendered: "social.render.rendered",
  failed: "social.render.failed",
};

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

    // Query key matches usePipelineEvents composable's "social-posts" invalidation key so
    // SSE social.render.* events auto-refresh this list without manual wiring in the component.
    const { data: postsData, isLoading } = useQuery({
      queryKey: ["social-posts", props.articleId],
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
    reRenderingIds: [] as string[],
    expandedPostId: null as string | null,
    preview: {
      open: false,
      urls: [] as string[],
      slideIdx: 0,
      caption: "" as string | null,
      hashtags: [] as string[],
    },
    _previewKeyHandler: null as ((e: Event) => void) | null,
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

    renderStatusLabel(status: string): string {
      const key = RENDER_STATUS_KEYS[status];
      return key ? (this.$t(key) as string) : status;
    },

    openPreview(post: SocialPost, slideIdx: number): void {
      const urls = this.postSlideUrls(post);
      if (urls.length === 0) return;
      this.preview = {
        open: true,
        urls,
        slideIdx,
        caption: post.content?.caption ?? null,
        hashtags: post.content?.hashtags ?? [],
      };
      // Store bound handler so removeEventListener gets the same reference
      this._previewKeyHandler = (e: Event) => {
        const key = (e as KeyboardEvent).key;
        if (key === "Escape") this.closePreview();
        if (key === "ArrowRight" && this.preview.slideIdx < this.preview.urls.length - 1) this.preview.slideIdx++;
        if (key === "ArrowLeft" && this.preview.slideIdx > 0) this.preview.slideIdx--;
      };
      document.addEventListener("keydown", this._previewKeyHandler);
    },

    closePreview(): void {
      this.preview.open = false;
      if (this._previewKeyHandler) {
        document.removeEventListener("keydown", this._previewKeyHandler);
        this._previewKeyHandler = null;
      }
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
        this.$q.notify({ type: "positive", message: this.$t("social.render.enqueuedHint") as string });
        void this.queryClient.invalidateQueries({ queryKey: ["social-posts", this.articleId] });
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

    canReRender(post: SocialPost): boolean {
      return post.renderStatus === "rendered" || post.renderStatus === "failed";
    },

    confirmReRender(post: SocialPost): void {
      this.$q.dialog({
        title: this.$t("social.reRenderConfirm.title") as string,
        message: this.$t("social.reRenderConfirm.message") as string,
        ok: { label: this.$t("social.reRenderConfirm.ok") as string, color: "primary", flat: true },
        cancel: { flat: true },
      }).onOk(() => {
        void this.triggerReRender(post.id);
      });
    },

    async triggerReRender(postId: string): Promise<void> {
      this.reRenderingIds = [...this.reRenderingIds, postId];
      try {
        await apiPost(`/social-posts/${postId}/re-render`);
        void this.queryClient.invalidateQueries({ queryKey: ["social-posts", this.articleId] });
      } catch (err) {
        this.$q.notify({
          type: "negative",
          message: err instanceof Error ? err.message : (this.$t("social.reRenderFailed") as string),
        });
      } finally {
        this.reRenderingIds = this.reRenderingIds.filter((id) => id !== postId);
      }
    },

    async onDownload(postId: string): Promise<void> {
      this.downloadingId = postId;
      try {
        // Use full API base URL: relative /api/... resolves to the Quasar dev server (no proxy),
        // so we must fetch through the same base the rest of the app uses.
        const base = (import.meta.env.VITE_API_BASE_URL as string) ?? "http://localhost:3000/api";
        const res = await fetch(`${base}/social-posts/${postId}/download-bundle`, { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const objUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objUrl;
        a.download = `social-post-${postId}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(objUrl);
      } catch (err) {
        this.$q.notify({ type: "negative", message: err instanceof Error ? err.message : (this.$t("social.postStatus.failed") as string) });
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
  cursor: pointer;
  transition: opacity 0.15s var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

@media (hover: hover) and (pointer: fine) {
  .slide-thumb:hover { opacity: 0.82; }
}
.slide-thumb:active { transform: scale(0.97); }

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

.render-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-family: var(--font-mono, monospace);
  padding: 2px 6px;
  border-radius: 3px;
  white-space: nowrap;
}

.render-chip--pending {
  color: var(--text-tertiary);
  background: color-mix(in oklch, var(--text-tertiary) 12%, transparent);
}

.render-chip--rendering {
  color: #f59e0b;
  background: color-mix(in oklch, #f59e0b 12%, transparent);
}

.render-chip--rendered {
  color: #22c55e;
  background: color-mix(in oklch, #22c55e 12%, transparent);
}

.render-chip--failed {
  color: #ef4444;
  background: color-mix(in oklch, #ef4444 12%, transparent);
}

.render-pulse {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  animation: renderPulse 1.2s ease-in-out infinite;
}

@keyframes renderPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.8); }
}

.render-error-hint {
  text-decoration: underline;
  cursor: help;
  opacity: 0.8;
}

.post-actions {
  display: flex;
  gap: 6px;
}

/* ─── Instagram preview modal ─────────────────────────────────── */
.ig-overlay {
  position: fixed;
  inset: 0;
  z-index: 9000;
  background: rgba(0, 0, 0, 0.82);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: igFadeIn 0.18s var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

@keyframes igFadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.ig-modal {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.ig-phone {
  width: 375px;
  background: #fff;
  border-radius: 24px;
  overflow: hidden;
  box-shadow: 0 32px 80px rgba(0, 0, 0, 0.6);
  animation: igSlideUp 0.22s var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

@keyframes igSlideUp {
  from { transform: scale(0.95) translateY(12px); opacity: 0; }
  to   { transform: scale(1) translateY(0); opacity: 1; }
}

.ig-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.ig-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ig-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  font-family: -apple-system, sans-serif;
  flex-shrink: 0;
}

.ig-username {
  font-size: 13px;
  font-weight: 600;
  color: #000;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  line-height: 1.2;
}

.ig-location {
  font-size: 11px;
  color: #737373;
  font-family: -apple-system, sans-serif;
  line-height: 1.2;
}

.ig-header-right {
  color: #000;
  display: flex;
  align-items: center;
}

.ig-slide-wrap {
  position: relative;
  width: 375px;
  height: 375px;
  background: #000;
  overflow: hidden;
}

.ig-slide-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.ig-dots {
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 4px;
  pointer-events: none;
}

.ig-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.55);
}

.ig-dot--active {
  background: #fff;
  width: 6px;
}

.ig-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  background: rgba(255, 255, 255, 0.85);
  border: none;
  border-radius: 50%;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #000;
  transition: background 0.12s;
}

.ig-nav:hover { background: #fff; }
.ig-nav--prev { left: 10px; }
.ig-nav--next { right: 10px; }

.ig-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px 4px;
}

.ig-actions-left {
  display: flex;
  gap: 16px;
  color: #000;
}

.ig-actions svg { color: #000; }

.ig-caption {
  padding: 0 14px 6px;
  font-size: 13px;
  color: #000;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  line-height: 1.45;
}

.ig-caption-user {
  font-weight: 600;
  margin-right: 4px;
}

.ig-hashtags {
  display: block;
  margin-top: 4px;
  color: #00376b;
  font-size: 12px;
  line-height: 1.5;
}

.ig-counter {
  padding: 0 14px 12px;
  font-size: 11px;
  color: #737373;
  font-family: -apple-system, sans-serif;
}

.ig-close {
  position: fixed;
  top: 16px;
  right: 16px;
  background: rgba(255, 255, 255, 0.12);
  border: none;
  border-radius: 50%;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #fff;
  transition: background 0.12s;
}

.ig-close:hover { background: rgba(255, 255, 255, 0.22); }
</style>
