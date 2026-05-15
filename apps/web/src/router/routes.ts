import type { RouteRecordRaw } from "vue-router";

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    component: () => import("src/layouts/MainLayout.vue"),
    children: [
      {
        path: "",
        name: "inbox",
        component: () => import("src/pages/InboxPage.vue"),
      },
      {
        path: "projects",
        name: "projects",
        component: () => import("src/pages/ProjectsPage.vue"),
      },
      {
        path: "projects/:slug",
        name: "project-detail",
        component: () => import("src/pages/ProjectDetailPage.vue"),
        props: true,
      },
      {
        path: "projects/:slug/cold-start",
        name: "cold-start",
        component: () => import("src/pages/ColdStartPage.vue"),
        props: true,
      },
      {
        path: "projects/:slug/articles",
        name: "articles",
        component: () => import("src/pages/ArticlesPage.vue"),
        props: true,
      },
      {
        path: "projects/:slug/clusters",
        name: "project-clusters",
        component: () => import("src/pages/ClustersManagementPage.vue"),
        props: true,
        meta: { requiresAuth: true },
      },
      {
        path: "projects/:slug/cornerstones",
        name: "cornerstone-approval",
        component: () => import("src/pages/CornerstoneApprovalPage.vue"),
        props: true,
        meta: { requiresAuth: true },
      },
      {
        path: "projects/:slug/brand/assets",
        name: "brand-assets",
        component: () => import("src/pages/projects/brand/AssetBrowserPage.vue"),
        props: true,
        meta: { requiresAuth: true },
      },
      {
        path: "projects/:slug/brand/colors",
        name: "brand-colors",
        component: () => import("src/pages/projects/brand/ColorSettingsPage.vue"),
        props: true,
        meta: { requiresAuth: true },
      },
      {
        path: "projects/:slug/brand/typography",
        name: "brand-typography",
        component: () => import("src/pages/projects/brand/TypographySettingsPage.vue"),
        props: true,
        meta: { requiresAuth: true },
      },
      {
        path: "projects/:slug/social-posts/admin",
        name: "social-posts-admin",
        component: () => import("src/pages/projects/social/SocialPostsAdminPage.vue"),
        props: true,
        meta: { requiresAuth: true },
      },
      {
        path: "projects/:slug/trends",
        name: "project-trends",
        component: () => import("src/pages/projects/TrendsPage.vue"),
        props: true,
        meta: { requiresAuth: true },
      },
      {
        path: "articles/:id",
        name: "article-detail",
        component: () => import("src/pages/ArticleDetailPage.vue"),
        props: true,
      },
      {
        path: "admin/templates",
        name: "admin-templates",
        component: () => import("src/pages/admin/templates/TemplatesIndexPage.vue"),
        meta: { requiresAuth: true, title: "Template Gallery" },
      },
      {
        path: "cost",
        name: "cost-dashboard",
        component: () => import("src/pages/CostDashboardPage.vue"),
      },
      {
        path: "activity",
        name: "activity",
        component: () => import("src/pages/ActivityPage.vue"),
      },
      {
        path: "settings",
        name: "settings",
        component: () => import("src/pages/SettingsPage.vue"),
      },
    ],
  },
  {
    path: "/auth",
    component: () => import("src/layouts/AuthLayout.vue"),
    children: [
      {
        path: "login",
        name: "login",
        component: () => import("src/pages/LoginPage.vue"),
      },
      {
        path: "verify",
        name: "auth-verify",
        component: () => import("src/pages/AuthVerifyPage.vue"),
      },
    ],
  },
  {
    path: "/installer",
    component: () => import("src/layouts/InstallerLayout.vue"),
    children: [
      {
        path: "",
        name: "installer",
        component: () => import("src/pages/InstallerPage.vue"),
      },
    ],
  },
  {
    path: "/:catchAll(.*)*",
    component: () => import("src/pages/ErrorNotFound.vue"),
  },
];

export default routes;
