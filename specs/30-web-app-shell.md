# Spec 30: Web App Shell

**Phase:** 4 (Web App Foundation Wave 1)
**Estimated Effort:** 1.5 days (1-2 sessions)
**Dependencies:** none (Phase-3 backend is fully functional and audited)
**Status:** Ready for implementation
**Recommended Model:** Sonnet 4.6 (frontend boilerplate is template-y; Opus not needed)

---

## Goal

Build the **frontend application shell**: a Quasar 2 + Vite + TypeScript app that runs alongside the existing API and provides the foundation every Phase-4 feature spec builds on.

After this spec:
- A working Quasar dev server runs on port **3051**
- Layout: header + collapsible sidebar + main content area, responsive (desktop + mobile, NOT touch-first)
- Routing for all 11 planned Phase-4 routes (most are stub pages — actual implementation in later specs)
- vue-i18n with `de` locale (full coverage) and `en` locale (stub structure for later)
- Pinia stores: `auth`, `ui`, `system-status`
- HTTP client wired to the API at `import.meta.env.VITE_API_BASE_URL`
- Light/dark theme toggle with system-preference detection
- Centralized error handling + Quasar Notify for user feedback

This spec **does not** wire actual auth (Spec 31), the installer (Spec 32), or any feature views. The shell is structurally complete but functionally minimal — it boots, navigates between empty pages, looks polished, and is ready for Spec 31 to plug in.

## Architecture Decisions

**Decision 1: Quasar CLI with Vite, not plain Vite + Quasar plugin.**
The Quasar CLI provides `quasar.config.ts`, boot files, automatic component imports, and a path to PWA/Capacitor targets later (Spec 40 wants Web Push, which needs PWA mode). Plain Vite would be lighter but locks us into rebuilding all that infrastructure ourselves. Marcel knows this stack from Vanilla v3 — same patterns transfer.

**Decision 2: Vue 3 with Options API for components, Composition API for composables.**
Per Marcel's standing user-memory preferences. Components use `<script lang="ts">` with `data: () => ({...})` arrow shorthand. Composables in `src/composables/` use Composition API for reusable logic.

**Decision 3: TypeScript strict mode.**
Mirrors the backend's strictness. The `tsconfig.json` extends Quasar's auto-generated `.quasar/tsconfig.json` and adds the same strictness flags as `tsconfig.base.json` in the backend monorepo where compatible.

**Decision 4: vue-i18n with `de` default + `en` stub.**
All UI strings go through `t()`. Initial bundle: only `de`. The `en/` folder structure is created with empty key files mirroring `de/`, ready to be filled later. No loader logic for runtime locale switching yet — locale is fixed to `de` in `i18n/index.ts`.

**Decision 5: Pinia for state management.**
Three stores baseline: `auth`, `ui`, `system-status`. More are added in later specs. Stores expose typed actions and getters; components consume via `useXxxStore()`.

**Decision 6: Port 3051 for dev server.**
Per Marcel's preference, avoids conflict with API on 3000.

**Decision 7: Mode-aware base URL.**
`VITE_API_BASE_URL` defaults to `http://localhost:3000/api`. Production builds inject the deployed API URL. The HTTP client always uses this var, never hardcodes.

**Decision 8: Quasar Material Design colors, custom palette.**
We don't use Quasar's default `$primary` blue. Custom palette: a calm, professional indigo for `$primary`, neutral grays for surfaces. Keeps the tool feeling tool-like, not playful.

**Decision 9: No Tailwind.**
Quasar's design system + scoped component styles only. Avoids dual-styling-system confusion.

**Decision 10: Responsive sidebar (left-drawer), no bottom nav.**
Sidebar collapses to a hamburger menu under 1023px. No bottom navigation. Marcel works mostly desktop; mobile is functional but not optimized.

## Non-Goals

- **No auth implementation** — login form is a stub; Spec 31 makes it real
- **No installer** — `/installer` route exists as stub; Spec 32 fills it
- **No feature views** — pages are placeholders that say "Coming in Spec X"
- **No Service Worker / PWA registration** — Spec 40 enables it
- **No Capacitor / mobile app build target** — out of scope
- **No SSR** — pure SPA
- **No production deployment config** — Marcel runs it locally; Spec 41+ would add deployment
- **No test setup** beyond what Quasar CLI generates by default — Vitest unit tests can be added per-component later
- **No Storybook** — out of scope

## Detailed Implementation

### Workspace Position

Frontend lives at `apps/web/` (sibling to `apps/api/`). The root `package.json` workspace declaration already includes `apps/*`, so it's auto-detected. Verify before scaffolding.

```
marketing-automation/
├── apps/
│   ├── api/             # existing
│   └── web/             # NEW
├── packages/
│   ├── adapters/
│   ├── db/
│   └── ...
└── package.json
```

### Scaffolding

We do NOT use `npm init quasar` interactively. Marcel creates the structure manually following this spec, because the interactive scaffolder makes choices we'd need to override anyway. Reference: https://quasar.dev/quasar-cli-vite/quasar-config-file

```bash
mkdir -p apps/web
cd apps/web
```

Then create files per the structure below.

### `apps/web/package.json`

