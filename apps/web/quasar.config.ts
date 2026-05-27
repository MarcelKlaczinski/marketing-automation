/* eslint-env node */
import { defineConfig } from "#q-app/wrappers";

export default defineConfig((/* ctx */) => ({
  eslint: {
    warnings: true,
    errors: true,
  },

  preFetch: false,

  boot: ["i18n", "query", "auth"],

  // Quasar resolves css[] paths from src/css/ — files live at src/css/styles/
  css: [
    "styles/tokens.css",
    "styles/reset.css",
    "styles/typography.css",
    "styles/animations.css",
    "styles/global.css",
  ],

  extras: ["material-icons"],

  build: {
    target: {
      browser: ["es2022", "firefox115", "chrome115", "safari14"],
      node: "node20",
    },
    typescript: {
      strict: true,
      vueShim: true,
    },
    vueRouterMode: "history",
    env: {
      VITE_API_BASE_URL: process.env.VITE_API_BASE_URL ?? "http://localhost:3000/api",
    },
    extendViteConf(viteConf) {
      if (!viteConf.build) viteConf.build = {};
      // MarkdownEditor (CodeMirror) bundles to ~644 KB — silence the warning
      viteConf.build.chunkSizeWarningLimit = 700;

      // Spec 65.V1.5c — @quasar/quasar-ui-qcalendar ships CSS with an
      // invalid chained-pseudo-element selector (`:before.q-range-first:before`)
      // that lightningcss (Vite 8's default minifier) rejects. esbuild is
      // more permissive and was the pre-Vite-8 default. We force esbuild
      // for CSS minify only — the JS minifier preference is unchanged.
      viteConf.build.cssMinify = "esbuild";

      // Spec 65.V1.5c — React-in-Vue end-slide live preview.
      //
      // The end-slide React components (packages/social/src/end-slide-components/)
      // import `AbsoluteFill` from "remotion" — Remotion's browser bundle is
      // heavy (player + animation runtime). Since AbsoluteFill is literally
      // just `<div style="position:absolute;inset:0">`, we alias `remotion`
      // to a 5-line shim that keeps the preview light.
      //
      // The `@marketing-auto/social/end-slide-components` alias maps to the
      // package source so Vite/esbuild can JIT-compile the .tsx files at
      // import time — one-component-exception to apps/web/CLAUDE.md's
      // "no @marketing-auto/* imports" DO-NOT, accepted because vendoring
      // would force keeping a parallel copy of 7 end-slide components in sync.
      if (!viteConf.resolve) viteConf.resolve = {};
      const existingAlias = viteConf.resolve.alias;
      const aliasArray = Array.isArray(existingAlias)
        ? existingAlias
        : existingAlias
          ? Object.entries(existingAlias).map(([find, replacement]) => ({
              find,
              replacement: replacement as string,
            }))
          : [];
      aliasArray.push(
        {
          find: /^remotion$/,
          replacement: new URL("src/lib/end-slide-preview/remotion-shim.ts", import.meta.url)
            .pathname,
        },
        {
          find: /^@marketing-auto\/social\/end-slide-components$/,
          replacement: new URL(
            "../../packages/social/src/end-slide-components/index.ts",
            import.meta.url,
          ).pathname,
        },
      );
      viteConf.resolve.alias = aliasArray;
    },
  },

  devServer: {
    port: 3051,
    open: false,
    // Static assets (rendered slides, brand uploads) are served by the API on
    // a different port in dev (see VITE_API_BASE_URL). The frontend resolves them
    // to absolute URLs via assetUrl() in src/lib/asset-url.ts.
  },

  framework: {
    config: {
      brand: {
        primary: "#3f51b5",
        secondary: "#26a69a",
        accent: "#7c4dff",
        dark: "#1d1d1d",
        positive: "#21ba45",
        negative: "#c10015",
        info: "#31ccec",
        warning: "#f2c037",
      },
      notify: {
        position: "top-right",
        timeout: 4000,
      },
    },

    plugins: ["Notify", "Dialog", "LocalStorage", "Dark"],

    iconSet: "material-icons",

    lang: "de",
  },

  animations: [],

  sourceFiles: {
    rootComponent: "src/App.vue",
    router: "src/router/index",
    store: "src/stores/index",
  },
}));
