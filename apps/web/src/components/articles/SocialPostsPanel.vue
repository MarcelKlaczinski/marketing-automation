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
            {{ $t('social.slides', { n: post.total_slides ?? '?' }) }}
          </span>
          <span class="post-card__time">{{ formatTime(post.generated_at ?? post.created_at) }}</span>
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
        </div>
      </div>
    </div>

    <!-- Preview modal -->
    <q-dialog v-model="previewOpen" maximized>
      <q-card class="preview-modal">
        <q-card-section class="preview-modal__header">
          <q-btn flat round icon="close" @click="previewOpen = false" />
        </q-card-section>
        <q-card-section class="preview-modal__slides">
          <img
            v-for="(url, i) in previewSlideUrls"
            :key="i"
            :src="url"
            class="preview-modal__slide"
            alt=""
          />
        </q-card-section>
        <q-card-section v-if="previewPost" class="preview-modal__caption">
          <pre class="caption-text">{{ previewCaption }}</pre>
          <div class="hashtags-text">{{ previewHashtags }}</div>
        </q-card-section>
      </q-card>
    </q-dialog>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import { api } from "../../lib/api-client";

interface SocialPost {
  id: string;
  article_id: string | null;
  platform: string;
  format: string;
  theme: string;
  status: string;
  total_slides: number | null;
  content: {
    kind: string;
    slides?: Array<{ imageUrl: string }>;
    caption?: string;
    hashtags?: string[];
  };
  generated_at: string | null;
  created_at: string;
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
    pollingTimer: null as ReturnType<typeof setInterval> | null,
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
      this.previewOpen = true;
    },

    async onDownload(post: SocialPost) {
      const url = `/api/social-posts/${post.id}/download-bundle`;
      const a = document.createElement("a");
      a.href = url;
      a.download = `carousel-${post.id}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
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

.preview-modal {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.preview-modal__header {
  display: flex;
  justify-content: flex-end;
  padding: 8px;
}

.preview-modal__slides {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  overflow-y: auto;
  padding: 16px;
}

.preview-modal__slide {
  width: calc(50% - 6px);
  max-width: 360px;
  border-radius: 8px;
}

.preview-modal__caption {
  padding: 16px;
  border-top: 1px solid var(--q-separator-color);
}

.caption-text {
  font-size: 13px;
  white-space: pre-wrap;
  margin: 0 0 8px;
}

.hashtags-text {
  font-size: 12px;
  color: var(--q-primary);
  word-break: break-word;
}
</style>