```json
{
  "name": "@marketing-auto/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "quasar dev",
    "build": "quasar build",
    "lint": "eslint --ext .js,.ts,.vue src",
    "typecheck": "vue-tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@quasar/extras": "^1.16.0",
    "axios": "^1.7.0",
    "pinia": "^2.2.0",
    "quasar": "^2.17.0",
    "vue": "^3.5.0",
    "vue-i18n": "^10.0.0",
    "vue-router": "^4.4.0"
  },
  "devDependencies": {
    "@quasar/app-vite": "^2.0.0",
    "@types/node": "^22.0.0",
    "@vue/eslint-config-typescript": "^14.0.0",
    "autoprefixer": "^10.4.0",
    "eslint": "^9.0.0",
    "eslint-plugin-vue": "^9.27.0",
    "sass-embedded": "^1.93.2",
    "typescript": "~5.6.0",
    "vue-tsc": "^2.1.0"
  },
  "engines": {
    "node": ">=20"
  }
}
```

Note: explicit versions may need adjustment when scaffolding — verify against latest at install time. Use `bun install` from the monorepo root, since the workspace setup handles linking.

### `apps/web/quasar.config.ts`

```typescript
/* eslint-env node */
import { defineConfig } from '#q-app/wrappers';
import { fileURLToPath } from 'node:url';

export default defineConfig((/* ctx */) => ({
  eslint: {
    warnings: true,
    errors: true,
  },

  // https://v2.quasar.dev/quasar-cli-vite/prefetch-feature
  preFetch: false,

  // app boot file (/src/boot)
  // --> boot files are part of "main.js"
  // https://v2.quasar.dev/quasar-cli-vite/boot-files
  boot: ['i18n', 'axios', 'pinia'],

  // https://v2.quasar.dev/quasar-cli-vite/quasar-config-file#css
  css: ['app.scss'],

  // https://github.com/quasarframework/quasar/tree/dev/extras
  extras: ['material-icons', 'roboto-font'],

  // https://v2.quasar.dev/quasar-cli-vite/quasar-config-file#build
  build: {
    target: {
      browser: ['es2022', 'firefox115', 'chrome115', 'safari14'],
      node: 'node20',
    },
    typescript: {
      strict: true,
      vueShim: true,
    },
    vueRouterMode: 'history',
    env: {
      VITE_API_BASE_URL: process.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api',
    },
  },

  // https://v2.quasar.dev/quasar-cli-vite/quasar-config-file#devServer
  devServer: {
    port: 3051,
    open: false,
  },

  // https://v2.quasar.dev/quasar-cli-vite/quasar-config-file#framework
  framework: {
    config: {
      brand: {
        primary: '#3f51b5',      // indigo 500
        secondary: '#26a69a',
        accent: '#7c4dff',
        dark: '#1d1d1d',
        positive: '#21ba45',
        negative: '#c10015',
        info: '#31ccec',
        warning: '#f2c037',
      },
      notify: {
        position: 'top-right',
        timeout: 4000,
      },
    },

    // Quasar plugins to make available app-wide
    plugins: ['Notify', 'Dialog', 'LocalStorage', 'Dark'],

    // Whether iconSet to use; default 'material-icons'
    iconSet: 'material-icons',

    // For language packs, see boot/i18n.ts
    lang: 'de',
  },

  animations: [],

  // https://v2.quasar.dev/quasar-cli-vite/quasar-config-file#sourceFiles
  sourceFiles: {
    rootComponent: 'src/App.vue',
    router: 'src/router/index',
    store: 'src/stores/index',
  },
}));
```

### `apps/web/index.html`

```html
<!DOCTYPE html>
<html>
  <head>
    <title>Marketing Automation Platform</title>
    <meta charset="utf-8">
    <meta name="description" content="Marketing Automation Platform — internal tool for content production">
    <meta name="format-detection" content="telephone=no">
    <meta name="msapplication-tap-highlight" content="no">
    <meta name="viewport" content="user-scalable=no, initial-scale=1, maximum-scale=1, minimum-scale=1, width=device-width">
  </head>
  <body>
    <!-- quasar:entry-point -->
  </body>
</html>
```

### `apps/web/tsconfig.json`

```json
{
  "extends": "./.quasar/tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true
  },
  "include": [
    "src/**/*.ts",
    "src/**/*.d.ts",
    "src/**/*.vue"
  ],
  "exclude": ["node_modules", "dist"]
}
```

Mirrors backend strictness so the patterns Marcel knows from `packages/` apply here too.

### `apps/web/src/App.vue`

```vue
<template>
  <router-view />
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useThemeInit } from 'src/composables/useTheme';

export default defineComponent({
  name: 'App',
  setup() {
    useThemeInit();
  },
});
</script>
```

### Routing

`apps/web/src/router/routes.ts`:

