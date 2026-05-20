<template>
  <div class="social-tab">

    <!-- ─── Locale + Theme toggles ─────────────────────────────────────────── -->
    <div class="controls-row">
      <div class="control-group">
        <span class="control-label">{{ $t("social.templatePicker.localeLabel") as string }}</span>
        <div class="toggle-row">
          <button
            v-for="loc in availableLocales"
            :key="loc"
            class="toggle-btn"
            :class="{ 'toggle-btn--active': selectedLocale === loc }"
            @click="selectLocale(loc)"
          >
            {{ localeFlag(loc) }} {{ loc.toUpperCase() }}
          </button>
        </div>
      </div>
      <div class="control-group">
        <span class="control-label">{{ $t("social.templatePicker.themeLabel") as string }}</span>
        <div class="toggle-row">
          <button
            class="toggle-btn"
            :class="{ 'toggle-btn--active': selectedTheme === 'dark' }"
            @click="selectedTheme = 'dark'"
          >
            {{ $t("social.darkTheme") as string }}
          </button>
          <button
            class="toggle-btn"
            :class="{ 'toggle-btn--active': selectedTheme === 'light' }"
            @click="selectedTheme = 'light'"
          >
            {{ $t("social.lightTheme") as string }}
          </button>
        </div>
      </div>
    </div>

    <!-- ─── Loading shimmer ────────────────────────────────────────────────── -->
    <LoadingShimmer v-if="templatesLoading" variant="card" :count="3" />

    <template v-else>

      <!-- ─── Top suggestion block ─────────────────────────────────────────── -->
      <GlassCard v-if="topSuggestion" variant="strong" class="suggestion-block">
        <div class="suggestion-header">
          <span class="suggestion-star">★</span>
          <span class="suggestion-heading">{{ $t("social.templatePicker.suggestedHeading") as string }}</span>
          <span class="suggestion-confidence">
            {{ $t("social.templatePicker.confidence", { pct: Math.round(topSuggestion.confidence * 100) }) as string }}
          </span>
        </div>
        <div class="suggestion-key">{{ templateLabel(topSuggestion.templateKey) }}</div>
        <div class="suggestion-actions">
          <GlassButton
            variant="primary"
            size="sm"
            :loading="generatingKey === topSuggestion.templateKey"
            :disabled="generating"
            @click="generateTemplate(topSuggestion.templateKey)"
          >
            {{ $t("social.templatePicker.generateBtn") as string }}
          </GlassButton>
        </div>
      </GlassCard>

      <!-- ─── All templates list ────────────────────────────────────────────── -->
      <div class="section">
        <h3 class="section-title">{{ $t("social.templatePicker.allTemplatesHeading") as string }}</h3>

        <div class="template-list">
          <div
            v-for="tmpl in sortedTemplates"
            :key="tmpl.templateKey"
            class="template-row"
            :class="{ 'template-row--ineligible': !tmpl.eligible }"
          >
            <div class="template-info">
              <span class="template-eligibility-dot" :class="tmpl.eligible ? 'dot--eligible' : 'dot--ineligible'" />
              <div class="template-details">
                <span class="template-key">{{ tmpl.templateKey }}</span>
                <span v-if="isSuggested(tmpl.templateKey)" class="suggestion-badge">★</span>
                <span v-if="tmpl.eligible" class="template-status eligible-label">
                  {{ $t("social.templatePicker.eligible") as string }}
                </span>
                <span
                  v-else
                  class="template-status ineligible-label"
                  :title="tmpl.ineligibleReason ? ($t('social.templatePicker.ineligibleReason', { reason: tmpl.ineligibleReason }) as string) : ''"
                >
                  {{ $t("social.templatePicker.ineligible") as string }}
                </span>
              </div>
            </div>

            <div v-if="tmpl.eligible" class="template-actions">
              <GlassButton
                variant="ghost"
                size="sm"
                :loading="generatingKey === tmpl.templateKey"
                :disabled="generating"
                @click="generateTemplate(tmpl.templateKey)"
              >
                {{ $t("social.templatePicker.generateBtn") as string }}
              </GlassButton>
            </div>
          </div>
        </div>
      </div>

      <!-- ─── Already generated ─────────────────────────────────────────────── -->
      <div class="section">
        <h3 class="section-title">{{ $t("social.templatePicker.generatedHeading") as string }}</h3>

        <LoadingShimmer v-if="isLoading" variant="card" :count="2" />

        <EmptyState
          v-else-if="!posts.length"
          :title="$t('social.templatePicker.empty') as string"
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
                {{ $t("social.history.localeGroupHeader", { locale: group.locale, slides: group.posts[0]?.totalSlides ?? 0 }) as string }}
              </span>
            </div>

            <div class="post-list">
              <div
                v-for="post in group.posts"
                :key="post.id"
                class="post-entry"
              >
                <div class="post-row" :class="`post-${post.status}`">
                  <!-- Thumbnail -->
                  <img
                    v-if="postSlideUrls(post).length > 0"
                    :src="postSlideUrls(post)[0]"
                    :alt="($t('social.slideAlt', { n: 1 }) as string)"
                    class="post-thumb"
                    loading="lazy"
                    @click="openPreview(post, 0)"
                  />
                  <div v-else class="post-thumb post-thumb--empty" />

                  <div class="post-meta">
                    <div class="post-meta-row">
                      <span class="post-status-dot" :class="`dot-${post.status}`" />
                      <span class="post-status mono">{{ statusLabel(post.status) }}</span>
                      <span v-if="post.renderStatus" class="render-chip" :class="`render-chip--${post.renderStatus}`">
                        <span v-if="post.renderStatus === 'rendering'" class="render-pulse" />
                        {{ renderStatusLabel(post.renderStatus) }}
                      </span>
                    </div>
                    <div class="post-meta-row post-meta-row--secondary">
                      <span v-if="post.templateKey" class="post-template-key mono">{{ post.templateKey }}</span>
                      <span class="post-date mono">{{ formatDate(post.createdAt) }}</span>
                      <span v-if="post.costEur != null" class="post-cost mono">€{{ parseFloat(post.costEur).toFixed(3) }}</span>
                    </div>
                  </div>

                  <div class="post-actions">
                    <GlassButton
                      v-if="postSlideUrls(post).length > 0"
                      variant="ghost"
                      size="sm"
                      @click="toggleSlides(post.id)"
                    >
                      {{ expandedPostId === post.id ? ($t("social.slidesHide") as string) : ($t("social.slidesView") as string) }}
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
                      {{ $t("social.templatePicker.rerenderBtn") as string }}
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
    </template>
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
        <div class="ig-phone">
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

          <div class="ig-slide-wrap">
            <img
              v-if="preview.urls.length > 0"
              :src="preview.urls[preview.slideIdx]"
              class="ig-slide-img"
              :alt="($t('social.slideAlt', { n: preview.slideIdx + 1 }) as string)"
            />
            <div class="ig-dots">
              <span
                v-for="(_, i) in preview.urls"
                :key="i"
                class="ig-dot"
                :class="{ 'ig-dot--active': i === preview.slideIdx }"
              />
            </div>
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

          <div class="ig-actions">
            <div class="ig-actions-left">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </div>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </div>

          <div class="ig-caption">
            <span class="ig-caption-user">toolwiki.ai</span>
            {{ (preview.caption ?? "").slice(0, 120) }}{{ (preview.caption ?? "").length > 120 ? "…" : "" }}
            <span v-if="preview.hashtags && preview.hashtags.length" class="ig-hashtags">
              {{ preview.hashtags.join(" ") }}
            </span>
          </div>

          <div class="ig-counter">{{ preview.slideIdx + 1 }} / {{ preview.urls.length }}</div>
        </div>

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
  locale?: string;
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
  templateKey?: string | null;
  content?: SocialPostContent | null;
}

