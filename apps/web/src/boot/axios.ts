import { api } from "src/lib/api-client";
import { defineBoot } from "#q-app/wrappers";

declare module "vue" {
  interface ComponentCustomProperties {
    $api: typeof api;
  }
}

export default defineBoot(({ app }) => {
  app.config.globalProperties.$api = api;
});
