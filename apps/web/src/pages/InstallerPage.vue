<template>
  <q-page padding>
    <q-card>
      <q-card-section>
        <div class="text-h5 q-mb-sm">{{ $t('installer.title') }}</div>
        <p class="text-body2">{{ $t('installer.intro') }}</p>
        <q-banner class="bg-info text-white">
          <template #avatar>
            <q-icon name="construction" />
          </template>
          Installer wird in Spec 32 implementiert.
        </q-banner>
      </q-card-section>
    </q-card>
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
export default defineComponent({ name: 'InstallerPage' });
</script>
