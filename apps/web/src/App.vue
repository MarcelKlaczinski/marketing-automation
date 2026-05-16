<template>
  <router-view />
</template>

<script lang="ts">
import { defineComponent } from "vue";

/**
 * Root application component.
 * Renders the current route via <router-view>.
 * AppShell (layout) is mounted by the /projects/:slug routes.
 */
export default defineComponent({
  name: "App",
});
</script>
