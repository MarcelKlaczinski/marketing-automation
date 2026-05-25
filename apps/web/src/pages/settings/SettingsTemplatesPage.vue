<template>
  <div class="templates-page">
    <header class="page-header">
      <h1 class="page-title">{{ $t("settings.templates.title") as string }}</h1>
      <p class="page-description">{{ $t("settings.templates.description") as string }}</p>
    </header>

    <section class="filters-row">
      <div class="filter-group">
        <label class="filter-label">{{ $t("settings.templates.filters.formatType") as string }}</label>
        <select v-model="formatTypeFilter" class="filter-select">
          <option :value="null">{{ $t("settings.templates.filters.allFormats") as string }}</option>
          <option
            v-for="ft in formatTypeOptions"
            :key="ft"
            :value="ft"
          >
            {{ formatTypeLabel(ft) }}
          </option>
        </select>
      </div>
      <div class="filter-group">
        <label class="filter-label">{{ $t("settings.templates.filters.scope") as string }}</label>
        <select v-model="scopeFilter" class="filter-select">
          <option value="all">{{ $t("settings.templates.filters.allScopes") as string }}</option>
          <option value="global">{{ $t("settings.templates.filters.scopeGlobal") as string }}</option>
          <option value="project">{{ $t("settings.templates.filters.scopeProject") as string }}</option>
        </select>
      </div>
    </section>

    <div v-if="loading" class="state-banner">
      {{ $t("settings.templates.loading") as string }}
    </div>

    <div v-else-if="error" class="state-banner error" role="alert">
      {{ $t("settings.templates.loadError") as string }}
    </div>

    <div v-else-if="!filteredItems.length" class="state-banner empty">
      {{ $t("settings.templates.empty") as string }}
    </div>

    <div v-else class="cards-grid">
      <article
        v-for="tpl in filteredItems"
        :key="tpl.id"
        class="template-card"
      >
        <header class="card-header">
          <div class="card-name">{{ tpl.displayName ?? tpl.templateKey }}</div>
          <span class="card-scope-chip" :class="`scope-${tpl.scope}`">
            {{ scopeLabel(tpl.scope) }}
          </span>
        </header>

        <div class="card-key mono">{{ tpl.templateKey }}</div>

        <!-- Spec 65.0 Day 5: persistent-render thumbnail. Click → open
             modal. URL is deterministic so we cache-bust by the renderedAt
             timestamp; the browser otherwise serves the old PNG after a
             re-render. -->
        <button
          v-if="tpl.lastPreview && tpl.lastPreview.previewUrls.length"
          class="card-thumbnail-button"
          type="button"
          :aria-label="$t('settings.templates.card.preview') as string"
          @click="openPreview(tpl)"
        >
          <img
            :src="cacheBustedThumb(tpl)"
            :alt="tpl.templateKey"
            class="card-thumbnail"
            loading="lazy"
          />
        </button>

        <p v-if="tpl.description" class="card-description">{{ tpl.description }}</p>

        <dl class="card-meta">
          <div class="meta-row">
            <dt>{{ $t("settings.templates.card.format") as string }}</dt>
            <dd>{{ tpl.formatTypes.map(formatTypeLabel).join(", ") || "—" }}</dd>
          </div>
          <div class="meta-row">
            <dt>{{ $t("settings.templates.card.channels") as string }}</dt>
            <dd>{{ tpl.compatibleChannels.join(", ") || "—" }}</dd>
          </div>
          <div class="meta-row">
            <dt>{{ $t("settings.templates.card.slides") as string }}</dt>
            <dd>{{ tpl.defaultSlideCount ?? "—" }}</dd>
          </div>
          <div class="meta-row">
            <dt>{{ $t("settings.templates.card.usageCount", { n: tpl.usageCount }) as string }}</dt>
            <dd>{{ lastUsedLabel(tpl.lastUsedAt) }}</dd>
          </div>
        </dl>

        <footer class="card-footer">
          <q-btn
            color="primary"
            unelevated
            size="sm"
            :label="$t('settings.templates.card.preview') as string"
            @click="openPreview(tpl)"
          />
          <q-btn
            flat
            disable
            size="sm"
            :label="$t('settings.templates.card.disable') as string"
          >
            <q-tooltip>{{ $t("settings.templates.card.disableTooltip") as string }}</q-tooltip>
          </q-btn>
        </footer>
      </article>
    </div>

    <TemplatePreviewModal
      v-if="activeTemplate"
      v-model="previewOpen"
      :slug="projectSlug"
      :template-key="activeTemplate.templateKey"
      :display-name="activeTemplate.displayName"
      :initial-preview-urls="activeTemplate.lastPreview?.previewUrls ?? []"
      :initial-rendered-at="activeTemplate.lastPreview?.renderedAt ?? null"
      @rendered="onPreviewRendered"
    />

    <!-- Spec 65.0 Day 5: per-project text + eligibility overrides (Spec 57.3),
         relocated from SettingsProjectPage so Templates is the single home
         for everything template-related (registry browser + preview +
         per-project overrides). -->
    <TemplateOverridesSection
      v-if="projectSlug"
      :slug="projectSlug"
      class="overrides-section"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import {
  useTemplatesList,
  type TemplateListItem,
} from "src/composables/settings/useTemplatesList";
import TemplatePreviewModal from "src/components/settings/TemplatePreviewModal.vue";
import TemplateOverridesSection from "src/components/settings/TemplateOverridesSection.vue";
import { assetUrl } from "src/lib/asset-url";

