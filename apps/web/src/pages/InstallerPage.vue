<template>
  <q-page style="padding: 0">
    <!-- Mobile progress bar (sidebar hidden on small screens) -->
    <div class="ins-mobile-bar">
      <span class="ins-mobile-bar__step">
        {{ $t('installer.step', { current: currentIdx + 1, total: allStepDefs.length }) }}
      </span>
      <span class="ins-mobile-bar__title">{{ $t(`installer.steps.${currentStep}.title`) }}</span>
    </div>

    <div class="ins-shell">
      <!-- ── Sidebar ─────────────────────────────────────────── -->
      <aside class="ins-sidebar">
        <div class="ins-brand">
          <q-icon name="terminal" size="17px" />
          <span>Marketing Auto</span>
        </div>

        <nav class="ins-nav" role="navigation" :aria-label="$t('installer.title')">
          <button
            v-for="(step, idx) in steps"
            :key="step.id"
            type="button"
            class="ins-nav-item"
            :class="{
              'ins-nav-item--active': currentStep === step.id,
              'ins-nav-item--done': step.id !== 'summary' && (step.status === 'configured' || step.status === 'skipped'),
              'ins-nav-item--skipped': step.status === 'skipped',
              'ins-nav-item--error': step.status === 'failed',
            }"
            @click="currentStep = step.id"
          >
            <span class="ins-nav-bullet">
              <q-icon
                v-if="step.id !== 'summary' && (step.status === 'configured' || step.status === 'skipped')"
                name="check"
                size="11px"
              />
              <q-icon v-else-if="step.status === 'failed'" name="close" size="11px" />
              <span v-else>{{ idx + 1 }}</span>
            </span>
            <span class="ins-nav-title">{{ $t(`installer.steps.${step.id}.title`) }}</span>
          </button>
        </nav>
      </aside>

      <!-- ── Main content ───────────────────────────────────── -->
      <main class="ins-main">
        <div v-if="systemStatusStore.initialized" class="ins-reinit-notice">
          <q-icon name="info" size="15px" />
          <span>{{ $t('installer.alreadyInitialized') }}</span>
        </div>

        <h1 class="ins-step-title">
          {{ $t(`installer.steps.${currentStep}.title`) }}
        </h1>

        <div class="ins-step-body">
          <component
            :is="currentComponent"
            @configured="onStepConfigured"
            @skipped="onStepSkipped"
          />
        </div>

        <!-- Footer: Back / Continue -->
        <div class="ins-footer">
          <q-btn
            v-if="!isFirstStep"
            flat
            no-caps
            dense
            :label="$t('installer.back')"
            class="ins-btn-back"
            @click="goPrev"
          />
          <q-space />
          <q-btn
            v-if="isOnSummary"
            unelevated
            no-caps
            :label="$t('installer.steps.summary.finishButton')"
            :loading="finishing"
            class="ins-btn-finish"
            @click="onFinish"
          />
          <q-btn
            v-else
            unelevated
            no-caps
            :disable="!canContinue"
            :label="$t('installer.next')"
            icon-right="arrow_forward"
            class="ins-btn-next"
            @click="goNext"
          />
        </div>
      </main>
    </div>
  </q-page>
</template>

<script lang="ts">
import { useNotify } from "src/composables/useNotify";
import { api } from "src/lib/api-client";
import { HttpError } from "src/lib/http-error";
import { useSystemStatusStore } from "src/stores/system-status";
import { defineAsyncComponent, defineComponent } from "vue";

const allStepDefs = [
  { id: "intro" },
  { id: "core" },
  { id: "smtp" },
  { id: "anthropic" },
  { id: "replicate" },
  { id: "r2" },
  { id: "dataforseo" },
  { id: "githubApp" },
  { id: "producthunt" },
  { id: "voyage" },
  { id: "summary" },
] as const;

type StepId = (typeof allStepDefs)[number]["id"];
type StepStatus = "pending" | "configured" | "failed" | "skipped";

interface StepState {
  id: StepId;
  status: StepStatus;
}

type ComponentMapType = Record<StepId, ReturnType<typeof defineAsyncComponent>>;

