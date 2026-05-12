<template>
  <div class="adapter-card">
    <div class="adapter-card__header" @click="expanded = !expanded">
      <div class="adapter-card__icon">
        <q-icon :name="icon" size="24px" />
      </div>
      <div class="adapter-card__main">
        <div class="adapter-card__title">{{ title }}</div>
        <div class="adapter-card__caption">{{ description }}</div>
      </div>
      <div class="adapter-card__status">
        <span :class="statusClass">{{ statusLabel }}</span>
        <q-icon
          :name="expanded ? 'expand_less' : 'expand_more'"
          size="20px"
          class="q-ml-sm"
        />
      </div>
    </div>

    <div v-if="expanded" class="adapter-card__body">
      <component
        :is="stepComponent"
        @configured="onConfigured"
      />

      <div v-if="status.configured" class="adapter-card__danger-zone q-mt-lg">
        <q-btn
          flat
          color="negative"
          :label="$t('settings.adapters.disconnect')"
          icon="link_off"
          @click="confirmDisconnect"
        />
      </div>
    </div>

    <q-dialog v-model="disconnectDialogOpen">
      <q-card style="min-width: 320px;">
        <q-card-section>
          <div class="text-h6">{{ $t('settings.adapters.disconnectDialog.title') }}</div>
          <p class="q-mt-md">{{ $t('settings.adapters.disconnectDialog.description', { adapter: title }) }}</p>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat :label="$t('common.cancel')" v-close-popup />
          <q-btn
            flat
            color="negative"
            :label="$t('settings.adapters.disconnectDialog.confirm')"
            :loading="disconnecting"
            @click="doDisconnect"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script lang="ts">
import { useNotify } from "src/composables/useNotify";
import { api } from "src/lib/api-client";
import { HttpError } from "src/lib/http-error";
import { type Component, type PropType, defineComponent } from "vue";

interface AdapterStatus {
  configured: boolean;
  verified: boolean | null;
  lastVerifiedAt: string | null;
  missingKeys?: string[];
}

export default defineComponent({
  name: "SettingsAdapterCard",

  props: {
    service: { type: String, required: true },
    icon: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    status: { type: Object as PropType<AdapterStatus>, required: true },
    stepComponent: { type: [Object, Function] as PropType<Component>, required: true },
  },

  emits: ["configured", "disconnected"],

  setup() {
    return { notify: useNotify() };
  },

  data: () => ({
    expanded: false,
    disconnectDialogOpen: false,
    disconnecting: false,
  }),

  computed: {
    statusClass(): string {
      if (this.status.verified === true) return "status-pill status-pill--ok";
      if (this.status.configured) return "status-pill status-pill--warn";
      return "status-pill status-pill--off";
    },
    statusLabel(): string {
      if (this.status.verified === true)
        return this.$t("settings.adapters.status.verified") as string;
      if (this.status.configured) return this.$t("settings.adapters.status.configured") as string;
      return this.$t("settings.adapters.status.notConfigured") as string;
    },
  },

  methods: {
    onConfigured(): void {
      this.$emit("configured");
    },
    confirmDisconnect(): void {
      this.disconnectDialogOpen = true;
    },
    async doDisconnect(): Promise<void> {
      this.disconnecting = true;
      try {
        await api.delete(`/system/credentials/${this.service}`);
        this.notify.success(this.$t("settings.adapters.disconnectDialog.success") as string);
        this.disconnectDialogOpen = false;
        this.expanded = false;
        this.$emit("disconnected");
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      } finally {
        this.disconnecting = false;
      }
    },
  },
});
</script>

<style lang="scss" scoped>
.adapter-card {
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 8px;
  background: var(--q-card-bg, #fff);
  transition: box-shadow 0.15s;

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }
}

.adapter-card__header {
  display: flex;
  align-items: center;
  padding: 16px;
  cursor: pointer;
  user-select: none;

  &:hover {
    background: rgba(0, 0, 0, 0.02);

    body.body--dark & {
      background: rgba(255, 255, 255, 0.03);
    }
  }
}

.adapter-card__icon {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  background: rgba(63, 81, 181, 0.1);
  border-radius: 8px;
  color: #3f51b5;
}

.adapter-card__main {
  flex-grow: 1;
  margin-left: 12px;
  min-width: 0;
}

.adapter-card__title {
  font-weight: 500;
  font-size: 15px;
}

.adapter-card__caption {
  font-size: 13px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.6));
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  body.body--dark & {
    color: rgba(255, 255, 255, 0.6);
  }
}

.adapter-card__status {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  margin-left: 12px;
}

.status-pill {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 999px;
  font-weight: 500;
}

.status-pill--ok {
  background: rgba(33, 186, 69, 0.12);
  color: #21ba45;
}

.status-pill--warn {
  background: rgba(242, 192, 55, 0.18);
  color: #b07b00;
}

.status-pill--off {
  background: rgba(0, 0, 0, 0.06);
  color: rgba(0, 0, 0, 0.5);

  body.body--dark & {
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.55);
  }
}

.adapter-card__body {
  padding: 0 16px 16px;
  border-top: 1px solid var(--q-grey-2, #f0f0f0);

  body.body--dark & {
    border-top-color: rgba(255, 255, 255, 0.06);
  }
}

.adapter-card__danger-zone {
  border-top: 1px dashed var(--q-grey-3, #e0e0e0);
  padding-top: 12px;

  body.body--dark & {
    border-top-color: rgba(255, 255, 255, 0.1);
  }
}
</style>
