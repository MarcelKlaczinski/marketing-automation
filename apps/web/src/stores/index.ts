import { defineStore as wrapper } from '#q-app/wrappers';
import { createPinia } from 'pinia';

export default wrapper((/* { ssrContext } */) => {
  const pinia = createPinia();
  return pinia;
});
