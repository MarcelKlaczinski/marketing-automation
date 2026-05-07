<template>
  <q-banner v-if="pauseInfo" class="bg-negative text-white q-mb-md">
    <template #avatar>
      <q-icon name="pause_circle" size="32px" />
    </template>
    <div class="text-subtitle1 text-weight-bold">{{ $t('projectPause.title') }}</div>
    <div class="text-body2 q-mt-xs">
      {{ $t('projectPause.reason', { reason: $t(`projectPause.reasons.${pauseInfo.reason}`) }) }}
      <span v-if="pauseInfo.service"> ({{ $t(`cost.services.${pauseInfo.service}`) }})</span>
    </div>
    <div class="text-caption q-mt-xs opacity-75">
      {{ $t('projectPause.pausedAt', { time: formatTime(pauseInfo.pausedAt) }) }}
    </div>
    <template #action>
      <q-btn
        flat
        color="white"
        :label="$t('projectPause.resume') as string"
        :loading="resuming"
        @click="onResume"
      />
    </template>
  </q-banner>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useProjectPauseState } from 'src/composables/useProjectPauseState';
import { useNotify } from 'src/composables/useNotify';
import { HttpError } from 'src/lib/http-error';

export default defineComponent({
  name: 'ProjectPauseBanner',

  props: {
    slug: { type: String, required: true },
  },

  setup(props) {
    const { pauseInfo, resume } = useProjectPauseState(props.slug);
    return { pauseInfo, resume, notify: useNotify() };
  },

  data: () => ({
    resuming: false,
  }),

  methods: {
    formatTime(iso: string): string {
      const locale = this.$i18n.locale === 'de' ? 'de-DE' : 'en-US';
      return new Date(iso).toLocaleString(locale);
    },

    async onResume(): Promise<void> {
      this.resuming = true;
      try {
        await this.resume();
        this.notify.success(this.$t('projectPause.resumeSuccess') as string);
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      } finally {
        this.resuming = false;
      }
    },
  },
});
</script>
