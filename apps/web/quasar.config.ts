/* eslint-env node */
import { defineConfig } from "#q-app/wrappers";

export default defineConfig((/* ctx */) => ({
  eslint: {
    warnings: true,
    errors: true,
  },

  preFetch: false,

  boot: ["i18n", "axios", "pinia"],

  css: ["app.scss"],

  extras: ["material-icons", "roboto-font"],

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
    },
  },

  devServer: {
    port: 3051,
    open: false,
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
