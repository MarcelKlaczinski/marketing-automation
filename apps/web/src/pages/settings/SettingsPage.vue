<template>
  <div class="settings-page">
    <aside class="settings-nav">
      <h2 class="settings-nav-title">{{ $t("settings.title") }}</h2>
      <ul class="settings-nav-list">
        <li v-for="section in sections" :key="section.key">
          <router-link
            :to="`/projects/${projectSlug}/settings/${section.key}`"
            class="settings-nav-item"
            active-class="settings-nav-active"
          >
            <span>{{ $t(`settings.sections.${section.key}`) }}</span>
          </router-link>
        </li>
      </ul>
    </aside>

    <main class="settings-content">
      <router-view />
    </main>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  name: "SettingsPage",

  computed: {
    projectSlug(): string {
      return this.$route.params.slug as string;
    },
    sections() {
      return [
        { key: "project" },
        { key: "brand-tokens" },
        { key: "brand-assets" },
        { key: "credentials" },
        { key: "signal-sources" },
        { key: "planner" },
        { key: "inventory" },
      ];
    },
  },
});
</script>

<style scoped>
.settings-page {
  display: grid;
  grid-template-columns: 220px 1fr;
  height: 100%;
  background: var(--bg-base);
  overflow: hidden;
}

.settings-nav {
  border-right: 1px solid var(--border-subtle);
  padding: 24px 12px;
  overflow-y: auto;
}

.settings-nav-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-tertiary);
  padding: 0 8px;
  margin: 0 0 12px;
}

.settings-nav-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.settings-nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  text-decoration: none;
  transition: background 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
              color 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

@media (hover: hover) and (pointer: fine) {
  .settings-nav-item:hover {
    background: var(--bg-glass-strong);
    color: var(--text-primary);
  }
}

.settings-nav-active {
  background: var(--bg-glass-strong);
  color: var(--text-primary);
}

.settings-content {
  padding: 24px 32px;
  overflow-y: auto;
  max-width: 800px;
}

.nav-icon {
  font-size: 14px;
}

@media (max-width: 1023px) {
  .settings-page {
    grid-template-columns: 1fr;
  }

  .settings-nav {
    border-right: none;
    border-bottom: 1px solid var(--border-subtle);
    padding: 12px;
  }

  .settings-nav-list {
    flex-direction: row;
    flex-wrap: wrap;
  }

  .settings-content {
    padding: 16px;
    max-width: 100%;
  }
}
</style>
