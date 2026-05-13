<template>
  <q-card
    flat
    bordered
    class="asset-card cursor-pointer"
    @click="$emit('select', asset)"
  >
    <q-card-section class="q-pa-sm column items-center">
      <!-- SVG / PNG preview -->
      <div class="asset-preview q-mb-sm">
        <img
          v-if="asset.previewUrl && asset.source !== 'deterministic-avatar'"
          :src="asset.previewUrl"
          :alt="asset.displayName || asset.assetKey"
          class="asset-img"
          loading="lazy"
        />
        <!-- Avatar fallback -->
        <q-avatar
          v-else
          size="40px"
          :style="{ backgroundColor: avatarColor, color: 'white', fontSize: '14px', fontWeight: 600 }"
        >
          {{ initials }}
        </q-avatar>
      </div>

      <div class="text-caption text-weight-medium ellipsis full-width text-center" style="max-width: 80px">
        {{ asset.displayName || asset.assetKey }}
      </div>

      <span
        class="q-mt-xs"
        style="font-size: 9px; border-radius: 3px; padding: 1px 4px; color: white; font-weight: 600; letter-spacing: 0.02em"
        :style="{ backgroundColor: sourceBadgeColor }"
      >
        {{ shortSourceLabel }}
      </span>
    </q-card-section>

    <!-- Hover actions -->
    <div class="asset-card-actions">
      <q-btn
        flat
        dense
        round
        icon="upload"
        size="sm"
        :aria-label="$t('brand.assets.override')"
        @click.stop="$emit('override', asset)"
      >
        <q-tooltip>{{ $t('brand.assets.override') }}</q-tooltip>
      </q-btn>
      <q-btn
        flat
        dense
        round
        icon="refresh"
        size="sm"
        :aria-label="$t('brand.assets.reset')"
        @click.stop="$emit('reset', asset)"
      >
        <q-tooltip>{{ $t('brand.assets.reset') }}</q-tooltip>
      </q-btn>
      <q-btn
        v-if="asset.source === 'custom-upload'"
        flat
        dense
        round
        icon="delete"
        size="sm"
        color="negative"
        :aria-label="$t('brand.assets.delete')"
        @click.stop="$emit('delete', asset)"
      >
        <q-tooltip>{{ $t('brand.assets.delete') }}</q-tooltip>
      </q-btn>
    </div>
  </q-card>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";

export interface BrandAsset {
  id: string;
  assetType: string;
  assetKey: string;
  source: string;
  sourceRef: string | null;
  inlineSvg: string | null;
  r2Key: string | null;
  displayName: string | null;
  metadata: Record<string, unknown>;
  previewUrl: string;
}

const SOURCE_COLORS: Record<string, string> = {
  "simple-icons": "#1565c0",
  iconify: "#2e7d32",
  "lobe-icons": "#6a1b9a",
  "custom-upload": "#e65100",
  wordmark: "#37474f",
  "deterministic-avatar": "#546e7a",
};

const SOURCE_SHORT: Record<string, string> = {
  "simple-icons": "SI",
  iconify: "ICO",
  "lobe-icons": "LI",
  "custom-upload": "UP",
  wordmark: "WM",
  "deterministic-avatar": "AVT",
};

export default defineComponent({
  name: "AssetCard",

  props: {
    asset: {
      type: Object as PropType<BrandAsset>,
      required: true,
    },
  },

  emits: ["select", "override", "reset", "delete"],

  computed: {
    sourceBadgeColor(): string {
      return SOURCE_COLORS[this.asset.source] ?? "grey";
    },

    shortSourceLabel(): string {
      return SOURCE_SHORT[this.asset.source] ?? this.asset.source.slice(0, 4).toUpperCase();
    },

    initials(): string {
      return this.asset.assetKey.slice(0, 2).toUpperCase();
    },

    avatarColor(): string {
      let h = 0;
      for (let i = 0; i < this.asset.assetKey.length; i++) {
        h = (h * 31 + this.asset.assetKey.charCodeAt(i)) % 360;
      }
      return `hsl(${h},60%,45%)`;
    },
  },
});
</script>

<style scoped>
.asset-card {
  position: relative;
  width: 100px;
  min-height: 110px;
  transition: box-shadow 0.2s;
}

.asset-card:hover {
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
}

.asset-preview {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.asset-img {
  max-width: 40px;
  max-height: 40px;
  object-fit: contain;
}

.asset-card-actions {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.55);
  display: none;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border-radius: inherit;
}

.asset-card:hover .asset-card-actions {
  display: flex;
}
</style>
