<template>
  <div class="settings-brand-assets-page">
    <h1 class="page-title">{{ $t("settings.brandAssets.title") as string }}</h1>

    <div class="asset-grid">
      <AssetUploadSlot
        v-for="slot in assetSlots"
        :key="slot.key"
        :asset-type="slot.type"
        :asset-key="slot.key"
        :title="$t(`settings.brandAssets.slots.${slot.key}.title`) as string"
        :description="$t(`settings.brandAssets.slots.${slot.key}.description`) as string"
        :current-asset="findAsset(slot.type, slot.key)"
        :accepted-mime-types="slot.mimeTypes"
        @upload="onUpload"
        @delete="onDelete"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { useRoute } from "vue-router";
import AssetUploadSlot from "src/components/settings/AssetUploadSlot.vue";
import { apiDelete } from "src/lib/api";

const BASE = (import.meta.env.VITE_API_BASE_URL as string) ?? "http://localhost:3000/api";

interface BrandAsset {
  id: string;
  assetType: string;
  assetKey: string;
  inlineSvg?: string | null;
  url?: string | null;
}

interface AssetSlot {
  type: string;
  key: string;
  mimeTypes: string[];
}

const ASSET_SLOTS: AssetSlot[] = [
  { type: "logo", key: "logo", mimeTypes: ["image/svg+xml", "image/png", "image/jpeg"] },
  { type: "tool_icon", key: "tool_icon", mimeTypes: ["image/svg+xml", "image/png"] },
];

export default defineComponent({
  name: "SettingsBrandAssetsPage",

  components: { AssetUploadSlot },

  setup() {
    const route = useRoute();
    const slug = route.params.slug as string;
    const queryClient = useQueryClient();

    const { data: assets } = useQuery({
      queryKey: ["brand-assets", slug],
      queryFn: async () => {
        const res = await fetch(`${BASE}/projects/${slug}/brand-assets`, {
          credentials: "include",
        });
        const body = (await res.json()) as { ok: boolean; data: BrandAsset[] };
        return body.data;
      },
    });

    return { slug, queryClient, assets };
  },

  data: () => ({
    assetSlots: ASSET_SLOTS,
  }),

  methods: {
    findAsset(type: string, key: string): BrandAsset | null {
      return (
        (this.assets ?? []).find(
          (a) => a.assetType === type && a.assetKey === key,
        ) ?? null
      );
    },

    async onUpload(payload: { file: File; assetType: string; assetKey: string }): Promise<void> {
      const fd = new FormData();
      fd.append("file", payload.file);
      fd.append("assetType", payload.assetType);
      fd.append("assetKey", payload.assetKey);

      await fetch(`${BASE}/projects/${this.slug}/brand-assets/upload`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });

      await this.queryClient.invalidateQueries({ queryKey: ["brand-assets", this.slug] });
    },

    async onDelete(payload: { assetId: string }): Promise<void> {
      await apiDelete(`/projects/${this.slug}/brand-assets/${payload.assetId}`);
      await this.queryClient.invalidateQueries({ queryKey: ["brand-assets", this.slug] });
    },
  },
});
</script>

<style scoped>
.settings-brand-assets-page {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.page-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.asset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}
</style>
