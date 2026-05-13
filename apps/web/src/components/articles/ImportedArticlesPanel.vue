<template>
  <div class="imported-articles-panel">
    <div class="row items-center justify-between q-mb-md">
      <div>
        <q-btn-toggle
          v-model="activeCollection"
          :options="collectionOptions"
          no-caps
          rounded
          unelevated
          toggle-color="primary"
          class="q-mr-sm"
        />
      </div>
      <div>
        <q-btn
          color="primary"
          icon="cloud_download"
          :label="$t('articles.imported.syncFromRepo')"
          :loading="syncing"
          @click="triggerImport"
        />
      </div>
    </div>

    <div v-if="loading" class="q-pa-md text-center">
      <q-spinner-dots size="2em" />
    </div>

    <div v-else-if="collectionOptions.length === 0" class="q-pa-md text-grey-6 text-center">
      {{ $t('articles.imported.noData') }}
    </div>

    <ImportedArticlesTable
      v-else
      :collection="activeCollection"
      :pairs="pairs"
      @row-click="openDetail"
    />

    <ImportedArticleDetailDialog
      v-model="detailOpen"
      :article-id="detailArticleId"
    />

    <DiscoveryGateModal
      v-if="discoveryGateOpen && discoveryImportRunId"
      v-model="discoveryGateOpen"
      :project-slug="slug"
      :import-run-id="discoveryImportRunId"
      :stats="discoveryStats"
      @triggered="onDiscoveryTriggered"
      @skipped="discoveryGateOpen = false"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { Notify } from "quasar";
import { api } from "src/lib/api-client";
import ImportedArticlesTable from "./ImportedArticlesTable.vue";
import ImportedArticleDetailDialog from "./ImportedArticleDetailDialog.vue";
import DiscoveryGateModal from "./DiscoveryGateModal.vue";

type ImportedArticleRow = {
  id: string;
  collection: string;
  locale: string;
  slug: string;
  title: string | null;
  metaDescription: string | null;
  translationKey: string | null;
  author: string | null;
  category: string | null;
  subcategory: string | null;
  tags: string[] | null;
  publishedAt: string | null;
  frontmatterUpdatedAt: string | null;
  filePath: string | null;
  frontmatterExtras: Record<string, unknown>;
  importMetadata: Record<string, unknown>;
  lastImportedAt: string | null;
  // Spec 49a: typed cluster metadata
  clusterKey: string | null;
  clusterRole: string | null;
};

type Pair = {
  translationKey: string | null;
  de: ImportedArticleRow | null;
  en: ImportedArticleRow | null;
};

type CollectionSummary = Record<string, { de: number; en: number; total: number }>;

type ImportRun = {
  id: string;
  status: string;
  articlesInserted: number | null;
  articlesUpdated: number | null;
  articlesUnchanged: number | null;
};

