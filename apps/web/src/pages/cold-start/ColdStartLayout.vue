<template>
  <div class="cold-start-layout">
    <header class="cold-start-header">
      <div class="cold-start-brand">
        <div class="cs-logo" aria-hidden="true">
          <span class="cs-logo-text mono">MA</span>
        </div>
        <h1 class="cs-title">{{ $t("coldStart.title") as string }}</h1>
      </div>

      <div class="cold-start-actions">
        <GlassButton
          v-if="canSaveAndExit"
          variant="ghost"
          @click="onSaveAndExit"
        >
          {{ $t("coldStart.saveAndExit") as string }}
        </GlassButton>
        <GlassButton
          variant="ghost"
          @click="onAbandon"
        >
          {{ $t("coldStart.abandon") as string }}
        </GlassButton>
      </div>
    </header>

    <PhaseProgressBar
      :current-phase="currentPhase"
      :total-phases="5"
      :completed-phases="completedPhases"
    />

    <main class="cold-start-content">
      <router-view v-slot="{ Component, route: childRoute }">
        <transition name="phase-fade" mode="out-in">
          <component :is="Component" :key="childRoute.path" />
        </transition>
      </router-view>
    </main>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useColdStartDraft } from "src/composables/useColdStartDraft";
import { apiPost } from "src/lib/api";
import GlassButton from "src/components/ui/GlassButton.vue";
import PhaseProgressBar from "src/components/cold-start/PhaseProgressBar.vue";

export default defineComponent({
  name: "ColdStartLayout",

  components: { GlassButton, PhaseProgressBar },

  setup() {
    return useColdStartDraft();
  },

  computed: {
    currentPhase(): number {
      return this.state?.currentPhase ?? 1;
    },
    completedPhases(): number[] {
      return this.state?.completedPhases ?? [];
    },
    canSaveAndExit(): boolean {
      return !!this.draftId && !this.finalizing;
    },
  },

  methods: {
    onSaveAndExit(): void {
      // Draft auto-saves on each PATCH — navigate away to persist silently
      void this.$router.push("/");
    },
    async onAbandon(): Promise<void> {
      const ok = await this.$q
        .dialog({
          title: this.$t("coldStart.abandonConfirm.title") as string,
          message: this.$t("coldStart.abandonConfirm.message") as string,
          cancel: true,
          persistent: true,
        })
        .onOk(() => true)
        .onCancel(() => false)
        .onDismiss(() => false);

      if (!ok) return;

      try {
        await apiPost(`/cold-start/${this.draftId}/abandon`);
      } catch {
        // best-effort; still navigate away
      }
      void this.$router.push("/");
    },
  },
});
</script>

<style scoped>
.cold-start-layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  background: var(--bg-base);
}

.cold-start-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24px 32px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.cold-start-brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.cs-logo {
  width: 32px;
  height: 32px;
  background: var(--accent-primary);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
}

.cs-logo-text {
  font-size: 11px;
  font-weight: 700;
  color: white;
  letter-spacing: 0.05em;
}

.cs-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.cold-start-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cold-start-content {
  flex: 1;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 48px 24px;
}

/* Phase transitions */
.phase-fade-enter-active,
.phase-fade-leave-active {
  transition: opacity 200ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
              transform 200ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.phase-fade-enter-from {
  opacity: 0;
  transform: translateY(20px);
}

.phase-fade-leave-to {
  opacity: 0;
  transform: translateY(-20px);
}

@media (max-width: 768px) {
  .cold-start-header {
    padding: 16px 20px;
  }

  .cold-start-content {
    padding: 24px 16px;
  }
}
</style>
