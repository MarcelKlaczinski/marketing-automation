<template>
  <q-banner class="bg-info text-white" rounded>
    <template #avatar>
      <q-icon name="construction" />
    </template>
    {{ $t('common.comingSoon') }}
  </q-banner>
</template>

<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'ArticleHistoryPanel',

  props: {
    articleId: { type: String, required: true },
  },
});
</script>
