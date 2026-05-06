<template>
  <q-page padding>
    <div class="row items-center q-mb-lg">
      <div class="col">
        <h1 class="text-h5 q-my-none">{{ $t('projects.title') }}</h1>
      </div>
      <div class="col-auto">
        <q-btn
          color="primary"
          icon="add"
          :label="$t('projects.createButton')"
          @click="createDialogOpen = true"
        />
      </div>
    </div>

    <div v-if="projectsStore.loading && projectsStore.list.length === 0" class="text-center q-pa-xl">
      <q-spinner size="3em" color="primary" />
    </div>

    <div v-else-if="projectsStore.list.length === 0" class="text-center q-pa-xl">
      <q-icon name="folder_open" size="64px" color="grey-5" />
      <p class="text-body1 q-mt-md text-grey-7">{{ $t('projects.empty') }}</p>
      <q-btn
        color="primary"
        icon="add"
        :label="$t('projects.createButton')"
        class="q-mt-md"
        @click="createDialogOpen = true"
      />
    </div>

    <div v-else class="project-grid">
      <ProjectListCard
        v-for="proj in projectsStore.list"
        :key="proj.id"
        :project="proj"
        @click="goToProject(proj.slug)"
      />
    </div>

    <ProjectCreateDialog
      v-model="createDialogOpen"
      @created="onProjectCreated"
    />
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useProjectsStore } from 'src/stores/projects';
import ProjectListCard from 'src/components/projects/ProjectListCard.vue';
import ProjectCreateDialog from 'src/components/projects/ProjectCreateDialog.vue';

export default defineComponent({
  name: 'ProjectsPage',

  components: {
    ProjectListCard,
    ProjectCreateDialog,
  },

  setup() {
    return { projectsStore: useProjectsStore() };
  },

  data: () => ({
    createDialogOpen: false,
  }),

  async created() {
    await this.projectsStore.fetchList();
  },

  methods: {
    goToProject(slug: string): void {
      void this.$router.push({ name: 'project-detail', params: { slug } });
    },

    onProjectCreated(slug: string): void {
      this.createDialogOpen = false;
      this.goToProject(slug);
    },
  },
});
</script>

<style lang="scss" scoped>
.project-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;

  @media (min-width: 768px) {
    grid-template-columns: repeat(2, 1fr);
  }

  @media (min-width: 1280px) {
    grid-template-columns: repeat(3, 1fr);
  }
}
</style>
