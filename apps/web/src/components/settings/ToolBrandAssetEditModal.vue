<template>
  <q-dialog
    :model-value="modelValue"
    persistent
    dark
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="modal-card">
      <header class="modal-header">
        <h2 class="modal-title">
          {{ $t("settings.toolBrandAssets.modal.title", { name: item?.toolTitle ?? "" }) as string }}
        </h2>
        <button type="button" class="modal-close" aria-label="Close" @click="onCancel">×</button>
      </header>

      <div v-if="loadingUsage" class="modal-banner">
        {{ $t("settings.toolBrandAssets.modal.loadingUsage") as string }}
      </div>
      <div v-else-if="usage && usage.otherProjectCount > 0" class="modal-banner info">
        {{
          $t("settings.toolBrandAssets.modal.multiDomainWarning", { n: usage.otherProjectCount }, usage.otherProjectCount) as string
        }}
      </div>

      <section class="modal-body">
        <div class="logo-block">
          <div class="logo-preview-wrap">
            <img
              v-if="item?.logoUrl"
              :src="assetUrl(item.logoUrl)"
              :alt="item.toolTitle"
              class="logo-preview"
            />
            <div v-else class="logo-placeholder">
              {{ initials }}
            </div>
          </div>
          <div v-if="item?.logoWordmarkUrl" class="logo-wordmark-wrap">
            <img
              :src="assetUrl(item.logoWordmarkUrl)"
              :alt="`${item.toolTitle} wordmark`"
              class="logo-wordmark"
            />
            <div class="logo-variant-label">{{ $t("settings.toolBrandAssets.modal.wordmarkLabel") as string }}</div>
          </div>
          <div class="logo-actions">
            <q-btn
              flat
              dense
              :loading="reresolving"
              :label="$t('settings.toolBrandAssets.modal.reresolve') as string"
              @click="onReresolve"
            />
            <q-btn
              flat
              dense
              :label="$t('settings.toolBrandAssets.modal.uploadCustom') as string"
              @click="onUploadClick"
            />
            <input
              ref="fileInput"
              type="file"
              accept=".svg,image/svg+xml"
              style="display: none"
              @change="onFileSelected"
            />
          </div>
          <div v-if="item" class="logo-source mono">
            {{ $t("settings.toolBrandAssets.modal.source") as string }}:
            <span>{{ item.source ?? "—" }}</span>
          </div>
        </div>

        <div class="form-block">
          <div class="form-group">
            <label class="form-label" for="brand-name-canonical">
              {{ $t("settings.toolBrandAssets.modal.brandNameCanonical") as string }}
            </label>
            <input
              id="brand-name-canonical"
              v-model="form.brandNameCanonical"
              class="form-input"
              type="text"
              :placeholder="item?.toolTitle ?? ''"
            />
          </div>

          <ColorPicker
            v-model="form.primaryColor"
            :label="$t('settings.toolBrandAssets.modal.primaryColor') as string"
          />
          <ColorPicker
            v-model="form.secondaryColor"
            :label="$t('settings.toolBrandAssets.modal.secondaryColor') as string"
          />
          <ColorPicker
            v-model="form.tertiaryColor"
            :label="$t('settings.toolBrandAssets.modal.tertiaryColor') as string"
          />

          <div v-if="willAutoFlip" class="form-hint">
            {{ $t("settings.toolBrandAssets.modal.autoFlipHint") as string }}
          </div>
        </div>
      </section>

      <footer class="modal-footer">
        <q-btn flat dark :label="$t('common.cancel') as string" @click="onCancel" />
        <q-btn
          color="primary"
          unelevated
          :loading="saving"
          :label="$t('settings.toolBrandAssets.modal.save') as string"
          @click="onSave"
        />
      </footer>
    </div>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import ColorPicker from "./ColorPicker.vue";
import { assetUrl } from "src/lib/asset-url";
import {
  getToolBrandAssetUsage,
  patchToolBrandAsset,
  reresolveToolBrandAsset,
  uploadCustomLogo,
  type UsageInfo,
  type ToolBrandAssetRow,
} from "src/composables/settings/useToolBrandAssetActions";
import type { ToolBrandAssetListItem } from "src/composables/settings/useToolBrandAssetsList";

interface FormState {
  brandNameCanonical: string;
  primaryColor: string | null;
  secondaryColor: string | null;
  tertiaryColor: string | null;
}