```typescript
import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('src/layouts/MainLayout.vue'),
    children: [
      {
        path: '',
        name: 'home',
        component: () => import('src/pages/IndexPage.vue'),
      },
      {
        path: 'inbox',
        name: 'inbox',
        component: () => import('src/pages/InboxPage.vue'),
      },
      {
        path: 'projects',
        name: 'projects',
        component: () => import('src/pages/ProjectsPage.vue'),
      },
      {
        path: 'projects/:slug',
        name: 'project-detail',
        component: () => import('src/pages/ProjectDetailPage.vue'),
        props: true,
      },
      {
        path: 'projects/:slug/cold-start',
        name: 'cold-start',
        component: () => import('src/pages/ColdStartPage.vue'),
        props: true,
      },
      {
        path: 'projects/:slug/articles',
        name: 'articles',
        component: () => import('src/pages/ArticlesPage.vue'),
        props: true,
      },
      {
        path: 'articles/:id',
        name: 'article-detail',
        component: () => import('src/pages/ArticleDetailPage.vue'),
        props: true,
      },
      {
        path: 'cost',
        name: 'cost-dashboard',
        component: () => import('src/pages/CostDashboardPage.vue'),
      },
      {
        path: 'activity',
        name: 'activity',
        component: () => import('src/pages/ActivityPage.vue'),
      },
      {
        path: 'settings',
        name: 'settings',
        component: () => import('src/pages/SettingsPage.vue'),
      },
    ],
  },
  {
    // Auth routes use a different layout (no sidebar) — implementation in Spec 31
    path: '/auth',
    component: () => import('src/layouts/AuthLayout.vue'),
    children: [
      {
        path: 'login',
        name: 'login',
        component: () => import('src/pages/LoginPage.vue'),
      },
      {
        path: 'verify',
        name: 'auth-verify',
        component: () => import('src/pages/AuthVerifyPage.vue'),
      },
    ],
  },
  {
    // Installer/onboarding (Spec 32)
    path: '/installer',
    component: () => import('src/layouts/AuthLayout.vue'),
    children: [
      {
        path: '',
        name: 'installer',
        component: () => import('src/pages/InstallerPage.vue'),
      },
    ],
  },
  // 404
  {
    path: '/:catchAll(.*)*',
    component: () => import('src/pages/ErrorNotFound.vue'),
  },
];

export default routes;
```

`apps/web/src/router/index.ts`:

```typescript
import { defineRouter } from '#q-app/wrappers';
import { createRouter, createMemoryHistory, createWebHistory, createWebHashHistory } from 'vue-router';
import routes from './routes';

export default defineRouter(function () {
  const createHistory = process.env.SERVER
    ? createMemoryHistory
    : process.env.VUE_ROUTER_MODE === 'history'
      ? createWebHistory
      : createWebHashHistory;

  const Router = createRouter({
    scrollBehavior: () => ({ left: 0, top: 0 }),
    routes,
    history: createHistory(process.env.VUE_ROUTER_BASE),
  });

  return Router;
});
```

### Layouts

`apps/web/src/layouts/MainLayout.vue`:

```vue
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
          aria-label="Menu"
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
      // Spec 31 wires the actual logout call; for now just a stub
      await this.authStore.logout();
      void this.$router.push({ name: 'login' });
    },
  },
});
</script>
```

`apps/web/src/layouts/AuthLayout.vue`:

```vue
<template>
  <q-layout view="lHh lpR lFf">
    <q-page-container>
      <div class="auth-container row justify-center items-center" style="min-height: 100vh;">
        <div class="col-12 col-sm-8 col-md-6 col-lg-4 q-pa-md">
          <router-view />
        </div>
      </div>
    </q-page-container>
  </q-layout>
</template>

<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'AuthLayout',
});
</script>
```

### Stores

`apps/web/src/stores/index.ts`:

```typescript
import { defineStore as wrapper } from '#q-app/wrappers';
import { createPinia } from 'pinia';

export default wrapper((/* { ssrContext } */) => {
  const pinia = createPinia();
  return pinia;
});
```

`apps/web/src/stores/auth.ts`:

```typescript
import { defineStore } from 'pinia';
import { api } from 'src/lib/api-client';

interface User {
  id: string;
  email: string;
}

interface AuthState {
  user: User | null;
  loading: boolean;
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    user: null,
    loading: false,
  }),

  getters: {
    isAuthenticated: (state): boolean => state.user !== null,
  },

  actions: {
    /**
     * Fetch current session from /api/auth/me.
     * Called on app boot and after auth flow completion.
     * Returns null silently if no active session (401 from API).
     */
    async fetchCurrent(): Promise<User | null> {
      this.loading = true;
      try {
        const res = await api.get<User>('/auth/me');
        this.user = res.data;
        return this.user;
      } catch {
        this.user = null;
        return null;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Logout via API + clear local state.
     * Real implementation in Spec 31; for shell, this is a placeholder.
     */
    async logout(): Promise<void> {
      try {
        await api.post('/auth/logout');
      } catch {
        // Ignore — local state cleanup is what matters
      }
      this.user = null;
    },
  },
});
```

`apps/web/src/stores/ui.ts`:

```typescript
import { defineStore } from 'pinia';
import { LocalStorage } from 'quasar';

interface UiState {
  sidebarOpen: boolean;
  darkMode: boolean | 'auto';
}

export const useUiStore = defineStore('ui', {
  state: (): UiState => ({
    sidebarOpen: true,
    darkMode: (LocalStorage.getItem('darkMode') as boolean | 'auto' | null) ?? 'auto',
  }),

  actions: {
    setDarkMode(value: boolean | 'auto'): void {
      this.darkMode = value;
      LocalStorage.set('darkMode', value);
    },

    toggleSidebar(): void {
      this.sidebarOpen = !this.sidebarOpen;
    },
  },
});
```

`apps/web/src/stores/system-status.ts`:

