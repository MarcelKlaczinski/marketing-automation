<template>
  <div class="feed-row" :class="{ 'feed-disabled': !feed.enabled }">
    <div class="feed-info">
      <div v-if="!editing" class="feed-label" @click="startEdit">
        {{ feed.label }}
      </div>
      <FormInput
        v-else
        ref="labelInput"
        :model-value="editingLabel"
        class="label-input"
        @update:model-value="(v: string) => { editingLabel = v; }"
        @blur="saveEdit"
        @keydown.enter.prevent="saveEdit"
        @keydown.escape="cancelEdit"
      />
      <a :href="feed.url" target="_blank" rel="noopener noreferrer" class="feed-url mono">
        {{ feed.url }}
      </a>
      <span class="feed-meta mono">
        {{ $t("settings.signalSources.sources.vendor_rss.added", { date: formatDate(feed.addedAt) }) as string }}
      </span>
    </div>

    <div class="feed-actions">
      <label class="toggle-label">
        <input
          type="checkbox"
          class="toggle-checkbox"
          :checked="feed.enabled"
          @change="onToggle"
        />
      </label>
      <GlassButton
        variant="danger"
        size="sm"
        @click="$emit('remove', feed.id)"
      >
        {{ $t("common.remove") as string }}
      </GlassButton>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, nextTick, type PropType } from "vue";
import GlassButton from "src/components/ui/GlassButton.vue";
import FormInput from "src/components/forms/FormInput.vue";

export interface VendorFeed {
  id: string;
  url: string;
  label: string;
  enabled: boolean;
  addedAt: string;
  lastVerifiedAt: string | null;
}

export default defineComponent({
  name: "FeedRow",

  components: { GlassButton, FormInput },

  emits: ["rename", "toggle", "remove"],

  props: {
    feed: { type: Object as PropType<VendorFeed>, required: true },
  },

  data() {
    return {
      editing: false,
      editingLabel: this.feed.label,
    };
  },

  methods: {
    async startEdit() {
      this.editing = true;
      this.editingLabel = this.feed.label;
      await nextTick();
      const inputEl = this.$refs.labelInput as { $el?: HTMLInputElement } | undefined;
      inputEl?.$el?.focus();
    },

    saveEdit() {
      const trimmed = this.editingLabel.trim();
      if (trimmed && trimmed !== this.feed.label) {
        this.$emit("rename", { feedId: this.feed.id, label: trimmed });
      }
      this.editing = false;
    },

    cancelEdit() {
      this.editing = false;
      this.editingLabel = this.feed.label;
    },

    onToggle(event: Event) {
      const enabled = (event.target as HTMLInputElement).checked;
      this.$emit("toggle", { feedId: this.feed.id, enabled });
    },

    formatDate(iso: string): string {
      return new Date(iso).toLocaleDateString(
        this.$i18n.locale === "de" ? "de-DE" : "en-US",
        { year: "numeric", month: "short", day: "numeric" },
      );
    },
  },
});
</script>

<style scoped>
.feed-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-subtle);
  transition: opacity 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.feed-row:last-child {
  border-bottom: none;
}

.feed-disabled {
  opacity: 0.5;
}

.feed-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}

.feed-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  cursor: text;
  padding: 2px 4px;
  border-radius: 4px;
  transition: background 120ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

@media (hover: hover) and (pointer: fine) {
  .feed-label:hover {
    background: var(--bg-glass-strong);
  }
}

.label-input {
  font-size: 13px;
  width: 100%;
}

.feed-url {
  font-size: 11px;
  color: var(--text-tertiary);
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 320px;
}

@media (hover: hover) and (pointer: fine) {
  .feed-url:hover {
    color: var(--brand, #6366f1);
    text-decoration: underline;
  }
}

.feed-meta {
  font-size: 10px;
  color: var(--text-tertiary);
}

.mono {
  font-family: var(--font-mono);
}

.feed-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.toggle-label {
  cursor: pointer;
}

.toggle-checkbox {
  width: 16px;
  height: 16px;
  accent-color: var(--brand, #6366f1);
  cursor: pointer;
}
</style>
