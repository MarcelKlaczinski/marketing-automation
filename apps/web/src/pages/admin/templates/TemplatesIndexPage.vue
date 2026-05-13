<template>
  <q-page class="q-pa-md">
    <TemplatesPanel />
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import TemplatesPanel from 'src/components/admin/templates/TemplatesPanel.vue';

export default defineComponent({
  name: 'TemplatesIndexPage',
  components: { TemplatesPanel },
});
</script>