export default defineComponent({
  name: "ToolBrandAssetEditModal",

  components: { ColorPicker },

  props: {
    modelValue: { type: Boolean, default: false },
    item: {
      type: Object as PropType<ToolBrandAssetListItem | null>,
      default: null,
    },
    slug: { type: String, required: true },
  },

  emits: ["update:modelValue", "saved"],

  data: () => ({
    form: {
      brandNameCanonical: "",
      primaryColor: null,
      secondaryColor: null,
      tertiaryColor: null,
    } as FormState,
    saving: false,
    reresolving: false,
    usage: null as UsageInfo | null,
    loadingUsage: false,
  }),

  computed: {
    initials(): string {
      const title = this.item?.toolTitle ?? "";
      return title.slice(0, 2).toUpperCase();
    },
    willAutoFlip(): boolean {
      const hadIncomplete = this.item?.needsReview === true;
      return (
        hadIncomplete &&
        this.form.primaryColor !== null &&
        this.form.secondaryColor !== null
      );
    },
  },

  watch: {
    modelValue(open: boolean): void {
      if (open) {
        this.resetFromItem();
        void this.fetchUsage();
      }
    },
    item(): void {
      if (this.modelValue) this.resetFromItem();
    },
  },

  methods: {
    assetUrl,

    resetFromItem(): void {
      const item = this.item;
      if (!item) {
        this.form = {
          brandNameCanonical: "",
          primaryColor: null,
          secondaryColor: null,
          tertiaryColor: null,
        };
        return;
      }
      this.form = {
        brandNameCanonical: item.brandNameCanonical ?? "",
        primaryColor: item.primaryColor,
        secondaryColor: item.secondaryColor,
        tertiaryColor: item.tertiaryColor,
      };
    },

    async fetchUsage(): Promise<void> {
      if (!this.item) return;
      this.loadingUsage = true;
      try {
        this.usage = await getToolBrandAssetUsage({
          slug: this.slug,
          toolId: this.item.toolId,
        });
      } catch {
        this.usage = null;
      } finally {
        this.loadingUsage = false;
      }
    },

    onCancel(): void {
      this.$emit("update:modelValue", false);
    },

    /**
     * Emit `saved` to the parent + close the modal. Renamed from `notify` to
     * avoid the visual clash with `this.$q.notify` (Marcel said "passiert
     * nichts" — turned out the save WAS firing but with no toast feedback).
     */
    emitSavedAndClose(row: ToolBrandAssetRow): void {
      this.$emit("saved", row);
      this.$emit("update:modelValue", false);
    },

    async onSave(): Promise<void> {
      if (!this.item) return;
      this.saving = true;
      const result = await patchToolBrandAsset({
        slug: this.slug,
        toolId: this.item.toolId,
        primaryColor: this.form.primaryColor,
        secondaryColor: this.form.secondaryColor,
        tertiaryColor: this.form.tertiaryColor,
        brandNameCanonical:
          this.form.brandNameCanonical.trim() === ""
            ? null
            : this.form.brandNameCanonical.trim(),
      });
      this.saving = false;
      if (!result.ok) {
        this.$q.notify({
          type: "negative",
          message: result.error,
        });
        return;
      }
      // Spec 65.2 follow-up: success-toast so Marcel sees the save landed.
      // Without this the modal close + list-refetch happened silently and
      // the click felt like a no-op ("passiert nichts" feedback).
      this.$q.notify({
        type: "positive",
        message: this.$t("settings.toolBrandAssets.modal.saved") as string,
      });
      this.emitSavedAndClose(result.data);
    },

    async onReresolve(): Promise<void> {
      if (!this.item) return;
      this.reresolving = true;
      const result = await reresolveToolBrandAsset({
        slug: this.slug,
        toolId: this.item.toolId,
      });
      this.reresolving = false;
      if (!result.ok) {
        this.$q.notify({ type: "negative", message: result.error });
        return;
      }
      this.$q.notify({
        type: "positive",
        message: this.$t("settings.toolBrandAssets.modal.reresolved") as string,
      });
      this.emitSavedAndClose(result.data);
    },

    onUploadClick(): void {
      const input = this.$refs.fileInput as HTMLInputElement | undefined;
      input?.click();
    },

    async onFileSelected(e: Event): Promise<void> {
      if (!this.item) return;
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const result = await uploadCustomLogo({
        slug: this.slug,
        toolId: this.item.toolId,
        file,
      });
      // reset input so re-selecting the same file fires change again
      (e.target as HTMLInputElement).value = "";
      if (!result.ok) {
        this.$q.notify({ type: "negative", message: result.error });
        return;
      }
      this.$q.notify({
        type: "positive",
        message: this.$t("settings.toolBrandAssets.modal.uploaded") as string,
      });
      this.emitSavedAndClose(result.data);
    },
  },
});
</script>

<style scoped>
.modal-card {
  background: var(--bg-base);
  color: var(--text-primary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg, 12px);
  width: min(560px, 92vw);
  display: flex;
  flex-direction: column;
  max-height: 90vh;
  overflow: hidden;
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-subtle);
}
.modal-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}
.modal-close {
  background: transparent;
  color: var(--text-tertiary);
  border: 0;
  font-size: 22px;
  cursor: pointer;
}
.modal-banner {
  padding: 10px 20px;
  font-size: 12px;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-subtle);
}
.modal-banner.info {
  background: color-mix(in oklch, var(--color-info, #38bdf8) 12%, transparent);
}
.modal-body {
  display: grid;
  grid-template-columns: 160px 1fr;
  gap: 24px;
  padding: 20px;
  overflow-y: auto;
}
.logo-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
}
.logo-preview-wrap {
  width: 120px;
  height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--border-subtle);
  border-radius: var(--radius-md, 8px);
  /* White background so dark brand SVGs (simple-icons currentColor) stay
     visible — same reasoning as `.row-logo.has-logo` in the list page. */
  background: #fff;
  padding: 12px;
}
.logo-preview {
  max-width: 100%;
  max-height: 100%;
}
.logo-wordmark-wrap {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  background: #fff;
  border: 1px dashed var(--border-subtle);
  border-radius: var(--radius-md, 8px);
  padding: 10px 14px;
  width: 100%;
}
.logo-wordmark {
  max-width: 100%;
  max-height: 40px;
}
.logo-variant-label {
  font-size: 10px;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.logo-placeholder {
  font-size: 36px;
  font-weight: 700;
  color: var(--text-tertiary);
}
.logo-actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
}
.logo-source {
  font-size: 11px;
  color: var(--text-tertiary);
}
.form-block {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.form-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}
.form-input {
  height: 36px;
  padding: 0 10px;
  background: var(--bg-glass);
  color: var(--text-primary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-size: 13px;
}
.form-hint {
  font-size: 11px;
  color: var(--color-success, #22c55e);
}
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--border-subtle);
}
@media (max-width: 640px) {
  .modal-body {
    grid-template-columns: 1fr;
  }
}
</style>
