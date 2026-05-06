<template>
  <q-page padding>
    <div class="row q-mb-md">
      <div class="col">
        <h1 class="text-h5 q-my-none">{{ $t('inbox.title') }}</h1>
        <p class="text-body2 text-grey-7 q-mt-xs">
          {{ $t('inbox.greeting', { email: authStore.user?.email ?? '' }) }}
        </p>
      </div>
    </div>

    <q-banner v-if="!systemStatusStore.allConfigured" class="bg-warning text-dark q-mb-md">
      <template #avatar>
        <q-icon name="warning" />
      </template>
      <div>{{ $t('inbox.setupIncomplete') }}</div>
      <template #action>
        <q-btn flat :label="$t('inbox.openInstaller')" :to="{ name: 'installer' }" />
      </template>
    </q-banner>

    <q-card>
      <q-card-section>
        <div class="text-h6">{{ $t('inbox.todoTitle') }}</div>
      </q-card-section>
      <q-card-section>
        <q-banner class="bg-info text-white">
          <template #avatar>
            <q-icon name="construction" />
          </template>
          {{ $t('inbox.comingSoon') }}
        </q-banner>
      </q-card-section>
    </q-card>
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useAuthStore } from 'src/stores/auth';
import { useSystemStatusStore } from 'src/stores/system-status';

export default defineComponent({
  name: 'InboxPage',

  setup() {
    return {
      authStore: useAuthStore(),
      systemStatusStore: useSystemStatusStore(),
    };
  },
});
</script>
