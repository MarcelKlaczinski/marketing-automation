<template>
  <div class="notifications-panel">
    <h3 class="text-h6">{{ $t('settings.notifications.title') }}</h3>
    <p class="text-body2 q-mb-md">{{ $t('settings.notifications.intro') }}</p>

    <q-card flat bordered class="q-mb-lg">
      <q-card-section>
        <div v-if="!supported">
          <q-icon name="block" color="grey" size="24px" />
          <div class="text-body2 q-mt-sm">{{ $t('settings.notifications.unsupported') }}</div>
        </div>

        <div v-else>
          <div class="row items-center">
            <q-icon
              :name="isSubscribed ? 'notifications_active' : 'notifications_off'"
              :color="isSubscribed ? 'positive' : 'grey'"
              size="24px"
            />
            <div class="q-ml-md">
              <div class="text-body2">
                {{ isSubscribed ? $t('settings.notifications.enabled') : $t('settings.notifications.disabled') }}
              </div>
              <div v-if="permission === 'denied'" class="text-caption text-negative">
                {{ $t('settings.notifications.permissionDenied') }}
              </div>
            </div>

            <q-space />

            <q-btn
              v-if="!isSubscribed && permission !== 'denied'"
              color="primary"
              :label="$t('settings.notifications.enable') as string"
              :loading="loading"
              @click="onEnable"
            />
            <q-btn
              v-else-if="isSubscribed"
              outline
              :label="$t('settings.notifications.disable') as string"
              :loading="loading"
              @click="onDisable"
            />
          </div>

          <div v-if="isSubscribed" class="q-mt-md">
            <q-btn
              flat
              size="sm"
              icon="campaign"
              :label="$t('settings.notifications.sendTest') as string"
              @click="onSendTest"
            />
          </div>
        </div>
      </q-card-section>
    </q-card>

    <h4 class="text-subtitle1">{{ $t('settings.notifications.activeDevices') }}</h4>

    <q-list bordered separator>
      <q-item v-for="sub in subscriptions" :key="sub.id">
        <q-item-section avatar>
          <q-icon :name="deviceIcon(sub.userAgent)" size="24px" />
        </q-item-section>
        <q-item-section>
          <q-item-label>{{ deviceLabel(sub.userAgent) }}</q-item-label>
          <q-item-label caption>
            {{ $t('settings.notifications.subscribedAt', { time: formatTime(sub.createdAt) }) }}
            <span v-if="sub.lastUsedAt">
              · {{ $t('settings.notifications.lastUsed', { time: formatTime(sub.lastUsedAt) }) }}
            </span>
          </q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-btn flat dense icon="delete" color="negative" @click="onDelete(sub.id)">
            <q-tooltip>{{ $t('settings.notifications.revoke') }}</q-tooltip>
          </q-btn>
        </q-item-section>
      </q-item>

      <q-item v-if="subscriptions.length === 0">
        <q-item-section class="text-grey-7 text-center q-pa-md">
          {{ $t('settings.notifications.noDevices') }}
        </q-item-section>
      </q-item>
    </q-list>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { usePushSubscription } from 'src/composables/usePushSubscription';
import { useNotify } from 'src/composables/useNotify';

export default defineComponent({
  name: 'NotificationsPanel',

  setup() {
    return { ...usePushSubscription(), notify: useNotify() };
  },

  methods: {
    deviceIcon(ua: string | null): string {
      if (!ua) return 'devices';
      if (/iPhone|iPad/.test(ua)) return 'phone_iphone';
      if (/Android/.test(ua)) return 'phone_android';
      if (/Mac/.test(ua)) return 'laptop_mac';
      if (/Windows/.test(ua)) return 'laptop_windows';
      return 'computer';
    },
    deviceLabel(ua: string | null): string {
      if (!ua) return this.$t('settings.notifications.unknownDevice') as string;
      let browser = 'Browser';
      if (/Edg\//.test(ua)) browser = 'Edge';
      else if (/Chrome\//.test(ua)) browser = 'Chrome';
      else if (/Firefox\//.test(ua)) browser = 'Firefox';
      else if (/Safari\//.test(ua)) browser = 'Safari';

      let os = '';
      if (/iPhone|iPad/.test(ua)) os = ' on iOS';
      else if (/Android/.test(ua)) os = ' on Android';
      else if (/Mac OS/.test(ua)) os = ' on macOS';
      else if (/Windows/.test(ua)) os = ' on Windows';
      else if (/Linux/.test(ua)) os = ' on Linux';

      return `${browser}${os}`;
    },
    formatTime(iso: string): string {
      const locale = this.$i18n.locale === 'de' ? 'de-DE' : 'en-US';
      return new Date(iso).toLocaleString(locale);
    },
    async onEnable(): Promise<void> {
      await this.subscribe();
      if (this.error === 'permission_denied') {
        this.notify.warn(this.$t('settings.notifications.permissionDeniedToast') as string);
      } else if (this.error) {
        this.notify.error(this.error);
      } else {
        this.notify.success(this.$t('settings.notifications.enabledSuccess') as string);
      }
    },
    async onDisable(): Promise<void> {
      await this.unsubscribeCurrent();
      this.notify.success(this.$t('settings.notifications.disabledSuccess') as string);
    },
    async onDelete(id: string): Promise<void> {
      await this.deleteSubscription(id);
      this.notify.success(this.$t('settings.notifications.deviceRevoked') as string);
    },
    async onSendTest(): Promise<void> {
      await this.sendTest();
      this.notify.info(this.$t('settings.notifications.testSent') as string);
    },
  },
});
</script>

<style lang="scss" scoped>
.notifications-panel {
  max-width: 720px;
}
</style>
