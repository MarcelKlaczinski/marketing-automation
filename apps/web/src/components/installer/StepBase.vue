<template>
  <div>
    <p class="sb-desc">{{ description }}</p>

    <!-- Mode note -->
    <div v-if="modeNote" class="sb-alert sb-alert--info">
      <q-icon name="info" size="14px" class="sb-alert__icon" />
      <span>{{ modeNote }}</span>
    </div>

    <!-- Verify success -->
    <div v-if="status.verified === true" class="sb-alert sb-alert--success">
      <q-icon name="check_circle" size="14px" class="sb-alert__icon" />
      <div>
        <div>{{ $t('installer.verify.success') }}</div>
        <div v-if="status.lastVerifiedAt" class="sb-alert__sub">
          {{ formatDate(status.lastVerifiedAt) }}
        </div>
      </div>
    </div>

    <!-- Verify failure -->
    <div v-if="status.verified === false" class="sb-alert sb-alert--error">
      <q-icon name="error" size="14px" class="sb-alert__icon" />
      <span>{{ $t('installer.verify.failure', { message: lastVerifyMessage }) }}</span>
    </div>

    <q-form @submit.prevent="onSave" class="sb-form">
      <slot />

      <!-- Primary actions: Save + Verify -->
      <div class="sb-actions">
        <q-btn
          type="submit"
          unelevated
          no-caps
          :label="status.configured ? $t('installer.save.update') : $t('installer.save.save')"
          :loading="saving"
          class="sb-btn-save"
        />
        <q-btn
          v-if="status.configured"
          outline
          no-caps
          :label="verifying ? $t('installer.verify.inProgress') : $t('installer.verify.button')"
          :loading="verifying"
          class="sb-btn-verify"
          @click.prevent="onVerify"
        />
      </div>

      <!-- Skip link — visually separate and muted -->
      <button type="button" class="sb-skip-link" @click="onSkipClick">
        {{ $t('installer.skip') }}
      </button>
    </q-form>

    <!-- Skip dialog -->
    <q-dialog v-model="skipDialogOpen">
      <q-card style="min-width: 340px; max-width: 460px">
        <q-card-section class="q-pb-none">
          <div class="text-subtitle1 text-weight-semibold">
            {{ $t('installer.skipDialog.title') }}
          </div>
        </q-card-section>
        <q-card-section>
          <p class="text-body2 q-mb-sm">{{ $t('installer.skipDialog.intro') }}</p>
          <div class="sb-consequence">{{ consequenceIfSkipped }}</div>
        </q-card-section>
        <q-card-actions align="right" class="q-pt-none q-pb-md q-px-md">
          <q-btn flat no-caps :label="$t('installer.skipDialog.cancel')" v-close-popup />
          <q-btn
            unelevated
            no-caps
            color="negative"
            :label="$t('installer.skipDialog.confirm')"
            @click="confirmSkip"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import { api } from 'src/lib/api-client';
import { useNotify } from 'src/composables/useNotify';
import { HttpError } from 'src/lib/http-error';

export interface AdapterStatus {
  configured: boolean;
  verified: boolean | null;
  lastVerifiedAt: string | null;
}

export default defineComponent({
  name: 'StepBase',

  props: {
    service: { type: String, required: true },
    description: { type: String, required: true },
    consequenceIfSkipped: { type: String, required: true },
    modeNote: { type: String, default: '' },
    status: { type: Object as PropType<AdapterStatus>, required: true },
    fields: { type: Array as PropType<{ key: string; value: string }[]>, required: true },
  },

  emits: ['configured', 'skipped', 'verify-result'],

  setup() {
    return { notify: useNotify() };
  },

  data: () => ({
    saving: false,
    verifying: false,
    skipDialogOpen: false,
    lastVerifyMessage: '',
  }),

  methods: {
    async onSave(): Promise<void> {
      this.saving = true;
      try {
        for (const field of this.fields) {
          if (!field.value) continue;
          await api.post('/system/credentials', {
            service: this.service,
            key: field.key,
            value: field.value,
          });
        }
        this.notify.success(this.$t('installer.save.saved') as string);
        this.$emit('configured');
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      } finally {
        this.saving = false;
      }
    },

    async onVerify(): Promise<void> {
      this.verifying = true;
      try {
        const res = await api.post<{ ok: boolean; data: { ok: boolean; message: string } }>(
          `/system/verify/${this.service}`,
        );
        const result = res.data.data;
        this.lastVerifyMessage = result.message;
        if (result.ok) {
          this.notify.success(this.$t('installer.verify.success') as string);
        } else {
          this.notify.error(
            this.$t('installer.verify.failure', { message: result.message }) as string,
          );
        }
        this.$emit('verify-result', result);
      } catch (e) {
        if (e instanceof HttpError) {
          this.lastVerifyMessage = e.userMessage;
          this.notify.error(e.userMessage);
        }
      } finally {
        this.verifying = false;
      }
    },

    onSkipClick(): void {
      this.skipDialogOpen = true;
    },

    confirmSkip(): void {
      this.skipDialogOpen = false;
      this.$emit('skipped');
    },

    formatDate(iso: string): string {
      return new Date(iso).toLocaleString(this.$i18n.locale === 'de' ? 'de-DE' : 'en-US');
    },
  },
});
</script>

<style lang="scss" scoped>
.sb-desc {
  font-size: 14px;
  color: #52525b;
  line-height: 1.65;
  margin: 0 0 20px;
}

/* ── Alert boxes ────────────────────────────────────────────────── */
.sb-alert {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 11px 13px;
  border-radius: 7px;
  font-size: 13px;
  line-height: 1.5;
  margin-bottom: 16px;

  &__icon { flex-shrink: 0; margin-top: 1px; }
  &__sub { font-size: 12px; opacity: 0.75; margin-top: 2px; }

  &--success {
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    border-left: 3px solid #16a34a;
    color: #15803d;
  }

  &--error {
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-left: 3px solid #dc2626;
    color: #b91c1c;
  }

  &--info {
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-left: 3px solid #3b82f6;
    color: #1d4ed8;
  }
}

/* ── Form ───────────────────────────────────────────────────────── */
.sb-form {
  margin-top: 4px;
}

/* ── Primary actions ────────────────────────────────────────────── */
.sb-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 22px;
}

.sb-btn-save {
  background: #4f46e5 !important;
  color: #fff !important;
  font-size: 13px;
  font-weight: 500;
  padding: 7px 16px;
  border-radius: 7px;
}

.sb-btn-verify {
  font-size: 13px;
  font-weight: 400;
  padding: 7px 16px;
  border-radius: 7px;
  border-color: #c7d2fe !important;
  color: #4f46e5 !important;
}

/* ── Skip link ──────────────────────────────────────────────────── */
.sb-skip-link {
  display: block;
  background: none;
  border: none;
  padding: 0;
  margin-top: 14px;
  font-size: 12px;
  color: #a1a1aa;
  cursor: pointer;
  text-align: left;
  transition: color 0.1s;

  &:hover { color: #71717a; text-decoration: underline; }
}

/* ── Skip dialog consequence box ────────────────────────────────── */
.sb-consequence {
  padding: 10px 12px;
  background: #fafafa;
  border: 1px solid #e4e4e7;
  border-radius: 6px;
  font-size: 13px;
  color: #52525b;
  line-height: 1.55;
}
</style>