/**
 * Spec 65.0 Day 5 — Settings Templates page.
 *
 * Lists active templates for the current project (global + project-scoped,
 * resolved by the DB layer). Format-type and scope filters are client-side
 * (cheap for ~5-20 rows); the server-side `?formatType=` filter is used
 * for the format-type narrowing because it's also useful for future
 * planner-side queries. The scope filter is purely UI-local.
 *
 * Disable button is stubbed (`q-tooltip` flags "Day 6") — the PATCH endpoint
 * for `templates.is_active` is not yet implemented.
 */
export default defineComponent({
  name: "SettingsTemplatesPage",

  components: { TemplatePreviewModal, TemplateOverridesSection },

  setup() {
    const projectSlug = ""; // placeholder for typing — real value is the computed below
    const slugRef = { value: projectSlug };
    void slugRef;
    // Composable consumes MaybeRef — we pass closures that read `this`-side
    // computeds via the binding hack below. Cleaner: use a getter.
    return {};
  },

  data: () => ({
    formatTypeFilter: null as string | null,
    scopeFilter: "all" as "all" | "global" | "project",
    items: [] as TemplateListItem[],
    loading: false,
    error: null as string | null,
    previewOpen: false,
    activeTemplate: null as TemplateListItem | null,
    _refetch: (() => Promise.resolve()) as () => Promise<void>,
  }),

  computed: {
    projectSlug(): string {
      return (this.$route.params.slug as string) ?? "";
    },
    /**
     * Static list of known format-types — extracted from the
     * `TemplatePlannerMeta.contentType` enum in
     * `packages/social/src/templates/types.ts`. Duplicated here because
     * `apps/web` cannot import from `@marketing-auto/*` workspace packages.
     */
    formatTypeOptions(): string[] {
      return ["comparison", "tool-spotlight", "use-case", "news", "concept"];
    },
    filteredItems(): TemplateListItem[] {
      if (this.scopeFilter === "all") return this.items;
      return this.items.filter((t) => t.scope === this.scopeFilter);
    },
  },

  watch: {
    formatTypeFilter() {
      void this._refetch();
    },
    "$route.params.slug"() {
      void this._refetch();
    },
  },

  mounted() {
    // Wire the composable here (not in setup()) so we can access reactive
    // `data()` values (formatTypeFilter). Pattern: pass getter functions to
    // the composable so it always reads the latest data().
    const composable = useTemplatesList({
      slug: () => this.projectSlug,
      formatType: () => this.formatTypeFilter,
    });
    // Mirror composable refs onto this so the template can read them
    // through `data` slots and re-render on change.
    this._refetch = () => composable.refetch();
    // Watch the composable refs and copy values into our component state.
    this.$watch(
      () => composable.items.value,
      (v) => {
        this.items = v;
      },
      { immediate: true },
    );
    this.$watch(
      () => composable.loading.value,
      (v) => {
        this.loading = v;
      },
      { immediate: true },
    );
    this.$watch(
      () => composable.error.value,
      (v) => {
        this.error = v;
      },
      { immediate: true },
    );
  },

  methods: {
    formatTypeLabel(value: string): string {
      const key = `settings.templates.formatTypes.${value}`;
      const translated = this.$t(key) as string;
      // Fall back to the raw value if the key is missing.
      return translated === key ? value : translated;
    },
    scopeLabel(scope: "global" | "project"): string {
      return scope === "global"
        ? (this.$t("settings.templates.card.scopeGlobal") as string)
        : (this.$t("settings.templates.card.scopeProject") as string);
    },
    lastUsedLabel(when: string | null): string {
      if (!when) return this.$t("settings.templates.card.lastUsedNever") as string;
      const date = new Date(when);
      if (Number.isNaN(date.getTime())) return when;
      const locale = this.$i18n.locale === "de" ? "de-DE" : "en-US";
      return date.toLocaleString(locale, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    },
    openPreview(tpl: TemplateListItem): void {
      this.activeTemplate = tpl;
      this.previewOpen = true;
    },
    assetUrl(path: string | null | undefined): string {
      return assetUrl(path);
    },
    cacheBustedThumb(tpl: TemplateListItem): string {
      const first = tpl.lastPreview?.previewUrls[0];
      if (!first) return "";
      const base = assetUrl(first);
      const v = tpl.lastPreview?.renderedAt;
      if (!v) return base;
      return base.includes("?") ? `${base}&v=${encodeURIComponent(v)}` : `${base}?v=${encodeURIComponent(v)}`;
    },
    /**
     * Re-render finished — patch the active card's `lastPreview` so the
     * thumbnail updates without a full list refetch. Real change here is
     * just the `renderedAt` (URLs are deterministic so they stay identical).
     */
    onPreviewRendered(payload: { previewUrls: string[]; renderedAt: string }): void {
      if (!this.activeTemplate) return;
      const key = this.activeTemplate.templateKey;
      this.items = this.items.map((t) =>
        t.templateKey === key
          ? { ...t, lastPreview: { previewUrls: payload.previewUrls, renderedAt: payload.renderedAt } }
          : t,
      );
      this.activeTemplate = this.items.find((t) => t.templateKey === key) ?? this.activeTemplate;
    },
  },
});
</script>

<style scoped>
.templates-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.page-header {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.page-title {
  font-size: 22px;
  font-weight: 600;
  margin: 0;
}

.page-description {
  font-size: 13px;
  color: var(--text-tertiary);
  margin: 0;
  max-width: 760px;
  line-height: 1.5;
}

.filters-row {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--border-subtle);
  padding-bottom: 16px;
}

.filter-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.filter-label {
  font-size: 11px;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.filter-select {
  background: var(--bg-glass-strong);
  color: var(--text-primary);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  font-size: 13px;
  min-width: 180px;
}

.state-banner {
  background: var(--bg-glass-strong);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  padding: 16px 20px;
  color: var(--text-tertiary);
  font-size: 13px;
}

.state-banner.error {
  border-color: color-mix(in oklch, var(--color-error, #e53e3e) 35%, transparent);
  color: var(--color-error, #e53e3e);
}

.state-banner.empty {
  text-align: center;
  padding: 32px 20px;
}

.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.template-card {
  background: var(--bg-glass-strong);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.card-name {
  font-size: 14px;
  font-weight: 600;
}

.card-scope-chip {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--bg-base);
}

.card-scope-chip.scope-global {
  color: var(--color-info, #5b9aff);
  border: 1px solid color-mix(in oklch, var(--color-info, #5b9aff) 35%, transparent);
}

.card-scope-chip.scope-project {
  color: var(--color-success, #16a34a);
  border: 1px solid color-mix(in oklch, var(--color-success, #16a34a) 35%, transparent);
}

.card-key {
  font-size: 11px;
  color: var(--text-tertiary);
}

.mono {
  font-family: var(--font-mono, "JetBrains Mono", monospace);
}

.card-thumbnail-button {
  display: block;
  width: 100%;
  padding: 0;
  background: transparent;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  overflow: hidden;
  cursor: pointer;
  transition: border-color 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
              transform 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

@media (hover: hover) and (pointer: fine) {
  .card-thumbnail-button:hover {
    border-color: var(--color-brand, var(--text-primary));
  }
}

.card-thumbnail-button:active {
  transform: scale(0.985);
}

.card-thumbnail {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 5;
  object-fit: cover;
  background: var(--bg-base);
}

.card-description {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 10px 0;
  border-top: 1px solid var(--border-subtle);
  border-bottom: 1px solid var(--border-subtle);
}

.meta-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
}

.meta-row dt {
  color: var(--text-tertiary);
}

.meta-row dd {
  margin: 0;
  color: var(--text-secondary);
  font-weight: 500;
}

.card-footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.overrides-section {
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid var(--border-subtle);
}

@media (max-width: 600px) {
  .cards-grid {
    grid-template-columns: 1fr;
  }
}
</style>
