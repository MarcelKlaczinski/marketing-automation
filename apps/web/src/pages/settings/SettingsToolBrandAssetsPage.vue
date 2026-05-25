<template>
  <div class="tba-page">
    <header class="page-header">
      <h1 class="page-title">{{ $t("settings.toolBrandAssets.title") as string }}</h1>
      <p class="page-description">{{ $t("settings.toolBrandAssets.description") as string }}</p>
    </header>

    <section class="stats-row">
      <div class="stat">
        <div class="stat-value">{{ list.stats.value.total }}</div>
        <div class="stat-label">{{ $t("settings.toolBrandAssets.stats.total") as string }}</div>
      </div>
      <div class="stat">
        <div class="stat-value">{{ list.stats.value.needsReview }}</div>
        <div class="stat-label">{{ $t("settings.toolBrandAssets.stats.needsReview") as string }}</div>
      </div>
      <div class="stat">
        <div class="stat-value">{{ list.stats.value.complete }}</div>
        <div class="stat-label">{{ $t("settings.toolBrandAssets.stats.complete") as string }}</div>
      </div>
      <div class="stat">
        <div class="stat-value">{{ list.stats.value.missing }}</div>
        <div class="stat-label">{{ $t("settings.toolBrandAssets.stats.missing") as string }}</div>
      </div>
    </section>

    <div
      v-if="list.stats.value.missing > 0"
      class="state-banner backfill-hint"
      role="status"
    >
      {{ $t("settings.toolBrandAssets.notifications.runBackfill") as string }}
      <code class="backfill-cmd">bun --filter @marketing-auto/api backfill-tool-brand-assets --project={{ slug }} --apply</code>
    </div>

    <section class="filters-row">
      <q-select
        v-model="needsReviewFilter"
        :options="needsReviewOptions"
        :label="$t('settings.toolBrandAssets.filters.status') as string"
        dense
        outlined
        dark
        emit-value
        map-options
        class="filter-select"
      />
      <q-select
        v-model="sourceFilter"
        :options="sourceOptions"
        :label="$t('settings.toolBrandAssets.filters.source') as string"
        dense
        outlined
        dark
        clearable
        emit-value
        map-options
        class="filter-select"
      />
    </section>

    <div v-if="list.loading.value" class="state-banner">
      {{ $t("settings.toolBrandAssets.loading") as string }}
    </div>
    <div v-else-if="list.error.value" class="state-banner error" role="alert">
      {{ $t("settings.toolBrandAssets.loadError") as string }}
    </div>
    <div v-else-if="!list.items.value.length" class="state-banner empty">
      {{ $t("settings.toolBrandAssets.empty") as string }}
    </div>

    <ul v-else class="asset-list">
      <li
        v-for="row in list.items.value"
        :key="row.toolId"
        class="asset-row"
        :class="{ 'needs-review': row.needsReview === true, missing: row.source === null }"
        @click="openEdit(row)"
      >
        <div
          class="row-logo"
          :class="{ 'has-logo': row.logoUrl !== null }"
          :style="row.logoUrl === null ? avatarStyle(row.toolSlug) : undefined"
        >
          <img v-if="row.logoUrl" :src="assetUrl(row.logoUrl)" :alt="row.toolTitle" />
          <div v-else class="row-logo-placeholder">{{ initials(row.toolTitle) }}</div>
        </div>
        <div class="row-main">
          <div class="row-title">{{ row.brandNameCanonical ?? row.toolTitle }}</div>
          <div class="row-slug mono">{{ row.toolSlug }}</div>
        </div>
        <div class="row-colors">
          <span
            v-if="row.primaryColor"
            class="row-swatch"
            :style="{ background: row.primaryColor }"
            :title="row.primaryColor"
          />
          <span
            v-if="row.secondaryColor"
            class="row-swatch"
            :style="{ background: row.secondaryColor }"
            :title="row.secondaryColor"
          />
          <span
            v-if="row.tertiaryColor"
            class="row-swatch"
            :style="{ background: row.tertiaryColor }"
            :title="row.tertiaryColor"
          />
          <span
            v-if="!row.primaryColor && !row.secondaryColor && !row.tertiaryColor"
            class="row-empty"
            >—</span
          >
        </div>
        <div class="row-source mono">{{ row.source ?? "—" }}</div>
        <div class="row-status">
          <span v-if="row.source === null" class="status-chip missing">
            {{ $t("settings.toolBrandAssets.status.missing") as string }}
          </span>
          <span v-else-if="row.needsReview" class="status-chip review">
            {{ $t("settings.toolBrandAssets.status.review") as string }}
          </span>
          <span v-else class="status-chip ok">
            {{ $t("settings.toolBrandAssets.status.ok") as string }}
          </span>
        </div>
      </li>
    </ul>

    <ToolBrandAssetEditModal
      v-model="editOpen"
      :item="editing"
      :slug="slug"
      @saved="onSaved"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import {
  useToolBrandAssetsList,
  type ToolBrandAssetListItem,
} from "src/composables/settings/useToolBrandAssetsList";
import ToolBrandAssetEditModal from "src/components/settings/ToolBrandAssetEditModal.vue";
import { assetUrl } from "src/lib/asset-url";

