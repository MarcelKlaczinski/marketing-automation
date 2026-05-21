<template>
  <q-dialog :model-value="true" persistent @update:model-value="onCancel">
    <div class="rerun-confirm">
      <h2 class="title">
        {{ $t("runs.actions.rerunPreflightTitle", { stepName }) as string }}
      </h2>

      <p v-if="impact" class="body text-secondary">
        <span v-if="impact.requiresConfirm">
          {{ $t("runs.actions.rerunDestructiveBody", { n: impact.dbWritesToRevert.length }, impact.dbWritesToRevert.length) as string }}
        </span>
        <span v-else>
          {{
            $t(
              "runs.actions.rerunSafeBody",
              { n: impact.stepsToInvalidate.length },
              impact.stepsToInvalidate.length,
            ) as string
          }}
        </span>
      </p>

      <ul v-if="impact && impact.stepsToInvalidate.length > 0" class="steps-list">
        <li class="steps-heading">{{ $t("runs.actions.rerunStepsToInvalidate") as string }}</li>
        <li v-for="name in impact.stepsToInvalidate" :key="name" class="mono text-xs">
          {{ name }}
        </li>
      </ul>

      <div v-if="impact && impact.dbWritesToRevert.length > 0" class="db-writes">
        <p class="db-writes-heading">{{ $t("runs.actions.rerunDbWritesHeading") as string }}</p>
        <ul>
          <li v-for="msg in impact.dbWritesToRevert" :key="msg" class="text-xs">
            {{ msg }}
          </li>
        </ul>
      </div>

      <p v-if="impact && impact.itemsToCancel > 0" class="items-warning">
        {{ $t("runs.actions.rerunItemsToCancel", { n: impact.itemsToCancel }, impact.itemsToCancel) as string }}
      </p>

      <!-- Type-DELETE protection only when destructive. -->
      <template v-if="impact && impact.requiresConfirm">
        <label class="modal-label">
          {{ $t("runs.actions.rerunTypeDeleteInstruction") as string }}
        </label>
        <input
          v-model="typed"
          class="modal-input"
          placeholder="DELETE"
          autocomplete="off"
          spellcheck="false"
        />
        <p v-if="typed && typed !== 'DELETE'" class="mismatch text-xs">
          {{ $t("runs.actions.rerunTypeDeleteMismatch") as string }}
        </p>
      </template>

      <div class="modal-actions">
        <GlassButton variant="ghost" :disabled="busy" @click="onCancel">
          {{ $t("runs.actions.cancel") as string }}
        </GlassButton>
        <GlassButton
          :variant="impact?.requiresConfirm ? 'danger' : 'primary'"
          :loading="busy"
          :disabled="busy || (impact?.requiresConfirm === true && typed !== 'DELETE')"
          @click="$emit('confirm')"
        >
          {{
            (impact?.requiresConfirm
              ? $t("runs.actions.confirmDestructive")
              : $t("runs.actions.confirm")) as string
          }}
        </GlassButton>
      </div>
    </div>
  </q-dialog>
</template>

<script lang="ts">
import GlassButton from "src/components/ui/GlassButton.vue";
import type { RerunImpactPayload } from "src/composables/runs/usePauseActions";
import { type PropType, defineComponent } from "vue";

export default defineComponent({
  name: "RerunConfirmDialog",

  components: { GlassButton },

  props: {
    stepName: { type: String, required: true },
    impact: { type: Object as PropType<RerunImpactPayload | null>, default: null },
    busy: { type: Boolean, default: false },
  },

  emits: ["cancel", "confirm"],

  data: () => ({
    typed: "",
  }),

  methods: {
    onCancel(): void {
      this.$emit("cancel");
    },
  },
});
</script>

<style scoped>
.rerun-confirm {
  background: var(--bg-card, var(--bg-glass-strong));
  border-radius: var(--radius-lg, 12px);
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-width: 560px;
  width: 90vw;
}

.title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.body {
  margin: 0;
  font-size: 13px;
}

.steps-list {
  margin: 0;
  padding-left: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.steps-heading,
.db-writes-heading {
  font-size: 12px;
  color: var(--text-tertiary);
  list-style: none;
  margin-left: calc(-1 * var(--space-4));
  font-weight: 500;
}

.db-writes ul {
  margin: 4px 0 0;
  padding-left: var(--space-4);
}

.items-warning {
  background: rgba(255, 77, 109, 0.08);
  border: 1px solid rgba(255, 77, 109, 0.25);
  border-radius: var(--radius-md);
  padding: 8px 12px;
  margin: 0;
  font-size: 13px;
  color: var(--status-failed, #ff4d6d);
}

.modal-label {
  font-size: 12px;
  color: var(--text-tertiary);
}

.modal-input {
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 13px;
  padding: 8px 10px;
  letter-spacing: 0.04em;
}

.mismatch {
  color: var(--status-failed, #ff4d6d);
  margin: 0;
}

.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: var(--space-2);
}
</style>
