<template>
  <q-dialog :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)">
    <q-card style="min-width: 320px; max-width: 500px">
      <q-card-section>
        <div class="text-h6">{{ $t('cornerstones.actions.rejectTitle') }}</div>
      </q-card-section>

      <q-card-section class="q-pt-none">
        <q-input
          v-model="reason"
          type="textarea"
          :label="$t('cornerstones.actions.rejectReason')"
          outlined
          dense
          rows="3"
          autogrow
        />
      </q-card-section>

      <q-card-actions align="right">
        <q-btn
          flat
          :label="$t('cornerstones.actions.cancel')"
          @click="$emit('update:modelValue', false)"
        />
        <q-btn
          flat
          color="negative"
          :label="$t('cornerstones.actions.rejectConfirm')"
          :loading="loading"
          @click="submit"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import { Notify } from "quasar";
import { api } from "src/lib/api-client";
import type { CornerstonePair, CornerstoneSpec } from "./types";

export default defineComponent({
  name: "CornerstoneRejectDialog",
  emits: ["update:modelValue", "rejected"],
  props: {
    modelValue: { type: Boolean, required: true },
    pair: { type: Object as PropType<CornerstonePair>, required: true },
    slug: { type: String, required: true },
    spec: { type: Object as PropType<CornerstoneSpec | null>, default: null },
  },

  data: () => ({
    reason: "" as string,
    loading: false,
  }),

  methods: {
    async submit(): Promise<void> {
      if (!this.spec) return;
      this.loading = true;
      try {
        await api.post(`/projects/${this.slug}/cornerstone-specs/${this.spec.id}/reject`, {
          reason: this.reason || null,
        });
        Notify.create({
          type: "positive",
          message: this.$t("cornerstones.notify.specRejected") as string,
        });
        this.$emit("update:modelValue", false);
        this.$emit("rejected");
        this.reason = "";
      } catch {
        Notify.create({
          type: "negative",
          message: this.$t("cornerstones.notify.generationError") as string,
        });
      } finally {
        this.loading = false;
      }
    },
  },
});
</script>
