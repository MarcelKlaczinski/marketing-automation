<template>
  <q-page padding>
    <h1 class="text-h4 q-mb-md">{{ $t('app.title') }}</h1>
    <p class="text-body1">{{ $t('home.intro') }}</p>
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
export default defineComponent({ name: 'IndexPage' });
</script>
