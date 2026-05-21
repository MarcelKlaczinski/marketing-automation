<template>
  <div class="slot-date-editor">
    <q-input
      v-model="localDate"
      type="date"
      :min="minDate"
      :max="maxDate"
      dense
      outlined
      :hint="$t('planner.weekRange', { start: minDate, end: maxDate }) as string"
      :aria-label="$t('planner.detail.editSlotDate') as string"
    />
    <div class="slot-date-actions">
      <GlassButton variant="ghost" size="sm" @click="onCancel">
        {{ $t("planner.detail.cancelEdit") as string }}
      </GlassButton>
      <GlassButton variant="primary" size="sm" :loading="saving" :disabled="!isValid" @click="onSave">
        {{ $t("planner.detail.saveSlotDate") as string }}
      </GlassButton>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import GlassButton from "src/components/ui/GlassButton.vue";

/**
 * Inline date picker for the detail page reschedule action. Uses a native
 * `type="date"` input (Quasar QInput) constrained to the plan week range. The
 * parent passes `minDate` / `maxDate` (ISO YYYY-MM-DD) — server validates too.
 */
export default defineComponent({
  name: "PlannerSlotDateEditor",

  components: { GlassButton },

  emits: ["save", "cancel"],

  props: {
    initialDate: { type: String, required: true },
    minDate: { type: String, required: true },
    maxDate: { type: String, required: true },
    saving: { type: Boolean, default: false },
  },

  data() {
    return {
      // Slice to YYYY-MM-DD so native date inputs accept it (won't accept timestamps).
      localDate: this.initialDate.slice(0, 10),
    };
  },

  computed: {
    isValid(): boolean {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(this.localDate)) return false;
      return this.localDate >= this.minDate && this.localDate <= this.maxDate;
    },
  },

  methods: {
    onSave(): void {
      if (!this.isValid) return;
      this.$emit("save", this.localDate);
    },
    onCancel(): void {
      this.$emit("cancel");
    },
  },
});
</script>

<style scoped>
.slot-date-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.slot-date-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>
