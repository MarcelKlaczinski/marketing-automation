<template>
  <section class="inbox-section">
    <div class="inbox-section__header">
      <h2 class="inbox-section__title">
        {{ title }}
        <span v-if="!loading && count > 0" class="inbox-section__count">({{ count }})</span>
      </h2>
    </div>

    <div v-if="loading" class="inbox-section__loading">
      <q-skeleton type="rect" height="80px" class="q-mb-sm" />
      <q-skeleton type="rect" height="80px" />
    </div>

    <div v-else-if="isEmpty" class="inbox-section__empty">
      {{ emptyMessage }}
    </div>

    <slot v-else />
  </section>
</template>

<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'InboxSection',

  props: {
    title: { type: String, required: true },
    count: { type: Number, default: 0 },
    loading: { type: Boolean, default: false },
    isEmpty: { type: Boolean, default: false },
    emptyMessage: { type: String, default: '' },
  },
});
</script>

<style lang="scss" scoped>
.inbox-section__header {
  margin-bottom: 16px;
}

.inbox-section__title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.7));
}

.inbox-section__count {
  font-weight: 400;
  margin-left: 8px;
  font-size: 14px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
}

.inbox-section__loading {
  min-height: 180px;
}

.inbox-section__empty {
  padding: 32px 16px;
  text-align: center;
  font-size: 13px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.5));
  font-style: italic;
  border: 1px dashed var(--q-grey-3, #e0e0e0);
  border-radius: 8px;

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }
}
</style>
