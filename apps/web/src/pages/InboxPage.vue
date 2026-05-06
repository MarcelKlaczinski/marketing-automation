<template>
  <q-page padding>
    <h1 class="text-h4 q-mb-md">{{ $t('nav.inbox') }}</h1>
    <q-banner class="bg-info text-white">
      <template #avatar>
        <q-icon name="construction" />
      </template>
      Diese Seite wird in Spec 33 implementiert.
    </q-banner>
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
export default defineComponent({ name: 'InboxPage' });
</script>
