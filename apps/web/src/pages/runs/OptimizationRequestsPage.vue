<template>
  <div class="optreq-page">
    <header class="page-header">
      <h1 class="page-title">{{ $t("runs.optimizationRequests.pageTitle") as string }}</h1>
      <p class="page-desc text-secondary">
        {{ $t("runs.optimizationRequests.pageDescription") as string }}
      </p>
    </header>

    <div class="filter-row">
      <label class="filter-label">{{ $t("runs.optimizationRequests.statusFilter") as string }}</label>
      <select v-model="statusFilter" class="filter-select">
        <option value="open">{{ $t("runs.optimizationRequests.statusOpen") as string }}</option>
        <option value="resolved">{{ $t("runs.optimizationRequests.statusResolved") as string }}</option>
        <option value="dismissed">{{ $t("runs.optimizationRequests.statusDismissed") as string }}</option>
        <option value="all">{{ $t("runs.optimizationRequests.statusAll") as string }}</option>
      </select>
    </div>

    <div v-if="isPending" class="state-block">
      <p class="text-tertiary">{{ $t("common.loading") as string }}</p>
    </div>
    <div v-else-if="requests.length === 0" class="state-block">
      <p class="text-secondary">{{ $t("runs.optimizationRequests.empty") as string }}</p>
      <p class="text-tertiary text-sm">{{ $t("runs.optimizationRequests.emptyHint") as string }}</p>
    </div>
    <div v-else class="requests-list">
      <article v-for="req in requests" :key="req.id" class="request-card">
        <header class="card-header">
          <span class="timestamp mono text-xs text-tertiary">{{ formatDate(req.requestedAt) }}</span>
          <span class="step-name mono">{{ req.stepName }}</span>
          <span class="status-pill" :class="`status-pill--${req.status}`">
            {{ $t(`runs.optimizationRequests.status${capitalize(req.status)}`) as string }}
          </span>
        </header>

        <p class="user-note">{{ req.userNote }}</p>

        <p class="context text-xs text-tertiary">
          {{ $t("runs.optimizationRequests.contextLabel") as string }}:
          {{ req.pipelineName }} · {{ req.requestedBy }}
        </p>

        <div v-if="req.status === 'open'" class="card-actions">
          <GlassButton variant="primary" @click="openResolveDialog(req)">
            {{ $t("runs.optimizationRequests.markResolved") as string }}
          </GlassButton>
          <GlassButton variant="ghost" @click="openDismissDialog(req)">
            {{ $t("runs.optimizationRequests.markDismissed") as string }}
          </GlassButton>
        </div>
        <p v-else-if="req.addressedNote" class="addressed-note text-xs text-secondary">
          {{ req.addressedNote }}
        </p>
      </article>
    </div>

    <q-dialog v-model="noteDialog.open">
      <div class="modal-card">
        <h2 class="modal-title">
          {{
            (noteDialog.mode === "resolve"
              ? $t("runs.optimizationRequests.markResolved")
              : $t("runs.optimizationRequests.markDismissed")) as string
          }}
        </h2>
        <label class="modal-label">
          {{ $t("runs.optimizationRequests.addressedNoteLabel") as string }}
        </label>
        <textarea
          v-model="noteDialog.note"
          class="modal-textarea"
          rows="3"
          :placeholder="$t('runs.optimizationRequests.addressedNotePlaceholder') as string"
        />
        <div class="modal-actions">
          <GlassButton variant="ghost" @click="noteDialog.open = false">
            {{ $t("runs.actions.cancel") as string }}
          </GlassButton>
          <GlassButton variant="primary" :loading="noteDialog.busy" @click="confirmNote">
            {{ $t("runs.actions.confirm") as string }}
          </GlassButton>
        </div>
      </div>
    </q-dialog>
  </div>
</template>

<script lang="ts">
import { Notify } from "quasar";
import GlassButton from "src/components/ui/GlassButton.vue";
import {
  type OptimizationRequest,
  type OptimizationRequestStatus,
  useOptimizationRequests,
} from "src/composables/runs/useOptimizationRequests";
import { defineComponent, ref } from "vue";

