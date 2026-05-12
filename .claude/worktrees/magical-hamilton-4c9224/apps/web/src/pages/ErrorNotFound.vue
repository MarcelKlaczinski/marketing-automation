<template>
  <div class="flex flex-center column" style="min-height: 100vh;">
    <div class="text-h2 q-mb-md">404</div>
    <div class="text-h6 q-mb-md">{{ $t('errors.notFound') }}</div>
    <q-btn :to="{ name: 'inbox' }" color="primary">{{ $t('app.backToHome') }}</q-btn>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
export default defineComponent({ name: "ErrorNotFound" });
</script>
