<template>
  <q-layout view="lHh lpR lFf">
    <q-page-container>
      <div class="auth-container row justify-center items-center" style="min-height: 100vh;">
        <div class="col-12 col-sm-8 col-md-6 col-lg-4 q-pa-md">
          <router-view />
        </div>
      </div>
    </q-page-container>
  </q-layout>
</template>

<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'AuthLayout',
});
</script>
