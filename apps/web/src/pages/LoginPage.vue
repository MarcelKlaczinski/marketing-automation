<template>
  <q-card class="q-pa-lg">
    <q-card-section>
      <div class="text-h5 q-mb-md">{{ $t('auth.login.title') }}</div>
      <p class="text-body2 q-mb-md">
        {{ $t('auth.login.subtitle') }}
      </p>
    </q-card-section>

    <q-card-section v-if="!sent">
      <q-form @submit.prevent="onSubmit">
        <q-input
          v-model="email"
          type="email"
          :label="$t('auth.login.emailLabel')"
          :rules="emailRules"
          autofocus
          :disable="loading"
          autocomplete="email"
          inputmode="email"
        />

        <q-banner v-if="!smtpConfigured" class="q-mt-md bg-warning text-dark">
          <template #avatar>
            <q-icon name="warning" />
          </template>
          {{ $t('auth.login.smtpNotConfigured') }}
        </q-banner>

        <q-btn
          type="submit"
          :label="$t('auth.login.submitButton')"
          color="primary"
          class="full-width q-mt-md"
          :loading="loading"
        />
      </q-form>
    </q-card-section>

    <q-card-section v-else>
      <q-banner class="bg-positive text-white">
        <template #avatar>
          <q-icon name="mark_email_read" />
        </template>
        {{ $t('auth.login.successMessage') }}
      </q-banner>

      <q-banner v-if="!smtpConfigured" class="q-mt-md bg-info text-white">
        <template #avatar>
          <q-icon name="developer_mode" />
        </template>
        <div>{{ $t('auth.login.checkServerLog') }}</div>
        <div class="text-caption q-mt-xs">{{ $t('auth.login.checkServerLogHint') }}</div>
      </q-banner>

      <q-btn
        flat
        :label="$t('auth.login.useDifferentEmail')"
        class="q-mt-md"
        @click="onReset"
      />
    </q-card-section>
  </q-card>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { api } from 'src/lib/api-client';
import { useSystemStatusStore } from 'src/stores/system-status';
import { useNotify } from 'src/composables/useNotify';
import { HttpError } from 'src/lib/http-error';

export default defineComponent({
  name: 'LoginPage',

  setup() {
    return {
      systemStatusStore: useSystemStatusStore(),
      notify: useNotify(),
    };
  },

  data: () => ({
    email: '',
    loading: false,
    sent: false,
  }),

  computed: {
    smtpConfigured(): boolean {
      return this.systemStatusStore.adapters.smtp.configured;
    },

    emailRules(): Array<(v: string) => true | string> {
      return [
        (v: string) => !!v || (this.$t('auth.login.emailRequired') as string),
        (v: string) =>
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ||
          (this.$t('auth.login.emailInvalid') as string),
      ];
    },
  },

  methods: {
    async onSubmit(): Promise<void> {
      this.loading = true;
      try {
        await api.post('/auth/magic-link/request', { email: this.email });
        this.sent = true;
      } catch (e) {
        if (e instanceof HttpError) {
          this.notify.error(e.userMessage);
        }
      } finally {
        this.loading = false;
      }
    },

    onReset(): void {
      this.sent = false;
      this.email = '';
    },
  },
});
</script>
