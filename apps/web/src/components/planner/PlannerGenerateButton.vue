<template>
  <div>
    <GlassButton
      variant="primary"
      :loading="loading"
      :disabled="loading"
      @click="openDialog"
    >
      <span v-if="loading">{{ $t("planner.actions.generating") as string }}</span>
      <span v-else>
        {{ $t("planner.empty.cta", { n: isoWeek, year }) as string }}
      </span>
    </GlassButton>

    <q-dialog v-model="showConfirm">
      <div class="confirm-card">
        <h2 class="confirm-title">
          {{ $t("planner.generateConfirm.title", { n: isoWeek, year }) as string }}
        </h2>
        <p class="confirm-body text-secondary">
          {{ $t("planner.generateConfirm.body") as string }}
        </p>
        <div class="confirm-actions">
          <GlassButton variant="ghost" :disabled="loading" @click="showConfirm = false">
            {{ $t("planner.generateConfirm.cancel") as string }}
          </GlassButton>
          <GlassButton variant="primary" :loading="loading" @click="onConfirm">
            {{ $t("planner.generateConfirm.confirm") as string }}
          </GlassButton>
        </div>
      </div>
    </q-dialog>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import GlassButton from "src/components/ui/GlassButton.vue";

/**
 * Generate-Plan flow: button → confirm dialog → emit `confirmed`. The parent
 * owns the actual API call (so it can decide on 409-replace prompts etc).
 */
export default defineComponent({
  name: "PlannerGenerateButton",

  components: { GlassButton },

  emits: ["confirmed"],

  props: {
    year: { type: Number, required: true },
    isoWeek: { type: Number, required: true },
    loading: { type: Boolean, default: false },
  },

  data: () => ({
    showConfirm: false,
  }),

  methods: {
    openDialog(): void {
      this.showConfirm = true;
    },
    onConfirm(): void {
      this.$emit("confirmed");
      // Parent closes by toggling `loading` and re-rendering — but in case the
      // call is sync-fast, hide the dialog here too.
      this.showConfirm = false;
    },
  },
});
</script>

<style scoped>
.confirm-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-5);
  width: 480px;
  max-width: 95vw;
  background: var(--bg-glass-strong);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
}

.confirm-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.confirm-body {
  font-size: 14px;
  line-height: 1.5;
  margin: 0;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
</style>
