<template>
  <q-card flat bordered>
    <!-- Filters -->
    <q-card-section class="row items-center q-gutter-sm">
      <q-select
        v-model="filterSource"
        :options="sourceOptions"
        emit-value
        map-options
        dense
        outlined
        clearable
        :label="$t('trends.signalPool.filterSource')"
        style="min-width: 180px"
      />
      <q-select
        v-model="filterProcessed"
        :options="processedOptions"
        emit-value
        map-options
        dense
        outlined
        clearable
        :label="$t('trends.signalPool.filterProcessed')"
        style="min-width: 180px"
      />
      <q-space />
      <q-chip dense outline color="primary">{{ pagination.rowsNumber }} {{ $t('trends.signals') }}</q-chip>
    </q-card-section>

    <q-separator />

    <q-table
      :rows="signals"
      :columns="columns"
      v-model:pagination="pagination"
      :loading="loading"
      row-key="id"
      flat
      bordered
      dense
      server-side
      @request="onTableRequest"
    >
      <!-- Source column -->
      <template #body-cell-source="props">
        <q-td :props="props">
          <q-chip
            dense
            :color="sourceColor(props.value)"
            text-color="white"
            style="font-size: 11px;"
          >
            {{ $t(`trends.sources.${props.value}`) }}
          </q-chip>
        </q-td>
      </template>

      <!-- Title + URL column -->
      <template #body-cell-title="props">
        <q-td :props="props" style="max-width: 320px;">
          <div class="ellipsis">{{ props.row.title }}</div>
          <a
            v-if="props.row.url"
            :href="props.row.url"
            target="_blank"
            rel="noopener noreferrer"
            class="text-caption text-primary"
          >
            {{ $t('trends.signalPool.openUrl') }}
          </a>
        </q-td>
      </template>

      <!-- Published date column -->
      <template #body-cell-publishedAt="props">
        <q-td :props="props" style="white-space: nowrap;">
          {{ formatDateTime(props.row.publishedAt) }}
        </q-td>
      </template>

      <!-- Metrics column -->
      <template #body-cell-metrics="props">
        <q-td :props="props">
          <span
            v-for="(val, key) in props.value"
            :key="key"
            class="q-mr-xs text-caption"
          >
            {{ key }}: {{ val }}
          </span>
        </q-td>
      </template>

      <!-- Processed status column -->
      <template #body-cell-processedAt="props">
        <q-td :props="props">
          <q-badge
            v-if="props.row.processedAt"
            :color="props.row.processedInto ? 'positive' : 'grey-5'"
            outline
          >
            {{ props.row.processedInto ? $t('trends.signalPool.processedToBrief') : $t('trends.signalPool.processedSkipped') }}
          </q-badge>
          <q-badge v-else color="blue" outline>
            {{ $t('trends.signalPool.processedUnprocessed') }}
          </q-badge>
        </q-td>
      </template>

      <template #no-data>
        <div class="full-width text-center text-grey-6 q-pa-xl">
          {{ $t('trends.signalPool.noData') }}
        </div>
      </template>
    </q-table>
  </q-card>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { api } from "src/lib/api-client";
import { HttpError } from "src/lib/http-error";

type SignalSource = "producthunt" | "hackernews" | "vendor_rss" | "reddit" | "github" | "dataforseo_trends";
type ProcessedFilter = "unprocessed" | "processed-to-brief" | "processed-skipped";

interface SignalRow {
  id: string;
  source: SignalSource;
  title: string;
  url: string | null;
  publishedAt: string | null;
  collectedAt: string;
  metrics: Record<string, number>;
  processedAt: string | null;
  processedInto: string | null;
}

const SOURCE_COLORS: Record<SignalSource, string> = {
  producthunt: "deep-orange",
  hackernews: "orange",
  vendor_rss: "teal",
  reddit: "red",
  github: "grey-8",
  dataforseo_trends: "indigo",
};

const PAGE_SIZE = 50;