```typescript
import { defineStore } from 'pinia';
import { api } from 'src/lib/api-client';

/**
 * Reflects which adapters are configured on the backend.
 * Drives feature-gating throughout the UI.
 *
 * Populated by GET /api/system/status — endpoint added in Spec 32.
 * For Spec 30, the store has the shape but always returns "unknown" status.
 */
export interface AdapterStatus {
  configured: boolean;
  verified: boolean | null;     // null = never verified; true/false = last verify result
  lastVerifiedAt: string | null; // ISO timestamp
}

interface SystemStatusState {
  loading: boolean;
  adapters: {
    anthropic: AdapterStatus;
    replicate: AdapterStatus;
    r2: AdapterStatus;
    dataforseo: AdapterStatus;
    smtp: AdapterStatus;
    githubApp: AdapterStatus;
  };
  redis: AdapterStatus;
  postgres: AdapterStatus;
}

const unknownStatus: AdapterStatus = {
  configured: false,
  verified: null,
  lastVerifiedAt: null,
};

export const useSystemStatusStore = defineStore('systemStatus', {
  state: (): SystemStatusState => ({
    loading: false,
    adapters: {
      anthropic: { ...unknownStatus },
      replicate: { ...unknownStatus },
      r2: { ...unknownStatus },
      dataforseo: { ...unknownStatus },
      smtp: { ...unknownStatus },
      githubApp: { ...unknownStatus },
    },
    redis: { ...unknownStatus },
    postgres: { ...unknownStatus },
  }),

  getters: {
    allConfigured: (state): boolean => {
      const all = [
        state.adapters.anthropic,
        state.adapters.replicate,
        state.adapters.r2,
        state.adapters.dataforseo,
        state.adapters.smtp,
        state.adapters.githubApp,
        state.redis,
        state.postgres,
      ];
      return all.every((a) => a.configured);
    },

    requiredCoreReady: (state): boolean => {
      return state.postgres.configured && state.redis.configured;
    },
  },

  actions: {
    /**
     * Fetch from GET /api/system/status. Endpoint exists from Spec 32.
     * If Spec 32 hasn't been built yet, this silently fails — adapters stay "unknown".
     */
    async fetchStatus(): Promise<void> {
      this.loading = true;
      try {
        const res = await api.get<SystemStatusState>('/system/status');
        // Replace state with response, preserving the loading flag
        const data = res.data;
        this.adapters = data.adapters;
        this.redis = data.redis;
        this.postgres = data.postgres;
      } catch {
        // Silent — endpoint may not exist yet (Spec 32 builds it)
      } finally {
        this.loading = false;
      }
    },
  },
});
```

### HTTP Client

`apps/web/src/lib/api-client.ts`:

```typescript
import axios, { type AxiosInstance, type AxiosError } from 'axios';
import { Notify } from 'quasar';
import { HttpError } from './http-error';

/**
 * Centralized API client.
 * Base URL is read from VITE_API_BASE_URL at build time.
 * Cookie-based session auth — `withCredentials: true` is required.
 *
 * 401 responses do NOT auto-redirect — that's the responsibility of route guards
 * in Spec 31. The interceptor below only normalizes errors and surfaces non-401
 * server errors via Notify.
 */
export const api: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api',
  withCredentials: true,
  timeout: 30_000,
});

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const httpError = HttpError.fromAxios(error);

    // Surface server errors (5xx) and unexpected errors via Notify automatically.
    // 4xx errors should be handled at the call site (auth failures, validation errors, etc.).
    if (httpError.isServerError || httpError.isNetworkError) {
      Notify.create({
        type: 'negative',
        message: httpError.userMessage,
        timeout: 6000,
      });
    }

    return Promise.reject(httpError);
  },
);
```

`apps/web/src/lib/http-error.ts`:

```typescript
import type { AxiosError } from 'axios';

interface ApiErrorBody {
  error?: string;
  message?: string;
  code?: string;
  [key: string]: unknown;
}

/**
 * Normalized error wrapper around AxiosError.
 * All call sites can rely on consistent shape regardless of failure mode.
 */
export class HttpError extends Error {
  readonly status: number | null;
  readonly code: string | null;
  readonly body: ApiErrorBody | null;
  readonly isNetworkError: boolean;
  readonly originalCause: AxiosError | undefined;

  private constructor(args: {
    message: string;
    status: number | null;
    code: string | null;
    body: ApiErrorBody | null;
    isNetworkError: boolean;
    originalCause?: AxiosError;
  }) {
    super(args.message);
    this.name = 'HttpError';
    this.status = args.status;
    this.code = args.code;
    this.body = args.body;
    this.isNetworkError = args.isNetworkError;
    this.originalCause = args.originalCause;
  }

  get isClientError(): boolean {
    return this.status !== null && this.status >= 400 && this.status < 500;
  }

  get isServerError(): boolean {
    return this.status !== null && this.status >= 500;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /**
   * Human-friendly message suitable for showing in a Notify toast.
   * Prefers server-supplied message; falls back to a generic one.
   */
  get userMessage(): string {
    if (this.body?.message) return this.body.message;
    if (this.body?.error) return this.body.error;
    if (this.isNetworkError) return 'Network error — check your connection';
    if (this.isServerError) return 'Server error — please try again later';
    if (this.status === 401) return 'Not authenticated';
    if (this.status === 403) return 'Permission denied';
    if (this.status === 404) return 'Not found';
    return this.message;
  }

  static fromAxios(err: AxiosError): HttpError {
    if (!err.response) {
      return new HttpError({
        message: err.message,
        status: null,
        code: err.code ?? null,
        body: null,
        isNetworkError: true,
        originalCause: err,
      });
    }
    const body = err.response.data as ApiErrorBody | null;
    return new HttpError({
      message: body?.message ?? body?.error ?? err.message,
      status: err.response.status,
      code: body?.code ?? null,
      body,
      isNetworkError: false,
      originalCause: err,
    });
  }
}
```