export default defineComponent({
  name: "SettingsToolBrandAssetsPage",

  components: { ToolBrandAssetEditModal },

  setup() {
    const list = useToolBrandAssetsList();
    return { list };
  },

  data: () => ({
    needsReviewFilter: "all" as "all" | "true" | "false",
    sourceFilter: null as string | null,
    editing: null as ToolBrandAssetListItem | null,
    editOpen: false,
  }),

  computed: {
    slug(): string {
      return this.$route.params.slug as string;
    },
    needsReviewOptions() {
      return [
        { value: "all", label: this.$t("settings.toolBrandAssets.filters.statusAll") as string },
        { value: "true", label: this.$t("settings.toolBrandAssets.filters.statusReview") as string },
        { value: "false", label: this.$t("settings.toolBrandAssets.filters.statusOk") as string },
      ];
    },
    sourceOptions() {
      const sources = ["lobe-icons", "iconify", "simple-icons", "deterministic-avatar", "manual"];
      return sources.map((value) => ({
        value,
        label: value,
      }));
    },
  },

  watch: {
    needsReviewFilter(): void {
      void this.fetch();
    },
    sourceFilter(): void {
      void this.fetch();
    },
  },

  mounted(): void {
    void this.fetch();
  },

  methods: {
    assetUrl,
    initials(title: string): string {
      return title.slice(0, 2).toUpperCase();
    },
    // Deterministic HSL hue per slug — matches the pipelines `hashToHue()`
    // pattern in `_lib/resolve-tool-icon.ts` so the same tool gets the
    // same color whether it falls back to an avatar here OR in the renderer.
    avatarStyle(slug: string): Record<string, string> {
      let h = 0;
      for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) % 360;
      return {
        background: `hsl(${h}deg, 55%, 38%)`,
        color: "#fff",
      };
    },
    openEdit(row: ToolBrandAssetListItem): void {
      // V1 follow-up: missing rows can also be edited — PATCH does
      // INSERT-or-UPDATE so the user can fill colors / upload a custom logo
      // before the backfill script runs.
      this.editing = row;
      this.editOpen = true;
    },
    async fetch(): Promise<void> {
      await this.list.refetch({
        slug: this.slug,
        needsReviewFilter: this.needsReviewFilter,
        sourceFilter: this.sourceFilter,
      });
    },
    onSaved(): void {
      void this.fetch();
    },
  },
});
</script>

<style scoped>
.tba-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 24px;
}
.page-header { display: flex; flex-direction: column; gap: 4px; }
.page-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}
.page-description {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
}
.stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 16px;
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md, 8px);
}
.stat-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
}
.stat-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
}
.filters-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.filter-select { min-width: 180px; }
.state-banner {
  padding: 14px 18px;
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md, 8px);
  color: var(--text-secondary);
  font-size: 13px;
}
.state-banner.error { border-color: var(--color-danger, #ef4444); color: var(--color-danger); }
.state-banner.backfill-hint {
  border-color: color-mix(in oklch, var(--color-info, #38bdf8) 40%, transparent);
  background: color-mix(in oklch, var(--color-info, #38bdf8) 8%, var(--bg-glass));
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.backfill-cmd {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  padding: 4px 8px;
  background: var(--bg-base);
  border-radius: var(--radius-sm);
  user-select: all;
}
.asset-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.asset-row {
  display: grid;
  grid-template-columns: 56px 1fr auto auto auto;
  gap: 16px;
  align-items: center;
  padding: 10px 14px;
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md, 8px);
  cursor: pointer;
  transition: background 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}
@media (hover: hover) and (pointer: fine) {
  .asset-row:hover {
    background: var(--bg-glass-strong);
  }
}
.asset-row.needs-review {
  border-color: color-mix(in oklch, var(--color-warning, #f59e0b) 50%, transparent);
}
.asset-row.missing {
  opacity: 0.7;
}
.row-logo {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  overflow: hidden;
}
/* Resolved brand SVGs often render via fill='currentColor' (simple-icons)
   or contain dark/black paths — paint them onto a white card so they stay
   visible on the dark UI. Matches how the production Astro frontend shows
   logos on light brand cards. */
.row-logo.has-logo {
  background: #fff;
  padding: 4px;
}
.row-logo img { max-width: 100%; max-height: 100%; }
/* Avatar fallback (no logo) keeps the inline HSL background + white text
   from `avatarStyle(slug)`. The placeholder element just centers the
   initials inside the badge. */
.row-logo-placeholder {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.row-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.row-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.row-slug {
  font-size: 11px;
  color: var(--text-tertiary);
}
.row-colors {
  display: flex;
  gap: 4px;
}
.row-swatch {
  display: inline-block;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 1px solid var(--border-subtle);
}
.row-empty {
  font-size: 12px;
  color: var(--text-tertiary);
}
.row-source {
  font-size: 11px;
  color: var(--text-tertiary);
  min-width: 120px;
}
.status-chip {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
}
.status-chip.review {
  background: color-mix(in oklch, var(--color-warning, #f59e0b) 18%, transparent);
  color: var(--color-warning, #f59e0b);
}
.status-chip.ok {
  background: color-mix(in oklch, var(--color-success, #22c55e) 18%, transparent);
  color: var(--color-success, #22c55e);
}
.status-chip.missing {
  background: var(--bg-base);
  color: var(--text-tertiary);
}
</style>
