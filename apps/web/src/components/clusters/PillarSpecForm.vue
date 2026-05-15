<template>
  <div class="q-gutter-md">
    <!-- Pillar title -->
    <q-input
      v-model="local.pillar_title"
      outlined
      :label="$t('clusters.create.pillarTitle') as string"
      :hint="$t('clusters.create.pillarTitleHint') as string"
      :rules="[v => (v && v.length >= 10 && v.length <= 200) || 'Mindestens 10 Zeichen']"
      maxlength="200"
      counter
      lazy-rules
      @update:model-value="onTitleChange"
    />

    <!-- Pillar slug -->
    <q-input
      v-model="local.pillar_slug"
      outlined
      :label="$t('clusters.create.pillarSlug') as string"
      :hint="$t('clusters.create.pillarSlugHint') as string"
      :rules="[v => /^[a-z0-9-]+$/.test(v) || 'Nur Kleinbuchstaben, Zahlen und Bindestriche']"
      maxlength="120"
      lazy-rules
      style="font-family: monospace;"
    />

    <!-- Meta description with character counter -->
    <div>
      <q-input
        v-model="local.pillar_meta"
        outlined
        type="textarea"
        :label="$t('clusters.create.pillarMeta') as string"
        :hint="`${$t('clusters.create.pillarMetaHint')} (${local.pillar_meta?.length ?? 0}/160)`"
        :rules="[
          v => (v && v.length >= 50) || 'Mindestens 50 Zeichen',
          v => v.length <= 160 || 'Maximal 160 Zeichen'
        ]"
        maxlength="160"
        rows="3"
        lazy-rules
      />
    </div>

    <!-- Outline (drag-reorder) -->
    <div>
      <div class="text-caption text-grey-7 q-mb-xs">{{ $t('clusters.create.pillarOutline') }}</div>
      <div class="text-caption text-grey-6 q-mb-sm">{{ $t('clusters.create.pillarOutlineHint') }}</div>

      <q-list bordered separator class="q-mb-sm">
        <q-item
          v-for="(item, idx) in local.pillar_outline"
          :key="idx"
          class="q-pa-sm"
          draggable="true"
          @dragstart="onDragStart(idx)"
          @dragover.prevent="onDragOver(idx)"
          @drop.prevent="onDrop(idx)"
        >
          <q-item-section side>
            <q-icon name="drag_indicator" color="grey-5" style="cursor: grab;" />
          </q-item-section>
          <q-item-section>
            <q-input
              v-model="local.pillar_outline[idx]"
              borderless
              dense
              :placeholder="`${$t('clusters.create.pillarOutlineItem', { n: idx + 1 })}`"
              maxlength="150"
              @update:model-value="emitUpdate"
            />
          </q-item-section>
          <q-item-section side>
            <q-btn
              flat
              dense
              round
              icon="close"
              color="grey-5"
              size="sm"
              :disable="local.pillar_outline.length <= 5"
              @click="removeOutlineItem(idx)"
            />
          </q-item-section>
        </q-item>
      </q-list>

      <q-btn
        v-if="local.pillar_outline.length < 10"
        flat
        no-caps
        dense
        icon="add"
        :label="$t('clusters.create.addOutlineItem') as string"
        color="primary"
        size="sm"
        @click="addOutlineItem"
      />
      <div v-if="local.pillar_outline.length < 5" class="text-caption text-negative q-mt-xs">
        Mindestens 5 Abschnitte erforderlich
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";

interface PillarShapeLocal {
  pillar_title: string;
  pillar_slug: string;
  pillar_meta: string;
  pillar_outline: string[];
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[äöüÄÖÜ]/g, (c) => ({ ä: "ae", ö: "oe", ü: "ue", Ä: "ae", Ö: "oe", Ü: "ue" }[c] ?? c))
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default defineComponent({
  name: "PillarSpecForm",

  props: {
    modelValue: {
      type: Object as PropType<PillarShapeLocal>,
      required: true,
    },
  },

  emits: ["update:modelValue"],

  data() {
    return {
      local: {
        pillar_title: this.modelValue.pillar_title,
        pillar_slug: this.modelValue.pillar_slug,
        pillar_meta: this.modelValue.pillar_meta,
        pillar_outline: [...(this.modelValue.pillar_outline ?? [])],
      } as PillarShapeLocal,
      dragFromIdx: -1 as number,
    };
  },

  watch: {
    modelValue: {
      deep: true,
      handler(v: PillarShapeLocal) {
        this.local = {
          pillar_title: v.pillar_title,
          pillar_slug: v.pillar_slug,
          pillar_meta: v.pillar_meta,
          pillar_outline: [...(v.pillar_outline ?? [])],
        };
      },
    },
  },

  methods: {
    onTitleChange(val: string | number | null): void {
      if (typeof val === "string" && val) {
        // Auto-derive slug if slug looks auto-generated (no manual edits detected)
        const derived = slugify(val);
        if (derived) {
          this.local.pillar_slug = derived;
        }
      }
      this.emitUpdate();
    },

    emitUpdate(): void {
      this.$emit("update:modelValue", {
        ...this.modelValue,
        pillar_title: this.local.pillar_title,
        pillar_slug: this.local.pillar_slug,
        pillar_meta: this.local.pillar_meta,
        pillar_outline: [...this.local.pillar_outline],
      });
    },

    addOutlineItem(): void {
      if (this.local.pillar_outline.length >= 10) return;
      this.local.pillar_outline.push("");
      this.emitUpdate();
    },

    removeOutlineItem(idx: number): void {
      if (this.local.pillar_outline.length <= 5) return;
      this.local.pillar_outline.splice(idx, 1);
      this.emitUpdate();
    },

    onDragStart(idx: number): void {
      this.dragFromIdx = idx;
    },

    onDragOver(idx: number): void {
      void idx;
    },

    onDrop(toIdx: number): void {
      if (this.dragFromIdx === toIdx || this.dragFromIdx < 0) return;
      const items = [...this.local.pillar_outline];
      const [moved] = items.splice(this.dragFromIdx, 1);
      if (moved !== undefined) {
        items.splice(toIdx, 0, moved);
      }
      this.local.pillar_outline = items;
      this.dragFromIdx = -1;
      this.emitUpdate();
    },
  },
});
</script>
