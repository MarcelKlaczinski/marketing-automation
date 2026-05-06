<template>
  <div>
    <p class="si-desc">{{ $t('installer.steps.intro.description') }}</p>

    <div class="si-time-hint">
      <q-icon name="schedule" size="14px" />
      <span>{{ $t('installer.steps.intro.timeEstimate') }}</span>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'StepIntro',
  emits: ['configured', 'skipped'],
});
</script>

<style lang="scss" scoped>
.si-desc {
  font-size: 14px;
  color: #52525b;
  line-height: 1.65;
  margin: 0 0 20px;
}

.si-time-hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #71717a;
  background: #f4f4f5;
  border: 1px solid #e4e4e7;
  border-radius: 20px;
  padding: 5px 12px;
}
</style>
