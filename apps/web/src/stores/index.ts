import { store } from "quasar/wrappers";
import { createPinia } from "pinia";

/**
 * Pinia store entry point — required by Quasar sourceFiles.store.
 * Quasar's auto-generated app.js imports this as a default export.
 * Individual stores are imported directly by consumers via their own files.
 */
export default store(() => {
  return createPinia();
});
