<template>
  <GlassCard variant="strong" class="signal-source-card">
    <header class="source-header">
      <div class="source-titles">
        <h3 class="source-name">{{ $t(`settings.signalSources.sources.${sourceId}.name`) as string }}</h3>
        <p class="source-description">{{ $t(`settings.signalSources.sources.${sourceId}.description`) as string }}</p>
      </div>
      <div class="source-badges">
        <StatusBadge :variant="credentialsBadgeVariant" :label="credentialsBadgeLabel" />
        <StatusBadge
          :variant="isEnabled ? 'completed' : 'idle'"
          :label="$t(isEnabled ? 'settings.signalSources.enabled' : 'settings.signalSources.disabled') as string"
        />
        <StatusBadge
          v-if="cronActive"
          variant="running"
          :label="$t('settings.signalSources.cronActive') as string"
        />
      </div>
    </header>

    <div v-if="credentialsStatus === 'not-configured'" class="credentials-warning glass-card-subtle">
      <p class="credentials-warning-text">{{ $t("settings.signalSources.credentialsRequired") as string }}</p>
      <router-link :to="`/projects/${projectSlug}/settings/credentials`" class="credentials-link">
        {{ $t("settings.signalSources.goToCredentials") as string }} →
      </router-link>
    </div>

    <div class="source-config">
      <component
        :is="configEditorComponent"
        v-if="configEditorComponent"
        :config="configAsObject"
        :project-slug="projectSlug"
        @saved="$emit('config-saved')"
      />
    </div>

    <footer class="source-actions">
      <div class="left-actions">
        <label class="toggle-label">
          <input
            type="checkbox"
            class="toggle-checkbox"
            :checked="isEnabled"
            @change="onToggleEnabled"
          />
          <span class="toggle-text">{{ $t("settings.signalSources.enableSource") as string }}</span>
        </label>
        <label class="toggle-label" :class="{ 'toggle-disabled': !isEnabled }">
          <input
            type="checkbox"
            class="toggle-checkbox"
            :checked="cronActive"
            :disabled="!isEnabled"
            @change="onToggleCron"
          />
          <span class="toggle-text">{{ $t("settings.signalSources.enableCron") as string }}</span>
        </label>
      </div>
      <div class="right-actions">
        <GlassButton
          v-if="!requiresCredentials || credentialsStatus === 'configured'"
          variant="ghost"
          size="sm"
          :loading="verifying"
          @click="$emit('verify', sourceId)"
        >
          {{ $t("settings.signalSources.verify") as string }}
        </GlassButton>
        <GlassButton
          variant="ghost"
          size="sm"
          :disabled="!isEnabled"
          :loading="triggering"
          @click="$emit('manual-trigger', sourceId)"
        >
          {{ $t("settings.signalSources.triggerNow") as string }}
        </GlassButton>
      </div>
    </footer>
  </GlassCard>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import GlassCard from "src/components/ui/GlassCard.vue";
import GlassButton from "src/components/ui/GlassButton.vue";
import StatusBadge from "src/components/ui/StatusBadge.vue";
import RedditConfigEditor from "./signal-sources/RedditConfigEditor.vue";
import GitHubConfigEditor from "./signal-sources/GitHubConfigEditor.vue";
import HackerNewsConfigEditor from "./signal-sources/HackerNewsConfigEditor.vue";
import ProductHuntConfigEditor from "./signal-sources/ProductHuntConfigEditor.vue";
import VendorRssConfigEditor from "./signal-sources/VendorRssConfigEditor.vue";

type CredentialsStatus = "configured" | "not-configured" | "error" | "publicApi";

export default defineComponent({
  name: "SignalSourceCard",

  components: {
    GlassCard,
    GlassButton,
    StatusBadge,
    RedditConfigEditor,
    GitHubConfigEditor,
    HackerNewsConfigEditor,
    ProductHuntConfigEditor,
    VendorRssConfigEditor,
  },

  emits: ["toggle-enabled", "toggle-cron", "verify", "manual-trigger", "config-saved"],

  props: {
    sourceId: { type: String, required: true },
    requiresCredentials: { type: Boolean, default: true },
    credentialsStatus: {
      type: String as PropType<CredentialsStatus>,
      default: "not-configured",
    },
    config: { type: [Object, Boolean] as PropType<{ enabled?: boolean } | boolean | null>, default: null },
    cronActive: { type: Boolean, default: false },
    projectSlug: { type: String, required: true },
    verifying: { type: Boolean, default: false },
    triggering: { type: Boolean, default: false },
  },

  computed: {
    isEnabled(): boolean {
      if (this.config === null) return false;
      if (typeof this.config === "boolean") return this.config;
      return this.config?.enabled ?? false;
    },

    configEditorComponent(): string | null {
      const map: Record<string, string> = {
        reddit: "RedditConfigEditor",
        github: "GitHubConfigEditor",
        hackernews: "HackerNewsConfigEditor",
        producthunt: "ProductHuntConfigEditor",
        vendor_rss: "VendorRssConfigEditor",
      };
      return map[this.sourceId] ?? null;
    },

    configAsObject(): Record<string, unknown> | null {
      if (this.config === null) return null;
      if (typeof this.config === "boolean") return null;
      return this.config as Record<string, unknown>;
    },

    credentialsBadgeVariant(): "completed" | "failed" | "idle" | "pending" {
      if (this.credentialsStatus === "configured") return "completed";
      if (this.credentialsStatus === "error") return "failed";
      if (this.credentialsStatus === "publicApi") return "pending";
      return "idle";
    },

    credentialsBadgeLabel(): string {
      const key = this.credentialsStatus === "publicApi"
        ? "settings.signalSources.credentialsStatus.publicApi"
        : `settings.signalSources.credentialsStatus.${this.credentialsStatus}`;
      return this.$t(key) as string;
    },
  },

  methods: {
    onToggleEnabled(event: Event) {
      const enabled = (event.target as HTMLInputElement).checked;
      this.$emit("toggle-enabled", { sourceId: this.sourceId, enabled });
    },

    onToggleCron(event: Event) {
      const active = (event.target as HTMLInputElement).checked;
      this.$emit("toggle-cron", { sourceId: this.sourceId, active });
    },
  },
});
</script>

<style scoped>
.signal-source-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
}

.source-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.source-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 4px;
}

.source-description {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0;
}

.source-badges {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.credentials-warning {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 8px;
  flex-wrap: wrap;
}

.credentials-warning-text {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0;
  flex: 1;
}

.credentials-link {
  font-size: 12px;
  color: var(--brand, #6366f1);
  text-decoration: none;
  white-space: nowrap;
}

.source-config:not(:empty) {
  padding-top: 4px;
}

.source-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding-top: 4px;
  border-top: 1px solid var(--border-subtle);
}

.left-actions {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.right-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
}

.toggle-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.toggle-checkbox {
  width: 16px;
  height: 16px;
  accent-color: var(--brand, #6366f1);
  cursor: inherit;
}

.toggle-text {
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
