<template>
  <div class="vendor-rss-editor">
    <h4 class="section-title">{{ $t("settings.signalSources.sources.vendor_rss.title") as string }}</h4>

    <!-- Spec 64.19 / Phase C: per-project staleness override. Empty defaults to 14. -->
    <div class="max-age-row">
      <FormField
        :label="$t('settings.signalSources.sources.vendor_rss.maxAgeDays') as string"
        :hint="$t('settings.signalSources.sources.vendor_rss.maxAgeDaysHint') as string"
      >
        <FormInput
          :model-value="localMaxAgeDays"
          type="number"
          inputmode="numeric"
          :disabled="savingMaxAge"
          @update:model-value="(v: string) => { localMaxAgeDays = v; }"
        />
      </FormField>
      <GlassButton
        variant="ghost"
        size="sm"
        :disabled="!maxAgeDirty || savingMaxAge"
        :loading="savingMaxAge"
        @click="onSaveMaxAge"
      >
        {{ $t("common.save") as string }}
      </GlassButton>
    </div>

    <div class="add-feed-form">
      <FormField :label="$t('settings.signalSources.sources.vendor_rss.urlField') as string">
        <FormInput
          :model-value="newFeedUrl"
          :placeholder="$t('settings.signalSources.sources.vendor_rss.urlPlaceholder') as string"
          :disabled="adding"
          @update:model-value="(v: string) => { newFeedUrl = v; }"
        />
      </FormField>
      <FormField :label="$t('settings.signalSources.sources.vendor_rss.labelField') as string">
        <FormInput
          :model-value="newFeedLabel"
          :placeholder="$t('settings.signalSources.sources.vendor_rss.labelPlaceholder') as string"
          :disabled="adding"
          @update:model-value="(v: string) => { newFeedLabel = v; }"
          @keydown.enter.prevent="onAdd"
        />
      </FormField>
      <GlassButton
        variant="primary"
        size="sm"
        :disabled="!canAdd"
        :loading="adding"
        @click="onAdd"
      >
        {{ $t("settings.signalSources.sources.vendor_rss.addFeed") as string }}
      </GlassButton>
    </div>

    <div class="feeds-list">
      <div v-if="!feeds.length" class="empty-state">
        <p class="empty-title">{{ $t("settings.signalSources.sources.vendor_rss.empty.title") as string }}</p>
        <p class="empty-description">{{ $t("settings.signalSources.sources.vendor_rss.empty.description") as string }}</p>
      </div>

      <template v-else>
        <FeedRow
          v-for="feed in feeds"
          :key="feed.id"
          :feed="feed"
          @rename="onRename"
          @toggle="onToggle"
          @remove="onRemove"
        />
      </template>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import GlassButton from "src/components/ui/GlassButton.vue";
import FormField from "src/components/forms/FormField.vue";
import FormInput from "src/components/forms/FormInput.vue";
import FeedRow, { type VendorFeed } from "./FeedRow.vue";
import { apiPost, apiPatch, apiDelete } from "src/lib/api";

interface VendorRssConfigRaw {
  enabled?: boolean;
  feeds?: VendorFeed[];
  // Spec 64.19 / Phase C
  maxAgeDays?: number;
}

