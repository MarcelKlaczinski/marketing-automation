<template>
  <q-page padding>
    <q-card>
      <q-card-section>
        <div class="text-h5 q-mb-sm">{{ $t('auth.login.title') }}</div>
        <q-banner class="bg-info text-white">
          <template #avatar>
            <q-icon name="construction" />
          </template>
          Login wird in Spec 31 implementiert.
        </q-banner>
      </q-card-section>
    </q-card>
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
export default defineComponent({ name: 'LoginPage' });
</script>
