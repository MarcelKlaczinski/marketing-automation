import { useAuthStore } from "src/stores/auth";
import { useSystemStatusStore } from "src/stores/system-status";
import { defineBoot } from "#q-app/wrappers";

export default defineBoot(async (/* { app, router } */) => {
  const auth = useAuthStore();
  const systemStatus = useSystemStatusStore();
  await Promise.all([auth.fetchCurrent(), systemStatus.fetchStatus()]);
});
