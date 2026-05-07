<template>
  <div :class="['phase-section', `phase-section--${status}`, { 'phase-section--locked': !unlocked }]">
    <div class="phase-section__header" @click="onToggle">
      <div class="phase-section__index">{{ index }}</div>
      <div class="phase-section__main">
        <div class="phase-section__title">{{ title }}</div>
        <div class="phase-section__description">{{ description }}</div>
      </div>
      <div class="phase-section__status">
        <PhaseStatusPill :status="status" />
      </div>
      <q-icon
        :name="expanded ? 'expand_less' : 'expand_more'"
        size="20px"
        class="q-ml-sm"
      />
    </div>

    <div v-if="!unlocked" class="phase-section__locked-hint">
      <q-icon name="lock" size="14px" class="q-mr-xs" />
      {{ $t('coldStart.lockedHint') }}
    </div>

    <div v-show="expanded && unlocked" class="phase-section__body">
      <slot />
    </div>
  </div>
</template>

<script lang="ts">
import type { PhaseStatusLabel } from "src/stores/cold-start";
import { type PropType, defineComponent } from "vue";
import PhaseStatusPill from "./PhaseStatusPill.vue";

export default defineComponent({
  name: "PhaseSection",

  components: { PhaseStatusPill },

  props: {
    index: { type: Number, required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    status: { type: String as PropType<PhaseStatusLabel>, required: true },
    unlocked: { type: Boolean, default: true },
  },

  data: () => ({
    expanded: false,
  }),

  watch: {
    status: {
      immediate: true,
      handler(newStatus: PhaseStatusLabel) {
        if (this.unlocked && newStatus !== "complete") {
          this.expanded = true;
        }
        if (newStatus === "complete") {
          this.expanded = false;
        }
      },
    },
    unlocked: {
      immediate: true,
      handler(isUnlocked: boolean) {
        if (isUnlocked && this.status !== "complete") {
          this.expanded = true;
        }
      },
    },
  },

  methods: {
    onToggle(): void {
      if (this.unlocked) this.expanded = !this.expanded;
    },
  },
});
</script>

<style lang="scss" scoped>
.phase-section {
  border: 1px solid var(--q-separator-color, rgba(0, 0, 0, 0.12));
  border-radius: 8px;
  margin-bottom: 16px;
  background: var(--q-card-bg, #fff);

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.04);
  }

  &--locked {
    opacity: 0.55;
  }
}

.phase-section__header {
  display: flex;
  align-items: center;
  padding: 16px 20px;
  cursor: pointer;
  user-select: none;
  gap: 12px;
}

.phase-section--locked .phase-section__header {
  cursor: not-allowed;
}

.phase-section__index {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.06);
  color: rgba(0, 0, 0, 0.6);
  font-weight: 600;
  font-size: 14px;

  body.body--dark & {
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.7);
  }
}

.phase-section--complete .phase-section__index {
  background: rgba(33, 186, 69, 0.18);
  color: #21ba45;
}

.phase-section__main {
  flex-grow: 1;
  min-width: 0;
}

.phase-section__title {
  font-weight: 600;
  font-size: 15px;
}

.phase-section__description {
  font-size: 13px;
  color: rgba(0, 0, 0, 0.6);
  margin-top: 2px;

  body.body--dark & {
    color: rgba(255, 255, 255, 0.6);
  }
}

.phase-section__status {
  flex-shrink: 0;
}

.phase-section__locked-hint {
  padding: 0 20px 16px 64px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;

  body.body--dark & {
    color: rgba(255, 255, 255, 0.45);
  }
}

.phase-section__body {
  padding: 0 20px 20px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);

  body.body--dark & {
    border-top-color: rgba(255, 255, 255, 0.06);
  }
}
</style>
