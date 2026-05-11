<template>
  <q-page padding>
    <ProjectPauseBanner :slug="slug" />

    <div class="row items-center q-mb-lg">
      <div class="col">
        <q-breadcrumbs class="text-body2 q-mb-xs">
          <q-breadcrumbs-el :label="$t('projects.title')" :to="{ name: 'projects' }" />
          <q-breadcrumbs-el
            :label="projectName ?? slug"
            :to="{ name: 'project-detail', params: { slug } }"
          />
          <q-breadcrumbs-el :label="$t('clusters.pageTitle')" />
        </q-breadcrumbs>
        <h1 class="text-h5 q-my-none">{{ $t('clusters.pageTitle') }}</h1>
      </div>
    </div>

    <ClustersPanel :slug="slug" />
  </q-page>
</template>

<script lang="ts">
import ClustersPanel from "src/components/projects/ClustersPanel.vue";
import ProjectPauseBanner from "src/components/common/ProjectPauseBanner.vue";
import { useProjectsStore } from "src/stores/projects";
import { defineComponent } from "vue";

export default defineComponent({
  name: "ClustersManagementPage",

  components: {
    ProjectPauseBanner,
    ClustersPanel,
  },

  props: {
    slug: { type: String, required: true },
  },

  setup() {
    return { projectsStore: useProjectsStore() };
  },

  computed: {
    projectName(): string | null {
      return this.projectsStore.list.find((p) => p.slug === this.slug)?.name ?? null;
    },
  },

  async created() {
    if (this.projectsStore.list.length === 0) {
      await this.projectsStore.fetchList();
    }
  },
});
</script>
