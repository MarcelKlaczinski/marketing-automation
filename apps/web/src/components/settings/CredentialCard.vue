<template>
  <GlassCard variant="strong" class="credential-card">
    <header class="credential-header">
      <div class="credential-titles">
        <h3 class="credential-name">{{ adapter.name }}</h3>
        <StatusBadge :variant="statusBadgeVariant" :label="statusLabel" />
      </div>
      <div class="credential-header-actions">
        <GlassButton
          v-if="isConfigured"
          variant="ghost"
          size="sm"
          :loading="verifying"
          @click="onVerify"
        >
          {{ $t("settings.credentials.verify") as string }}
        </GlassButton>
        <GlassButton
          v-if="isConfigured"
          variant="danger"
          size="sm"
          :loading="removing"
          @click="onRemoveAll"
        >
          {{ $t("settings.credentials.remove") as string }}
        </GlassButton>
      </div>
    </header>

    <form class="credential-form" @submit.prevent="onSave">
      <FormField
        v-for="keySpec in adapter.keys"
        :key="keySpec.key"
        :label="$t(keySpec.labelKey) as string"
      >
        <FormInput
          :model-value="values[keySpec.key] ?? ''"
          type="password"
          :placeholder="isConfigured ? $t('settings.credentials.setBefore') as string : ''"
          autocomplete="new-password"
          @update:model-value="(v: string) => { values[keySpec.key] = v; }"
        />
      </FormField>

      <GlassButton
        type="submit"
        variant="primary"
        size="sm"
        :disabled="!isFormValid"
        :loading="saving"
      >
        {{ isConfigured ? $t("settings.credentials.update") as string : $t("settings.credentials.set") as string }}
      </GlassButton>
    </form>
  </GlassCard>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import type { PropType } from "vue";
import GlassCard from "src/components/ui/GlassCard.vue";
import GlassButton from "src/components/ui/GlassButton.vue";
import StatusBadge from "src/components/ui/StatusBadge.vue";
import FormField from "src/components/forms/FormField.vue";
import FormInput from "src/components/forms/FormInput.vue";
import { apiPost, apiDelete } from "src/lib/api";

interface KeySpec {
  key: string;
  labelKey: string;
}

interface AdapterDef {
  id: string;
  name: string;
  keys: KeySpec[];
}

interface AdapterStatusRow {
  configured: boolean;
  verified: boolean | null;
}

export default defineComponent({
  name: "CredentialCard",

  components: { GlassCard, GlassButton, StatusBadge, FormField, FormInput },

  props: {
    adapter: { type: Object as PropType<AdapterDef>, required: true },
    status: { type: Object as PropType<AdapterStatusRow | null>, default: null },
  },

  emits: ["refresh"],

  data() {
    const values: Record<string, string> = {};
    for (const k of this.adapter.keys) {
      values[k.key] = "";
    }
    return { values, saving: false, verifying: false, removing: false };
  },

  computed: {
    isConfigured(): boolean {
      return this.status?.configured ?? false;
    },

    statusBadgeVariant(): "completed" | "failed" | "idle" {
      if (!this.status?.configured) return "idle";
      if (this.status.verified === false) return "failed";
      return "completed";
    },

    statusLabel(): string {
      if (!this.status?.configured) return this.$t("settings.adapters.status.notConfigured") as string;
      if (this.status.verified === false) return this.$t("settings.adapters.status.configured") as string;
      return this.$t("settings.adapters.status.verified") as string;
    },

    isFormValid(): boolean {
      return this.adapter.keys.every((k) => (this.values[k.key] ?? "").trim().length > 0);
    },
  },

  methods: {
    async onSave(): Promise<void> {
      if (!this.isFormValid) return;
      this.saving = true;
      try {
        for (const keySpec of this.adapter.keys) {
          await apiPost("/system/credentials", {
            service: this.adapter.id,
            key: keySpec.key,
            value: this.values[keySpec.key],
          });
        }
        // Clear values after save — never leave secrets in component state
        for (const k of this.adapter.keys) {
          this.values[k.key] = "";
        }
        this.$q.notify({ type: "positive", message: this.$t("settings.credentials.savedSuccess") as string });
        this.$emit("refresh");
      } catch (err) {
        this.$q.notify({ type: "negative", message: String(err) });
      } finally {
        this.saving = false;
      }
    },

    async onVerify(): Promise<void> {
      this.verifying = true;
      try {
        const result = await apiPost<{ ok: boolean; message?: string }>(
          `/system/verify/${this.adapter.id}`,
        );
        if (result.ok) {
          this.$q.notify({ type: "positive", message: this.$t("settings.credentials.verifySuccess") as string });
        } else {
          this.$q.notify({ type: "negative", message: result.message ?? (this.$t("settings.credentials.verifyFailed") as string) });
        }
        this.$emit("refresh");
      } catch (err) {
        this.$q.notify({ type: "negative", message: String(err) });
      } finally {
        this.verifying = false;
      }
    },

    async onRemoveAll(): Promise<void> {
      this.removing = true;
      try {
        await apiDelete(`/system/credentials/${this.adapter.id}`);
        this.$emit("refresh");
      } catch (err) {
        this.$q.notify({ type: "negative", message: String(err) });
      } finally {
        this.removing = false;
      }
    },
  },
});
</script>

<style scoped>
.credential-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
}

.credential-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.credential-titles {
  display: flex;
  align-items: center;
  gap: 10px;
}

.credential-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.credential-header-actions {
  display: flex;
  gap: 8px;
}

.credential-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
</style>