export default defineComponent({
  name: "OptimizationRequestsPage",

  components: { GlassButton },

  setup() {
    const statusFilter = ref<OptimizationRequestStatus | "all">("open");
    const list = useOptimizationRequests({ status: statusFilter });
    return { statusFilter, list };
  },

  data: () => ({
    noteDialog: {
      open: false,
      mode: "resolve" as "resolve" | "dismiss",
      note: "",
      targetId: "",
      busy: false,
    },
  }),

  computed: {
    requests(): OptimizationRequest[] {
      return this.list.requests.value;
    },
    isPending(): boolean {
      return this.list.isPending.value;
    },
  },

  watch: {
    statusFilter: {
      handler(): void {
        void this.list.refetch();
      },
    },
  },

  methods: {
    formatDate(iso: string): string {
      const d = new Date(iso);
      const locale = this.$i18n.locale === "de" ? "de-DE" : "en-US";
      return d.toLocaleString(locale, {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    },
    capitalize(s: string): string {
      return s.charAt(0).toUpperCase() + s.slice(1);
    },
    openResolveDialog(req: OptimizationRequest): void {
      this.noteDialog = {
        open: true,
        mode: "resolve",
        note: "",
        targetId: req.id,
        busy: false,
      };
    },
    openDismissDialog(req: OptimizationRequest): void {
      this.noteDialog = {
        open: true,
        mode: "dismiss",
        note: "",
        targetId: req.id,
        busy: false,
      };
    },
    async confirmNote(): Promise<void> {
      this.noteDialog.busy = true;
      try {
        if (this.noteDialog.mode === "resolve") {
          await this.list.markResolved(this.noteDialog.targetId, this.noteDialog.note);
        } else {
          await this.list.markDismissed(this.noteDialog.targetId, this.noteDialog.note);
        }
        Notify.create({
          type: "positive",
          message: this.$t("runs.actions.actionSucceeded") as string,
          timeout: 2000,
        });
        this.noteDialog.open = false;
      } catch (err) {
        Notify.create({
          type: "negative",
          message: err instanceof Error ? err.message : "action_failed",
        });
      } finally {
        this.noteDialog.busy = false;
      }
    },
  },
});
</script>

<style scoped>
.optreq-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  padding: var(--space-5);
  max-width: 960px;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  margin: 0 auto;
  width: 100%;
  padding-bottom: var(--space-7, 48px);
}

.page-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.page-title {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
}

.page-desc {
  margin: 0;
  font-size: 14px;
}

.filter-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.filter-label {
  font-size: 12px;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.filter-select {
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  padding: 6px 10px;
  font-size: 13px;
}

.state-block {
  padding: var(--space-5);
  border-radius: var(--radius-md);
  background: var(--bg-glass);
  border: 1px dashed var(--border-subtle);
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.requests-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.request-card {
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.card-header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.step-name {
  flex: 1;
  color: var(--text-primary);
  font-weight: 500;
}

.user-note {
  margin: 0;
  font-size: 13px;
  color: var(--text-primary);
  font-style: italic;
}

.context {
  margin: 0;
}

.status-pill {
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  text-transform: capitalize;
}

.status-pill--open {
  background: rgba(255, 188, 0, 0.08);
  color: #ffbc00;
  border: 1px solid rgba(255, 188, 0, 0.25);
}

.status-pill--resolved {
  background: rgba(34, 197, 94, 0.08);
  color: #22c55e;
  border: 1px solid rgba(34, 197, 94, 0.25);
}

.status-pill--dismissed {
  background: var(--bg-glass-strong);
  color: var(--text-tertiary);
  border: 1px solid var(--border-subtle);
}

.card-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.addressed-note {
  margin: 0;
  padding-left: var(--space-2);
  border-left: 2px solid var(--border-subtle);
}

.modal-card {
  background: var(--bg-card, var(--bg-glass-strong));
  border-radius: var(--radius-lg, 12px);
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-width: 520px;
  width: 90vw;
}

.modal-title { margin: 0; font-size: 16px; font-weight: 600; }
.modal-label { font-size: 12px; color: var(--text-tertiary); }

.modal-textarea {
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 13px;
  padding: 10px;
  resize: vertical;
}

.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>