const COMPONENT_MAP: ComponentMapType = {
  intro: defineAsyncComponent(() => import("src/components/installer/StepIntro.vue")),
  core: defineAsyncComponent(() => import("src/components/installer/StepCore.vue")),
  smtp: defineAsyncComponent(() => import("src/components/installer/StepSmtp.vue")),
  anthropic: defineAsyncComponent(() => import("src/components/installer/StepAnthropic.vue")),
  replicate: defineAsyncComponent(() => import("src/components/installer/StepReplicate.vue")),
  r2: defineAsyncComponent(() => import("src/components/installer/StepR2.vue")),
  dataforseo: defineAsyncComponent(() => import("src/components/installer/StepDataforseo.vue")),
  githubApp: defineAsyncComponent(() => import("src/components/installer/StepGithubApp.vue")),
  producthunt: defineAsyncComponent(() => import("src/components/installer/StepProducthunt.vue")),
  voyage: defineAsyncComponent(() => import("src/components/installer/StepVoyage.vue")),
  summary: defineAsyncComponent(() => import("src/components/installer/InstallerSummary.vue")),
};

export default defineComponent({
  name: "InstallerPage",

  components: { ...COMPONENT_MAP },

  setup() {
    return {
      systemStatusStore: useSystemStatusStore(),
      notify: useNotify(),
      allStepDefs,
    };
  },

  data: () => ({
    currentStep: "intro" as StepId,
    skippedSteps: new Set<string>(),
    finishing: false,
  }),

  computed: {
    steps(): StepState[] {
      const store = this.systemStatusStore;

      const adapterStatus = (id: string): StepStatus => {
        if (this.skippedSteps.has(id)) return "skipped";
        const map: Record<string, { configured: boolean; verified: boolean | null }> = {
          smtp: store.adapters.smtp,
          anthropic: store.adapters.anthropic,
          replicate: store.adapters.replicate,
          r2: store.adapters.r2,
          dataforseo: store.adapters.dataforseo,
          githubApp: store.adapters.githubApp,
          producthunt: store.adapters.producthunt,
          voyage: store.adapters.voyage,
        };
        const s = map[id];
        if (!s) return "pending";
        if (!s.configured) return "pending";
        if (s.verified === false) return "failed";
        return "configured";
      };

      return allStepDefs.map((def) => {
        let status: StepStatus;
        if (def.id === "intro" || def.id === "summary") {
          status = "configured";
        } else if (def.id === "core") {
          status = store.requiredCoreReady ? "configured" : "pending";
        } else {
          status = adapterStatus(def.id);
        }
        return { id: def.id, status };
      });
    },

    currentIdx(): number {
      return allStepDefs.findIndex((d) => d.id === this.currentStep);
    },

    isFirstStep(): boolean {
      return this.currentIdx === 0;
    },

    isOnSummary(): boolean {
      return this.currentStep === "summary";
    },

    canContinue(): boolean {
      if (this.currentStep === "intro") return true;
      if (this.currentStep === "core") return this.systemStatusStore.requiredCoreReady;
      const step = this.steps.find((s) => s.id === this.currentStep);
      if (!step) return false;
      return step.status === "configured" || step.status === "skipped";
    },

    currentComponent(): ReturnType<typeof defineAsyncComponent> | undefined {
      return COMPONENT_MAP[this.currentStep as StepId];
    },
  },

  async created() {
    await this.systemStatusStore.fetchStatus();
    await this.systemStatusStore.fetchDeploymentMode();
    const firstPending = this.steps.find(
      (s) => s.id !== "summary" && (s.status === "pending" || s.status === "failed")
    );
    if (firstPending) this.currentStep = firstPending.id;
  },

  methods: {
    goNext(): void {
      const idx = this.currentIdx;
      if (idx < allStepDefs.length - 1) {
        this.currentStep = allStepDefs[idx + 1]!.id;
      }
    },

    goPrev(): void {
      const idx = this.currentIdx;
      if (idx > 0) this.currentStep = allStepDefs[idx - 1]!.id;
    },

    async onStepConfigured(): Promise<void> {
      await this.systemStatusStore.fetchStatus();
    },

    onStepSkipped(): void {
      this.skippedSteps = new Set([...this.skippedSteps, this.currentStep]);
      this.goNext();
    },

    async onFinish(): Promise<void> {
      this.finishing = true;
      try {
        await api.post("/system/initialize");
        await this.systemStatusStore.fetchStatus();
        void this.$router.push({ name: "inbox" });
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      } finally {
        this.finishing = false;
      }
    },
  },
});
</script>