Note: `originalCause` not `cause` — same convention as backend (Spec 12-24 lessons).

### i18n Setup

`apps/web/src/boot/i18n.ts`:

```typescript
import { defineBoot } from '#q-app/wrappers';
import { createI18n } from 'vue-i18n';
import messages from 'src/i18n';

export type MessageLanguages = keyof typeof messages;
// Type-define 'de-DE' as the default messages
export type MessageSchema = (typeof messages)['de'];

declare module 'vue-i18n' {
  export interface DefineLocaleMessage extends MessageSchema {}
  export interface DefineDateTimeFormat {}
  export interface DefineNumberFormat {}
}

export default defineBoot(({ app }) => {
  const i18n = createI18n<{ message: MessageSchema }, MessageLanguages>({
    locale: 'de',
    fallbackLocale: 'de',
    legacy: false,
    messages,
  });

  app.use(i18n);
});
```

`apps/web/src/i18n/index.ts`:

```typescript
import de from './de';
import en from './en';

export default {
  de,
  en,
};
```

`apps/web/src/i18n/de/index.ts`:

```typescript
import app from './app';
import nav from './nav';
import auth from './auth';
import installer from './installer';
import errors from './errors';

export default {
  app,
  nav,
  auth,
  installer,
  errors,
};
```

`apps/web/src/i18n/de/app.ts`:

```typescript
export default {
  title: 'Marketing Automation',
  toggleTheme: 'Design wechseln',
  userMenu: 'Benutzer-Menü',
  logout: 'Abmelden',
  setupIncomplete: 'Einrichtung unvollständig',
  setupIncompleteHint: 'Einige Adapter sind noch nicht konfiguriert. Klicke auf "Einstellungen" zum Vervollständigen.',
};
```

`apps/web/src/i18n/de/nav.ts`:

```typescript
export default {
  heading: 'Navigation',
  inbox: 'Inbox',
  projects: 'Projekte',
  cost: 'Kosten',
  activity: 'Aktivität',
  settings: 'Einstellungen',
};
```

`apps/web/src/i18n/de/auth.ts`:

```typescript
export default {
  login: {
    title: 'Anmelden',
    emailLabel: 'E-Mail-Adresse',
    submitButton: 'Magic Link senden',
    successMessage: 'E-Mail mit Anmelde-Link versendet. Bitte prüfe dein Postfach.',
  },
  verify: {
    loading: 'Anmeldung wird überprüft...',
    success: 'Erfolgreich angemeldet.',
    failure: 'Anmelde-Link ungültig oder abgelaufen.',
  },
};
```

`apps/web/src/i18n/de/installer.ts`:

```typescript
export default {
  title: 'Erste Einrichtung',
  intro: 'Dieser Assistent führt dich durch die Einrichtung aller Adapter. Du kannst einzelne Schritte überspringen und später nachholen.',
  steps: {
    database: 'Datenbank prüfen',
    redis: 'Redis prüfen',
    smtp: 'E-Mail (SMTP)',
    anthropic: 'Anthropic API',
    replicate: 'Replicate API',
    r2: 'Cloudflare R2',
    dataforseo: 'DataForSEO',
    githubApp: 'GitHub App',
  },
  // More keys added in Spec 32
};
```

`apps/web/src/i18n/de/errors.ts`:

```typescript
export default {
  notFound: 'Seite nicht gefunden',
  notAuthorized: 'Nicht angemeldet',
  forbidden: 'Keine Berechtigung',
  serverError: 'Serverfehler',
  networkError: 'Netzwerkfehler',
};
```

`apps/web/src/i18n/en/index.ts`:

```typescript
// Stub structure mirroring de/. Empty objects until translation pass.
import app from './app';
import nav from './nav';
import auth from './auth';
import installer from './installer';
import errors from './errors';

export default {
  app,
  nav,
  auth,
  installer,
  errors,
};
```

`apps/web/src/i18n/en/app.ts`:

```typescript
export default {
  title: 'Marketing Automation',
  toggleTheme: 'Toggle theme',
  userMenu: 'User menu',
  logout: 'Sign out',
  setupIncomplete: 'Setup incomplete',
  setupIncompleteHint: 'Some adapters are not configured yet. Click "Settings" to finish setup.',
};
```

(Other `en/*.ts` files: stub with same keys, English values where simple, otherwise placeholder strings prefixed `[EN]` so untranslated content is visible.)

### Boot files

`apps/web/src/boot/axios.ts`:

```typescript
import { defineBoot } from '#q-app/wrappers';
import { api } from 'src/lib/api-client';

declare module 'vue' {
  interface ComponentCustomProperties {
    $api: typeof api;
  }
}

export default defineBoot(({ app }) => {
  app.config.globalProperties.$api = api;
});
```

`apps/web/src/boot/pinia.ts`:

```typescript
import { defineBoot } from '#q-app/wrappers';
import { useAuthStore } from 'src/stores/auth';
import { useSystemStatusStore } from 'src/stores/system-status';

export default defineBoot(async (/* { app, router } */) => {
  // Eager-fetch the initial state so route guards in Spec 31 have data ready
  const auth = useAuthStore();
  const systemStatus = useSystemStatusStore();
  await Promise.all([auth.fetchCurrent(), systemStatus.fetchStatus()]);
});
```

### Composables

`apps/web/src/composables/useTheme.ts`:

