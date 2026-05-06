<template>
  <div>
    <p class="sc-desc">{{ $t('installer.steps.core.description') }}</p>

    <div class="sc-status-list">
      <div class="sc-status-row" :class="{ 'sc-status-row--ok': postgres.configured }">
        <div class="sc-status-bullet" :class="postgres.configured ? 'sc-status-bullet--ok' : 'sc-status-bullet--err'">
          <q-icon :name="postgres.configured ? 'check' : 'close'" size="11px" />
        </div>
        <div>
          <div class="sc-status-label">{{ $t('installer.steps.core.postgresLabel') }}</div>
          <div class="sc-status-caption">
            {{ postgres.configured ? $t('installer.status.verified') : $t('installer.status.pending') }}
          </div>
        </div>
      </div>

      <div class="sc-status-row" :class="{ 'sc-status-row--ok': redis.configured }">
        <div class="sc-status-bullet" :class="redis.configured ? 'sc-status-bullet--ok' : 'sc-status-bullet--err'">
          <q-icon :name="redis.configured ? 'check' : 'close'" size="11px" />
        </div>
        <div>
          <div class="sc-status-label">{{ $t('installer.steps.core.redisLabel') }}</div>
          <div class="sc-status-caption">
            {{ redis.configured ? $t('installer.status.verified') : $t('installer.status.pending') }}
          </div>
        </div>
      </div>
    </div>

    <div v-if="!postgres.configured || !redis.configured" class="sc-config-hint">
      <q-icon name="terminal" size="14px" class="sc-config-hint__icon" />
      <span>{{ $t('installer.steps.core.configHint') }}</span>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useSystemStatusStore } from 'src/stores/system-status';

interface InfraStatus {
  configured: boolean;
  verified: boolean | null;
  lastVerifiedAt: string | null;
}

export default defineComponent({
  name: 'StepCore',
  emits: ['configured', 'skipped'],
  setup() {
    return { systemStatusStore: useSystemStatusStore() };
  },
  computed: {
    postgres(): InfraStatus { return this.systemStatusStore.postgres; },
    redis(): InfraStatus { return this.systemStatusStore.redis; },
  },
});
</script>

<style lang="scss" scoped>
.sc-desc {
  font-size: 14px;
  color: #52525b;
  line-height: 1.65;
  margin: 0 0 20px;
}

.sc-status-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 16px;
}

.sc-status-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 8px;
  background: #fef2f2;
  border: 1px solid #fecaca;

  &--ok {
    background: #f0fdf4;
    border-color: #bbf7d0;
  }
}

.sc-status-bullet {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #fca5a5;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  &--ok { background: #16a34a; }
  &--err { background: #dc2626; }
}

.sc-status-label {
  font-size: 13px;
  font-weight: 500;
  color: #18181b;
}

.sc-status-caption {
  font-size: 12px;
  color: #71717a;
  margin-top: 1px;
}

.sc-config-hint {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 11px 13px;
  font-size: 13px;
  color: #52525b;
  background: #fafafa;
  border: 1px solid #e4e4e7;
  border-radius: 7px;
  line-height: 1.5;

  &__icon { flex-shrink: 0; margin-top: 1px; }
}
</style>
