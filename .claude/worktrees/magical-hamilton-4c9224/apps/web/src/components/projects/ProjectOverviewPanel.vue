<template>
  <div>
    <div class="row q-col-gutter-md q-mb-lg">
      <div class="col-12 col-md-8">
        <div class="overview-card">
          <div class="overview-card__header">
            <div class="overview-card__title">{{ $t('projects.overview.contextTitle') }}</div>
            <div class="overview-card__actions">
              <span v-if="hasUnsavedChanges" class="unsaved-indicator">
                {{ $t('common.unsavedChanges') }}
              </span>
              <q-btn
                v-if="hasUnsavedChanges"
                color="primary"
                size="sm"
                :label="$t('common.save')"
                :loading="saving"
                @click="onSave"
              />
            </div>
          </div>
          <p class="text-caption text-grey-7 q-mb-md">{{ $t('projects.overview.contextHint') }}</p>
          <MarkdownEditor
            v-model="contextDraft"
            :height="500"
            @blur="onAutoSave"
          />
        </div>
      </div>

      <div class="col-12 col-md-4">
        <!-- ── Zuletzt generiert ──────────────────────────────────────── -->
        <div class="overview-card q-mb-md">
          <div class="overview-card__title q-mb-sm">{{ $t('projects.overview.recentTitle') }}</div>
          <div v-if="recentLoading" class="text-center q-py-sm">
            <q-spinner size="20px" color="primary" />
          </div>
          <div v-else-if="recentArticles.length === 0" class="text-caption text-grey-6">
            {{ $t('projects.overview.recentEmpty') }}
          </div>
          <div v-else class="recent-list">
            <router-link
              v-for="a in recentArticles"
              :key="a.id"
              :to="`/articles/${a.id}`"
              class="recent-row"
            >
              <div class="recent-row__main">
                <span class="recent-row__locale">{{ (a.locale || 'de').toUpperCase() }}</span>
                <span class="recent-row__title">{{ a.title || a.cornerstoneKeyword }}</span>
              </div>
              <div class="recent-row__meta">
                <q-badge :color="statusColor(a.status)" :label="$t('articles.status.' + a.status)" dense />
                <span class="recent-row__time">{{ timeAgo(a.updatedAt) }}</span>
              </div>
            </router-link>
          </div>
          <router-link
            :to="`/projects/${project.slug}?tab=articles`"
            class="text-caption text-primary q-mt-sm block"
            style="display:block"
          >
            {{ $t('projects.overview.recentAllLink') }} →
          </router-link>
        </div>

        <div class="overview-card">
          <div class="overview-card__title q-mb-md">{{ $t('projects.overview.statsTitle') }}</div>
          <div class="stat-list">
            <div class="stat-row">
              <span class="stat-row__label">{{ $t('projects.stats.clusters') }}</span>
              <span class="stat-row__value">{{ project.stats?.clusterCount ?? 0 }}</span>
            </div>
            <div class="stat-row">
              <span class="stat-row__label">{{ $t('projects.stats.totalArticles') }}</span>
              <span class="stat-row__value">{{ project.stats?.totalArticles ?? 0 }}</span>
            </div>
            <template v-for="(count, status) in articleCounts" :key="status">
              <div class="stat-row">
                <span class="stat-row__label">{{ $t(`articleStatus.${status}`, String(status)) }}</span>
                <span class="stat-row__value">{{ count }}</span>
              </div>
            </template>
          </div>
        </div>

        <div class="overview-card q-mt-md">
          <div class="overview-card__title q-mb-md">{{ $t('projects.overview.metaTitle') }}</div>
          <div class="stat-list">
            <div class="stat-row">
              <span class="stat-row__label">{{ $t('projects.overview.industry') }}</span>
              <span class="stat-row__value">{{ $t(`industries.${project.industry}`) }}</span>
            </div>
            <div class="stat-row">
              <span class="stat-row__label">{{ $t('projects.overview.pipelineTemplate') }}</span>
              <span class="stat-row__value">{{ $t(`pipelineTemplates.${project.pipelineTemplate}`) }}</span>
            </div>
            <div class="stat-row">
              <span class="stat-row__label">{{ $t('projects.overview.created') }}</span>
              <span class="stat-row__value">{{ formatDate(project.createdAt) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import MarkdownEditor from "src/components/common/MarkdownEditor.vue";
import { useNotify } from "src/composables/useNotify";
import { api } from "src/lib/api-client";
import { HttpError } from "src/lib/http-error";
import { STATUS_GROUP_COLORS, STATUS_TO_GROUP } from "src/lib/article-status";
import { useProjectsStore } from "src/stores/projects";
import type { Project } from "src/stores/projects";
import { type PropType, defineComponent } from "vue";

interface RecentArticle {
  id: string;
  title: string | null;
  cornerstoneKeyword: string;
  locale: string | null;
  status: string;
  updatedAt: string;
}

export default defineComponent({
  name: "ProjectOverviewPanel",

  components: { MarkdownEditor },

  props: {
    project: { type: Object as PropType<Project>, required: true },
  },

  emits: ["updated"],

  setup() {
    return {
      projectsStore: useProjectsStore(),
      notify: useNotify(),
    };
  },

  data() {
    return {
      contextDraft: this.project.marketingContextMd ?? "",
      lastSaved: this.project.marketingContextMd ?? "",
      saving: false,
      recentArticles: [] as RecentArticle[],
      recentLoading: false,
    };
  },

  computed: {
    hasUnsavedChanges(): boolean {
      return this.contextDraft !== this.lastSaved;
    },
    articleCounts(): Record<string, number> {
      return this.project.stats?.articleCounts ?? {};
    },
  },

  watch: {
    "project.marketingContextMd"(newVal: string | null): void {
      if (newVal !== this.lastSaved) {
        this.contextDraft = newVal ?? "";
        this.lastSaved = newVal ?? "";
      }
    },
  },

  async mounted() {
    await this.fetchRecentArticles();
  },

  methods: {
    async onSave(): Promise<void> {
      if (!this.hasUnsavedChanges) return;
      this.saving = true;
      try {
        await this.projectsStore.update(this.project.slug, {
          marketingContextMd: this.contextDraft,
        });
        this.lastSaved = this.contextDraft;
        this.notify.success(this.$t("projects.overview.saveSuccess") as string);
        this.$emit("updated");
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      } finally {
        this.saving = false;
      }
    },

    async onAutoSave(): Promise<void> {
      if (this.hasUnsavedChanges) {
        await this.onSave();
      }
    },

    async fetchRecentArticles(): Promise<void> {
      this.recentLoading = true;
      try {
        const res = await api.get<{ ok: boolean; data: { items: RecentArticle[] } }>(
          `/articles?projectSlug=${encodeURIComponent(this.project.slug)}&limit=5&offset=0`
        );
        this.recentArticles = res.data.data.items ?? [];
      } catch {
        // silently ignore — widget is non-critical
      } finally {
        this.recentLoading = false;
      }
    },

    statusColor(status: string): string {
      const group = STATUS_TO_GROUP[status];
      if (!group) return "grey";
      const hex = STATUS_GROUP_COLORS[group];
      // Map hex colours to Quasar named colours for q-badge
      const hexMap: Record<string, string> = {
        "#f2c037": "warning",
        "#3f51b5": "primary",
        "#21ba45": "positive",
        "#c10015": "negative",
      };
      return hexMap[hex] ?? "grey";
    },

    timeAgo(iso: string): string {
      const diff = Date.now() - new Date(iso).getTime();
      const mins = Math.floor(diff / 60_000);
      if (mins < 2) return this.$t("common.justNow") as string;
      if (mins < 60) return this.$t("common.minutesAgo", { n: mins }) as string;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return this.$t("common.hoursAgo", { n: hours }) as string;
      const days = Math.floor(hours / 24);
      return this.$t("common.daysAgo", { n: days }) as string;
    },

    formatDate(iso: string): string {
      const locale = this.$i18n.locale === "de" ? "de-DE" : "en-US";
      return new Date(iso).toLocaleDateString(locale);
    },
  },
});
</script>

<style lang="scss" scoped>
.overview-card {
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 8px;
  padding: 20px;
  background: var(--q-card-bg, #fff);

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }
}

.overview-card__header {
  display: flex;
  align-items: center;
  margin-bottom: 4px;
}

.overview-card__title {
  font-size: 16px;
  font-weight: 600;
  flex-grow: 1;
}

.overview-card__actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.unsaved-indicator {
  font-size: 12px;
  color: var(--q-warning, #f2c037);
}

.stat-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
}

.stat-row__label {
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.65));
}

.stat-row__value {
  font-weight: 500;
}

.recent-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.recent-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
  border-radius: 6px;
  text-decoration: none;
  color: inherit;
  transition: background 0.15s;

  &:hover {
    background: rgba(0, 0, 0, 0.04);

    body.body--dark & {
      background: rgba(255, 255, 255, 0.06);
    }
  }
}

.recent-row__main {
  display: flex;
  align-items: center;
  gap: 6px;
}

.recent-row__locale {
  font-size: 10px;
  font-weight: 700;
  color: var(--q-primary);
  background: rgba(var(--q-primary-rgb, 63, 81, 181), 0.1);
  border-radius: 3px;
  padding: 1px 4px;
  flex-shrink: 0;
}

.recent-row__title {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.recent-row__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 2px;
}

.recent-row__time {
  font-size: 11px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.5));
  margin-left: auto;
}
</style>
