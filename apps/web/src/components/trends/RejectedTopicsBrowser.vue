<template>
  <q-card flat bordered>
    <q-card-section class="row items-center q-gutter-sm">
      <q-select
        v-model="reasonFilter"
        :options="reasonOptions"
        emit-value
        map-options
        dense
        outlined
        clearable
        :label="$t('trends.filterByReason')"
        style="min-width: 240px"
      />
      <q-space />
      <q-chip dense outline color="primary">
        {{ filtered.length }} {{ $t('trends.rejected') }}
      </q-chip>
    </q-card-section>

    <q-separator />

    <div v-if="loading" class="q-pa-md text-center">
      <q-spinner color="primary" size="24px" />
    </div>

    <q-list v-else-if="filtered.length > 0" separator>
      <q-item v-for="r in filtered" :key="r.id">
        <q-item-section>
          <q-item-label lines="2" class="text-weight-medium">{{ r.topicTitle }}</q-item-label>
          <q-item-label caption class="q-mt-xs row items-center q-gutter-xs">
            <q-chip
              dense
              size="xs"
              :color="reasonColor(r.reason)"
              text-color="white"
            >
              {{ $t(`trends.reasons.${r.reason}`) }}
            </q-chip>
            <span v-if="r.similarityScore != null" class="text-grey-7">
              {{ $t('trends.similarity') }}: {{ Number(r.similarityScore).toFixed(2) }}
            </span>
            <span v-if="r.trendScore != null" class="text-grey-7">
              {{ $t('trends.score') }}: {{ r.trendScore }}
            </span>
          </q-item-label>
        </q-item-section>

        <q-item-section side top class="text-right">
          <q-item-label caption>{{ $t('trends.expiresIn') }}</q-item-label>
          <q-item-label>{{ expiresInDays(r.expiresAt) }}</q-item-label>
        </q-item-section>
      </q-item>
    </q-list>

    <q-card-section v-else class="text-grey-6 text-center q-pa-xl">
      {{ $t('trends.noRejected') }}
    </q-card-section>
  </q-card>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { api } from "src/lib/api-client";
import { HttpError } from "src/lib/http-error";

type RejectedReason =
  | "existing_coverage"
  | "low_score"
  | "excluded_by_scope"
  | "low_signal_volume"
  | "manual_dismissal";

interface RejectedRow {
  id: string;
  topicTitle: string;
  reason: RejectedReason;
  trendScore: number | null;
  similarityScore: string | null;
  rejectedAt: string;
  expiresAt: string;
}

const REASON_COLORS: Record<RejectedReason, string> = {
  existing_coverage: "blue",
  low_score: "orange",
  excluded_by_scope: "purple",
  low_signal_volume: "grey-7",
  manual_dismissal: "red",
};

export default defineComponent({
  name: "RejectedTopicsBrowser",

  props: {
    projectSlug: { type: String, required: true },
  },

  data: () => ({
    rows: [] as RejectedRow[],
    loading: false,
    reasonFilter: null as RejectedReason | null,
  }),

  computed: {
    reasonOptions(): Array<{ label: string; value: RejectedReason }> {
      const reasons: RejectedReason[] = [
        "existing_coverage",
        "low_score",
        "excluded_by_scope",
        "low_signal_volume",
        "manual_dismissal",
      ];
      return reasons.map((r) => ({
        label: this.$t(`trends.reasons.${r}`) as string,
        value: r,
      }));
    },

    filtered(): RejectedRow[] {
      if (!this.reasonFilter) return this.rows;
      return this.rows.filter((r) => r.reason === this.reasonFilter);
    },
  },

  created() {
    void this.fetchRejected();
  },

  methods: {
    async fetchRejected(): Promise<void> {
      this.loading = true;
      try {
        const res = await api.get<{ ok: boolean; data: { rejected: RejectedRow[] } }>(
          `/projects/${this.projectSlug}/trends/rejected-topics`,
        );
        this.rows = res.data.data.rejected;
      } catch (e) {
        if (e instanceof HttpError) {
          console.error("Failed to load rejected topics", e.userMessage);
        }
        this.rows = [];
      } finally {
        this.loading = false;
      }
    },

    reasonColor(reason: RejectedReason): string {
      return REASON_COLORS[reason] ?? "grey-6";
    },

    expiresInDays(expiresAt: string): string {
      const ms = new Date(expiresAt).getTime() - Date.now();
      const days = Math.max(0, Math.ceil(ms / 86_400_000));
      return this.$t("trends.days", { n: days }, days) as string;
    },
  },
});
</script>