```typescript
import { onMounted, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useUiStore } from 'src/stores/ui';

/**
 * Initializes Quasar's dark mode based on user preference (LocalStorage)
 * with `'auto'` falling back to system preference.
 * Reactively syncs Quasar's dark setting with the UI store.
 */
export function useThemeInit(): void {
  const $q = useQuasar();
  const uiStore = useUiStore();

  onMounted(() => {
    if (uiStore.darkMode === 'auto') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      $q.dark.set(prefersDark);
    } else {
      $q.dark.set(uiStore.darkMode);
    }
  });

  watch(
    () => uiStore.darkMode,
    (mode) => {
      if (mode === 'auto') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        $q.dark.set(prefersDark);
      } else {
        $q.dark.set(mode);
      }
    },
  );
}
```

`apps/web/src/composables/useApi.ts`:

```typescript
import { ref, type Ref } from 'vue';
import { api } from 'src/lib/api-client';
import { HttpError } from 'src/lib/http-error';

interface UseApiResult<T> {
  data: Ref<T | null>;
  loading: Ref<boolean>;
  error: Ref<HttpError | null>;
  execute: () => Promise<T | null>;
}

/**
 * Lightweight composable for one-off API calls in components.
 * Use for view-bound data fetching where Pinia stores would be overkill.
 *
 * @example
 *   const { data, loading, error, execute } = useApi(() => api.get<Project>('/projects/foo'));
 *   onMounted(execute);
 */
export function useApi<T>(fn: () => Promise<{ data: T }>): UseApiResult<T> {
  const data = ref<T | null>(null) as Ref<T | null>;
  const loading = ref(false);
  const error = ref<HttpError | null>(null);

  async function execute(): Promise<T | null> {
    loading.value = true;
    error.value = null;
    try {
      const res = await fn();
      data.value = res.data;
      return res.data;
    } catch (e) {
      error.value = e instanceof HttpError ? e : null;
      return null;
    } finally {
      loading.value = false;
    }
  }

  return { data, loading, error, execute };
}

// Re-export the api instance for convenience
export { api };
```

`apps/web/src/composables/useNotify.ts`:

```typescript
import { Notify, type QNotifyCreateOptions } from 'quasar';

interface NotifyOptions {
  message: string;
  caption?: string;
  type?: 'positive' | 'negative' | 'warning' | 'info';
  timeout?: number;
}

/**
 * Wrapper around Quasar's Notify with consistent defaults.
 * Use for user feedback after actions (saved, copied, etc.).
 */
export function useNotify(): {
  success: (msg: string, caption?: string) => void;
  error: (msg: string, caption?: string) => void;
  warn: (msg: string, caption?: string) => void;
  info: (msg: string, caption?: string) => void;
  custom: (opts: QNotifyCreateOptions) => void;
} {
  function notify(opts: NotifyOptions): void {
    const config: QNotifyCreateOptions = {
      type: opts.type ?? 'info',
      message: opts.message,
      timeout: opts.timeout ?? 4000,
    };
    if (opts.caption) {
      config.caption = opts.caption;
    }
    Notify.create(config);
  }

  return {
    success: (msg, caption) => {
      const opts: NotifyOptions = { message: msg, type: 'positive' };
      if (caption) opts.caption = caption;
      notify(opts);
    },
    error: (msg, caption) => {
      const opts: NotifyOptions = { message: msg, type: 'negative' };
      if (caption) opts.caption = caption;
      notify(opts);
    },
    warn: (msg, caption) => {
      const opts: NotifyOptions = { message: msg, type: 'warning' };
      if (caption) opts.caption = caption;
      notify(opts);
    },
    info: (msg, caption) => {
      const opts: NotifyOptions = { message: msg, type: 'info' };
      if (caption) opts.caption = caption;
      notify(opts);
    },
    custom: (opts) => Notify.create(opts),
  };
}
```

### Pages (stubs)

All page files follow the same minimal pattern. Spec 31+ replace them.

`apps/web/src/pages/IndexPage.vue`:

```vue
<template>
  <q-page padding>
    <h1 class="text-h4 q-mb-md">{{ $t('app.title') }}</h1>
    <p class="text-body1">{{ $t('home.intro', "Wähle einen Bereich aus der Seitenleiste.") }}</p>
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
export default defineComponent({ name: 'IndexPage' });
</script>
```

`apps/web/src/pages/InboxPage.vue`, `ProjectsPage.vue`, `ProjectDetailPage.vue`, `ColdStartPage.vue`, `ArticlesPage.vue`, `ArticleDetailPage.vue`, `CostDashboardPage.vue`, `ActivityPage.vue`, `SettingsPage.vue`, `LoginPage.vue`, `AuthVerifyPage.vue`, `InstallerPage.vue`:

Each has the same structure — a heading and a placeholder note: "This page is implemented in Spec X" (where X is the spec that fills it). Example:

```vue
<template>
  <q-page padding>
    <h1 class="text-h4 q-mb-md">{{ $t('nav.projects') }}</h1>
    <q-banner class="bg-info text-white">
      <template v-slot:avatar>
        <q-icon name="construction" />
      </template>
      Diese Seite wird in Spec 34 implementiert.
    </q-banner>
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
export default defineComponent({ name: 'ProjectsPage' });
</script>
```

`apps/web/src/pages/ErrorNotFound.vue`:

