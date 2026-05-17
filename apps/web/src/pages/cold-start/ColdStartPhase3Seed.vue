<template>
  <PhaseShell
    :current-phase="3"
    :title="$t('coldStart.phases.seed.title') as string"
    :description="$t('coldStart.phases.seed.description') as string"
    :can-advance="hasPillars && hasAuthors"
    :busy="busy"
    @advance="onAdvance"
    @back="back()"
  >
    <!-- Pillars subsection -->
    <section class="seed-section">
      <header class="seed-section-header">
        <div class="seed-section-text">
          <h3>{{ $t("coldStart.phases.seed.pillars.title") as string }}</h3>
          <p>{{ $t("coldStart.phases.seed.pillars.description") as string }}</p>
        </div>
        <GlassButton
          v-if="!hasPillars"
          variant="primary"
          :loading="generatingPillars"
          @click="onGeneratePillars"
        >
          {{ $t("coldStart.phases.seed.pillars.generate") as string }}
        </GlassButton>
        <GlassButton
          v-else
          variant="ghost"
          :loading="generatingPillars"
          @click="onRegeneratePillars"
        >
          {{ $t("coldStart.phases.seed.pillars.regenerate") as string }}
        </GlassButton>
      </header>

      <template v-if="hasPillars">
        <div class="seed-cards stagger-list">
          <PillarCard
            v-for="(pillar, idx) in form.pillars"
            :key="pillar.id ?? idx"
            :pillar="pillar"
            :index="idx"
            class="stagger-item"
            @update="onUpdatePillar(idx, $event)"
            @remove="onRemovePillar(idx)"
          />
        </div>
        <button type="button" class="add-card-btn" @click="onAddPillar">
          + {{ $t("coldStart.phases.seed.pillars.add") as string }}
        </button>
      </template>

      <div v-else-if="generatingPillars" class="shimmer-list">
        <LoadingShimmer v-for="i in 3" :key="i" variant="card" height="140px" />
      </div>
    </section>

    <!-- Authors subsection -->
    <section class="seed-section">
      <header class="seed-section-header">
        <div class="seed-section-text">
          <h3>{{ $t("coldStart.phases.seed.authors.title") as string }}</h3>
          <p>{{ $t("coldStart.phases.seed.authors.description") as string }}</p>
        </div>
        <GlassButton
          v-if="!hasAuthors"
          variant="primary"
          :disabled="!hasPillars"
          :loading="generatingAuthors"
          @click="onGenerateAuthors"
        >
          {{ $t("coldStart.phases.seed.authors.generate") as string }}
        </GlassButton>
        <GlassButton
          v-else
          variant="ghost"
          :loading="generatingAuthors"
          @click="onRegenerateAuthors"
        >
          {{ $t("coldStart.phases.seed.authors.regenerate") as string }}
        </GlassButton>
      </header>

      <template v-if="hasAuthors">
        <div class="seed-cards stagger-list">
          <AuthorPersonaCard
            v-for="(author, idx) in form.authors"
            :key="author.slug ?? idx"
            :author="author"
            :index="idx"
            class="stagger-item"
            @update="onUpdateAuthor(idx, $event)"
            @remove="onRemoveAuthor(idx)"
          />
        </div>
      </template>

      <div v-else-if="generatingAuthors" class="shimmer-list">
        <LoadingShimmer v-for="i in 3" :key="i" variant="card" height="180px" />
      </div>
    </section>
  </PhaseShell>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useColdStartDraft } from "src/composables/useColdStartDraft";
import { apiPost } from "src/lib/api";
import PhaseShell from "src/components/cold-start/PhaseShell.vue";
import PillarCard from "src/components/cold-start/PillarCard.vue";
import AuthorPersonaCard from "src/components/cold-start/AuthorPersonaCard.vue";
import GlassButton from "src/components/ui/GlassButton.vue";
import LoadingShimmer from "src/components/ui/LoadingShimmer.vue";
import type { ColdStartDraft, ColdStartPillar, ColdStartAuthor } from "src/types/cold-start";

