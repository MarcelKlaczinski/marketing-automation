<template>
  <div class="project-card" @click="$emit('click')">
    <div class="project-card__header">
      <div class="project-card__icon" :style="{ background: iconBg }">
        <q-icon :name="industryIcon" size="20px" />
      </div>
      <div class="project-card__main">
        <div class="project-card__name">{{ project.name }}</div>
        <div class="project-card__slug">/{{ project.slug }}</div>
      </div>
    </div>

    <div class="project-card__meta">
      <span class="meta-pill">{{ $t(`industries.${project.industry}`) }}</span>
      <span class="meta-pill">{{ $t(`pipelineTemplates.${project.pipelineTemplate}`) }}</span>
    </div>

    <div v-if="project.stats" class="project-card__stats">
      <div class="stat">
        <div class="stat__value">{{ project.stats.clusterCount }}</div>
        <div class="stat__label">{{ $t('projects.stats.clusters') }}</div>
      </div>
      <div class="stat">
        <div class="stat__value">{{ project.stats.totalArticles }}</div>
        <div class="stat__label">{{ $t('projects.stats.articles') }}</div>
      </div>
      <div class="stat">
        <div class="stat__value">{{ publishedCount }}</div>
        <div class="stat__label">{{ $t('projects.stats.published') }}</div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import type { Project } from "src/stores/projects";
import { type PropType, defineComponent } from "vue";

const INDUSTRY_ICONS: Record<string, string> = {
  ai_education: "school",
  automotive_dealer: "directions_car",
  renewable_affiliate: "solar_power",
  music_school: "music_note",
  other: "business",
};

const INDUSTRY_COLORS: Record<string, string> = {
  ai_education: "rgba(0, 188, 212, 0.12)",
  automotive_dealer: "rgba(63, 81, 181, 0.12)",
  renewable_affiliate: "rgba(76, 175, 80, 0.12)",
  music_school: "rgba(156, 39, 176, 0.12)",
  other: "rgba(158, 158, 158, 0.18)",
};

export default defineComponent({
  name: "ProjectListCard",

  props: {
    project: { type: Object as PropType<Project>, required: true },
  },

  emits: ["click"],

  computed: {
    industryIcon(): string {
      return INDUSTRY_ICONS[this.project.industry] ?? "business";
    },

    iconBg(): string {
      return INDUSTRY_COLORS[this.project.industry] ?? "rgba(158, 158, 158, 0.18)";
    },

    publishedCount(): number {
      return this.project.stats?.articleCounts.published ?? 0;
    },
  },
});
</script>

<style lang="scss" scoped>
.project-card {
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 8px;
  padding: 20px;
  background: var(--q-card-bg, #fff);
  cursor: pointer;
  transition: border-color 0.15s, transform 0.15s;

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }

  &:hover {
    border-color: var(--q-primary, #3f51b5);
    transform: translateY(-2px);
  }
}

.project-card__header {
  display: flex;
  align-items: flex-start;
  margin-bottom: 12px;
}

.project-card__icon {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  color: var(--q-primary, #3f51b5);
}

.project-card__main {
  margin-left: 12px;
  min-width: 0;
}

.project-card__name {
  font-weight: 600;
  font-size: 16px;
}

.project-card__slug {
  font-size: 12px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  font-family: monospace;

  body.body--dark & {
    color: rgba(255, 255, 255, 0.55);
  }
}

.project-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 16px;
}

.meta-pill {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.05);
  color: rgba(0, 0, 0, 0.7);

  body.body--dark & {
    background: rgba(255, 255, 255, 0.07);
    color: rgba(255, 255, 255, 0.7);
  }
}

.project-card__stats {
  display: flex;
  gap: 24px;
  border-top: 1px solid var(--q-grey-2, #f0f0f0);
  padding-top: 12px;

  body.body--dark & {
    border-top-color: rgba(255, 255, 255, 0.06);
  }
}

.stat {
  text-align: left;
}

.stat__value {
  font-size: 20px;
  font-weight: 600;
  line-height: 1;
}

.stat__label {
  font-size: 11px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  margin-top: 4px;
  text-transform: uppercase;
  letter-spacing: 0.04em;

  body.body--dark & {
    color: rgba(255, 255, 255, 0.55);
  }
}
</style>
