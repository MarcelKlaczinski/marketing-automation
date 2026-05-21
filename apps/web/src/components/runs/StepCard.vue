<template>
  <div class="step-card" :class="cardClass">
    <header class="step-header" @click="onHeaderClick">
      <span class="step-icon" :title="statusHint">
        <span v-if="step.status === 'completed'" class="icon icon-completed">&#10003;</span>
        <span v-else-if="step.status === 'running'" class="icon icon-running">&#9655;</span>
        <span v-else-if="step.status === 'paused'" class="icon icon-paused">&#9208;</span>
        <span v-else-if="step.status === 'failed'" class="icon icon-failed">&#10007;</span>
        <span v-else-if="step.status === 'superseded'" class="icon icon-superseded">&#8856;</span>
        <span v-else class="icon icon-other">&#9679;</span>
      </span>
      <span class="step-index mono">{{ stepIndex + 1 }}.</span>
      <span class="step-name mono">{{ step.stepName ?? "(unknown)" }}</span>

      <span v-if="step.durationMs !== null" class="step-duration mono text-tertiary">
        {{ formattedDuration }}
      </span>

      <span v-if="isPaused" class="paused-pill">{{ $t("runs.list.statusPaused") as string }}</span>
    </header>

    <div v-if="expanded" class="step-body">
      <!-- Status hint line -->
      <p v-if="isPaused" class="hint hint-paused">{{ $t("runs.detail.pausedStepHint") as string }}</p>
      <p v-else-if="step.status === 'completed'" class="hint">
        {{ $t("runs.detail.completedStepHint") as string }}
      </p>
      <p v-else-if="step.status === 'failed'" class="hint hint-failed">
        {{ $t("runs.detail.failedStepHint") as string }}
        <span v-if="step.error" class="mono text-xs"> — {{ step.error }}</span>
      </p>
      <p v-else-if="step.status === 'superseded'" class="hint">
        {{ $t("runs.detail.supersededStepHint") as string }}
      </p>

      <!-- JSON inspectors (Input / Output / Prompt) -->
      <div class="json-section">
        <button class="toggle-btn" type="button" @click="showInput = !showInput">
          {{ (showInput ? $t("runs.detail.hideJson") : $t("runs.detail.showJson")) as string }}
          · {{ $t("runs.detail.inputLabel") as string }}
        </button>
        <PipelineJsonEditor
          v-if="showInput"
          :model-value="inputJson"
          :read-only="true"
          :min-height="160"
        />
      </div>

      <div class="json-section">
        <button class="toggle-btn" type="button" @click="showOutput = !showOutput">
          {{ (showOutput ? $t("runs.detail.hideJson") : $t("runs.detail.showJson")) as string }}
          · {{ $t("runs.detail.outputLabel") as string }}
        </button>
        <PipelineJsonEditor
          v-if="showOutput"
          :model-value="outputJson"
          :read-only="true"
          :min-height="160"
        />
      </div>

      <div v-if="step.pause?.promptUsed" class="json-section">
        <button class="toggle-btn" type="button" @click="showPrompt = !showPrompt">
          {{ (showPrompt ? $t("runs.detail.hidePrompt") : $t("runs.detail.showPrompt")) as string }}
        </button>
        <PipelineJsonEditor
          v-if="showPrompt"
          :model-value="step.pause.promptUsed"
          :read-only="true"
          :json-mode="false"
          :min-height="160"
        />
      </div>

      <!-- Action bar — only visible when this step is the active pause -->
      <div v-if="isPaused && step.pause" class="actions-bar">
        <GlassButton :disabled="busy" @click="onApprove">
          {{ $t("runs.actions.approve") as string }}
        </GlassButton>
        <GlassButton variant="ghost" :disabled="busy" @click="onOpenEditInput">
          {{ $t("runs.actions.editInput") as string }}
        </GlassButton>
        <GlassButton variant="ghost" :disabled="busy" @click="onOpenEditOutput">
          {{ $t("runs.actions.editOutput") as string }}
        </GlassButton>
        <GlassButton variant="ghost" :disabled="busy" @click="onOpenEditPrompt">
          {{ $t("runs.actions.editPrompt") as string }}
        </GlassButton>
        <GlassButton variant="ghost" :disabled="busy" @click="onOpenPromote">
          {{ $t("runs.actions.promote") as string }}
        </GlassButton>
        <GlassButton variant="ghost" :disabled="busy" @click="onOpenExtract">
          {{ $t("runs.actions.extract") as string }}
        </GlassButton>
        <GlassButton variant="secondary" :disabled="busy" @click="onOpenRerun">
          {{ $t("runs.actions.rerun") as string }}
        </GlassButton>
        <GlassButton variant="danger" :disabled="busy" @click="onOpenAbort">
          {{ $t("runs.actions.abort") as string }}
        </GlassButton>
      </div>
    </div>

    <!-- Editor modals -->
    <q-dialog v-model="editInputDialog.open">
      <div class="modal-card">
        <h2 class="modal-title">{{ $t("runs.actions.editInput") as string }}</h2>
        <PipelineJsonEditor
          :model-value="editInputDialog.value"
          :read-only="false"
          :min-height="300"
          @update:model-value="editInputDialog.value = $event"
        />
        <div class="modal-actions">
          <GlassButton variant="ghost" @click="editInputDialog.open = false">
            {{ $t("runs.actions.cancel") as string }}
          </GlassButton>
          <GlassButton variant="primary" :loading="busy" @click="confirmEditInput">
            {{ $t("runs.actions.save") as string }}
          </GlassButton>
        </div>
      </div>
    </q-dialog>

    <q-dialog v-model="editOutputDialog.open">
      <div class="modal-card">
        <h2 class="modal-title">{{ $t("runs.actions.editOutput") as string }}</h2>
        <PipelineJsonEditor
          :model-value="editOutputDialog.value"
          :read-only="false"
          :min-height="300"
          @update:model-value="editOutputDialog.value = $event"
        />
        <div class="modal-actions">
          <GlassButton variant="ghost" @click="editOutputDialog.open = false">
            {{ $t("runs.actions.cancel") as string }}
          </GlassButton>
          <GlassButton variant="primary" :loading="busy" @click="confirmEditOutput">
            {{ $t("runs.actions.save") as string }}
          </GlassButton>
        </div>
      </div>
    </q-dialog>

    <q-dialog v-model="editPromptDialog.open">
      <div class="modal-card">
        <h2 class="modal-title">{{ $t("runs.actions.editPrompt") as string }}</h2>
        <PipelineJsonEditor
          :model-value="editPromptDialog.value"
          :read-only="false"
          :json-mode="false"
          :min-height="300"
          @update:model-value="editPromptDialog.value = $event"
        />
        <div class="modal-actions">
          <GlassButton variant="ghost" @click="editPromptDialog.open = false">
            {{ $t("runs.actions.cancel") as string }}
          </GlassButton>
          <GlassButton variant="primary" :loading="busy" @click="confirmEditPrompt">
            {{ $t("runs.actions.save") as string }}
          </GlassButton>
        </div>
      </div>
    </q-dialog>

    <q-dialog v-model="promoteDialog.open">
      <div class="modal-card">
        <h2 class="modal-title">{{ $t("runs.actions.promote") as string }}</h2>
        <p class="text-secondary text-sm">{{ $t("runs.actions.promotePromptEdited") as string }}</p>
        <PipelineJsonEditor
          :model-value="promoteDialog.value"
          :read-only="false"
          :json-mode="false"
          :min-height="300"
          @update:model-value="promoteDialog.value = $event"
        />
        <div class="modal-actions">
          <GlassButton variant="ghost" @click="promoteDialog.open = false">
            {{ $t("runs.actions.cancel") as string }}
          </GlassButton>
          <GlassButton variant="primary" :loading="busy" @click="confirmPromote">
            {{ $t("runs.actions.confirm") as string }}
          </GlassButton>
        </div>
      </div>
    </q-dialog>

    <q-dialog v-model="extractDialog.open">
      <div class="modal-card">
        <h2 class="modal-title">{{ $t("runs.actions.extract") as string }}</h2>
        <label class="modal-label">{{ $t("runs.actions.extractNoteLabel") as string }}</label>
        <textarea
          v-model="extractDialog.note"
          class="modal-textarea"
          rows="4"
          :placeholder="$t('runs.actions.extractNotePlaceholder') as string"
        />
        <div class="modal-actions">
          <GlassButton variant="ghost" @click="extractDialog.open = false">
            {{ $t("runs.actions.cancel") as string }}
          </GlassButton>
          <GlassButton variant="primary" :loading="busy" :disabled="!extractDialog.note" @click="confirmExtract">
            {{ $t("runs.actions.confirm") as string }}
          </GlassButton>
        </div>
      </div>
    </q-dialog>

    <q-dialog v-model="abortDialog.open">
      <div class="modal-card">
        <h2 class="modal-title">{{ $t("runs.actions.confirmAbortTitle") as string }}</h2>
        <p class="text-secondary text-sm">{{ $t("runs.actions.confirmAbortBody") as string }}</p>
        <label class="modal-label">{{ $t("runs.actions.abortReasonLabel") as string }}</label>
        <textarea
          v-model="abortDialog.reason"
          class="modal-textarea"
          rows="3"
          :placeholder="$t('runs.actions.abortReasonPlaceholder') as string"
        />
        <div class="modal-actions">
          <GlassButton variant="ghost" @click="abortDialog.open = false">
            {{ $t("runs.actions.cancel") as string }}
          </GlassButton>
          <GlassButton variant="danger" :loading="busy" @click="confirmAbort">
            {{ $t("runs.actions.confirm") as string }}
          </GlassButton>
        </div>
      </div>
    </q-dialog>

    <!-- Rerun dialog: lives in a child component (Phase 5) — until then, simple confirm. -->
    <RerunConfirmDialog
      v-if="rerunDialog.open"
      :step-name="step.stepName ?? ''"
      :impact="rerunDialog.impact"
      :busy="busy"
      @cancel="rerunDialog.open = false"
      @confirm="onRerunConfirmed"
    />
  </div>
