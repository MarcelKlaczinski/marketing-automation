<template>
  <div>
    <p class="text-body2 q-mb-lg">{{ $t('settings.profile.intro') }}</p>

    <div class="profile-grid">
      <div class="system-card">
        <div class="system-card__label">{{ $t('settings.profile.email') }}</div>
        <div class="system-card__value">{{ authStore.user?.email || '—' }}</div>
      </div>

      <div class="system-card">
        <div class="system-card__label">{{ $t('settings.profile.userId') }}</div>
        <div class="system-card__value text-caption" style="font-family: monospace; font-size: 14px;">
          {{ authStore.user?.id || '—' }}
        </div>
      </div>
    </div>

    <div class="q-mt-xl">
      <q-btn
        outline
        color="negative"
        :label="$t('app.logout') as string"
        icon="logout"
        @click="onLogout"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { useAuthStore } from "src/stores/auth";
import { defineComponent } from "vue";

export default defineComponent({
  name: "SettingsProfilePanel",

  setup() {
    return { authStore: useAuthStore() };
  },

  methods: {
    async onLogout(): Promise<void> {
      await this.authStore.logout();
      void this.$router.push({ name: "login" });
    },
  },
});
</script>

<style lang="scss" scoped>
.profile-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;

  @media (min-width: 768px) {
    grid-template-columns: repeat(2, 1fr);
  }
}

.system-card {
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 8px;
  padding: 16px;
  background: var(--q-card-bg, #fff);

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }
}

.system-card__label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  margin-bottom: 8px;

  body.body--dark & {
    color: rgba(255, 255, 255, 0.55);
  }
}

.system-card__value {
  font-size: 18px;
  font-weight: 500;
}
</style>
