import { createPinia } from "pinia";
import { defineStore as wrapper } from "#q-app/wrappers";

export default wrapper((/* { ssrContext } */) => {
  const pinia = createPinia();
  return pinia;
});
