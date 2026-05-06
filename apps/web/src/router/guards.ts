import type { Router } from 'vue-router';
import { useAuthStore } from 'src/stores/auth';
import { useSystemStatusStore } from 'src/stores/system-status';

const PUBLIC_ROUTE_NAMES = new Set(['login', 'auth-verify', 'installer']);
const UNAUTH_ONLY_ROUTE_NAMES = new Set(['login']);

/**
 * Registers global navigation guards.
 * Called from router/index.ts after the Router is created.
 */
export function registerGuards(router: Router): void {
  router.beforeEach((to) => {
    const auth = useAuthStore();
    const systemStatus = useSystemStatusStore();

    // 1. Unconfigured core (Postgres + Redis) → force installer for everything except installer itself
    if (!systemStatus.requiredCoreReady && to.name !== 'installer') {
      return { name: 'installer' };
    }

    // 2. Authenticated user trying to access login-only routes → redirect to inbox
    if (auth.isAuthenticated && typeof to.name === 'string' && UNAUTH_ONLY_ROUTE_NAMES.has(to.name)) {
      return { name: 'inbox' };
    }

    // 3. Unauthenticated user trying to access protected routes → redirect to login
    if (!auth.isAuthenticated && typeof to.name === 'string' && !PUBLIC_ROUTE_NAMES.has(to.name)) {
      return { name: 'login' };
    }

    // Otherwise, proceed
    return true;
  });
}
