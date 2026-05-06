<template>
  <q-layout view="hHh LpR fFf">
    <!-- Header -->
    <q-header elevated :class="$q.dark.isActive ? 'bg-grey-10' : 'bg-primary'">
      <q-toolbar>
        <q-btn
          flat
          dense
          round
          :icon="leftDrawerOpen ? 'menu_open' : 'menu'"
          :aria-label="$t('app.menuToggle')"
          @click="toggleLeftDrawer"
        />

        <q-toolbar-title>
          {{ $t('app.title') }}
        </q-toolbar-title>

        <q-space />

        <q-btn
          flat
          dense
          round
          :icon="$q.dark.isActive ? 'light_mode' : 'dark_mode'"
          :aria-label="$t('app.toggleTheme')"
          @click="toggleTheme"
        />

        <q-btn-dropdown
          v-if="authStore.user"
          flat
          dense
          icon="account_circle"
          :aria-label="$t('app.userMenu')"
        >
          <q-list>
            <q-item-label header>{{ authStore.user.email }}</q-item-label>
            <q-item clickable v-close-popup @click="goToSettings">
              <q-item-section>{{ $t('nav.settings') }}</q-item-section>
            </q-item>
            <q-item clickable v-close-popup @click="logout">
              <q-item-section>{{ $t('app.logout') }}</q-item-section>
            </q-item>
          </q-list>
        </q-btn-dropdown>
      </q-toolbar>
    </q-header>

    <!-- Sidebar -->
    <q-drawer
      v-model="leftDrawerOpen"
      show-if-above
      bordered
      :width="240"
      :breakpoint="1023"
    >
      <q-list>
        <q-item-label header>{{ $t('nav.heading') }}</q-item-label>

        <q-item
          v-for="link in navLinks"
          :key="link.routeName"
          :to="{ name: link.routeName }"
          clickable
          v-ripple
          active-class="text-primary"
        >
          <q-item-section avatar>
            <q-icon :name="link.icon" />
          </q-item-section>
          <q-item-section>{{ $t(link.labelKey) }}</q-item-section>
        </q-item>

        <q-separator class="q-my-md" />

        <q-item v-if="!systemStatusStore.allConfigured" class="text-warning">
          <q-item-section avatar>
            <q-icon name="warning" />
          </q-item-section>
          <q-item-section>
            {{ $t('app.setupIncomplete') }}
            <q-tooltip>{{ $t('app.setupIncompleteHint') }}</q-tooltip>
          </q-item-section>
        </q-item>
      </q-list>
    </q-drawer>

    <!-- Page content -->
    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useAuthStore } from 'src/stores/auth';
import { useUiStore } from 'src/stores/ui';
import { useSystemStatusStore } from 'src/stores/system-status';
import { useQuasar } from 'quasar';

const navLinks = [
  { routeName: 'inbox', icon: 'inbox', labelKey: 'nav.inbox' },
  { routeName: 'projects', icon: 'folder', labelKey: 'nav.projects' },
  { routeName: 'cost-dashboard', icon: 'payments', labelKey: 'nav.cost' },
  { routeName: 'activity', icon: 'history', labelKey: 'nav.activity' },
  { routeName: 'settings', icon: 'settings', labelKey: 'nav.settings' },
];

export default defineComponent({
  name: 'MainLayout',

  setup() {
    const $q = useQuasar();
    return {
      $q,
      authStore: useAuthStore(),
      uiStore: useUiStore(),
      systemStatusStore: useSystemStatusStore(),
    };
  },

  data: () => ({
    navLinks,
  }),

  computed: {
    leftDrawerOpen: {
      get(): boolean {
        return this.uiStore.sidebarOpen;
      },
      set(v: boolean): void {
        this.uiStore.sidebarOpen = v;
      },
    },
  },

  methods: {
    toggleLeftDrawer(): void {
      this.uiStore.sidebarOpen = !this.uiStore.sidebarOpen;
    },

    toggleTheme(): void {
      const newDark = !this.$q.dark.isActive;
      this.$q.dark.set(newDark);
      this.uiStore.setDarkMode(newDark);
    },

    goToSettings(): void {
      void this.$router.push({ name: 'settings' });
    },

    async logout(): Promise<void> {
      await this.authStore.logout();
      void this.$router.push({ name: 'login' });
    },
  },
});
</script>
