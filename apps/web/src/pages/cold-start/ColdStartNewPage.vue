<template>
  <div class="cold-start-new">
    <div class="new-page-bg" aria-hidden="true" />

    <GlassCard variant="elevated" class="new-card">
      <div class="new-card-logo" aria-hidden="true">
        <span class="new-logo-text mono">MA</span>
      </div>

      <h1 class="new-card-title">{{ $t("coldStart.new.title") as string }}</h1>
      <p class="new-card-description">{{ $t("coldStart.new.description") as string }}</p>

      <div class="new-actions">
        <GlassButton
          variant="primary"
          class="new-start-btn"
          :loading="starting"
          @click="onStartNew"
        >
          {{ $t("coldStart.new.start") as string }}
        </GlassButton>

        <GlassButton
          v-if="hasExistingDrafts"
          variant="secondary"
          @click="$router.push('/cold-start/drafts')"
        >
          {{ $t("coldStart.new.resumeDraft") as string }}
        </GlassButton>
      </div>
    </GlassCard>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { apiGet, apiPost } from "src/lib/api";
import GlassCard from "src/components/ui/GlassCard.vue";
import GlassButton from "src/components/ui/GlassButton.vue";
import type { ColdStartDraftListItem } from "src/types/cold-start";

export default defineComponent({
  name: "ColdStartNewPage",

  components: { GlassCard, GlassButton },

  data: () => ({
    starting: false,
    existingDrafts: [] as ColdStartDraftListItem[],
  }),

  computed: {
    hasExistingDrafts(): boolean {
      return this.existingDrafts.length > 0;
    },
  },

  async mounted() {
    try {
      const drafts = await apiGet<ColdStartDraftListItem[]>("/cold-start/drafts");
      this.existingDrafts = drafts ?? [];
    } catch {
      // Optional — don't block entry if endpoint isn't available yet
    }
  },

  methods: {
    async onStartNew(): Promise<void> {
      this.starting = true;
      try {
        const result = await apiPost<{ draftId: string }>("/cold-start/initialize");
        const draftId = result.draftId;
        if (draftId) {
          void this.$router.push(`/cold-start/${draftId}/phase-1`);
        }
      } catch (err) {
        this.$q.notify({
          type: "negative",
          message:
            err instanceof Error ? err.message : (this.$t("coldStart.errors.initFailed") as string),
        });
      } finally {
        this.starting = false;
      }
    },
  },
});
</script>

<style scoped>
.cold-start-new {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--bg-base);
  position: relative;
}

.new-page-bg {
  position: fixed;
  inset: 0;
  background:
    radial-gradient(ellipse 60% 40% at 30% 20%, rgba(124, 92, 255, 0.12) 0%, transparent 60%),
    radial-gradient(ellipse 50% 35% at 70% 70%, rgba(220, 38, 127, 0.08) 0%, transparent 55%);
  pointer-events: none;
  z-index: 0;
}

.new-card {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 440px;
  padding: 48px 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  text-align: center;
}

.new-card-logo {
  width: 48px;
  height: 48px;
  background: var(--accent-primary);
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
}

.new-logo-text {
  font-size: 14px;
  font-weight: 700;
  color: white;
  letter-spacing: 0.05em;
}

.new-card-title {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.03em;
  margin: 0;
  background: linear-gradient(135deg, var(--text-primary) 0%, var(--accent-primary) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.new-card-description {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0;
  max-width: 340px;
}

.new-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 100%;
  margin-top: 8px;
}

.new-start-btn {
  width: 100%;
  justify-content: center;
  padding: 12px 24px;
  font-size: 14px;
  min-height: 44px;
}

@media (max-width: 480px) {
  .new-card {
    padding: 32px 24px;
  }
}
</style>
