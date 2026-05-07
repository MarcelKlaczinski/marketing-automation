<template>
  <q-page padding>
    <h1 class="text-h5 q-mb-lg">{{ $t('settings.title') }}</h1>

    <q-tabs
      v-model="activeTab"
      align="left"
      class="text-grey-8 q-mb-lg"
      indicator-color="primary"
      active-color="primary"
      narrow-indicator
      @update:model-value="onTabChange"
    >
      <q-tab name="adapters" :label="$t('settings.tabs.adapters') as string" icon="api" />
      <q-tab name="system" :label="$t('settings.tabs.system') as string" icon="dns" />
      <q-tab name="profile" :label="$t('settings.tabs.profile') as string" icon="person" />
      <q-tab name="notifications" :label="$t('settings.tabs.notifications') as string" icon="notifications" />
    </q-tabs>

    <q-tab-panels v-model="activeTab" animated class="bg-transparent">
      <q-tab-panel name="adapters" class="q-px-none">
        <SettingsAdaptersPanel />
      </q-tab-panel>
      <q-tab-panel name="system" class="q-px-none">
        <SettingsSystemPanel />
      </q-tab-panel>
      <q-tab-panel name="profile" class="q-px-none">
        <SettingsProfilePanel />
      </q-tab-panel>
      <q-tab-panel name="notifications" class="q-px-none">
        <NotificationsPanel />
      </q-tab-panel>
    </q-tab-panels>
  </q-page>
</template>

<script lang="ts">
import NotificationsPanel from "src/components/settings/NotificationsPanel.vue";
import SettingsAdaptersPanel from "src/components/settings/SettingsAdaptersPanel.vue";
import SettingsProfilePanel from "src/components/settings/SettingsProfilePanel.vue";
import SettingsSystemPanel from "src/components/settings/SettingsSystemPanel.vue";
import { defineComponent } from "vue";

type TabName = "adapters" | "system" | "profile" | "notifications";

export default defineComponent({
  name: "SettingsPage",

  components: {
    SettingsAdaptersPanel,
    SettingsSystemPanel,
    SettingsProfilePanel,
    NotificationsPanel,
  },

  data: () => ({
    activeTab: "adapters" as TabName,
  }),

  created() {
    const raw = this.$route.query.tab;
    const tabFromQuery = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");
    if (["adapters", "system", "profile", "notifications"].includes(tabFromQuery)) {
      this.activeTab = tabFromQuery as TabName;
    }
  },

  methods: {
    onTabChange(newTab: string | number | null): void {
      if (typeof newTab !== "string") return;
      void this.$router.replace({ query: { ...this.$route.query, tab: newTab } });
    },
  },
});
</script>
