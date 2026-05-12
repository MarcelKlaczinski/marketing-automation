<template>
  <router-view />
</template>

<script lang="ts">
import { useThemeInit } from "src/composables/useTheme";
import { defineComponent } from "vue";

export default defineComponent({
  name: "App",
  setup() {
    useThemeInit();
  },
});
</script>
