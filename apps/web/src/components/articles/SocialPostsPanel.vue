<template>
  <div class="social-posts-panel">
    <!-- Tab bar -->
    <q-tabs
      v-model="activeTab"
      dense
      align="left"
      class="social-posts-panel__tabs"
    >
      <q-tab name="generate" :label="$t('social.tabs.generate')" />
      <q-tab name="suggestions" :label="$t('social.tabs.suggestions')">
        <!-- Orange number badge: pending suggestions remain -->
        <q-badge
          v-if="pendingSuggestionsCount > 0"
          color="warning"
          floating
        >{{ pendingSuggestionsCount }}</q-badge>
        <!-- Green check badge: all suggestions done -->
        <q-badge
          v-else-if="totalSuggestionsCount > 0 && pendingSuggestionsCount === 0"
          color="positive"
          floating
        ><q-icon name="check" size="10px" /></q-badge>
      </q-tab>
      <q-tab name="history" :label="$t('social.tabs.history')" />
    </q-tabs>

    <q-tab-panels v-model="activeTab" animated class="social-posts-panel__panels">
      <!-- Generate panel -->
      <q-tab-panel name="generate" class="q-pa-none">
        <div class="social-posts-panel__section">
          <div class="social-posts-panel__title">{{ $t('social.templateGallery.title') }}</div>

          <!-- Global theme selector -->
          <div class="social-posts-panel__field">
            <div class="social-posts-panel__label">{{ $t('social.theme.label') }}</div>
            <div class="social-posts-panel__options">
              <button
                :class="['option-btn', { 'option-btn--active': selectedTheme === 'dark' }]"
                type="button"
                @click="selectedTheme = 'dark'"
              >{{ $t('social.theme.dark') }}</button>
              <button
                :class="['option-btn', { 'option-btn--active': selectedTheme === 'light' }]"
                type="button"
                @click="selectedTheme = 'light'"
              >{{ $t('social.theme.light') }}</button>
            </div>
          </div>

          <!-- Template cards -->
          <div v-if="templatesLoading" class="social-posts-panel__empty">
            <q-spinner size="28px" color="primary" />
          </div>

          <div v-else-if="availableTemplates.length === 0" class="social-posts-panel__empty">
            {{ $t('social.templateGallery.noTemplates') }}
          </div>

          <div
            v-for="tpl in availableTemplates"
            :key="tpl.templateKey"
            class="template-card"
          >
            <div class="template-card__header">
              <span class="template-card__name">{{ tpl.displayName }}</span>
              <q-badge
                v-if="tpl.renderStatus === 'ready'"
                color="positive"
                class="template-card__badge"
              >{{ $t('social.templateGallery.statusReady') }}</q-badge>
              <q-badge
                v-else-if="tpl.renderStatus === 'rendering' || tpl.renderStatus === 'pending'"
                color="warning"
                class="template-card__badge"
              >{{ $t('social.templateGallery.statusRendering') }}</q-badge>
              <q-badge
                v-else-if="tpl.renderStatus === 'failed'"
                color="negative"
                class="template-card__badge"
              >{{ $t('social.templateGallery.statusFailed') }}</q-badge>
              <q-badge
                v-else-if="tpl.eligible && !tpl.renderStatus"
                color="grey-5"
                class="template-card__badge"
              >{{ $t('social.templateGallery.statusNever') }}</q-badge>
            </div>

            <div class="template-card__desc">{{ tpl.description }}</div>

            <!-- Slide thumbnails when ready -->
            <div v-if="tpl.slides && tpl.slides.length" class="post-card__slides-strip">
              <img
                v-for="(s, i) in tpl.slides.slice(0, 4)"
                :key="i"
                :src="apiBase + s.imageUrl"
                class="post-card__slide-thumb"
                alt=""
              />
              <div v-if="tpl.slides.length > 4" class="post-card__slide-more">
                +{{ tpl.slides.length - 4 }}
              </div>
            </div>

            <!-- Actions -->
            <div class="template-card__actions">
              <button
                v-if="tpl.slides && tpl.slides.length"
                class="action-link"
                type="button"
                @click="onPreviewTemplate(tpl)"
              >{{ $t('social.templateGallery.preview') }}</button>

              <button
                v-if="tpl.renderId && tpl.renderStatus === 'ready'"
                class="action-link"
                type="button"
                @click="onDownloadRender(tpl.renderId)"
              >{{ $t('social.download') }}</button>

              <button
                v-if="tpl.eligible"
                :class="['generate-btn', 'generate-btn--sm', { 'generate-btn--loading': generatingKey === tpl.templateKey }]"
                :disabled="generatingKey === tpl.templateKey"
                type="button"
                @click="onGenerateTemplate(tpl.templateKey)"
              >
                <q-spinner v-if="generatingKey === tpl.templateKey" size="12px" color="white" class="q-mr-xs" />
                {{ tpl.renderStatus
                  ? $t('social.regenerateTemplate')
                  : $t('social.generateTemplate') }}
                <span v-if="tpl.estimatedCostUsd" class="generate-btn__hint">
                  {{ $t('social.templateGallery.costHint', { cost: tpl.estimatedCostUsd.toFixed(3) }) }}
                </span>
              </button>

              <span v-else class="template-card__ineligible">
                {{ $t('social.templateGallery.notEligible') }}
                <q-tooltip v-if="tpl.ineligibleReason">{{ tpl.ineligibleReason }}</q-tooltip>
              </span>
            </div>
          </div>
        </div>
      </q-tab-panel>

      <!-- Suggestions panel -->
      <q-tab-panel name="suggestions" class="q-pa-none">
        <TemplateSuggestionsPanel
          :article-id="articleId"
          @suggestions-loaded="onSuggestionsLoaded"
        />
      </q-tab-panel>

      <!-- History panel -->
      <q-tab-panel name="history" class="q-pa-none">
        <div class="social-posts-panel__section">
          <div class="social-posts-panel__title">{{ $t('social.history') }}</div>

          <div v-if="rendersLoading" class="social-posts-panel__empty">
            <q-spinner size="28px" color="primary" />
          </div>

          <div v-else-if="renderHistory.length === 0" class="social-posts-panel__empty">
            {{ $t('social.historyEmpty') }}
          </div>

          <div v-for="r in renderHistory" :key="r.id" class="post-card" :class="{ 'post-card--superseded': r.status === 'superseded' }">
            <!-- Header row: template name + status badge -->
            <div class="post-card__meta">
              <span class="post-card__template-name">{{ r.displayName }}</span>
              <q-badge
                v-if="r.status === 'ready'"
                color="positive"
              >{{ $t('social.renderCard.statusReady') }}</q-badge>
              <q-badge
                v-else-if="r.status === 'rendering' || r.status === 'pending'"
                color="warning"
              >{{ $t('social.renderCard.statusRendering') }}</q-badge>
              <q-badge
                v-else-if="r.status === 'failed'"
                color="negative"
              >{{ $t('social.renderCard.statusFailed') }}</q-badge>
              <q-badge
                v-else-if="r.status === 'superseded'"
                color="grey-6"
              >{{ $t('social.renderCard.statusSuperseded') }}</q-badge>
            </div>

            <!-- Meta row: locale, theme, timestamp, cost, duration -->
            <div class="post-card__submeta">
              <span>{{ r.locale.toUpperCase() }}</span>
              <span>{{ r.theme === 'dark' ? $t('social.darkTheme') : $t('social.lightTheme') }}</span>
              <span>{{ formatTime(r.createdAt) }}</span>
              <span v-if="r.durationMs">{{ $t('social.renderCard.duration', { s: (r.durationMs / 1000).toFixed(1) }) }}</span>
              <span v-if="r.costUsd">{{ $t('social.renderCard.costUsd', { cost: Number(r.costUsd).toFixed(4) }) }}</span>
            </div>

            <!-- Error message -->
            <div v-if="r.status === 'failed' && r.error" class="post-card__error">
              {{ $t('social.renderCard.error') }}: {{ r.error }}
            </div>

            <!-- Slide thumbnails -->
            <div v-if="r.slides && r.slides.length" class="post-card__slides-strip">
              <img
                v-for="(s, i) in r.slides.slice(0, 5)"
                :key="i"
                :src="apiBase + s.imageUrl"
                class="post-card__slide-thumb"
                alt=""
              />
              <div v-if="r.slides.length > 5" class="post-card__slide-more">
                +{{ r.slides.length - 5 }}
              </div>
            </div>

            <div class="post-card__actions">
              <button
                v-if="r.slides && r.slides.length"
                class="action-link"
                type="button"
                @click="onPreviewRender(r)"
              >{{ $t('social.preview') }}</button>
              <button
                v-if="r.status === 'ready'"
                class="action-link"
                type="button"
                @click="onDownloadRender(r.id)"
              >{{ $t('social.download') }}</button>
            </div>
          </div>
        </div>
      </q-tab-panel>
    </q-tab-panels>

    <!-- Re-render confirm dialog -->
    <q-dialog v-model="showReRenderConfirm">
      <q-card>
        <q-card-section>
          <div class="text-subtitle1">{{ $t('brand.reRender.confirmTitle') }}</div>
          <div class="text-body2 q-mt-sm text-grey-7">{{ $t('brand.reRender.confirmText') }}</div>
          <div class="text-caption q-mt-xs">{{ $t('brand.reRender.estimatedCost', { cost: '~$0.01' }) }}</div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat :label="$t('common.cancel')" v-close-popup />
          <q-btn color="primary" :label="$t('brand.reRender.single')" @click="doReRender" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Carousel preview modal -->
    <q-dialog v-model="previewOpen" maximized>
      <div class="ig-overlay" @click.self="previewOpen = false" @keydown.left="prevSlide" @keydown.right="nextSlide" tabindex="0">

        <!-- Close -->
        <button class="ig-close" @click="previewOpen = false" :aria-label="$t('social.closePreview')">✕</button>

        <!-- Left arrow -->
        <button
          v-if="previewSlideUrls.length > 1 && previewSlideIndex > 0"
          class="ig-arrow ig-arrow--left"
          @click="prevSlide"
          :aria-label="$t('social.prevSlide')"
        >‹</button>

        <!-- Center: phone frame + slide -->
        <div class="ig-frame">
          <!-- Instagram-style header -->
          <div class="ig-frame__header">
            <div class="ig-frame__avatar">{{ $t('social.igAvatarInitials') }}</div>
            <div class="ig-frame__meta">
              <span class="ig-frame__handle">{{ $t('social.igHandle') }}</span>
              <span class="ig-frame__sub">{{ $t('social.sponsored') }}</span>
            </div>
            <span class="ig-frame__dots">•••</span>
          </div>

          <!-- Slide image -->
          <div class="ig-frame__img-wrap">
            <img
              v-if="previewSlideUrls[previewSlideIndex]"
              :src="previewSlideUrls[previewSlideIndex]"
              class="ig-frame__img"
              alt=""
            />
            <!-- Dot indicators -->
            <div v-if="previewSlideUrls.length > 1" class="ig-dots">
              <span
                v-for="(_, i) in previewSlideUrls"
                :key="i"
                :class="['ig-dot', { 'ig-dot--active': i === previewSlideIndex }]"
              />
            </div>
          </div>

          <!-- Instagram-style actions -->
          <div class="ig-frame__actions">
            <span class="ig-frame__action-icon">♡</span>
            <span class="ig-frame__action-icon">💬</span>
            <span class="ig-frame__action-icon">↗</span>
            <span class="ig-frame__action-icon ig-frame__action-icon--right">🔖</span>
          </div>

          <!-- Caption -->
          <div class="ig-frame__caption">
            <span class="ig-frame__caption-handle">{{ $t('social.igHandle') }} </span>{{ previewCaption }}
          </div>
          <div class="ig-frame__hashtags">{{ previewHashtags }}</div>
        </div>

        <!-- Right arrow -->
        <button
          v-if="previewSlideUrls.length > 1 && previewSlideIndex < previewSlideUrls.length - 1"
          class="ig-arrow ig-arrow--right"
          @click="nextSlide"
          :aria-label="$t('social.nextSlide')"
        >›</button>
      </div>
    </q-dialog>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import { api } from "../../lib/api-client";
