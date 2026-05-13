<template>
  <div class="brand-panel">
    <div class="row q-col-gutter-md">
      <div
        v-for="item in brandItems"
        :key="item.route"
        class="col-12 col-sm-6 col-md-3"
      >
        <q-card
          flat
          bordered
          clickable
          v-ripple
          class="brand-card cursor-pointer full-height"
          @click="$router.push({ name: item.route, params: { slug } })"
        >
          <q-card-section class="column items-center q-py-lg">
            <q-icon :name="item.icon" size="48px" color="primary" class="q-mb-md" />
            <div class="text-subtitle1 text-weight-medium">{{ $t(item.titleKey) }}</div>
            <div class="text-caption text-grey-6 text-center q-mt-xs">{{ $t(item.descKey) }}</div>
          </q-card-section>
        </q-card>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  name: "BrandPanel",

  props: {
    slug: { type: String, required: true },
  },

  data: () => ({
    brandItems: [
      {
        route: "brand-assets",
        icon: "image",
        titleKey: "brand.navigation.assets",
        descKey: "brand.navigation.assetsDesc",
      },
      {
        route: "brand-colors",
        icon: "palette",
        titleKey: "brand.navigation.colors",
        descKey: "brand.navigation.colorsDesc",
      },
      {
        route: "brand-typography",
        icon: "text_fields",
        titleKey: "brand.navigation.typography",
        descKey: "brand.navigation.typographyDesc",
      },
      {
        route: "social-posts-admin",
        icon: "photo_library",
        titleKey: "brand.navigation.socialAdmin",
        descKey: "brand.navigation.socialAdminDesc",
      },
    ],
  }),
});
</script>

<style scoped>
.brand-card {
  transition: border-color 0.15s;
}
.brand-card:hover {
  border-color: var(--q-primary);
}
</style>