export default defineComponent({
  name: "ImportedArticlesPanel",
  components: { ImportedArticlesTable, ImportedArticleDetailDialog, DiscoveryGateModal },

  props: {
    slug: { type: String, required: true },
  },

  data: () => ({
    loading: false,
    syncing: false,
    activeCollection: "blog" as string,
    pairs: [] as Pair[],
    collectionSummary: {} as CollectionSummary,
    total: 0,
    limit: 50,
    offset: 0,
    detailOpen: false,
    detailArticleId: null as string | null,
    discoveryGateOpen: false,
    discoveryImportRunId: null as string | null,
    discoveryStats: { inserted: 0, updated: 0, unchanged: 0 },
    _pollTimer: null as ReturnType<typeof setTimeout> | null,
  }),

  computed: {
    collectionOptions(): Array<{ label: string; value: string }> {
      const order = [
        "blog", "ki-wissen", "comparisons", "usecases",
        "tools", "tool-categories", "authors", "special-landings",
      ];
      const present = order.filter((coll) => !!this.collectionSummary[coll]);
      const rest = Object.keys(this.collectionSummary).filter((c) => !order.includes(c));
      return [...present, ...rest].map((coll) => {
        const summary = this.collectionSummary[coll]!;
        const key = `articles.imported.collections.${coll}`;
        const label = this.$te(key) ? (this.$t(key) as string) : coll;
        return { value: coll, label: `${label} (${summary.total})` };
      });
    },
  },

  watch: {
    activeCollection(): void {
      void this.fetchPairs();
    },
  },

  async mounted(): Promise<void> {
    await this.fetchSummary();
    if (this.collectionOptions.length > 0) {
      this.activeCollection = this.collectionOptions[0]!.value;
      await this.fetchPairs();
    }
  },

  unmounted(): void {
    if (this._pollTimer !== null) clearTimeout(this._pollTimer);
  },

  methods: {
    async fetchSummary(): Promise<void> {
      try {
        const res = await api.get<{ ok: boolean; data: CollectionSummary }>(
          "/articles/imported/collections",
          { params: { projectSlug: this.slug } }
        );
        this.collectionSummary = res.data.data;
      } catch {
        // error surfaced by api-client interceptor
      }
    },

    async fetchPairs(opts: { limit?: number; offset?: number } = {}): Promise<void> {
      this.loading = true;
      try {
        const limit = opts.limit ?? this.limit;
        const offset = opts.offset ?? 0;
        const res = await api.get<{
          ok: boolean;
          data: { items: Pair[]; total: number; limit: number; offset: number };
        }>(
          "/articles/imported",
          { params: { projectSlug: this.slug, collection: this.activeCollection, limit, offset } }
        );
        this.pairs = res.data.data.items;
        this.total = res.data.data.total;
        this.limit = res.data.data.limit;
        this.offset = res.data.data.offset;
      } finally {
        this.loading = false;
      }
    },

    async triggerImport(): Promise<void> {
      this.syncing = true;
      try {
        const res = await api.post<{ ok: boolean; data: { importRunId: string; jobId: string; deduped?: boolean } }>(
          `/projects/${this.slug}/astro-import`,
        );
        const importRunId = res.data.data.importRunId;
        Notify.create({
          type: "positive",
          message: this.$t("articles.imported.syncStarted") as string,
          timeout: 3000,
        });
        void this.pollImportRun(importRunId);
      } catch {
        this.syncing = false;
      }
    },

    async pollImportRun(importRunId: string): Promise<void> {
      const checkRun = async (): Promise<void> => {
        try {
          const res = await api.get<{ ok: boolean; data: { items: ImportRun[] } }>(
            `/projects/${this.slug}/astro-import-runs`,
            { params: { limit: 1 } },
          );
          const run = res.data.data.items.find((r) => r.id === importRunId);
          if (run && (run.status === "succeeded" || run.status === "failed")) {
            this.syncing = false;
            await this.fetchSummary();
            await this.fetchPairs();

            if (run.status === "succeeded") {
              Notify.create({
                type: "positive",
                message: this.$t("articles.imported.syncCompleted") as string,
                timeout: 3000,
              });
              const inserted = run.articlesInserted ?? 0;
              const updated = run.articlesUpdated ?? 0;
              if (inserted + updated > 0) {
                this.discoveryImportRunId = importRunId;
                this.discoveryStats = {
                  inserted,
                  updated,
                  unchanged: run.articlesUnchanged ?? 0,
                };
                this.discoveryGateOpen = true;
              }
            }
            return;
          }
          // Still running — poll again in 4s
          this._pollTimer = setTimeout(() => { void checkRun(); }, 4000);
        } catch {
          this.syncing = false;
        }
      };
      void checkRun();
    },

    onDiscoveryTriggered(): void {
      this.discoveryGateOpen = false;
    },

    openDetail(articleId: string): void {
      this.detailArticleId = articleId;
      this.detailOpen = true;
    },
  },
});
</script>