export default defineComponent({
  name: "VendorRssConfigEditor",

  components: { GlassButton, FormField, FormInput, FeedRow },

  emits: ["saved"],

  props: {
    config: { type: Object as PropType<VendorRssConfigRaw | null>, default: null },
    projectSlug: { type: String, required: true },
  },

  data() {
    return {
      newFeedUrl: "",
      newFeedLabel: "",
      adding: false,
      // Spec 64.19 / Phase C — local-edit state for the staleness override.
      localMaxAgeDays: String(this.config?.maxAgeDays ?? 14),
      savingMaxAge: false,
    };
  },

  computed: {
    feeds(): VendorFeed[] {
      return this.config?.feeds ?? [];
    },

    canAdd(): boolean {
      if (!this.newFeedLabel.trim() || this.adding) return false;
      try {
        new URL(this.newFeedUrl);
        return true;
      } catch {
        return false;
      }
    },

    // Spec 64.19 / Phase C — dirty-state for the staleness override.
    maxAgeDirty(): boolean {
      const upstream = String(this.config?.maxAgeDays ?? 14);
      return this.localMaxAgeDays !== upstream;
    },
  },

  watch: {
    // Reset local edit when upstream config refreshes (after save / external change).
    config: {
      handler(next: VendorRssConfigRaw | null): void {
        if (!this.savingMaxAge) {
          this.localMaxAgeDays = String(next?.maxAgeDays ?? 14);
        }
      },
      deep: true,
    },
  },

  methods: {
    // Spec 64.19 / Phase C — PATCH the source-level config (vendor_rss.maxAgeDays).
    async onSaveMaxAge() {
      const parsed = parseInt(this.localMaxAgeDays, 10);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 365) {
        this.$q.notify({
          type: "negative",
          message: this.$t("settings.signalSources.sources.vendor_rss.maxAgeDaysInvalid") as string,
        });
        return;
      }
      this.savingMaxAge = true;
      try {
        await apiPatch(`/projects/${this.projectSlug}/signal-sources/vendor_rss`, {
          maxAgeDays: parsed,
        });
        this.$q.notify({
          type: "positive",
          message: this.$t("common.saved") as string,
        });
        this.$emit("saved");
      } catch {
        this.$q.notify({
          type: "negative",
          message: this.$t("settings.signalSources.sources.vendor_rss.addError") as string,
        });
      } finally {
        this.savingMaxAge = false;
      }
    },

    async onAdd() {
      if (!this.canAdd) return;
      this.adding = true;
      try {
        await apiPost(`/projects/${this.projectSlug}/signal-sources/vendor-rss/feeds`, {
          url: this.newFeedUrl,
          label: this.newFeedLabel,
        });
        this.newFeedUrl = "";
        this.newFeedLabel = "";
        this.$q.notify({
          type: "positive",
          message: this.$t("settings.signalSources.sources.vendor_rss.feedAdded") as string,
        });
        this.$emit("saved");
      } catch (err: unknown) {
        const body = (err as { body?: { error?: string; message?: string } })?.body;
        let message = this.$t("settings.signalSources.sources.vendor_rss.addError") as string;
        if (body?.error === "feed_already_exists") {
          message = this.$t("settings.signalSources.sources.vendor_rss.duplicateFeed") as string;
        } else if (body?.error === "feed_verification_failed") {
          message = this.$t("settings.signalSources.sources.vendor_rss.verifyFailed", {
            details: body.message ?? "",
          }) as string;
        }
        this.$q.notify({ type: "negative", message });
      } finally {
        this.adding = false;
      }
    },

    async onRename({ feedId, label }: { feedId: string; label: string }) {
      try {
        await apiPatch(`/projects/${this.projectSlug}/signal-sources/vendor-rss/feeds/${feedId}`, { label });
        this.$emit("saved");
      } catch {
        this.$q.notify({ type: "negative", message: this.$t("settings.signalSources.sources.vendor_rss.addError") as string });
      }
    },

    async onToggle({ feedId, enabled }: { feedId: string; enabled: boolean }) {
      try {
        await apiPatch(`/projects/${this.projectSlug}/signal-sources/vendor-rss/feeds/${feedId}`, { enabled });
        this.$emit("saved");
      } catch {
        this.$q.notify({ type: "negative", message: this.$t("settings.signalSources.sources.vendor_rss.addError") as string });
      }
    },

    async onRemove(feedId: string) {
      this.$q.dialog({
        title: this.$t("settings.signalSources.sources.vendor_rss.confirmRemove.title") as string,
        message: this.$t("settings.signalSources.sources.vendor_rss.confirmRemove.message") as string,
        cancel: true,
        persistent: true,
      }).onOk(async () => {
        try {
          await apiDelete(`/projects/${this.projectSlug}/signal-sources/vendor-rss/feeds/${feedId}`);
          this.$q.notify({
            type: "positive",
            message: this.$t("settings.signalSources.sources.vendor_rss.feedRemoved") as string,
          });
          this.$emit("saved");
        } catch {
          this.$q.notify({ type: "negative", message: this.$t("settings.signalSources.sources.vendor_rss.addError") as string });
        }
      });
    },
  },
});
</script>

<style scoped>
.vendor-rss-editor {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.max-age-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  align-items: end;
}

.add-feed-form {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 10px;
  align-items: end;
}

@media (max-width: 639px) {
  .add-feed-form {
    grid-template-columns: 1fr;
  }
}

.feeds-list {
  display: flex;
  flex-direction: column;
}

.empty-state {
  padding: 20px 0;
  text-align: center;
}

.empty-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  margin: 0 0 4px;
}

.empty-description {
  font-size: 12px;
  color: var(--text-tertiary);
  margin: 0;
}
</style>