export default defineComponent({
  name: "SignalPoolInspector",

  props: {
    projectSlug: { type: String, required: true },
  },

  data() {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86_400_000).toISOString();
    return {
      signals: [] as SignalRow[],
      loading: false,
      filterSource: null as SignalSource | null,
      filterProcessed: null as ProcessedFilter | null,
      fromDate: fourteenDaysAgo,
      pagination: {
        page: 1,
        rowsPerPage: PAGE_SIZE,
        rowsNumber: 0,
        sortBy: null as string | null,
        descending: false,
      },
    };
  },

  computed: {
    columns(): Array<{
      name: string;
      label: string;
      field: string | ((row: SignalRow) => unknown);
      align?: "left" | "right" | "center";
      sortable?: boolean;
    }> {
      return [
        { name: "source", label: this.$t("trends.signalPool.colSource") as string, field: "source", align: "left" },
        { name: "title",  label: this.$t("trends.signalPool.colTitle") as string,  field: "title",  align: "left" },
        { name: "publishedAt", label: this.$t("trends.signalPool.colPublished") as string, field: "publishedAt", align: "left" },
        { name: "metrics",    label: this.$t("trends.signalPool.colMetrics") as string,    field: "metrics",    align: "left" },
        { name: "processedAt", label: this.$t("trends.signalPool.colStatus") as string, field: "processedAt", align: "center" },
      ];
    },

    sourceOptions(): Array<{ label: string; value: SignalSource }> {
      const sources: SignalSource[] = ["producthunt", "hackernews", "vendor_rss", "reddit", "github", "dataforseo_trends"];
      return sources.map((s) => ({
        label: this.$t(`trends.sources.${s}`) as string,
        value: s,
      }));
    },

    processedOptions(): Array<{ label: string; value: ProcessedFilter }> {
      return [
        { label: this.$t("trends.signalPool.processedUnprocessed") as string, value: "unprocessed" },
        { label: this.$t("trends.signalPool.processedToBrief") as string,     value: "processed-to-brief" },
        { label: this.$t("trends.signalPool.processedSkipped") as string,     value: "processed-skipped" },
      ];
    },
  },

  watch: {
    filterSource() { void this.fetchSignals(1); },
    filterProcessed() { void this.fetchSignals(1); },
  },

  created() {
    void this.fetchSignals(1);
  },

  methods: {
    async onTableRequest(props: { pagination: { page: number; rowsPerPage: number } }): Promise<void> {
      await this.fetchSignals(props.pagination.page, props.pagination.rowsPerPage);
    },

    async fetchSignals(page = 1, rowsPerPage = PAGE_SIZE): Promise<void> {
      this.loading = true;
      try {
        const offset = (page - 1) * rowsPerPage;
        const params: Record<string, string | number> = {
          limit: rowsPerPage,
          offset,
          from: this.fromDate,
        };
        if (this.filterSource) params.source = this.filterSource;
        if (this.filterProcessed) params.processed = this.filterProcessed;

        const res = await api.get<{
          ok: boolean;
          data: { items: SignalRow[]; total: number; limit: number; offset: number };
        }>(`/projects/${this.projectSlug}/trends/signal-pool`, { params });

        this.signals = res.data.data.items;
        this.pagination = {
          ...this.pagination,
          page,
          rowsPerPage,
          rowsNumber: res.data.data.total,
        };
      } catch (e) {
        if (e instanceof HttpError) {
          console.error("Failed to load signal pool", e.userMessage);
        }
        this.signals = [];
      } finally {
        this.loading = false;
      }
    },

    sourceColor(source: SignalSource): string {
      return SOURCE_COLORS[source] ?? "grey-6";
    },

    formatDate(iso: string | null): string {
      if (!iso) return "—";
      return new Date(iso).toLocaleDateString(
        this.$i18n.locale === "de" ? "de-DE" : "en-US",
        { day: "2-digit", month: "short", year: "numeric" },
      );
    },

    formatDateTime(iso: string | null): string {
      if (!iso) return "—";
      const locale = this.$i18n.locale === "de" ? "de-DE" : "en-US";
      return new Date(iso).toLocaleString(locale, {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    },
  },
});
</script>
