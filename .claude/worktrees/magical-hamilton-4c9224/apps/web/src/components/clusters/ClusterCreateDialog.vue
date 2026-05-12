<template>
  <q-dialog :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)">
    <q-card style="min-width: 420px;">
      <q-card-section>
        <div class="text-h6">{{ title }}</div>
      </q-card-section>
      <q-card-section class="q-gutter-md">
        <q-input
          v-model="name"
          outlined
          dense
          autofocus
          :label="nameLabel"
          :rules="[
            (v: string) => (v && v.trim().length >= 2) || $t('clusters.validation.nameTooShort') as string,
          ]"
        />
        <q-input
          v-if="extraFieldLabel"
          v-model="extra"
          outlined
          dense
          :label="extraFieldLabel + (extraFieldOptional ? ' (' + ($t('common.optional') as string) + ')' : '')"
        />
        <q-input
          v-if="descriptionField"
          v-model="description"
          outlined
          type="textarea"
          autogrow
          :label="$t('clusters.fields.description') + ' (' + ($t('common.optional') as string) + ')'"
          :hint="$t('clusters.fields.descriptionHint')"
        />
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat :label="$t('common.cancel') as string" v-close-popup />
        <q-btn
          color="primary"
          :label="$t('common.create') as string"
          :disable="!isValid"
          @click="onConfirm"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  name: "ClusterCreateDialog",

  props: {
    modelValue: { type: Boolean, default: false },
    title: { type: String, required: true },
    nameLabel: { type: String, required: true },
    extraFieldLabel: { type: String, default: "" },
    extraFieldOptional: { type: Boolean, default: false },
    descriptionField: { type: Boolean, default: false },
  },

  emits: ["update:modelValue", "confirm"],

  data: () => ({
    name: "",
    extra: "",
    description: "",
  }),

  computed: {
    isValid(): boolean {
      return this.name.trim().length >= 2;
    },
  },

  watch: {
    modelValue(open: boolean): void {
      if (open) {
        this.name = "";
        this.extra = "";
        this.description = "";
      }
    },
  },

  methods: {
    onConfirm(): void {
      if (!this.isValid) return;
      const payload: { name: string; extra?: string; description?: string } = {
        name: this.name.trim(),
      };
      if (this.extra.trim()) payload.extra = this.extra.trim();
      if (this.description.trim()) payload.description = this.description.trim();
      this.$emit("confirm", payload);
    },
  },
});
</script>