</template>

<script lang="ts">
import { Notify } from "quasar";
import GlassButton from "src/components/ui/GlassButton.vue";
import {
  type PauseActionResult,
  type RerunImpactPayload,
  usePauseActions,
} from "src/composables/runs/usePauseActions";
import type { RunDetailStep } from "src/composables/runs/useRunDetail";
import { type PropType, defineComponent } from "vue";
import { ref } from "vue";
import PipelineJsonEditor from "./PipelineJsonEditor.vue";
import RerunConfirmDialog from "./RerunConfirmDialog.vue";

export default defineComponent({
  name: "StepCard",

  components: { GlassButton, PipelineJsonEditor, RerunConfirmDialog },

  props: {
    step: { type: Object as PropType<RunDetailStep>, required: true },
    stepIndex: { type: Number, required: true },
    runId: { type: String, required: true },
    projectSlug: { type: String, required: true },
    /** Auto-expand on initial render (true for currently-paused step). */
    initiallyExpanded: { type: Boolean, default: false },
  },

  emits: ["action-completed"],

  setup(props) {
    const runIdRef = ref(props.runId);
    const actions = usePauseActions({ runId: runIdRef });
    return { actions };
  },

  data() {
    return {
      expanded: this.initiallyExpanded,
      showInput: false,
      showOutput: false,
      showPrompt: false,
      editInputDialog: { open: false, value: "" },
      editOutputDialog: { open: false, value: "" },
      editPromptDialog: { open: false, value: "" },
      promoteDialog: { open: false, value: "" },
      extractDialog: { open: false, note: "" },
      abortDialog: { open: false, reason: "" },
      rerunDialog: {
        open: false,
        impact: null as RerunImpactPayload | null,
      },
    };
  },

  computed: {
    isPaused(): boolean {
      return this.step.status === "paused" && !!this.step.pause && !this.step.pause.resolvedAt;
    },
    busy(): boolean {
      return this.actions.isBusy.value;
    },
    cardClass(): string {
      return `step-card--${this.step.status.replace(/_/g, "-")}`;
    },
    statusHint(): string {
      const key =
        this.step.status === "completed"
          ? "runs.detail.completedStepHint"
          : this.step.status === "paused"
            ? "runs.detail.pausedStepHint"
            : this.step.status === "failed"
              ? "runs.detail.failedStepHint"
              : "runs.detail.supersededStepHint";
      return this.$t(key) as string;
    },
    formattedDuration(): string {
      const ms = this.step.durationMs ?? 0;
      if (ms < 1000) return `${ms}ms`;
      if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
      return `${(ms / 60_000).toFixed(1)}m`;
    },
    inputJson(): string {
      const src = this.step.pause?.stepInput ?? this.step.input;
      return src ? JSON.stringify(src, null, 2) : "";
    },
    outputJson(): string {
      const src = this.step.pause?.stepOutput ?? this.step.output;
      return src ? JSON.stringify(src, null, 2) : "";
    },
  },

  methods: {
    onHeaderClick(): void {
      this.expanded = !this.expanded;
    },
    handleResult(result: PauseActionResult, closeDialog: (() => void) | null): void {
      if (result.ok) {
        Notify.create({
          type: "positive",
          message: this.$t("runs.actions.actionSucceeded") as string,
          timeout: 2500,
        });
        if (closeDialog) closeDialog();
        this.$emit("action-completed");
      } else {
        Notify.create({
          type: "negative",
          message: result.error,
          timeout: 4000,
        });
      }
    },
    async onApprove(): Promise<void> {
      if (!this.step.pause) return;
      const res = await this.actions.approve({ stepPauseId: this.step.pause.id });
      this.handleResult(res, null);
    },
    onOpenEditInput(): void {
      if (!this.step.pause) return;
      this.editInputDialog.value = JSON.stringify(this.step.pause.stepInput, null, 2);
      this.editInputDialog.open = true;
    },
    async confirmEditInput(): Promise<void> {
      if (!this.step.pause) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(this.editInputDialog.value);
      } catch {
        Notify.create({
          type: "negative",
          message: this.$t("runs.actions.schemaInvalid") as string,
        });
        return;
      }
      const res = await this.actions.editInput({
        stepPauseId: this.step.pause.id,
        editedInput: parsed,
      });
      this.handleResult(res, () => {
        this.editInputDialog.open = false;
      });
    },
    onOpenEditOutput(): void {
      if (!this.step.pause) return;
      this.editOutputDialog.value = JSON.stringify(this.step.pause.stepOutput, null, 2);
      this.editOutputDialog.open = true;
    },
    async confirmEditOutput(): Promise<void> {
      if (!this.step.pause) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(this.editOutputDialog.value);
      } catch {
        Notify.create({
          type: "negative",
          message: this.$t("runs.actions.schemaInvalid") as string,
        });
        return;
      }
      const res = await this.actions.editOutput({
        stepPauseId: this.step.pause.id,
        editedOutput: parsed,
      });
      this.handleResult(res, () => {
        this.editOutputDialog.open = false;
      });
    },
    onOpenEditPrompt(): void {
      if (!this.step.pause) return;
      this.editPromptDialog.value = this.step.pause.promptUsed ?? "";
      this.editPromptDialog.open = true;
    },
    async confirmEditPrompt(): Promise<void> {
      if (!this.step.pause) return;
      if (!this.editPromptDialog.value.trim()) {
        Notify.create({
          type: "negative",
          message: this.$t("runs.actions.schemaInvalid") as string,
        });
        return;
      }
      const res = await this.actions.editPrompt({
        stepPauseId: this.step.pause.id,
        editedPrompt: this.editPromptDialog.value,
      });
      this.handleResult(res, () => {
        this.editPromptDialog.open = false;
      });
    },
    onOpenPromote(): void {
      if (!this.step.pause) return;
      this.promoteDialog.value = this.step.pause.promptUsed ?? "";
      this.promoteDialog.open = true;
    },
    async confirmPromote(): Promise<void> {
      if (!this.step.pause) return;
      if (!this.promoteDialog.value.trim()) {
        Notify.create({
          type: "negative",
          message: this.$t("runs.actions.schemaInvalid") as string,
        });
        return;
      }
      const res = await this.actions.promote({
        stepPauseId: this.step.pause.id,
        editedPrompt: this.promoteDialog.value,
      });
      this.handleResult(res, () => {
        this.promoteDialog.open = false;
      });
    },
    onOpenExtract(): void {
      this.extractDialog.note = "";
      this.extractDialog.open = true;
    },
    async confirmExtract(): Promise<void> {
      if (!this.step.pause) return;
      const res = await this.actions.extract({
        stepPauseId: this.step.pause.id,
        userNote: this.extractDialog.note,
      });
      this.handleResult(res, () => {
        this.extractDialog.open = false;
      });
    },
    onOpenAbort(): void {
      this.abortDialog.reason = "";
      this.abortDialog.open = true;
    },
    async confirmAbort(): Promise<void> {
      if (!this.step.pause) return;
      const args: { stepPauseId: string; userNote?: string } = {
        stepPauseId: this.step.pause.id,
      };
      if (this.abortDialog.reason) args.userNote = this.abortDialog.reason;
      const res = await this.actions.abort(args);
      this.handleResult(res, () => {
        this.abortDialog.open = false;
      });
    },
    async onOpenRerun(): Promise<void> {
      if (!this.step.pause) return;
      // First call without confirmDestructive — backend returns 409+impact if destructive,
      // or succeeds immediately if safe.
      const res = await this.actions.rerun({ stepPauseId: this.step.pause.id });
      if (res.ok) {
        this.handleResult(res, null);
        return;
      }
      if (res.impact) {
        // Surface confirm dialog so the user can opt in to destructive cleanup.
        this.rerunDialog.impact = res.impact;
        this.rerunDialog.open = true;
        return;
      }
      Notify.create({ type: "negative", message: res.error });
    },
    async onRerunConfirmed(): Promise<void> {
      if (!this.step.pause) return;
      const res = await this.actions.rerun({
        stepPauseId: this.step.pause.id,
        confirmDestructive: true,
      });
      this.handleResult(res, () => {
        this.rerunDialog.open = false;
      });
    },
  },
});
</script>

