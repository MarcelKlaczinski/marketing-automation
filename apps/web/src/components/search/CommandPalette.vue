<template>
  <q-dialog
    v-model="open"
    transition-show="fade"
    transition-hide="fade"
    @show="onShow"
    @hide="onHide"
  >
    <div class="command-palette" role="dialog" :aria-label="$t('search.placeholder') as string">
      <!-- Input row -->
      <div class="cmd-input-wrap">
        <svg class="cmd-search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.4"/>
          <line x1="10.5" y1="10.5" x2="14" y2="14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
        <input
          ref="inputEl"
          v-model="query"
          class="cmd-input"
          type="text"
          :placeholder="$t('search.placeholder') as string"
          autocomplete="off"
          spellcheck="false"
          @keydown.escape.prevent="close"
          @keydown.down.prevent="focusFirstResult"
        />
        <KbdShortcut keys="Esc" class="cmd-esc-hint" />
      </div>

      <!-- Results area -->
      <div class="cmd-results" role="presentation">
        <!-- Loading -->
        <div v-if="isLoading" class="cmd-status text-sm text-tertiary">
          {{ $t('search.loading') }}
        </div>

        <!-- Min chars hint (query started but not enough) -->
        <div
          v-else-if="query.length > 0 && query.length < 2"
          class="cmd-status text-sm text-tertiary"
        >
          {{ $t('search.minChars') }}
        </div>

        <!-- No results -->
        <div
          v-else-if="hasResults === false"
          class="cmd-status text-sm text-tertiary"
        >
          {{ $t('search.noResults') }}
        </div>

        <!-- Result sections -->
        <template v-else-if="results">
          <CommandPaletteSection
            v-if="articleItems.length"
            :title="$t('search.articles') as string"
            :items="articleItems"
            @select="onSelect"
          />
          <CommandPaletteSection
            v-if="briefItems.length"
            :title="$t('search.briefs') as string"
            :items="briefItems"
            @select="onSelect"
          />
          <CommandPaletteSection
            v-if="clusterItems.length"
            :title="$t('search.clusters') as string"
            :items="clusterItems"
            @select="onSelect"
          />
        </template>

        <!-- Idle (empty query) — Spec 62.0a stub: show "Show paused runs" action. -->
        <template v-else>
          <CommandPaletteSection
            v-if="actionItems.length"
            :title="$t('search.actions') as string"
            :items="actionItems"
            @select="onSelect"
          />
          <div class="cmd-idle text-xs text-dim">
            {{ $t('search.minChars') }}
          </div>
        </template>
      </div>
    </div>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useUiStore } from "src/stores/ui";
import { useProjectStore } from "src/stores/project";
import { apiGet } from "src/lib/api";
import KbdShortcut from "src/components/ui/KbdShortcut.vue";
import CommandPaletteSection from "./CommandPaletteSection.vue";
import type { SearchResultItem } from "./CommandPaletteSection.vue";

interface SearchResponse {
  articles: Array<{ id: string; title: string | null; slug: string; locale: string | null; status: string }>;
  briefs: Array<{ id: string; topicTitle: string; primaryKeyword: string | null; approvalStatus: string }>;
  clusters: Array<{ id: string; name: string; primaryKeyword: string | null; generationStatus: string | null }>;
}

/**
 * Global command palette modal.
 * Triggered by ⌘K via useKeyboardShortcuts (wired in AppShell).
 * Debounced search (300ms) fires once the query reaches ≥ 2 chars.
 * Uses direct fetch() in a watcher instead of TanStack Query —
 * search is ephemeral and doesn't benefit from a shared cache.
 */
