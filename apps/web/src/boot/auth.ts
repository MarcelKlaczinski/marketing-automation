import { useAuthStore } from "src/stores/auth";
import { defineBoot } from "#q-app/wrappers";

/**
 * Session bootstrap — runs on every app load.
 * Fetches the current authenticated user from /auth/me.
 * If unauthenticated, the router guard in router/index.ts handles redirect.
 */
export default defineBoot(async () => {
  const auth = useAuthStore();
  await auth.fetchCurrent();
});