<style scoped>
.step-card {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-glass);
  overflow: hidden;
}

.step-card--paused {
  border-color: rgba(255, 188, 0, 0.35);
  box-shadow: 0 0 0 1px rgba(255, 188, 0, 0.15);
}

.step-card--failed {
  border-color: rgba(255, 77, 109, 0.35);
}

.step-card--superseded {
  opacity: 0.6;
}

.step-header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 12px var(--space-3);
  cursor: pointer;
  user-select: none;
  transition: background 120ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

@media (hover: hover) and (pointer: fine) {
  .step-header:hover {
    background: var(--bg-glass-strong);
  }
}

.step-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  flex-shrink: 0;
}

.icon { font-size: 14px; line-height: 1; }
.icon-completed { color: #22c55e; }
.icon-running { color: var(--status-running, #00d4ff); }
.icon-paused { color: #ffbc00; }
.icon-failed { color: var(--status-failed, #ff4d6d); }
.icon-superseded { color: var(--text-tertiary); }
.icon-other { color: var(--text-tertiary); }

.step-index { font-size: 12px; color: var(--text-tertiary); }
.step-name { color: var(--text-primary); font-weight: 500; flex: 1; }
.step-duration { font-size: 12px; }

.paused-pill {
  background: rgba(255, 188, 0, 0.1);
  color: #ffbc00;
  padding: 2px 8px;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 600;
  border: 1px solid rgba(255, 188, 0, 0.3);
}

.step-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: 0 var(--space-3) var(--space-3);
  border-top: 1px solid var(--border-subtle);
}

.hint { font-size: 13px; color: var(--text-secondary); margin: 6px 0 0; }
.hint-paused { color: #ffbc00; }
.hint-failed { color: var(--status-failed, #ff4d6d); }

.json-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.toggle-btn {
  align-self: flex-start;
  background: transparent;
  border: 1px dashed var(--border-subtle);
  color: var(--text-secondary);
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  cursor: pointer;
}

.toggle-btn:hover {
  border-color: var(--border-strong);
  color: var(--text-primary);
}

.actions-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: var(--space-2);
}

.modal-card {
  background: var(--bg-card, var(--bg-glass-strong));
  border-radius: var(--radius-lg, 12px);
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-width: 720px;
  width: 90vw;
}

.modal-title { margin: 0; font-size: 16px; font-weight: 600; }

.modal-label {
  font-size: 12px;
  color: var(--text-tertiary);
  margin: 0;
}

.modal-textarea {
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 12px;
  padding: 10px;
  resize: vertical;
}

.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>
