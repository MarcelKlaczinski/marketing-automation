<template>
  <q-page class="flex flex-center column">
    <div class="text-h2 q-mb-md">404</div>
    <div class="text-h6 q-mb-md">{{ $t('errors.notFound') }}</div>
    <q-btn :to="{ name: 'home' }" color="primary">{{ $t('app.backToHome') }}</q-btn>
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
export default defineComponent({ name: 'ErrorNotFound' });
</script>
