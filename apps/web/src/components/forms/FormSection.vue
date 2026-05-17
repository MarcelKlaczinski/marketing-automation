<template>
  <div class="form-section">
    <header class="form-section-header">
      <div class="form-section-titles">
        <h2 class="form-section-title">{{ title }}</h2>
        <p v-if="description" class="form-section-description">{{ description }}</p>
      </div>
      <div v-if="$slots['header-actions']" class="form-section-actions">
        <slot name="header-actions" />
      </div>
    </header>

    <div class="form-section-body">
      <slot />
    </div>

    <footer v-if="dirty || saving || lastSavedAt" class="form-section-footer">
      <div class="footer-status">
        <span v-if="dirty && !saving" class="status-dirty mono">
          ● {{ $t("forms.unsavedChanges") }}
        </span>
        <span v-if="saving" class="status-saving mono">
          {{ $t("forms.saving") }}
        </span>
        <span v-if="lastSavedAt && !dirty && !saving" class="status-saved mono">
          {{ $t("forms.savedAt", { time: relativeSavedAt }) }}
        </span>
      </div>

      <div class="footer-actions">
        <GlassButton
          v-if="dirty && !saving"
          variant="ghost"
          @click="$emit('cancel')"
        >
          {{ $t("common.cancel") }}
        </GlassButton>
        <GlassButton
          variant="primary"
          :disabled="!dirty || saving"
          :loading="saving"
          @click="$emit('save')"
        >
          {{ $t("common.save") }}
        </GlassButton>
      </div>
    </footer>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import GlassButton from "src/components/ui/GlassButton.vue";

function formatRelative(isoString: string): string {
  const d = new Date(isoString);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "gerade eben";
  if (mins < 60) return `vor ${mins} Min.`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `vor ${hrs} Std.`;
  return `vor ${Math.floor(hrs / 24)} Tagen`;
}

export default defineComponent({
  name: "FormSection",

  components: { GlassButton },

  emits: ["save", "cancel"],

  props: {
    title: { type: String, required: true },
    description: { type: String, default: "" },
    dirty: { type: Boolean, default: false },
    saving: { type: Boolean, default: false },
    lastSavedAt: { type: String, default: null },
  },

  computed: {
    relativeSavedAt(): string {
      if (!this.lastSavedAt) return "";
      return formatRelative(this.lastSavedAt);
    },
  },
});
</script>

<style scoped>
.form-section {
  background: var(--bg-glass-strong);
  backdrop-filter: var(--blur-glass);
  -webkit-backdrop-filter: var(--blur-glass);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  margin-bottom: 20px;
  overflow: hidden;
}

.form-section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 20px 0;
}

.form-section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 4px;
}

.form-section-description {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.5;
}

.form-section-body {
  padding: 16px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-section-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 20px;
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-glass);
}

.footer-status {
  font-size: 11px;
}

.footer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-dirty {
  color: var(--accent-tertiary);
}

.status-saving {
  color: var(--text-secondary);
}

.status-saved {
  color: var(--text-tertiary);
}

.mono {
  font-family: var(--font-mono);
}

@media (max-width: 767px) {
  .form-section-header {
    flex-direction: column;
  }

  .form-section-footer {
    flex-direction: column;
    align-items: flex-end;
  }
}
</style>
