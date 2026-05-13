<template>
  <div class="social-posts-panel">
    <!-- Generate form -->
    <div class="social-posts-panel__section">
      <div class="social-posts-panel__title">{{ $t('social.title') }}</div>

      <div class="social-posts-panel__field">
        <div class="social-posts-panel__label">{{ $t('social.format.label') }}</div>
        <div class="social-posts-panel__options">
          <button
            :class="['option-btn', { 'option-btn--active': selectedFormat === 'list_carousel' }]"
            type="button"
            @click="selectedFormat = 'list_carousel'"
          >
            {{ $t('social.format.listCarousel') }}
          </button>
          <button
            class="option-btn option-btn--disabled"
            type="button"
            disabled
          >
            {{ $t('social.format.comparison') }}
          </button>
        </div>
      </div>

      <div class="social-posts-panel__field">
        <div class="social-posts-panel__label">{{ $t('social.theme.label') }}</div>
        <div class="social-posts-panel__options">
          <button
            :class="['option-btn', { 'option-btn--active': selectedTheme === 'dark' }]"
            type="button"
            @click="selectedTheme = 'dark'"
          >
            {{ $t('social.theme.dark') }}
          </button>
          <button
            :class="['option-btn', { 'option-btn--active': selectedTheme === 'light' }]"
            type="button"
            @click="selectedTheme = 'light'"
          >
            {{ $t('social.theme.light') }}
          </button>
        </div>
      </div>

      <button
        :class="['generate-btn', { 'generate-btn--loading': generating }]"
        :disabled="generating"
        type="button"
        @click="onGenerate"
      >
        <q-spinner v-if="generating" size="14px" color="white" class="q-mr-xs" />
        {{ generating ? $t('social.generating') : $t('social.generate') }}
        <span class="generate-btn__hint">{{ $t('social.cost') }}</span>
      </button>
    </div>

    <!-- History -->
    <div class="social-posts-panel__section">
      <div class="social-posts-panel__title">{{ $t('social.history') }}</div>

      <div v-if="posts.length === 0" class="social-posts-panel__empty">
        {{ $t('social.noPostsYet') }}
      </div>

      <div v-for="post in posts" :key="post.id" class="post-card">
        <div class="post-card__meta">
          <q-badge
            :color="post.theme === 'dark' ? 'grey-8' : 'amber-2'"
            :text-color="post.theme === 'dark' ? 'white' : 'dark'"
            :label="post.theme === 'dark' ? $t('social.darkTheme') : $t('social.lightTheme')"
          />
          <span class="post-card__slides">
            {{ $t('social.slides', { n: post.totalSlides ?? '?' }) }}
          </span>
          <span class="post-card__time">{{ formatTime(post.generatedAt ?? post.createdAt) }}</span>
        </div>

        <!-- Slide preview strip -->
        <div v-if="postSlideUrls(post).length" class="post-card__slides-strip">
          <img
            v-for="(url, i) in postSlideUrls(post).slice(0, 4)"
            :key="i"
            :src="url"
            class="post-card__slide-thumb"
            alt=""
          />
          <div v-if="postSlideUrls(post).length > 4" class="post-card__slide-more">
            +{{ postSlideUrls(post).length - 4 }}
          </div>
        </div>

        <div class="post-card__actions">
          <button class="action-link" type="button" @click="onPreview(post)">
            {{ $t('social.preview') }}
          </button>
          <button class="action-link" type="button" @click="onDownload(post)">
            {{ $t('social.download') }}
          </button>
          <button
            class="action-link action-link--rerender"
            type="button"
            :disabled="reRenderingId === post.id"
            @click="onReRender(post)"
          >
            {{ reRenderingId === post.id ? '…' : $t('brand.reRender.single') }}
          </button>
        </div>
      </div>
    </div>

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

export default defineComponent({
  name: "SocialPostsPanel",

  props: {
    articleId: {
      type: String as PropType<string>,
      required: true,
    },
  },

  data: () => ({
    selectedFormat: "list_carousel" as "list_carousel",
    selectedTheme: "dark" as "dark" | "light",
    generating: false,
    posts: [] as SocialPost[],
    previewOpen: false,
    previewPost: null as SocialPost | null,
    previewSlideIndex: 0,
    pollingTimer: null as ReturnType<typeof setInterval> | null,
    showReRenderConfirm: false,
    pendingReRenderPost: null as SocialPost | null,
    reRenderingId: null as string | null,
  }),

  computed: {
    previewSlideUrls(): string[] {
      return this.previewPost ? this.postSlideUrls(this.previewPost) : [];
    },
    previewCaption(): string {
      return this.previewPost?.content?.caption ?? "";
    },
    previewHashtags(): string {
      return (this.previewPost?.content?.hashtags ?? []).join(" ");
    },
  },

  mounted() {
    this.loadPosts();
  },

  beforeUnmount() {
    this.stopPolling();
  },

  methods: {
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

    async onGenerate() {
      this.generating = true;
      try {
        await api.post(`/articles/${this.articleId}/social-posts/generate`, {
          format: this.selectedFormat,
          theme: this.selectedTheme,
        });
        this.startPolling();
      } catch {
        this.generating = false;
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
        await api.post(`/api/social-posts/${post.id}/re-render`);
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
  gap: 24px;
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

.post-card {
  border: 1px solid var(--q-separator-color);
  border-radius: 10px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.post-card__meta {
  display: flex;
  align-items: center;
  gap: 10px;
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
  aspect-ratio: 1;
  background: #000;
}

.ig-frame__img {
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
