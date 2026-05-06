<template>
  <div>
    <div v-if="allRequiredReady" class="is-alert is-alert--success">
      <q-icon name="check_circle" size="15px" class="is-alert__icon" />
      <div>
        <div class="is-alert__title">{{ $t('installer.steps.summary.readyTitle') }}</div>
        <div class="is-alert__body">{{ $t('installer.steps.summary.readyDescription') }}</div>
      </div>
    </div>

    <div v-else class="is-alert is-alert--warn">
      <q-icon name="warning" size="15px" class="is-alert__icon" />
      <div>
        <div class="is-alert__title">{{ $t('installer.steps.summary.partialTitle') }}</div>
        <div class="is-alert__body">{{ $t('installer.steps.summary.partialDescription') }}</div>
      </div>
    </div>

    <div class="is-adapter-list">
      <div
        v-for="item in adapterItems"
        :key="item.key"
        class="is-adapter-row"
      >
        <div class="is-adapter-bullet" :class="`is-adapter-bullet--${item.state}`">
          <q-icon :name="item.icon" size="11px" />
        </div>
        <div>
          <div class="is-adapter-name">{{ item.label }}</div>
          <div class="is-adapter-caption">{{ item.description }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useSystemStatusStore, type AdapterStatus } from 'src/stores/system-status';

interface AdapterItem {
  key: string;
  label: string;
  icon: string;
  state: 'ok' | 'warn' | 'idle';
  description: string;
}

const ADAPTER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic API',
  replicate: 'Replicate',
  r2: 'Cloudflare R2',
  dataforseo: 'DataForSEO',
  smtp: 'E-Mail (SMTP)',
  githubApp: 'GitHub App',
};

export default defineComponent({
  name: 'InstallerSummary',

  setup() {
    return { systemStatusStore: useSystemStatusStore() };
  },

  computed: {
    allRequiredReady(): boolean {
      return this.systemStatusStore.adapters.anthropic.configured;
    },

    adapterItems(): AdapterItem[] {
      const adapters = this.systemStatusStore.adapters;
      return (Object.keys(adapters) as Array<keyof typeof adapters>).map((key) => {
        const a = adapters[key];
        return {
          key,
          label: ADAPTER_LABELS[key] ?? key,
          icon: this.getIcon(a),
          state: this.getState(a),
          description: this.getDescription(a),
        };
      });
    },
  },

  methods: {
    getIcon(a: AdapterStatus): string {
      if (a.verified === true) return 'check';
      if (a.configured) return 'radio_button_unchecked';
      return 'remove';
    },

    getState(a: AdapterStatus): 'ok' | 'warn' | 'idle' {
      if (a.verified === true) return 'ok';
      if (a.configured) return 'warn';
      return 'idle';
    },

    getDescription(a: AdapterStatus): string {
      if (a.verified === true) return this.$t('installer.adapters.verified') as string;
      if (a.configured) return this.$t('installer.adapters.configuredNotVerified') as string;
      return this.$t('installer.adapters.notConfigured') as string;
    },
  },
});
</script>

<style lang="scss" scoped>
/* ── Status alerts ──────────────────────────────────────────────── */
.is-alert {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px 16px;
  border-radius: 8px;
  margin-bottom: 24px;

  &__icon { flex-shrink: 0; margin-top: 2px; }

  &__title {
    font-size: 14px;
    font-weight: 600;
    line-height: 1.4;
  }

  &__body {
    font-size: 13px;
    line-height: 1.5;
    margin-top: 3px;
    opacity: 0.85;
  }

  &--success {
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    border-left: 3px solid #16a34a;
    color: #15803d;
  }

  &--warn {
    background: #fffbeb;
    border: 1px solid #fde68a;
    border-left: 3px solid #d97706;
    color: #92400e;
  }
}

/* ── Adapter list ───────────────────────────────────────────────── */
.is-adapter-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.is-adapter-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 7px;
  border: 1px solid #f4f4f5;
  background: #fafafa;
  transition: background 0.1s;

  &:hover { background: #f4f4f5; }
}

.is-adapter-bullet {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #fff;

  &--ok { background: #16a34a; }
  &--warn { background: #d97706; }
  &--idle { background: #d4d4d8; color: #71717a; }
}

.is-adapter-name {
  font-size: 13px;
  font-weight: 500;
  color: #18181b;
}

.is-adapter-caption {
  font-size: 12px;
  color: #71717a;
  margin-top: 1px;
}
</style>