interface LocaleGroup {
  locale: string;
  posts: SocialPost[];
}

interface EligibilityResult {
  templateKey: string;
  displayName: string;
  description: string;
  eligible: boolean;
  ineligibleReason?: string;
}

interface TemplateSuggestion {
  templateKey: string;
  confidence: number;
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

const CONFIDENCE_THRESHOLD = 0.6;

export default defineComponent({
  name: "ArticleSocialTab",

  components: { GlassCard, GlassButton, LoadingShimmer, EmptyState },

  props: {
    articleId: { type: String, required: true },
    articleLocale: { type: String, default: "de" },
  },

  setup(props) {
    const queryClient = useQueryClient();
    const projectStore = useProjectStore();

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

  data() {
    return {
      selectedLocale: (this.articleLocale?.startsWith("en") ? "en" : "de") as "de" | "en",
      selectedTheme: "dark" as "dark" | "light",
      generating: false,
      generatingKey: null as string | null,
      downloadingId: null as string | null,
      reRenderingIds: [] as string[],
      expandedPostId: null as string | null,
      allTemplates: [] as EligibilityResult[],
      suggestions: [] as TemplateSuggestion[],
      templatesLoading: false,
      templatesError: null as string | null,
      preview: {
        open: false,
        urls: [] as string[],
        slideIdx: 0,
        caption: "" as string | null,
        hashtags: [] as string[],
      },
      _previewKeyHandler: null as ((e: Event) => void) | null,
    };
  },

  computed: {
    posts(): SocialPost[] {
      return (this.postsData as SocialPost[] | undefined) ?? [];
    },

    availableLocales(): string[] {
      const projectLocales = (this.projectData as ProjectInfo | undefined)?.targetLocales ?? ["de-DE"];
      const locales: string[] = [];
      if (projectLocales.some((l) => l.startsWith("de"))) locales.push("de");
      if (projectLocales.some((l) => l.startsWith("en"))) locales.push("en");
      return locales.length > 0 ? locales : ["de"];
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

    topSuggestion(): TemplateSuggestion | null {
      const eligible = this.suggestions.filter((s) => s.confidence >= CONFIDENCE_THRESHOLD);
      if (eligible.length === 0) return null;
      return eligible.sort((a, b) => b.confidence - a.confidence)[0] ?? null;
    },

    sortedTemplates(): EligibilityResult[] {
      const suggestionKeys = new Set(this.suggestions.map((s) => s.templateKey));
      return [...this.allTemplates].sort((a, b) => {
        const aS = suggestionKeys.has(a.templateKey) ? 1 : 0;
        const bS = suggestionKeys.has(b.templateKey) ? 1 : 0;
        if (aS !== bS) return bS - aS;
        if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
        return 0;
      });
    },
  },

  mounted() {
    void this.loadTemplates();
  },

  methods: {
    async loadTemplates(): Promise<void> {
      this.templatesLoading = true;
      this.templatesError = null;
      try {
        const [templatesRes, suggestionsRes] = await Promise.all([
          apiGet<{ templates: EligibilityResult[] }>(`/articles/${this.articleId}/all-templates`),
          apiGet<{ suggestions: TemplateSuggestion[] }>(`/articles/${this.articleId}/template-suggestions`),
        ]);
        this.allTemplates = templatesRes.templates ?? [];
        this.suggestions = suggestionsRes.suggestions ?? [];
      } catch (err) {
        this.templatesError = err instanceof Error ? err.message : String(err);
      } finally {
        this.templatesLoading = false;
      }
    },

    // Locale selector — typed method avoids as-cast in template (CLAUDE.md: no narrowing casts in template bindings)
    selectLocale(loc: string): void {
      this.selectedLocale = loc.startsWith("en") ? "en" : "de";
    },

    isSuggested(templateKey: string): boolean {
      return this.suggestions.some((s) => s.templateKey === templateKey);
    },

    // Returns the human-readable display name for a template key, cross-referencing allTemplates.
    // Falls back to the raw key when not yet loaded (e.g. during initial suggestion display).
    templateLabel(templateKey: string): string {
      return this.allTemplates.find((t) => t.templateKey === templateKey)?.displayName ?? templateKey;
    },

    async generateTemplate(templateKey: string): Promise<void> {
      this.generating = true;
      this.generatingKey = templateKey;
      try {
        const suggestion = this.suggestions.find((s) => s.templateKey === templateKey);
        const body: Record<string, unknown> = {
          templateKeys: [templateKey],
          locale: this.selectedLocale,
          theme: this.selectedTheme,
        };
        if (suggestion) {
          body.suggestionMeta = {
            suggestedTemplate: suggestion.templateKey,
            suggestionConfidence: suggestion.confidence,
          };
        } else if (this.topSuggestion) {
          // User chose a different template from the suggestion → mark as override
          body.suggestionMeta = {
            suggestedTemplate: this.topSuggestion.templateKey,
            suggestionConfidence: this.topSuggestion.confidence,
          };
        }
        await apiPost(`/articles/${this.articleId}/generate-templates`, body);
        this.$q.notify({ type: "positive", message: this.$t("social.render.enqueuedHint") as string });
        void this.queryClient.invalidateQueries({ queryKey: ["social-posts", this.articleId] });
      } catch (err) {
        this.$q.notify({
          type: "negative",
          message: err instanceof Error ? err.message : (this.$t("social.postStatus.failed") as string),
        });
      } finally {
        this.generating = false;
        this.generatingKey = null;
      }
    },

    localeFlag(locale: string): string {
      if (locale.startsWith("de")) return "🇩🇪";
      if (locale === "en-US") return "🇺🇸";
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

/* ─── Controls row ────────────────────────────────────────── */
.controls-row {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
}

.control-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.control-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.toggle-row {
  display: flex;
  gap: 4px;
}

.toggle-btn {
  padding: 5px 12px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm, 4px);
  background: none;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary);
  transition: border-color 140ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
    background 140ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
    color 140ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.toggle-btn--active {
  border-color: var(--accent-primary, #7c5cff);
  background: color-mix(in oklch, var(--accent-primary, #7c5cff) 12%, transparent);
  color: var(--text-primary);
}

@media (hover: hover) and (pointer: fine) {
  .toggle-btn:not(.toggle-btn--active):hover {
    border-color: var(--border-medium);
    color: var(--text-primary);
  }
}

/* ─── Suggestion block ────────────────────────────────────── */
.suggestion-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid color-mix(in oklch, var(--accent-primary, #7c5cff) 30%, transparent);
}

.suggestion-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.suggestion-star {
  color: var(--accent-primary, #7c5cff);
  font-size: 14px;
}

.suggestion-heading {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
}

.suggestion-confidence {
  font-size: 11px;
  font-family: var(--font-mono, monospace);
  color: var(--text-secondary);
  margin-left: auto;
}

.suggestion-key {
  font-size: 12px;
  font-family: var(--font-mono, monospace);
  color: var(--accent-primary, #7c5cff);
}

.suggestion-actions {
  display: flex;
  justify-content: flex-end;
}

/* ─── Section ─────────────────────────────────────────────── */
.section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

/* ─── Template list ───────────────────────────────────────── */
.template-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.template-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: var(--radius-sm, 4px);
  background: var(--surface-secondary, rgba(255, 255, 255, 0.03));
  transition: background 120ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.template-row--ineligible {
  opacity: 0.5;
}

.template-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.template-eligibility-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot--eligible { background: #22c55e; }
.dot--ineligible { background: var(--text-tertiary); }

.template-details {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex-wrap: wrap;
}

.template-key {
  font-size: 12px;
  font-family: var(--font-mono, monospace);
  color: var(--text-primary);
}

.suggestion-badge {
  font-size: 11px;
  color: var(--accent-primary, #7c5cff);
}

.template-status {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 5px;
  border-radius: 3px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.eligible-label {
  color: #22c55e;
  background: color-mix(in oklch, #22c55e 12%, transparent);
}

.ineligible-label {
  color: var(--text-tertiary);
  background: color-mix(in oklch, var(--text-tertiary) 10%, transparent);
  cursor: help;
}

.template-actions {
  flex-shrink: 0;
}

/* ─── Post list (history) ─────────────────────────────────── */
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

.locale-flag { font-size: 14px; }

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
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-sm, 4px);
  background: var(--surface-secondary, rgba(255, 255, 255, 0.03));
}

.post-thumb {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-sm, 4px);
  object-fit: cover;
  flex-shrink: 0;
  cursor: pointer;
  background: var(--surface-tertiary, rgba(0, 0, 0, 0.2));
  transition: opacity 0.15s var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.post-thumb--empty {
  cursor: default;
  border: 1px dashed var(--border-soft);
}

@media (hover: hover) and (pointer: fine) {
  .post-thumb:not(.post-thumb--empty):hover { opacity: 0.8; }
}

.post-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.post-meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.post-meta-row--secondary {
  gap: 6px;
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

.post-template-key {
  font-size: 11px;
  color: var(--text-tertiary);
}

.mono { font-family: var(--font-mono, monospace); }

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

.render-chip--pending { color: var(--text-tertiary); background: color-mix(in oklch, var(--text-tertiary) 12%, transparent); }
.render-chip--rendering { color: #f59e0b; background: color-mix(in oklch, #f59e0b 12%, transparent); }
.render-chip--rendered { color: #22c55e; background: color-mix(in oklch, #22c55e 12%, transparent); }
.render-chip--failed { color: #ef4444; background: color-mix(in oklch, #ef4444 12%, transparent); }

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

.post-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.slide-strip {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 4px 2px 8px;
  scrollbar-width: thin;
}

.slide-thumb {
  height: 140px;
  width: auto;
  border-radius: var(--radius-sm, 4px);
  flex-shrink: 0;
  object-fit: contain;
  background: var(--surface-tertiary, rgba(0, 0, 0, 0.2));
  cursor: pointer;
  transition: opacity 0.15s var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

@media (hover: hover) and (pointer: fine) { .slide-thumb:hover { opacity: 0.82; } }
.slide-thumb:active { transform: scale(0.97); }

/* ─── Instagram preview modal ─────────────────────────────── */
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

@keyframes igFadeIn { from { opacity: 0; } to { opacity: 1; } }

.ig-modal { position: relative; display: flex; align-items: flex-start; gap: 16px; }

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

.ig-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid rgba(0,0,0,.06); }
.ig-header-left { display: flex; align-items: center; gap: 10px; }
.ig-avatar { width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888); display: flex; align-items: center; justify-content: center; color: #fff; font-size: 11px; font-weight: 700; flex-shrink: 0; }
.ig-username { font-size: 13px; font-weight: 600; color: #000; line-height: 1.2; }
.ig-location { font-size: 11px; color: #737373; line-height: 1.2; }
.ig-header-right { color: #000; display: flex; align-items: center; }

.ig-slide-wrap { position: relative; width: 375px; height: 375px; background: #000; overflow: hidden; }
.ig-slide-img { width: 100%; height: 100%; object-fit: cover; display: block; }

.ig-dots { position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%); display: flex; gap: 4px; pointer-events: none; }
.ig-dot { width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,.55); }
.ig-dot--active { background: #fff; }

.ig-nav { position: absolute; top: 50%; transform: translateY(-50%); background: rgba(255,255,255,.85); border: none; border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #000; transition: background 0.12s; }
.ig-nav:hover { background: #fff; }
.ig-nav--prev { left: 10px; }
.ig-nav--next { right: 10px; }

.ig-actions { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px 4px; }
.ig-actions-left { display: flex; gap: 16px; color: #000; }
.ig-actions svg { color: #000; }

.ig-caption { padding: 0 14px 6px; font-size: 13px; color: #000; line-height: 1.45; }
.ig-caption-user { font-weight: 600; margin-right: 4px; }
.ig-hashtags { display: block; margin-top: 4px; color: #00376b; font-size: 12px; line-height: 1.5; }
.ig-counter { padding: 0 14px 12px; font-size: 11px; color: #737373; }

.ig-close { position: fixed; top: 16px; right: 16px; background: rgba(255,255,255,.12); border: none; border-radius: 50%; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #fff; transition: background 0.12s; }
.ig-close:hover { background: rgba(255,255,255,.22); }
</style>
