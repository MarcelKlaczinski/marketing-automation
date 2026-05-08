<template>
  <div class="spec-preview">
    <div class="text-subtitle2 q-mb-xs">{{ spec.proposedTitle }}</div>
    <div class="text-caption text-grey-7 q-mb-xs">
      <span class="text-weight-medium">{{ $t('cornerstones.pair.keyword') }}:</span>
      {{ spec.cornerstoneKeyword }}
    </div>
    <div class="text-caption text-grey-7 q-mb-xs">
      <span class="text-weight-medium">{{ $t('cornerstones.pair.slug') }}:</span>
      /{{ spec.proposedSlug }}/
    </div>
    <div class="text-caption text-grey-7 q-mb-xs">
      <span class="text-weight-medium">{{ $t('cornerstones.pair.wordCount') }}:</span>
      ~{{ spec.estimatedWordCount.toLocaleString() }}
    </div>
    <div class="text-caption text-grey-7 q-mb-sm">
      <span class="text-weight-medium">{{ $t('cornerstones.pair.meta') }}:</span>
      {{ spec.metaDescription }}
    </div>
    <div class="text-caption text-weight-medium text-grey-8 q-mb-xs">
      {{ $t('cornerstones.pair.outline') }}:
    </div>
    <ul class="spec-outline q-ma-none q-pl-md">
      <li v-for="(h2, idx) in spec.h2Outline" :key="idx" class="text-caption text-grey-8">
        {{ h2 }}
      </li>
    </ul>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import type { CornerstoneSpec } from "./types";

export default defineComponent({
  name: "SpecPreview",
  props: {
    spec: { type: Object as PropType<CornerstoneSpec>, required: true },
  },
});
</script>

<style scoped>
.spec-outline {
  line-height: 1.6;
}
</style>
