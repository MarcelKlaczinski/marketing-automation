<template>
  <q-page padding>
    <ArticlesPanel :slug="slug" />
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import ArticlesPanel from 'src/components/projects/ArticlesPanel.vue';

export default defineComponent({
  name: 'ArticlesPage',

  components: { ArticlesPanel },

  props: {
    slug: { type: String, required: true },
  },
});
</script>