export default defineComponent({
  name: "CommandPalette",

  components: { KbdShortcut, CommandPaletteSection },

  setup() {
    const uiStore = useUiStore();
    const projectStore = useProjectStore();
    return { uiStore, projectStore };
  },

  data: () => ({
    query: "",
    results: null as SearchResponse | null,
    isLoading: false,
    debounceTimer: null as ReturnType<typeof setTimeout> | null,
  }),

  computed: {
    open: {
      get(): boolean {
        return this.uiStore.commandPaletteOpen;
      },
      set(val: boolean): void {
        if (!val) this.uiStore.commandPaletteOpen = false;
      },
    },

    hasResults(): boolean | null {
      if (!this.results) return null;
      const total =
        this.results.articles.length +
        this.results.briefs.length +
        this.results.clusters.length;
      return total > 0;
    },

    articleItems(): SearchResultItem[] {
      return (this.results?.articles ?? []).map((a) => ({
        id: a.id,
        title: a.title ?? a.slug,
        badge: a.status,
        href: `/articles/${a.id}`,
        ...(a.locale !== null && { subtitle: a.locale }),
      }));
    },

    briefItems(): SearchResultItem[] {
      return (this.results?.briefs ?? []).map((b) => ({
        id: b.id,
        title: b.topicTitle,
        badge: b.approvalStatus,
        ...(b.primaryKeyword !== null && { subtitle: b.primaryKeyword }),
      }));
    },

    clusterItems(): SearchResultItem[] {
      return (this.results?.clusters ?? []).map((c) => ({
        id: c.id,
        title: c.name,
        ...(c.primaryKeyword !== null && { subtitle: c.primaryKeyword }),
        ...(c.generationStatus !== null && { badge: c.generationStatus }),
      }));
    },

    // Spec 62.0a Section 7: static actions surfaced on the idle palette state.
    // Full debug-run inspector UI lands in Spec 62.6; this entry deep-links to the stub page.
    actionItems(): SearchResultItem[] {
      const slug = this.projectStore.currentSlug;
      if (!slug) return [];
      return [
        {
          id: "action-paused-runs",
          title: this.$t("search.actionPausedRuns") as string,
          subtitle: this.$t("search.actionPausedRunsSubtitle") as string,
          href: `/projects/${slug}/paused-runs`,
        },
        {
          id: "action-planner-goals",
          title: this.$t("search.actionPlannerGoals") as string,
          subtitle: this.$t("search.actionPlannerGoalsSubtitle") as string,
          href: `/projects/${slug}/settings/planner`,
        },
        // 62.5 planner deep links
        {
          id: "action-planner",
          title: this.$t("search.actionPlanner") as string,
          subtitle: this.$t("search.actionPlannerSubtitle") as string,
          href: `/projects/${slug}/planner`,
        },
        {
          id: "action-planner-generate",
          title: this.$t("search.actionPlannerGenerate") as string,
          subtitle: this.$t("search.actionPlannerGenerateSubtitle") as string,
          href: `/projects/${slug}/planner?generate=current`,
        },
      ];
    },
  },

  watch: {
    query(newVal: string): void {
      // Cancel pending debounce
      if (this.debounceTimer !== null) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }

      if (newVal.length < 2) {
        this.results = null;
        this.isLoading = false;
        return;
      }

      // Debounce: fire search 300ms after typing stops
      this.isLoading = true;
      this.debounceTimer = setTimeout(() => {
        void this.runSearch(newVal);
      }, 300);
    },
  },

  methods: {
    async runSearch(q: string): Promise<void> {
      const slug = this.projectStore.currentSlug;
      if (!slug) return;
      try {
        this.results = await apiGet<SearchResponse>(
          `/projects/${slug}/search?q=${encodeURIComponent(q)}`,
        );
      } catch {
        this.results = null;
      } finally {
        this.isLoading = false;
      }
    },

    close(): void {
      this.uiStore.commandPaletteOpen = false;
    },

    onShow(): void {
      this.query = "";
      this.results = null;
      this.isLoading = false;
      this.$nextTick(() => {
        (this.$refs.inputEl as HTMLInputElement | undefined)?.focus();
      });
    },

    onHide(): void {
      this.query = "";
      this.results = null;
      this.isLoading = false;
      if (this.debounceTimer !== null) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
    },

    focusFirstResult(): void {
      const first = (this.$el as HTMLElement | undefined)
        ?.querySelector?.(".section-item") as HTMLElement | null;
      first?.focus();
    },

    onSelect(item: SearchResultItem): void {
      this.close();
      if (item.href) {
        void this.$router.push(item.href);
      }
    },
  },
});
</script>

<style scoped>
/* The dialog content panel */
.command-palette {
  width: min(640px, 100vw - 32px);
  background: var(--bg-elevated);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-elevated), 0 0 40px rgba(124, 92, 255, 0.12);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: min(520px, 80vh);
}

/* Input row */
.cmd-input-wrap {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 14px var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.cmd-search-icon {
  color: var(--text-dim);
  flex-shrink: 0;
}

.cmd-input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  color: var(--text-primary);
  font-size: 14px;
  font-family: var(--font-sans);
  caret-color: var(--accent-primary);
}

.cmd-input::placeholder {
  color: var(--text-dim);
}

.cmd-esc-hint {
  flex-shrink: 0;
  opacity: 0.6;
}

/* Results area */
.cmd-results {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-2) 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.cmd-status,
.cmd-idle {
  padding: var(--space-5) var(--space-4);
  text-align: center;
}
</style>
