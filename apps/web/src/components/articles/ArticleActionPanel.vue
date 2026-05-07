<template>
  <q-banner class="bg-info text-white" rounded>
    <template #avatar>
      <q-icon name="construction" />
    </template>
    {{ $t('common.comingSoon') }}
  </q-banner>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import type { ArticleDetail } from 'src/stores/articles';

export default defineComponent({
  name: 'ArticleActionPanel',

  props: {
    detail: { type: Object as PropType<ArticleDetail>, required: true },
  },

  emits: ['action-triggered'],
});
</script>
