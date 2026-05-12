<template>
  <q-dialog
    :model-value="modelValue"
    persistent
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <q-card style="min-width: 420px;">
      <q-card-section class="row items-center">
        <q-icon name="warning" color="negative" size="32px" class="q-mr-md" />
        <div>
          <div class="text-h6">{{ title }}</div>
          <div class="text-body2 text-grey-7 q-mt-xs">{{ message }}</div>
        </div>
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat :label="$t('common.cancel') as string" v-close-popup />
        <q-btn
          color="negative"
          :label="$t('common.delete') as string"
          :loading="loading"
          @click="$emit('confirm')"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  name: "ConfirmDeleteDialog",

  props: {
    modelValue: { type: Boolean, default: false },
    title: { type: String, required: true },
    message: { type: String, required: true },
    loading: { type: Boolean, default: false },
  },

  emits: ["update:modelValue", "confirm"],
});
</script>
