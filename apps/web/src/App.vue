<template>
  <router-view />
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useThemeInit } from 'src/composables/useTheme';

export default defineComponent({
  name: 'App',
  setup() {
    useThemeInit();
  },
});
</script>
