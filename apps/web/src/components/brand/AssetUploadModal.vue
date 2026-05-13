<template>
  <q-dialog v-model="show" persistent>
    <q-card style="min-width: 400px; max-width: 560px">
      <q-card-section>
        <div class="text-h6">{{ $t('brand.assets.uploadTitle') }}</div>
      </q-card-section>

      <q-card-section class="q-pt-none">
        <q-select
          v-model="form.assetType"
          :options="assetTypeOptions"
          :label="$t('brand.assets.assetType')"
          emit-value
          map-options
          outlined
          dense
          class="q-mb-md"
        />

        <q-input
          v-model="form.assetKey"
          :label="$t('brand.assets.assetKey')"
          :hint="$t('brand.assets.assetKeyHint')"
          outlined
          dense
          class="q-mb-md"
          autocomplete="off"
        />

        <q-input
          v-model="form.displayName"
          :label="$t('brand.assets.displayName')"
          outlined
          dense
          class="q-mb-md"
          autocomplete="off"
        />

        <!-- Drop zone -->
        <div
          class="drop-zone q-pa-md text-center rounded-borders"
          :class="{ 'drop-zone--active': dragging, 'drop-zone--has-file': !!selectedFile }"
          @dragover.prevent="dragging = true"
          @dragleave="dragging = false"
          @drop.prevent="onDrop"
          @click="triggerFilePicker"
        >
          <input
            ref="fileInput"
            type="file"
            accept=".svg,.png,.jpg,.jpeg"
            style="display: none"
            @change="onFileChange"
          />
          <template v-if="!selectedFile">
            <q-icon name="cloud_upload" size="32px" color="grey-5" />
            <div class="text-body2 q-mt-sm">{{ $t('brand.assets.dropFile') }}</div>
            <div class="text-caption text-grey-6">{{ $t('brand.assets.orClick') }}</div>
            <div class="text-caption text-grey-5 q-mt-xs">{{ $t('brand.assets.maxSize') }}</div>
          </template>
          <template v-else>
            <q-icon name="check_circle" size="32px" color="positive" />
            <div class="text-body2 q-mt-sm">{{ selectedFile.name }}</div>
            <div class="text-caption text-grey-6">{{ fileSizeLabel }}</div>
          </template>
        </div>

        <q-banner v-if="sizeError" class="text-negative q-mt-sm" dense>
          {{ sizeError }}
        </q-banner>
      </q-card-section>

      <q-card-actions align="right">
        <q-btn flat :label="$t('common.cancel')" @click="close" :disable="uploading" />
        <q-btn
          color="primary"
          :label="uploading ? $t('brand.assets.uploading') : $t('brand.assets.upload')"
          :loading="uploading"
          :disable="!canUpload"
          @click="upload"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import { api } from "src/lib/api-client";
import { useQuasar } from "quasar";

const MAX_FILE_SIZE = 500 * 1024;

export default defineComponent({
  name: "AssetUploadModal",

  props: {
    modelValue: {
      type: Boolean,
      required: true,
    },
    projectSlug: {
      type: String,
      required: true,
    },
    prefillAssetKey: {
      type: String as PropType<string | null>,
      default: null,
    },
    prefillAssetType: {
      type: String as PropType<string | null>,
      default: null,
    },
  },

  emits: ["update:modelValue", "uploaded"],

  setup() {
    const $q = useQuasar();
    return { $q };
  },

  data: () => ({
    form: {
      assetType: "tool_icon" as string,
      assetKey: "",
      displayName: "",
    },
    selectedFile: null as File | null,
    dragging: false,
    uploading: false,
    sizeError: "" as string,
  }),

  computed: {
    show: {
      get(): boolean {
        return this.modelValue;
      },
      set(v: boolean) {
        this.$emit("update:modelValue", v);
      },
    },

    assetTypeOptions() {
      return [
        { label: this.$t("brand.assets.toolIcons") as string, value: "tool_icon" },
        { label: this.$t("brand.assets.logos") as string, value: "logo" },
      ];
    },

    fileSizeLabel(): string {
      if (!this.selectedFile) return "";
      const kb = (this.selectedFile.size / 1024).toFixed(1);
      return `${kb} KB`;
    },

    canUpload(): boolean {
      return (
        !!this.form.assetKey.trim() &&
        !!this.selectedFile &&
        !this.sizeError
      );
    },
  },

  watch: {
    modelValue(v: boolean) {
      if (v) this.reset();
    },
    prefillAssetKey(v: string | null) {
      if (v) this.form.assetKey = v;
    },
    prefillAssetType(v: string | null) {
      if (v) this.form.assetType = v;
    },
  },

  methods: {
    reset() {
      this.form.assetType = this.prefillAssetType ?? "tool_icon";
      this.form.assetKey = this.prefillAssetKey ?? "";
      this.form.displayName = "";
      this.selectedFile = null;
      this.sizeError = "";
      this.uploading = false;
    },

    close() {
      this.show = false;
    },

    triggerFilePicker() {
      (this.$refs["fileInput"] as HTMLInputElement).click();
    },

    onFileChange(e: Event) {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) this.setFile(file);
    },

    onDrop(e: DragEvent) {
      this.dragging = false;
      const file = e.dataTransfer?.files[0];
      if (file) this.setFile(file);
    },

    setFile(file: File) {
      if (file.size > MAX_FILE_SIZE) {
        this.sizeError = this.$t("brand.assets.maxSize") as string;
        this.selectedFile = null;
        return;
      }
      this.sizeError = "";
      this.selectedFile = file;
    },

    async upload() {
      if (!this.canUpload || !this.selectedFile) return;
      this.uploading = true;

      try {
        const fd = new FormData();
        fd.append("file", this.selectedFile);
        fd.append("assetType", this.form.assetType);
        fd.append("assetKey", this.form.assetKey.trim());
        if (this.form.displayName.trim()) fd.append("displayName", this.form.displayName.trim());

        const res = await api.post<{ ok: boolean; data: { asset: unknown; previewUrl: string } }>(
          `/projects/${this.projectSlug}/brand-assets/upload`,
          fd,
          { headers: { "Content-Type": "multipart/form-data" } }
        );

        this.$emit("uploaded", res.data.data);
        this.show = false;
        this.$q.notify({ type: "positive", message: this.$t("common.saved") as string });
      } catch {
        // HttpError surfaces via global interceptor
      } finally {
        this.uploading = false;
      }
    },
  },
});
</script>

<style scoped>
.drop-zone {
  border: 2px dashed #ccc;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
  min-height: 120px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.drop-zone--active {
  border-color: var(--q-primary);
  background: rgba(var(--q-primary-rgb), 0.05);
}

.drop-zone--has-file {
  border-color: var(--q-positive);
}
</style>
