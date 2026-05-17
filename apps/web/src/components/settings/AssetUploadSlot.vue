<template>
  <GlassCard variant="strong" class="asset-upload-slot">
    <div class="slot-header">
      <h3 class="slot-title">{{ title }}</h3>
      <p v-if="description" class="slot-description">{{ description }}</p>
    </div>

    <div class="slot-preview">
      <template v-if="currentAsset">
        <img
          v-if="currentAsset.inlineSvg || currentAsset.url"
          :src="currentAsset.inlineSvg ? svgDataUrl : (currentAsset.url ?? '')"
          :alt="title"
          class="asset-preview-img"
        />
        <span v-else class="asset-placeholder mono">{{ $t("settings.brandAssets.noAsset") as string }}</span>
      </template>
      <div v-else class="asset-drop-area" @click="triggerFileInput" @dragover.prevent @drop.prevent="onDrop">
        <span class="drop-label">{{ $t("settings.brandAssets.uploadDrag") as string }}</span>
        <input ref="fileInput" type="file" :accept="acceptedMimeTypes.join(',')" class="file-input" @change="onFileChange" />
      </div>
    </div>

    <div v-if="uploadError" class="upload-error">{{ $t("settings.brandAssets.uploadError") as string }}</div>

    <div class="slot-actions">
      <GlassButton v-if="currentAsset" variant="ghost" size="sm" :loading="uploading" @click="triggerFileInput">
        {{ $t("settings.brandAssets.uploadLabel") as string }}
        <input ref="fileInput" type="file" :accept="acceptedMimeTypes.join(',')" class="file-input" @change="onFileChange" />
      </GlassButton>
      <GlassButton v-if="currentAsset" variant="danger" size="sm" :loading="deleting" @click="onDelete">
        {{ $t("settings.brandAssets.deleteLabel") as string }}
      </GlassButton>
      <GlassButton v-if="!currentAsset" variant="primary" size="sm" :loading="uploading" @click="triggerFileInput">
        {{ $t("settings.brandAssets.uploadLabel") as string }}
        <input ref="fileInput" type="file" :accept="acceptedMimeTypes.join(',')" class="file-input" @change="onFileChange" />
      </GlassButton>
    </div>
  </GlassCard>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import type { PropType } from "vue";
import GlassCard from "src/components/ui/GlassCard.vue";
import GlassButton from "src/components/ui/GlassButton.vue";

interface BrandAsset {
  id: string;
  assetType: string;
  assetKey: string;
  inlineSvg?: string | null;
  url?: string | null;
}

export default defineComponent({
  name: "AssetUploadSlot",

  components: { GlassCard, GlassButton },

  props: {
    title: { type: String, required: true },
    description: { type: String, default: "" },
    assetType: { type: String, required: true },
    assetKey: { type: String, required: true },
    currentAsset: { type: Object as PropType<BrandAsset | null>, default: null },
    acceptedMimeTypes: {
      type: Array as PropType<string[]>,
      default: () => ["image/svg+xml", "image/png", "image/jpeg"],
    },
  },

  emits: ["upload", "delete"],

  data: () => ({
    uploading: false,
    deleting: false,
    uploadError: false,
  }),

  computed: {
    svgDataUrl(): string {
      if (!this.currentAsset?.inlineSvg) return "";
      return `data:image/svg+xml;utf8,${encodeURIComponent(this.currentAsset.inlineSvg)}`;
    },
  },

  methods: {
    triggerFileInput(): void {
      const el = this.$refs.fileInput as HTMLInputElement | undefined;
      el?.click();
    },

    onFileChange(e: Event): void {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      this.uploadFile(file);
    },

    onDrop(e: DragEvent): void {
      const file = e.dataTransfer?.files[0];
      if (!file) return;
      this.uploadFile(file);
    },

    uploadFile(file: File): void {
      this.uploadError = false;
      this.$emit("upload", { file, assetType: this.assetType, assetKey: this.assetKey });
    },

    onDelete(): void {
      this.$emit("delete", { assetId: this.currentAsset?.id });
    },
  },
});
</script>

<style scoped>
.asset-upload-slot {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
}

.slot-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.slot-description {
  font-size: 12px;
  color: var(--text-tertiary);
  margin: 4px 0 0;
}

.slot-preview {
  min-height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.asset-preview-img {
  max-width: 200px;
  max-height: 80px;
  object-fit: contain;
  border-radius: var(--radius-sm);
}

.asset-drop-area {
  width: 100%;
  min-height: 80px;
  border: 1px dashed var(--border-soft);
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: border-color 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

@media (hover: hover) and (pointer: fine) {
  .asset-drop-area:hover {
    border-color: var(--accent-primary);
  }
}

.drop-label {
  font-size: 12px;
  color: var(--text-tertiary);
  pointer-events: none;
}

.asset-placeholder {
  font-size: 12px;
  color: var(--text-tertiary);
}

.file-input {
  display: none;
}

.upload-error {
  font-size: 12px;
  color: var(--color-error, #e53e3e);
}

.slot-actions {
  display: flex;
  gap: 8px;
}
</style>
