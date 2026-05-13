<template>
  <q-page class="q-pa-md">
    <div class="row items-center q-mb-md">
      <div class="text-h5">{{ $t('brand.assets.title') }}</div>
      <q-space />
      <q-btn
        color="primary"
        icon="upload"
        :label="$t('brand.assets.upload')"
        @click="openUpload(null)"
        unelevated
      />
    </div>

    <!-- Filters -->
    <div class="row q-gutter-sm q-mb-md">
      <q-btn-toggle
        v-model="typeFilter"
        :options="typeOptions"
        unelevated
        dense
        toggle-color="primary"
      />
      <q-space />
      <q-input
        v-model="search"
        :placeholder="$t('brand.assets.searchPlaceholder')"
        dense
        outlined
        clearable
        style="min-width: 200px"
      >
        <template #prepend>
          <q-icon name="search" />
        </template>
      </q-input>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex flex-center q-py-xl">
      <q-spinner size="40px" color="primary" />
    </div>

    <!-- Empty -->
    <div v-else-if="filteredAssets.length === 0" class="text-center text-grey q-py-xl">
      {{ $t('brand.assets.noAssets') }}
    </div>

    <!-- Grid -->
    <div v-else class="assets-grid">
      <AssetCard
        v-for="asset in filteredAssets"
        :key="asset.id"
        :asset="asset"
        @select="selectedAsset = asset"
        @override="openUpload(asset)"
        @reset="confirmReset(asset)"
        @delete="confirmDelete(asset)"
      />

      <!-- Upload placeholder card -->
      <q-card
        flat
        bordered
        class="asset-card-add cursor-pointer flex flex-center"
        @click="openUpload(null)"
      >
        <div class="column items-center text-grey">
          <q-icon name="add" size="32px" />
          <div class="text-caption q-mt-xs">{{ $t('brand.assets.upload') }}</div>
        </div>
      </q-card>
    </div>

    <!-- Upload modal -->
    <AssetUploadModal
      v-model="showUpload"
      :project-slug="slug"
      :prefill-asset-key="uploadPrefillKey"
      :prefill-asset-type="uploadPrefillType"
      @uploaded="onUploaded"
    />

    <!-- Confirm delete dialog -->
    <q-dialog v-model="showDeleteConfirm">
      <q-card>
        <q-card-section>{{ $t('brand.assets.confirmDelete') }}</q-card-section>
        <q-card-actions align="right">
          <q-btn flat :label="$t('common.cancel')" v-close-popup />
          <q-btn color="negative" :label="$t('brand.assets.delete')" @click="doDelete" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Confirm reset dialog -->
    <q-dialog v-model="showResetConfirm">
      <q-card>
        <q-card-section>{{ $t('brand.assets.confirmReset') }}</q-card-section>
        <q-card-actions align="right">
          <q-btn flat :label="$t('common.cancel')" v-close-popup />
          <q-btn color="warning" :label="$t('brand.assets.reset')" @click="doReset" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { api } from "src/lib/api-client";
import AssetCard, { type BrandAsset } from "src/components/brand/AssetCard.vue";
import AssetUploadModal from "src/components/brand/AssetUploadModal.vue";

export default defineComponent({
  name: "AssetBrowserPage",

  components: { AssetCard, AssetUploadModal },

  props: {
    slug: {
      type: String,
      required: true,
    },
  },

  data: () => ({
    assets: [] as BrandAsset[],
    loading: false,
    search: "",
    typeFilter: "all" as string,
    showUpload: false,
    uploadPrefillKey: null as string | null,
    uploadPrefillType: null as string | null,
    selectedAsset: null as BrandAsset | null,
    showDeleteConfirm: false,
    showResetConfirm: false,
    pendingAsset: null as BrandAsset | null,
  }),

  computed: {
    typeOptions() {
      return [
        { label: this.$t("brand.assets.toolIcons") as string, value: "tool_icon" },
        { label: this.$t("brand.assets.logos") as string, value: "logo" },
        { label: this.$t("brand.assets.filterAll") as string, value: "all" },
      ];
    },

    filteredAssets(): BrandAsset[] {
      let list = this.assets;

      if (this.typeFilter !== "all") {
        list = list.filter((a) => a.assetType === this.typeFilter);
      }

      if (this.search.trim()) {
        const q = this.search.toLowerCase();
        list = list.filter(
          (a) =>
            a.assetKey.toLowerCase().includes(q) ||
            (a.displayName ?? "").toLowerCase().includes(q)
        );
      }

      return list;
    },
  },

  mounted() {
    void this.loadAssets();
  },

  methods: {
    async loadAssets() {
      this.loading = true;
      try {
        const res = await api.get<{
          ok: boolean;
          data: { assets: BrandAsset[]; summary: unknown };
        }>(`/api/projects/${this.slug}/brand-assets`);
        this.assets = res.data.data.assets;
      } finally {
        this.loading = false;
      }
    },

    openUpload(asset: BrandAsset | null) {
      this.uploadPrefillKey = asset?.assetKey ?? null;
      this.uploadPrefillType = asset?.assetType ?? null;
      this.showUpload = true;
    },

    onUploaded() {
      void this.loadAssets();
    },

    confirmDelete(asset: BrandAsset) {
      this.pendingAsset = asset;
      this.showDeleteConfirm = true;
    },

    confirmReset(asset: BrandAsset) {
      this.pendingAsset = asset;
      this.showResetConfirm = true;
    },

    async doDelete() {
      if (!this.pendingAsset) return;
      this.showDeleteConfirm = false;
      await api.delete(`/api/projects/${this.slug}/brand-assets/${this.pendingAsset.id}`);
      this.pendingAsset = null;
      void this.loadAssets();
    },

    async doReset() {
      if (!this.pendingAsset) return;
      this.showResetConfirm = false;
      await api.post(`/api/projects/${this.slug}/brand-assets/${this.pendingAsset.id}/reset`);
      this.pendingAsset = null;
      void this.loadAssets();
    },
  },
});
</script>

<style scoped>
.assets-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.asset-card-add {
  width: 100px;
  min-height: 110px;
  border-style: dashed;
  transition: border-color 0.2s;
}

.asset-card-add:hover {
  border-color: var(--q-primary);
  color: var(--q-primary);
}
</style>