```vue
<template>
  <q-page class="flex flex-center column">
    <div class="text-h2 q-mb-md">404</div>
    <div class="text-h6 q-mb-md">{{ $t('errors.notFound') }}</div>
    <q-btn :to="{ name: 'home' }" color="primary">Zur Startseite</q-btn>
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
export default defineComponent({ name: 'ErrorNotFound' });
</script>
```

### Global Styles

`apps/web/src/css/app.scss`:

```scss
// Custom global styles. Quasar variables are loaded automatically by quasar.config.ts.

body {
  font-family: 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

// Reduce default Quasar header shadow intensity in light mode
.q-header.bg-primary {
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

// Tighten q-item spacing in dense lists
.q-list--dense > .q-item {
  min-height: 36px;
}
```

`apps/web/src/css/quasar.variables.sass`:

```sass
$primary   : #3f51b5
$secondary : #26a69a
$accent    : #7c4dff

$dark      : #1d1d1d

$positive  : #21ba45
$negative  : #c10015
$info      : #31ccec
$warning   : #f2c037
```

### Backend: Add `/api/system/status` minimal stub

The store fetches from `/api/system/status` on boot. Spec 32 fully implements this endpoint, but we add a minimal stub now so the boot doesn't error:

`apps/api/src/routes/system.ts`:

```typescript
import { Hono } from 'hono';

export const systemRoutes = new Hono();

/**
 * MINIMAL STUB. Spec 32 replaces this with real adapter status checks.
 * Returns "all unknown" so the frontend doesn't show false-confidence indicators.
 */
systemRoutes.get('/status', (c) => {
  const unknown = { configured: false, verified: null, lastVerifiedAt: null };
  return c.json({
    loading: false,
    adapters: {
      anthropic: unknown,
      replicate: unknown,
      r2: unknown,
      dataforseo: unknown,
      smtp: unknown,
      githubApp: unknown,
    },
    redis: unknown,
    postgres: unknown,
  });
});
```

Mount in `apps/api/src/index.ts`:
```typescript
import { systemRoutes } from './routes/system';
// ...
app.route('/api/system', systemRoutes);
```

This endpoint is **not** behind `requireAuth` — the system status is needed before login (e.g., installer wizard checks if the system is unconfigured to redirect there).

### Environment File

`apps/web/.env.example`:

```bash
# API base URL — must point to where apps/api is served
VITE_API_BASE_URL=http://localhost:3000/api
```

`apps/web/.env`:

```bash
VITE_API_BASE_URL=http://localhost:3000/api
```

(Marcel creates this manually; not committed.)

### Root-level scripts

Add to root `package.json` for convenience:

```json
{
  "scripts": {
    "dev:api": "bun --filter @marketing-auto/api dev",
    "dev:web": "bun --filter @marketing-auto/web dev",
    "dev": "concurrently \"npm:dev:api\" \"npm:dev:web\"",
    "typecheck": "bun --filter '*' typecheck"
  },
  "devDependencies": {
    "concurrently": "^9.0.0"
  }
}
```

Now `bun install` at root → `bun run dev` at root brings up both servers.

## Acceptance Criteria

### Setup
- [ ] `apps/web/` exists with all files described
- [ ] `bun install` at root completes without errors
- [ ] `bun --filter @marketing-auto/web typecheck` passes
- [ ] `bun --filter @marketing-auto/web dev` starts the Quasar dev server on port 3051
- [ ] Visiting `http://localhost:3051` shows the IndexPage with sidebar
- [ ] `bun --filter @marketing-auto/web build` produces a `dist/spa/` directory

### Layout & Routing
- [ ] All 11 main routes render their stub page without errors
- [ ] Sidebar shows on desktop (≥1024px), collapsible via hamburger
- [ ] Sidebar hidden by default on mobile (<1024px), opens via hamburger
- [ ] Theme toggle in header switches between light/dark
- [ ] Dark mode preference persists in LocalStorage
- [ ] 404 page shows for invalid routes
- [ ] AuthLayout renders for `/auth/*` and `/installer` routes (no sidebar)

### i18n
- [ ] All visible strings come from `t()` — no hardcoded strings in components
- [ ] Default locale is `de`
- [ ] `en/` folder exists with mirrored key structure (placeholder values)
- [ ] vue-i18n type augmentation works — `t('nav.inbox')` is type-safe in IDE

### Stores
- [ ] `useAuthStore()` returns Pinia store
- [ ] `fetchCurrent()` calls `/api/auth/me`, sets `user` on 200, clears on 401
- [ ] `useUiStore()` persists `darkMode` to LocalStorage
- [ ] `useSystemStatusStore()` calls `/api/system/status`, parses response, exposes `allConfigured` getter

### HTTP Client
- [ ] `api.get('/some/path')` makes request to `http://localhost:3000/api/some/path`
- [ ] `withCredentials: true` sends cookies
- [ ] 401 errors do NOT auto-redirect (route guards do that — Spec 31)
- [ ] 5xx errors trigger a Notify toast automatically
- [ ] Network errors trigger a Notify toast
- [ ] All errors are normalized to `HttpError` instances

### Backend
- [ ] `GET /api/system/status` returns the stub response with all adapters as "unknown"
- [ ] Endpoint is unauthenticated (must work before login)

## Testing Strategy

For Spec 30, manual smoke tests are sufficient:

