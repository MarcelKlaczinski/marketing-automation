import { route } from "quasar/wrappers";
import {
  createRouter,
  createMemoryHistory,
  createWebHistory,
  createWebHashHistory,
} from "vue-router";
import { useAuthStore } from "src/stores/auth";
import { useProjectStore } from "src/stores/project";

const routes = [
  // Root → redirect to default project dashboard
  {
    path: "/",
    redirect: () => {
      const projectStore = useProjectStore();
      return `/projects/${projectStore.currentSlug}/dashboard`;
    },
  },

  // Login — public
  {
    path: "/login",
    name: "login",
    component: () => import("src/pages/LoginPage.vue"),
    meta: { public: true },
  },

  // Magic link verify — public
  {
    path: "/auth/verify",
    name: "auth-verify",
    component: () => import("src/pages/AuthVerifyPage.vue"),
    meta: { public: true },
  },

  // Project shell — all project-scoped pages live here
  {
    path: "/projects/:slug",
    component: () => import("src/components/layout/AppShell.vue"),
    children: [
      {
        path: "dashboard",
        name: "dashboard",
        component: () => import("src/pages/DashboardPage.vue"),
      },

      // 56.2: Articles — master-detail list
      {
        path: "articles",
        name: "articles",
        component: () => import("src/pages/articles/ArticlesListPage.vue"),
        children: [
          {
            path: ":articleId",
            name: "article-detail",
            component: () =>
              import("src/pages/articles/ArticleDetailPage.vue"),
          },
        ],
      },

      // 56.2: Briefs — 3-section backlog
      {
        path: "briefs",
        name: "briefs",
        component: () => import("src/pages/briefs/BriefsPage.vue"),
        children: [
          {
            path: ":briefId",
            name: "brief-detail",
            component: () =>
              import("src/pages/briefs/BriefDetailPage.vue"),
          },
        ],
      },

      // 56.2: Clusters list
      {
        path: "clusters",
        name: "clusters",
        component: () =>
          import("src/pages/clusters/ClustersListPage.vue"),
      },

      // 56.2: Cluster detail — full page (not nested in list per spec F.1)
      {
        path: "clusters/:clusterId",
        name: "cluster-detail",
        component: () =>
          import("src/pages/clusters/ClusterDetailPage.vue"),
      },

      // 56.3: Settings — sidebar nav with 4 sub-sections
      {
        path: "settings",
        name: "settings",
        component: () => import("src/pages/settings/SettingsPage.vue"),
        children: [
          {
            path: "project",
            name: "settings-project",
            component: () => import("src/pages/settings/SettingsProjectPage.vue"),
          },
          {
            path: "brand-tokens",
            name: "settings-brand-tokens",
            component: () => import("src/pages/settings/SettingsBrandTokensPage.vue"),
          },
          {
            path: "brand-assets",
            name: "settings-brand-assets",
            component: () => import("src/pages/settings/SettingsBrandAssetsPage.vue"),
          },
          {
            path: "credentials",
            name: "settings-credentials",
            component: () => import("src/pages/settings/SettingsCredentialsPage.vue"),
          },
          {
            path: "signal-sources",
            name: "settings-signal-sources",
            component: () => import("src/pages/settings/SettingsSignalSourcesPage.vue"),
          },
          // Redirect bare /settings to /settings/project
          {
            path: "",
            redirect: { name: "settings-project" },
          },
        ],
      },

      // 56.3: Costs — overview + alerts
      {
        path: "costs",
        name: "costs",
        component: () => import("src/pages/costs/CostsPage.vue"),
      },

      // 56.3: Article Tools — generate wizard + manual triggers
      {
        path: "article-tools",
        name: "article-tools",
        component: () => import("src/pages/article-tools/ArticleToolsPage.vue"),
      },

      // 56.6: Trends view — master-detail
      {
        path: "trends",
        name: "trends",
        component: () => import("src/pages/trends/TrendsListPage.vue"),
        children: [
          {
            path: ":trendId",
            name: "trend-detail",
            component: () => import("src/pages/trends/TrendDetailPage.vue"),
          },
        ],
      },

      // 56.6: Refresh Queue — flat list (no master-detail, action is in-place)
      {
        path: "refresh-queue",
        name: "refresh-queue",
        component: () => import("src/pages/refresh/RefreshQueuePage.vue"),
      },

      // 62.0a: Step-paused runs queue — Stub page, full UI lands in 62.6
      {
        path: "paused-runs",
        name: "paused-runs",
        component: () => import("src/pages/paused-runs/PausedRunsStubPage.vue"),
      },

    ],
  },

  // 56.4: Cold-Start wizard — full-page, outside AppShell (no sidebar/topbar)
  {
    path: "/cold-start",
    redirect: "/cold-start/new",
  },
  {
    path: "/cold-start/new",
    name: "cold-start-new",
    component: () => import("src/pages/cold-start/ColdStartNewPage.vue"),
  },
  {
    path: "/cold-start/drafts",
    redirect: "/cold-start/new",
  },
  {
    path: "/cold-start/:draftId",
    component: () => import("src/pages/cold-start/ColdStartLayout.vue"),
    children: [
      {
        path: "",
        redirect: { name: "cold-start-phase-1" },
      },
      {
        path: "phase-1",
        name: "cold-start-phase-1",
        component: () => import("src/pages/cold-start/ColdStartPhase1Basics.vue"),
      },
      {
        path: "phase-2",
        name: "cold-start-phase-2",
        component: () => import("src/pages/cold-start/ColdStartPhase2Brand.vue"),
      },
      {
        path: "phase-3",
        name: "cold-start-phase-3",
        component: () =>
          import("src/pages/cold-start/ColdStartPhase3Seed.vue"),
      },
      {
        path: "phase-4",
        name: "cold-start-phase-4",
        component: () =>
          import("src/pages/cold-start/ColdStartPhase4Astro.vue"),
      },
      {
        path: "phase-5",
        name: "cold-start-phase-5",
        component: () =>
          import("src/pages/cold-start/ColdStartPhase5Confirm.vue"),
      },
    ],
  },

  // 404
  {
    path: "/:pathMatch(.*)*",
    name: "not-found",
    component: () => import("src/pages/NotFoundPage.vue"),
  },
];

export default route(function (/* { store, ssrContext } */) {
  const createHistory = process.env.SERVER
    ? createMemoryHistory
    : process.env.VUE_ROUTER_MODE === "history"
      ? createWebHistory
      : createWebHashHistory;

  const router = createRouter({
    scrollBehavior: () => ({ left: 0, top: 0 }),
    routes,
    history: createHistory(process.env.VUE_ROUTER_BASE),
  });

  // Global navigation guard — redirect to /login if unauthenticated
  router.beforeEach(async (to) => {
    if (to.meta.public) return true;

    const authStore = useAuthStore();
    if (!authStore.isAuthenticated && !authStore.loading) {
      await authStore.fetchCurrent();
    }
    if (!authStore.isAuthenticated) {
      return { name: "login" };
    }

    // Sync URL slug into project store
    if (typeof to.params.slug === "string") {
      const projectStore = useProjectStore();
      projectStore.setCurrentSlug(to.params.slug);
    }

    return true;
  });

  return router;
});