<style lang="scss" scoped>
/* ── Shell ──────────────────────────────────────────────────────── */
.ins-shell {
  display: flex;
  min-height: 100vh;
  background: #fafafa;
}

/* ── Mobile bar (visible only <600px) ──────────────────────────── */
.ins-mobile-bar {
  display: none;
  padding: 12px 16px;
  background: #f4f4f5;
  border-bottom: 1px solid #e4e4e7;
  font-size: 12px;
  color: #71717a;
  gap: 6px;
  align-items: center;

  &__step { font-weight: 600; }
  &__title { color: #18181b; }

  @media (max-width: 599px) {
    display: flex;
  }
}

/* ── Sidebar ────────────────────────────────────────────────────── */
.ins-sidebar {
  width: 216px;
  flex-shrink: 0;
  background: #f4f4f5;
  border-right: 1px solid #e4e4e7;
  display: flex;
  flex-direction: column;
  padding-top: 28px;

  @media (max-width: 599px) {
    display: none;
  }
}

.ins-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 18px 22px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #52525b;
}

.ins-nav {
  flex: 1;
  overflow-y: auto;
}

.ins-nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px 18px;
  background: none;
  border: none;
  border-left: 2px solid transparent;
  cursor: pointer;
  text-align: left;
  transition: background 0.1s, border-color 0.1s;

  .ins-nav-title {
    font-size: 13px;
    color: #71717a;
    line-height: 1.4;
    transition: color 0.1s;
  }

  &:hover {
    background: rgba(0, 0, 0, 0.04);
    .ins-nav-title { color: #3f3f46; }
  }
}

.ins-nav-item--active {
  background: #fff;
  border-left-color: #4f46e5;

  .ins-nav-title {
    color: #18181b;
    font-weight: 500;
  }

  .ins-nav-bullet {
    background: #4f46e5;
    color: #fff;
  }
}

.ins-nav-item--done {
  .ins-nav-bullet { background: #16a34a; color: #fff; }
  .ins-nav-title { color: #3f3f46; }
}

.ins-nav-item--skipped {
  .ins-nav-title { color: #a1a1aa; text-decoration: line-through; }
  .ins-nav-bullet { background: #a1a1aa; color: #fff; }
}

.ins-nav-item--error {
  .ins-nav-bullet { background: #dc2626; color: #fff; }
}

.ins-nav-bullet {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #e4e4e7;
  color: #71717a;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
}

/* ── Main content ───────────────────────────────────────────────── */
.ins-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 44px 56px 40px;
  max-width: 660px;

  @media (max-width: 767px) { padding: 28px 24px 24px; }
  @media (max-width: 599px) { padding: 20px 16px 20px; }
}

.ins-reinit-notice {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  color: #1d4ed8;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-left: 3px solid #3b82f6;
  border-radius: 6px;
  padding: 10px 14px;
  margin-bottom: 24px;
}

.ins-step-title {
  font-size: 21px;
  font-weight: 600;
  color: #18181b;
  letter-spacing: -0.025em;
  margin: 0 0 28px;
  line-height: 1.3;
}

.ins-step-body {
  flex: 1;
}

/* ── Footer nav ─────────────────────────────────────────────────── */
.ins-footer {
  display: flex;
  align-items: center;
  padding-top: 28px;
  margin-top: 28px;
  border-top: 1px solid #e4e4e7;
}

.ins-btn-back {
  font-size: 13px;
  color: #71717a !important;
  padding: 6px 10px;

  :deep(.q-btn__content) { font-weight: 400; }
}

.ins-btn-next,
.ins-btn-finish {
  font-size: 13px;
  font-weight: 500;
  padding: 8px 18px;
  border-radius: 8px;
  background: #4f46e5 !important;
  color: #fff !important;

  :deep(.q-btn__content) { gap: 6px; }
}
</style>
