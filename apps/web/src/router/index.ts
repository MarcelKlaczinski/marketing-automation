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

      // 56.3: settings, costs, products
      // 56.4: cold-start
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