import TemplateSuggestionsPanel from "./TemplateSuggestionsPanel.vue";

interface SocialPost {
  id: string;
  articleId: string | null;
  platform: string;
  format: string;
  theme: string;
  status: string;
  totalSlides: number | null;
  content: {
    kind: string;
    slides?: Array<{ imageUrl: string }>;
    caption?: string;
    hashtags?: string[];
  };
  generatedAt: string | null;
  createdAt: string;
}

interface TemplateInfo {
  templateKey: string;
  displayName: string;
  description: string;
  estimatedCostUsd: number | null;
  eligible: boolean;
  ineligibleReason?: string;
  renderStatus: string | null;
  renderId: string | null;
  slides: Array<{ imageUrl: string }> | null;
  completedAt: string | null;
}

interface RenderHistoryItem {
  id: string;
  templateKey: string | null;
  displayName: string;
  locale: string;
  theme: string;
  status: string;
  slides: Array<{ imageUrl: string }> | null;
  costUsd: string | null;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export default defineComponent({
  name: "SocialPostsPanel",

  components: { TemplateSuggestionsPanel },

  props: {
    articleId: {
      type: String as PropType<string>,
      required: true,
    },
  },

  data: () => ({
    activeTab: "generate" as "generate" | "suggestions" | "history",
    pendingSuggestionsCount: 0,
    totalSuggestionsCount: 0,
    selectedTheme: "dark" as "dark" | "light",
    generating: false,
    generatingKey: null as string | null,
    templatesLoading: false,
    availableTemplates: [] as TemplateInfo[],
    templatePollingTimer: null as ReturnType<typeof setInterval> | null,
    posts: [] as SocialPost[],
    renderHistory: [] as RenderHistoryItem[],
    rendersLoading: false,
    previewOpen: false,
    previewPost: null as SocialPost | null,
    previewSlideUrls_: [] as string[],
    previewCaption_: "" as string,
    previewHashtags_: "" as string,
    previewSlideIndex: 0,
    pollingTimer: null as ReturnType<typeof setInterval> | null,
    showReRenderConfirm: false,
    pendingReRenderPost: null as SocialPost | null,
    reRenderingId: null as string | null,
  }),

  computed: {
    apiBase(): string {
      return (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000/api").replace(/\/api$/, "");
    },
    previewSlideUrls(): string[] {
      if (this.previewSlideUrls_.length) return this.previewSlideUrls_;
      return this.previewPost ? this.postSlideUrls(this.previewPost) : [];
    },
    previewCaption(): string {
      return this.previewCaption_ || (this.previewPost?.content?.caption ?? "");
    },
    previewHashtags(): string {
      return this.previewHashtags_ || (this.previewPost?.content?.hashtags ?? []).join(" ");
    },
  },

  mounted() {
    this.loadPosts();
    this.loadTemplates();
    this.loadSuggestionsCount();
    this.loadRenderHistory();
  },

  beforeUnmount() {
    this.stopPolling();
    this.stopTemplatePolling();
  },

  methods: {
    async loadSuggestionsCount() {
      try {
        const res = await api.get<{
          ok: boolean;
          data: { suggestions: Array<{ templateKey: string; confidence: number }>; renders: Record<string, string> };
        }>(`/articles/${this.articleId}/template-suggestions`);
        if (res.data.ok) {
          const { suggestions, renders } = res.data.data;
          this.totalSuggestionsCount = suggestions.length;
          this.pendingSuggestionsCount = suggestions.filter((s) => renders[s.templateKey] !== "ready").length;
        }
      } catch {
        // silently ignore
      }
    },

    onSuggestionsLoaded(payload: { total: number; pending: number }) {
      this.totalSuggestionsCount = payload.total;
      this.pendingSuggestionsCount = payload.pending;
    },

    async loadTemplates() {
      this.templatesLoading = true;
      try {
        const res = await api.get<{ ok: boolean; data: { templates: TemplateInfo[] } }>(
          `/articles/${this.articleId}/all-templates`
        );
        if (res.data.ok) this.availableTemplates = res.data.data.templates;
      } catch {
        // silently ignore
      } finally {
        this.templatesLoading = false;
      }
    },

    async onGenerateTemplate(templateKey: string) {
      this.generatingKey = templateKey;
      try {
        await api.post(`/articles/${this.articleId}/generate-templates`, {
          templateKeys: [templateKey],
          locale: "de",
          theme: this.selectedTheme,
        });
        this.startTemplatePolling();
      } catch {
        this.generatingKey = null;
      }
    },

    async loadRenderHistory() {
      this.rendersLoading = true;
      try {
        const res = await api.get<{ ok: boolean; data: { renders: RenderHistoryItem[] } }>(
          `/articles/${this.articleId}/template-renders`
        );
        if (res.data.ok) this.renderHistory = res.data.data.renders;
      } catch {
        // silently ignore
      } finally {
        this.rendersLoading = false;
      }
    },

    onPreviewRender(r: RenderHistoryItem) {
      this.previewPost = null;
      this.previewSlideUrls_ = (r.slides ?? []).map((s) => this.apiBase + s.imageUrl);
      this.previewCaption_ = "";
      this.previewHashtags_ = "";
      this.previewSlideIndex = 0;
      this.previewOpen = true;
    },

    startTemplatePolling() {
      this.templatePollingTimer = setInterval(async () => {
        await this.loadTemplates();
        await this.loadRenderHistory();
        const isStillRendering = this.availableTemplates.some(
          (t) => t.renderStatus === "rendering" || t.renderStatus === "pending"
        );
        if (!isStillRendering) {
          this.stopTemplatePolling();
          this.generatingKey = null;
        }
      }, 2000);
    },

    stopTemplatePolling() {
      if (this.templatePollingTimer) {
        clearInterval(this.templatePollingTimer);
        this.templatePollingTimer = null;
      }
    },

    onPreviewTemplate(tpl: TemplateInfo) {
      this.previewPost = null;
      this.previewSlideUrls_ = (tpl.slides ?? []).map((s) => this.apiBase + s.imageUrl);
      this.previewCaption_ = "";
      this.previewHashtags_ = "";
      this.previewSlideIndex = 0;
      this.previewOpen = true;
    },

    onDownloadRender(renderId: string) {
      // Direct navigation — browser sends SameSite=Lax session cookie automatically
      // and handles Content-Disposition: attachment natively without fetch+blob.
      const base = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000/api";
      const a = document.createElement("a");
      a.href = `${base}/template-renders/${renderId}/download`;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    },

    postSlideUrls(post: SocialPost): string[] {
      return (post.content?.slides ?? []).map((s) => s.imageUrl);
    },

    formatTime(iso: string): string {
      const d = new Date(iso);
      return d.toLocaleString(this.$i18n.locale === "de" ? "de-DE" : "en-US", {
        dateStyle: "short",
        timeStyle: "short",
      });
    },

    async loadPosts() {
      try {
        const res = await api.get<{ ok: boolean; data: SocialPost[] }>(
          `/articles/${this.articleId}/social-posts`
        );
        if (res.data.ok) this.posts = res.data.data;
      } catch {
        // silently ignore load failures
      }
    },

    startPolling() {
      this.pollingTimer = setInterval(async () => {
        await this.loadPosts();
        // Stop polling when a new post appears in generated/draft status
        const latest = this.posts[0];
        if (latest && (latest.status === "draft" || latest.status === "approved")) {
          this.stopPolling();
          this.generating = false;
        }
      }, 2000);
    },

    stopPolling() {
      if (this.pollingTimer) {
        clearInterval(this.pollingTimer);
        this.pollingTimer = null;
      }
    },

    onPreview(post: SocialPost) {
      this.previewPost = post;
      this.previewSlideUrls_ = [];
      this.previewCaption_ = "";
      this.previewHashtags_ = "";
      this.previewSlideIndex = 0;
      this.previewOpen = true;
    },

    prevSlide() {
      if (this.previewSlideIndex > 0) this.previewSlideIndex--;
    },

    nextSlide() {
      if (this.previewSlideIndex < this.previewSlideUrls.length - 1) this.previewSlideIndex++;
    },

    onReRender(post: SocialPost) {
      this.pendingReRenderPost = post;
      this.showReRenderConfirm = true;
    },

    async doReRender() {
      if (!this.pendingReRenderPost) return;
      const post = this.pendingReRenderPost;
      this.showReRenderConfirm = false;
      this.reRenderingId = post.id;
      try {
        await api.post(`/social-posts/${post.id}/re-render`);
        this.startPolling();
      } catch {
        // error surfaces via interceptor
      } finally {
        this.reRenderingId = null;
      }
    },

    async onDownload(post: SocialPost) {
      const base = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000/api";
      const resp = await fetch(`${base}/social-posts/${post.id}/download-bundle`, { credentials: "include" });
      if (!resp.ok) return;
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `carousel-${post.id}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    },
  },
});
</script>

<style scoped>
.social-posts-panel {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.social-posts-panel__tabs {
  border-bottom: 1px solid var(--q-separator-color);
  margin-bottom: 16px;
}

.social-posts-panel__panels {
  background: transparent;
}

.social-posts-panel__panels :deep(.q-tab-panel) {
  padding: 0;
}

.social-posts-panel__section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.social-posts-panel__title {
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--q-secondary);
}

.social-posts-panel__label {
  font-size: 12px;
  color: var(--q-secondary);
  margin-bottom: 4px;
}

.social-posts-panel__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.social-posts-panel__options {
  display: flex;
  gap: 8px;
}

.social-posts-panel__variant-hint {
  font-size: 11px;
  color: var(--q-secondary);
  font-style: italic;
  margin-top: 2px;
}

.option-btn {
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid var(--q-separator-color);
  background: transparent;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.1s, border-color 0.1s;
}

.option-btn--active {
  background: var(--q-primary);
  border-color: var(--q-primary);
  color: #fff;
}

.option-btn--disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.option-btn--stunning {
  font-weight: 600;
}

.option-btn--legacy {
  font-size: 12px;
  opacity: 0.75;
}

.generate-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 18px;
  background: var(--q-primary);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
  align-self: flex-start;
}

.generate-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.generate-btn__hint {
  font-size: 11px;
  font-weight: 400;
  opacity: 0.75;
  margin-left: 4px;
}

.social-posts-panel__empty {
  font-size: 13px;
  color: var(--q-secondary);
  font-style: italic;
}

.template-card {
  border: 1px solid var(--q-separator-color);
  border-radius: 10px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.template-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.template-card__name {
  font-size: 13px;
  font-weight: 600;
  flex: 1;
}

.template-card__badge {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.template-card__desc {
  font-size: 12px;
  color: var(--q-secondary);
  line-height: 1.4;
}

.template-card__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 2px;
}

.template-card__ineligible {
  font-size: 12px;
  color: var(--q-secondary);
  font-style: italic;
  cursor: default;
}

.generate-btn--sm {
  padding: 7px 14px;
  font-size: 13px;
}

.post-card {
  border: 1px solid var(--q-separator-color);
  border-radius: 10px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.post-card--superseded {
  opacity: 0.55;
}

.post-card__meta {
  display: flex;
  align-items: center;
  gap: 10px;
}

.post-card__template-name {
  font-size: 13px;
  font-weight: 600;
  flex: 1;
}

.post-card__submeta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11px;
  color: var(--q-secondary);
}

.post-card__submeta span::before {
  content: "·";
  margin-right: 8px;
}

.post-card__submeta span:first-child::before {
  content: none;
}

.post-card__error {
  font-size: 11px;
  color: var(--q-negative);
  background: color-mix(in srgb, var(--q-negative) 8%, transparent);
  border-radius: 6px;
  padding: 6px 10px;
  word-break: break-word;
}

.post-card__slides,
.post-card__time {
  font-size: 12px;
  color: var(--q-secondary);
}

.post-card__slides-strip {
  display: flex;
  gap: 6px;
  overflow: hidden;
}

.post-card__slide-thumb {
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--q-separator-color);
}

.post-card__slide-more {
  width: 56px;
  height: 56px;
  border-radius: 6px;
  background: var(--q-separator-color);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--q-secondary);
}

.post-card__actions {
  display: flex;
  gap: 12px;
}

.action-link {
  background: none;
  border: none;
  color: var(--q-primary);
  font-size: 13px;
  cursor: pointer;
  padding: 0;
}

.action-link--rerender {
  color: var(--q-warning);
}

.action-link:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ig-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.88);
  display: flex;
  align-items: center;
  justify-content: center;
  outline: none;
}

.ig-close {
  position: fixed;
  top: 16px;
  right: 20px;
  background: none;
  border: none;
  color: #fff;
  font-size: 24px;
  cursor: pointer;
  z-index: 10;
  line-height: 1;
  opacity: 0.8;
}
.ig-close:hover { opacity: 1; }

.ig-arrow {
  position: fixed;
  top: 50%;
  transform: translateY(-50%);
  background: rgba(255,255,255,0.12);
  border: none;
  color: #fff;
  font-size: 36px;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  transition: background 0.15s;
  z-index: 10;
}
.ig-arrow--left  { left:  calc(50% - 240px); }
.ig-arrow--right { right: calc(50% - 240px); }
.ig-arrow:hover { background: rgba(255,255,255,0.22); }

/* Phone frame */
.ig-frame {
  width: 400px;
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: 90vh;
  overflow-y: auto;
}

.ig-frame__header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid #efefef;
}

.ig-frame__avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: linear-gradient(135deg, #405de6, #5851db, #833ab4, #c13584, #e1306c, #fd1d1d, #f56040, #f77737, #fcaf45, #ffdc80);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;
}

.ig-frame__meta {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.ig-frame__handle {
  font-size: 13px;
  font-weight: 600;
  color: #000;
  line-height: 1.2;
}

.ig-frame__sub {
  font-size: 11px;
  color: #8e8e8e;
  line-height: 1.2;
}

.ig-frame__dots {
  font-size: 18px;
  color: #000;
  letter-spacing: 1px;
}

.ig-frame__img-wrap {
  position: relative;
  width: 100%;
  background: #000;
}

.ig-frame__img {
  width: 100%;
  height: auto;
  display: block;
}

.ig-dots {
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 5px;
}

.ig-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(255,255,255,0.5);
  transition: background 0.2s, transform 0.2s;
}

.ig-dot--active {
  background: #fff;
  transform: scale(1.2);
}

.ig-frame__actions {
  display: flex;
  align-items: center;
  padding: 8px 14px;
  gap: 14px;
}

.ig-frame__action-icon {
  font-size: 22px;
  cursor: default;
  line-height: 1;
}

.ig-frame__action-icon--right {
  margin-left: auto;
}

.ig-frame__caption {
  padding: 0 14px 4px;
  font-size: 13px;
  color: #000;
  line-height: 1.5;
  white-space: pre-wrap;
}

.ig-frame__caption-handle {
  font-weight: 600;
}

.ig-frame__hashtags {
  padding: 2px 14px 14px;
  font-size: 12px;
  color: #00376b;
  word-break: break-word;
  line-height: 1.6;
}
</style>
