<template>
  <q-btn-dropdown
    flat
    dense
    :loading="store.loading"
    :label="store.currentProject ? store.currentProject.name : $t('projects.selectProject')"
    :aria-label="$t('projects.selectProject')"
    color="white"
    no-caps
    class="text-weight-medium"
  >
    <q-list dense style="min-width: 200px">
      <q-item-label header class="text-caption">{{ $t('projects.switchProject') }}</q-item-label>
      <q-item
        v-for="project in store.allProjects"
        :key="project.id"
        clickable
        v-close-popup
        @click="store.setProject(project.slug)"
        :active="project.slug === store.currentProjectSlug"
        active-class="text-primary"
      >
        <q-item-section>{{ project.name }}</q-item-section>
        <q-item-section side v-if="project.slug === store.currentProjectSlug">
          <q-icon name="check" size="xs" />
        </q-item-section>
      </q-item>
    </q-list>
  </q-btn-dropdown>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useProjectContextStore } from "src/stores/project-context";

export default defineComponent({
  name: "ProjectSelector",

  setup() {
    const store = useProjectContextStore();
    return { store };
  },
});
</script>