1. **Smoke test 1**: `bun run dev` from root — both servers start, no errors in either log.
2. **Smoke test 2**: Open `http://localhost:3051` — IndexPage renders, sidebar visible.
3. **Smoke test 3**: Click each nav item — stub pages render, no console errors.
4. **Smoke test 4**: Toggle theme — colors change, persist on refresh.
5. **Smoke test 5**: Resize window to 800px — sidebar hides, hamburger appears.
6. **Smoke test 6**: Open DevTools network tab — `/api/auth/me` and `/api/system/status` are called on boot. `/auth/me` returns 401 (no session); `/system/status` returns 200 with all "unknown".
7. **Smoke test 7**: Stop the API server — refresh the frontend — Notify toast for network error appears, app doesn't crash.

Vitest + @vue/test-utils setup for component tests is added in a future spec or as needed; not required for Spec 30 to be considered complete.

## Open Questions / Decisions Made

**Decision 1: AuthLayout vs MainLayout split.**
Auth-related routes (login, verify, installer) live under a separate layout without the sidebar. Cleaner UX: when users aren't logged in, they shouldn't see nav links to features they can't access.

**Decision 2: System status fetched on boot, not on-demand.**
Pinia store eager-fetches in the boot file so `MainLayout`'s "setup incomplete" indicator is accurate from first paint. Cost: one extra HTTP call on every page load. Worth it for UX clarity.

**Decision 3: `requireAuth` route guard NOT added in Spec 30.**
The shell renders all routes regardless of auth state. Spec 31 adds the guard. Reason: separating concerns. Spec 30's job is structure; Spec 31's job is auth. If guards were here, the shell wouldn't be testable until Spec 31 finishes the auth flow.

**Decision 4: Direct LocalStorage usage for `darkMode` in store, not IndexedDB.**
Quasar's LocalStorage plugin is sufficient. No size concerns. IndexedDB would be over-engineering for one boolean.

**Decision 5: No store for routing state.**
Vue Router's reactive state is enough. Stores would duplicate.

**Decision 6: API base URL env var only — no per-environment switching at runtime.**
Build-time injection via Vite. If we ever need runtime switching (e.g., user-configurable backend), that's a future spec.

**Decision 7: Quasar's Material Icons over icon imports.**
Already in `extras`. No need for tree-shaken icon libraries (lucide, etc.) when Material Icons covers everything we need. May reconsider if bundle size becomes an issue.

**Decision 8: No Vitest setup in this spec.**
Adds complexity without clear payoff for a structural spec. Test setup follows when first feature spec needs them.

**Decision 9: `verbatimModuleSyntax: true` in tsconfig.**
Per Quasar's recommended TypeScript config. Forces explicit `import type` for type-only imports. Caught early reduces friction later.

**Decision 10: Chinese-style component naming convention.**
Pages: `XxxPage.vue`. Layouts: `XxxLayout.vue`. Components: PascalCase noun (`AdapterStatusCard.vue`). Composables: `useXxx.ts`. Matches Vanilla v3 conventions Marcel knows.

## Implementation Order

**Recommend 2 sessions.**

**Session 1: Scaffold + Layout (~4-5h)**
1. Create `apps/web/` with all config files (`package.json`, `quasar.config.ts`, `tsconfig.json`, `index.html`)
2. Run `bun install` from root, verify Quasar installs
3. Create `App.vue`, `MainLayout.vue`, `AuthLayout.vue`
4. Create `router/routes.ts` and `router/index.ts`
5. Create all stub pages (one file each, copy-paste pattern)
6. Add quasar.variables.sass + app.scss
7. Verify `bun --filter @marketing-auto/web dev` starts and renders IndexPage with sidebar
8. Commit: `feat(web): scaffold quasar app shell with layouts and routing (spec 30)`

**Session 2: Stores + i18n + HTTP client (~3-4h)**
1. Create three Pinia stores (auth, ui, system-status)
2. Create boot files (i18n, axios, pinia)
3. Create i18n bundles (de full, en stubs)
4. Create lib/api-client.ts and lib/http-error.ts
5. Create composables (useTheme, useApi, useNotify)
6. Wire MainLayout to stores (theme toggle, system-status indicator, user menu)
7. Add backend `/api/system/status` stub endpoint
8. Run all 7 smoke tests, fix any failures
9. Commit: `feat(web): pinia stores, i18n setup, http client (spec 30)`

Total: 7-9 hours. Cost: €0.

## Splitting Plan

See "Implementation Order" — 2 sessions with `/clear` between.

## Discovered During Implementation

- The spec's i18n key inventory was incomplete. Three keys were missing and caught during `/review-task`:
  - `app.menuToggle` — needed for the hamburger button's `:aria-label`
  - `app.backToHome` — needed for the 404 page's back button
  - `home` namespace (`home.intro`) — needed for the IndexPage body text
  All three were added to both `de/` and `en/` locale bundles.

- The spec example for `IndexPage` used `$t('home.intro', "...")` with a fallback default string but never defined the `home` namespace in the locale index files. The implementation adds a proper `home/` module wired into both locale indexes — cleaner than relying on fallback defaults.

- Stub page titles for parametric routes (`Projekt: {{ slug }}`, `Artikel: {{ slug }}`, etc.) and "Diese Seite wird in Spec X implementiert." banners were deliberately left as hardcoded German — they are pure scaffolding markers, not production UI, and will be entirely replaced by Spec 31–39.

## Deviations

- **`home` i18n namespace added** (not in spec's original key list): `src/i18n/de/home.ts` and `src/i18n/en/home.ts` introduced. The spec listed the `de/` keys inline but omitted `home` from the module structure. The deviation is additive and improves type-safety (avoids runtime fallback strings).
