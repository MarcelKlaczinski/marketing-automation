<template>
  <q-page padding>
    <div v-if="!project && projectsStore.loading" class="text-center q-pa-xl">
      <q-spinner size="3em" color="primary" />
    </div>

    <div v-else-if="!project" class="text-center q-pa-xl">
      <q-icon name="error_outline" size="64px" color="negative" />
      <p class="text-body1 q-mt-md">{{ $t('projects.detail.notFound') }}</p>
      <q-btn
        outline
        color="primary"
        :label="$t('projects.detail.backToList')"
        :to="{ name: 'projects' }"
      />
    </div>

    <template v-else>
      <div class="row items-center q-mb-md">
        <q-btn flat round icon="arrow_back" :to="{ name: 'projects' }" class="q-mr-sm" />
        <div class="col">
          <h1 class="text-h5 q-my-none">{{ project.name }}</h1>
          <div class="text-caption text-grey-7" style="font-family: monospace;">/{{ project.slug }}</div>
        </div>
      </div>

      <q-tabs
        v-model="activeTab"
        align="left"
        class="text-grey-8 q-mb-lg"
        indicator-color="primary"
        active-color="primary"
        narrow-indicator
        @update:model-value="onTabChange"
      >
        <q-tab name="overview" :label="$t('projects.detail.tabs.overview')" icon="info" />
        <q-tab name="cold-start" :label="$t('projects.detail.tabs.coldStart')" icon="rocket_launch" />
        <q-tab name="articles" :label="$t('projects.detail.tabs.articles')" icon="article" />
        <q-tab name="clusters" :label="$t('projects.detail.tabs.clusters')" icon="hub" />
        <q-tab name="settings" :label="$t('projects.detail.tabs.settings')" icon="settings" />
      </q-tabs>

      <q-tab-panels v-model="activeTab" animated class="bg-transparent">
        <q-tab-panel name="overview" class="q-px-none">
          <ProjectOverviewPanel :project="project" @updated="onProjectUpdated" />
        </q-tab-panel>

        <q-tab-panel name="cold-start" class="q-px-none">
          <q-banner class="bg-info text-white">
            <template #avatar><q-icon name="construction" /></template>
            {{ $t('projects.detail.coldStartStub') }}
          </q-banner>
        </q-tab-panel>

        <q-tab-panel name="articles" class="q-px-none">
          <q-banner class="bg-info text-white">
            <template #avatar><q-icon name="construction" /></template>
            {{ $t('projects.detail.articlesStub') }}
          </q-banner>
        </q-tab-panel>

        <q-tab-panel name="clusters" class="q-px-none">
          <q-banner class="bg-info text-white">
            <template #avatar><q-icon name="construction" /></template>
            {{ $t('projects.detail.clustersStub') }}
          </q-banner>
        </q-tab-panel>

        <q-tab-panel name="settings" class="q-px-none">
          <ProjectSettingsPanel :project="project" @updated="onProjectUpdated" />
        </q-tab-panel>
      </q-tab-panels>
    </template>
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useProjectsStore } from 'src/stores/projects';
import ProjectOverviewPanel from 'src/components/projects/ProjectOverviewPanel.vue';
import ProjectSettingsPanel from 'src/components/projects/ProjectSettingsPanel.vue';

type TabName = 'overview' | 'cold-start' | 'articles' | 'clusters' | 'settings';
const VALID_TABS: ReadonlyArray<TabName> = ['overview', 'cold-start', 'articles', 'clusters', 'settings'];

export default defineComponent({
  name: 'ProjectDetailPage',

  components: { ProjectOverviewPanel, ProjectSettingsPanel },

  props: {
    slug: { type: String, required: true },
  },

  setup() {
    return { projectsStore: useProjectsStore() };
  },

  data: () => ({
    activeTab: 'overview' as TabName,
  }),

  computed: {
    project() {
      return this.projectsStore.current;
    },
  },

  async created() {
    const raw = this.$route.query['tab'];
    const tabFromQuery = Array.isArray(raw) ? raw[0] ?? '' : raw ?? '';
    if (typeof tabFromQuery === 'string' && (VALID_TABS as ReadonlyArray<string>).includes(tabFromQuery)) {
      this.activeTab = tabFromQuery as TabName;
    }
    await this.projectsStore.fetchOne(this.slug);
  },

  methods: {
    onTabChange(newTab: string | number | null): void {
      if (typeof newTab !== 'string') return;
      void this.$router.replace({ query: { ...this.$route.query, tab: newTab } });
    },

    async onProjectUpdated(): Promise<void> {
      await this.projectsStore.fetchOne(this.slug);
    },
  },
});
</script>