export default defineComponent({
  name: "ColdStartPhase3Seed",

  components: { PhaseShell, PillarCard, AuthorPersonaCard, GlassButton, LoadingShimmer },

  setup() {
    return useColdStartDraft();
  },

  data: () => ({
    busy: false,
    generatingPillars: false,
    generatingAuthors: false,
    form: {
      pillars: [] as ColdStartPillar[],
      authors: [] as ColdStartAuthor[],
    },
  }),

  computed: {
    hasPillars(): boolean {
      return this.form.pillars.length > 0;
    },
    hasAuthors(): boolean {
      return this.form.authors.length > 0;
    },
  },

  watch: {
    draft: {
      immediate: true,
      handler(newDraft: ColdStartDraft | undefined) {
        if (!newDraft) return;
        if (newDraft.pillars?.length) {
          this.form.pillars = newDraft.pillars.map((p: ColdStartPillar) => ({ ...p }));
        }
        if (newDraft.authors?.length) {
          this.form.authors = newDraft.authors.map((a: ColdStartAuthor) => ({ ...a }));
        }
      },
    },
  },

  methods: {
    async onGeneratePillars(): Promise<void> {
      this.generatingPillars = true;
      try {
        const result = await apiPost<{ pillars: ColdStartPillar[] }>(
          `/cold-start/${this.draftId}/seed-pillars`,
        );
        this.form.pillars = result.pillars ?? [];
      } catch (err) {
        this.$q.notify({
          type: "negative",
          message: err instanceof Error ? err.message : (this.$t("errors.generic") as string),
        });
      } finally {
        this.generatingPillars = false;
      }
    },
    async onRegeneratePillars(): Promise<void> {
      this.form.pillars = [];
      await this.onGeneratePillars();
    },
    async onGenerateAuthors(): Promise<void> {
      this.generatingAuthors = true;
      try {
        const result = await apiPost<{ authors: ColdStartAuthor[] }>(
          `/cold-start/${this.draftId}/seed-authors`,
        );
        this.form.authors = result.authors ?? [];
      } catch (err) {
        this.$q.notify({
          type: "negative",
          message: err instanceof Error ? err.message : (this.$t("errors.generic") as string),
        });
      } finally {
        this.generatingAuthors = false;
      }
    },
    async onRegenerateAuthors(): Promise<void> {
      this.form.authors = [];
      await this.onGenerateAuthors();
    },
    onUpdatePillar(idx: number, updated: ColdStartPillar): void {
      this.form.pillars.splice(idx, 1, updated);
    },
    onRemovePillar(idx: number): void {
      this.form.pillars.splice(idx, 1);
    },
    onAddPillar(): void {
      this.form.pillars.push({ name: "", description: "", keywords: [] });
    },
    onUpdateAuthor(idx: number, updated: ColdStartAuthor): void {
      this.form.authors.splice(idx, 1, updated);
    },
    onRemoveAuthor(idx: number): void {
      this.form.authors.splice(idx, 1);
    },
    async onAdvance(): Promise<void> {
      if (!this.hasPillars || !this.hasAuthors) return;
      this.busy = true;
      try {
        await this.updateDraft({
          pillars: this.form.pillars,
          authors: this.form.authors,
        });
        await this.advance();
      } catch (err) {
        this.$q.notify({
          type: "negative",
          message: err instanceof Error ? err.message : (this.$t("errors.generic") as string),
        });
      } finally {
        this.busy = false;
      }
    },
  },
});
</script>

<style scoped>
.seed-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--border-subtle);
}

.seed-section:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.seed-section-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.seed-section-text h3 {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 4px;
}

.seed-section-text p {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.5;
}

.seed-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.add-card-btn {
  background: transparent;
  border: 1px dashed var(--border-medium);
  border-radius: var(--radius-md);
  padding: 10px;
  width: 100%;
  text-align: center;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: border-color 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
              color 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
  min-height: 44px;
}

@media (hover: hover) and (pointer: fine) {
  .add-card-btn:hover {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }
}

.shimmer-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
</style>
