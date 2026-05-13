<template>
  <q-page class="q-pa-md">
    <div class="row items-center q-mb-lg">
      <div class="text-h5">{{ $t('brand.reRender.title') }}</div>
    </div>

    <!-- Filters -->
    <q-card flat bordered class="q-mb-md">
      <q-card-section>
        <div class="row q-gutter-md">
          <q-select
            v-model="filterStatus"
            :options="statusOptions"
            :label="$t('brand.reRender.filterStatus')"
            emit-value
            map-options
            dense
            outlined
            style="min-width: 160px"
            clearable
          />
          <q-select
            v-model="filterHasEmoji"
            :options="emojiOptions"
            :label="$t('brand.reRender.filterHasEmoji')"
            emit-value
            map-options
            dense
            outlined
            style="min-width: 160px"
          />
        </div>
      </q-card-section>
    </q-card>

    <!-- Selection controls -->
    <div class="row items-center q-mb-sm">
      <q-btn flat dense :label="$t('brand.reRender.selectAll')" @click="selectAll" />
      <q-btn flat dense :label="$t('brand.reRender.selectNone')" @click="selected = []" />
      <q-space />
      <span class="text-caption text-grey-6">{{ selected.length }} {{ $t('common.selected', selected.length) }}</span>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex flex-center q-py-xl">
      <q-spinner size="40px" color="primary" />
    </div>

    <!-- Empty -->
    <div v-else-if="filteredPosts.length === 0" class="text-center text-grey q-py-xl">
      {{ $t('brand.reRender.noPosts') }}
    </div>

    <!-- Post list -->
    <q-list v-else bordered separator class="rounded-borders q-mb-lg">
      <q-item
        v-for="post in filteredPosts"
        :key="post.id"
        dense
      >
        <q-item-section side>
          <q-checkbox :model-value="selected.includes(post.id)" @update:model-value="(v) => togglePost(post.id, v)" />
        </q-item-section>
        <q-item-section>
          <q-item-label>{{ post.articleSlug ?? post.id.slice(0, 8) }}</q-item-label>
          <q-item-label caption>{{ post.format }} · {{ formatTime(post.createdAt) }}</q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-badge :color="statusColor(post.status)" :label="post.status" />
        </q-item-section>
      </q-item>
    </q-list>

    <!-- Batch re-render button -->
    <div class="row items-center q-gutter-sm">
      <q-btn
        color="warning"
        :label="batchLabel"
        :disable="selected.length === 0 || batching"
        :loading="batching"
        @click="showConfirm = true"
        unelevated
      />
    </div>

    <!-- Confirm dialog -->
    <q-dialog v-model="showConfirm">
      <q-card>
        <q-card-section>
          <div class="text-subtitle1">{{ $t('brand.reRender.confirmTitle') }}</div>
          <div class="text-body2 q-mt-sm text-grey-7">{{ $t('brand.reRender.confirmText') }}</div>
          <div class="text-caption q-mt-xs">{{ $t('brand.reRender.estimatedCost', { cost: estimatedCost }) }}</div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat :label="$t('common.cancel')" v-close-popup />
          <q-btn color="warning" :label="$t('brand.reRender.batch', { count: selected.length, cost: estimatedCost })" @click="doBatch" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { api } from "src/lib/api-client";

interface SocialPostSummary {
  id: string;
  articleSlug: string | null;
  format: string;
  status: string;
  createdAt: string;
  theme: string;
}

const STATUS_COLORS: Record<string, string> = {
  draft: "grey",
  in_review: "orange",
  approved: "green",
  scheduled: "blue",
  published: "positive",
  failed: "negative",
  replaced: "grey-4",
};

export default defineComponent({
  name: "SocialPostsAdminPage",

  props: {
    slug: {
      type: String,
      required: true,
    },
  },

  data: () => ({
    loading: false,
    batching: false,
    posts: [] as SocialPostSummary[],
    selected: [] as string[],
    filterStatus: null as string | null,
    filterHasEmoji: "all" as string,
    showConfirm: false,
  }),

  computed: {
    statusOptions() {
      return [
        { label: this.$t("common.all") as string, value: null },
        { label: "Draft", value: "draft" },
        { label: "Approved", value: "approved" },
        { label: "Published", value: "published" },
        { label: "Replaced", value: "replaced" },
      ];
    },

    emojiOptions() {
      return [
        { label: this.$t("brand.reRender.filterHasEmojiAll") as string, value: "all" },
        { label: this.$t("brand.reRender.filterHasEmojiYes") as string, value: "yes" },
        { label: this.$t("brand.reRender.filterHasEmojiNo") as string, value: "no" },
      ];
    },

    filteredPosts(): SocialPostSummary[] {
      let list = this.posts;
      if (this.filterStatus) {
        list = list.filter((p) => p.status === this.filterStatus);
      }
      return list;
    },

    estimatedCost(): string {
      return `~$${(this.selected.length * 0.01).toFixed(2)}`;
    },

    batchLabel(): string {
      if (this.selected.length === 0) return this.$t("brand.reRender.noSelection") as string;
      return this.$t("brand.reRender.batch", {
        count: this.selected.length,
        cost: this.estimatedCost,
      }) as string;
    },
  },

  mounted() {
    void this.loadPosts();
  },

  methods: {
    formatTime(iso: string): string {
      return new Date(iso).toLocaleString(
        this.$i18n.locale === "de" ? "de-DE" : "en-US",
        { dateStyle: "short", timeStyle: "short" }
      );
    },

    statusColor(status: string): string {
      return STATUS_COLORS[status] ?? "grey";
    },

    async loadPosts() {
      this.loading = true;
      try {
        // Use the project brand-assets endpoint to get social posts list
        // We get posts via existing articles/:id/social-posts or directly
        const res = await api.get<{ ok: boolean; data: { items: SocialPostSummary[] } }>(
          `/projects/${this.slug}/social-posts`
        );
        this.posts = res.data.data.items ?? [];
      } catch {
        this.posts = [];
      } finally {
        this.loading = false;
      }
    },

    selectAll() {
      this.selected = this.filteredPosts.map((p) => p.id);
    },

    togglePost(id: string, checked: boolean) {
      if (checked && !this.selected.includes(id)) {
        this.selected = [...this.selected, id];
      } else if (!checked) {
        this.selected = this.selected.filter((s) => s !== id);
      }
    },

    async doBatch() {
      this.showConfirm = false;
      this.batching = true;
      try {
        const res = await api.post<{ ok: boolean; data: { triggered: number } }>(
          `/projects/${this.slug}/social-posts/re-render-batch`,
          { socialPostIds: this.selected }
        );
        this.$q.notify({
          type: "positive",
          message: this.$t("brand.reRender.batchQueued", { count: res.data.data.triggered }) as string,
        });
        this.selected = [];
        await this.loadPosts();
      } finally {
        this.batching = false;
      }
    },
  },
});
</script>
