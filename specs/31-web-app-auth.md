# Spec 31: Auth + Session UI

**Phase:** 4 (Web App Foundation Wave 1)
**Estimated Effort:** 1 day (1 session)
**Dependencies:** Spec 30 (web app shell), Spec 04 (magic-link auth backend), Spec 11.5 (email adapter for sending the link)
**Status:** Ready for implementation
**Recommended Model:** Sonnet 4.6 (UI + auth flow; no architectural complexity)

---

## Goal

Wire the **frontend authentication flow** on top of Spec 30's shell. After this spec:

- `/auth/login` page with email input → POST to `/api/auth/magic-link/request`
- `/auth/verify?token=...` page that POSTs to `/api/auth/magic-link/verify`, sets the session cookie, and redirects to `/inbox`
- `/inbox` page shows a basic post-login landing (real content in later specs)
- Route guard `requireAuth` on all `/projects/*`, `/articles/*`, `/cost`, `/activity`, `/settings`, `/inbox`
- Logout flow (`/api/auth/logout` → clear cookie → redirect to `/auth/login`)
- "Remember me" via the existing httpOnly session cookie (max-age 30 days from Spec 04)
- Dev-mode UX: when SMTP is not configured, login page shows a clear message + a "Get magic link from server log" hint

The backend is already complete (Spec 04 + 11.5). This spec is pure frontend integration, plus a small UX-polish concern around dev-mode.

## Architecture Decisions

**Decision 1: Cookie-based session, not JWT in localStorage.**
Spec 04 sets an httpOnly cookie. The frontend never sees the session token directly — it just makes credentialed requests. This is more secure than localStorage tokens and was already decided in Spec 04. Spec 31 just respects that.

**Decision 2: Route guards via Vue Router's `beforeEach`, not per-component checks.**
Centralized guard logic in `router/guards.ts`. Components don't need to check auth themselves. Two guards:
- `requireAuth`: redirect to `/auth/login` if not authenticated
- `requireUnauth`: redirect to `/inbox` if already authenticated (so users don't see login while logged in)

**Decision 3: Auth state hydrated on app boot.**
Already done in Spec 30's pinia boot file (`fetchCurrent()`). Spec 31 uses that — no re-fetch on every navigation.

**Decision 4: Dev-mode awareness via `system.status.adapters.smtp.configured`.**
The login page checks `useSystemStatusStore()`. If SMTP is unconfigured, shows different copy. No special "dev mode" flag — uses the existing system status that the installer also uses.

**Decision 5: Verify page parses query string, not route params.**
Magic links come as `/auth/verify?token=abc123`. Easier to copy-paste from email body than path-based tokens. Matches Spec 04's URL convention (`APP_BASE_URL/auth/verify?token=...`).

**Decision 6: Single redirect target after verify.**
Spec 31 always redirects to `/inbox` after successful verify. No support for "intended destination" via query params — that's a Phase-5 enhancement. Reason: keeps verify flow simple and avoids edge-case bugs around malicious redirect URLs.

**Decision 7: No "magic link sent" page — banner inline on login page.**
After clicking "Send magic link", the login page swaps its form for a confirmation banner. Less navigation, clearer UX.

**Decision 8: Logout via API call, then state clear, then redirect.**
Even if the API call fails (network error), state is still cleared and redirect happens. Prevents users from being stuck logged-in on the frontend when the backend session is broken.

## Non-Goals

- **No "remember me" toggle** — sessions are 30 days regardless (simpler UX, same as Vanilla v3)
- **No social login** (Google/GitHub) — magic-link is the only auth method
- **No password fallback** — magic-link only
- **No multi-device session management UI** — sessions exist server-side, but no UI to view/revoke them (future spec if needed)
- **No "intended destination" preservation** — always redirect to `/inbox` post-verify
- **No CAPTCHA** — internal tool, not subject to bot abuse
- **No rate-limit feedback in UI** — Spec 04 has rate limiting on magic-link requests; if the user hits it, the API returns an error which our generic error toast shows. No special "you've requested too many links" UI.
- **No verify-link expiration countdown** — links expire after 15 min per Spec 04, but we don't show a countdown on the login page

## Detailed Implementation

### Backend: Verify endpoint behavior

Quick check that Spec 04's behavior matches what this spec needs:

- `POST /api/auth/magic-link/request` body `{ email: string }` → 202 Accepted (always — don't reveal if email is registered)
- `POST /api/auth/magic-link/verify` body `{ token: string }` → 200 with `{ user: { id, email } }` and `Set-Cookie: session=...`
- `POST /api/auth/logout` → 204, clears cookie
- `GET /api/auth/me` → 200 with `{ id, email }` if authenticated, 401 otherwise

Confirm these match before starting. If not, note the deviation and update either side.

### Add Backend `requireAuth` Middleware to Article Routes

Spec 30 fixed Issue #8 from the audit (article routes unauthenticated) — verify it's done. If not done by the cleanup sweep, add `articleRoutes.use(requireAuth)` before mounting.

This belongs in the cleanup sweep, but if for any reason it wasn't applied, it MUST be applied as part of this spec. Frontend cannot rely on auth without backend enforcement.

### Frontend: LoginPage

`apps/web/src/pages/LoginPage.vue`:

```vue
<template>
  <q-card class="q-pa-lg">
    <q-card-section>
      <div class="text-h5 q-mb-md">{{ $t('auth.login.title') }}</div>
      <p class="text-body2 q-mb-md">
        {{ $t('auth.login.subtitle') }}
      </p>
    </q-card-section>

    <q-card-section v-if="!sent">
      <q-form @submit.prevent="onSubmit">
        <q-input
          v-model="email"
          type="email"
          :label="$t('auth.login.emailLabel')"
          :rules="emailRules"
          autofocus
          :disable="loading"
          autocomplete="email"
          inputmode="email"
        />

        <q-banner v-if="!smtpConfigured" class="q-mt-md bg-warning text-dark">
          <template v-slot:avatar>
            <q-icon name="warning" />
          </template>
          {{ $t('auth.login.smtpNotConfigured') }}
        </q-banner>

        <q-btn
          type="submit"
          :label="$t('auth.login.submitButton')"
          color="primary"
          class="full-width q-mt-md"
          :loading="loading"
        />
      </q-form>
    </q-card-section>

    <q-card-section v-else>
      <q-banner class="bg-positive text-white">
        <template v-slot:avatar>
          <q-icon name="mark_email_read" />
        </template>
        {{ $t('auth.login.successMessage') }}
      </q-banner>

      <q-banner v-if="!smtpConfigured" class="q-mt-md bg-info text-white">
        <template v-slot:avatar>
          <q-icon name="developer_mode" />
        </template>
        <div>{{ $t('auth.login.checkServerLog') }}</div>
        <div class="text-caption q-mt-xs">{{ $t('auth.login.checkServerLogHint') }}</div>
      </q-banner>

      <q-btn
        flat
        :label="$t('auth.login.useDifferentEmail')"
        class="q-mt-md"
        @click="sent = false; email = ''"
      />
    </q-card-section>
  </q-card>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { api } from 'src/lib/api-client';
import { useSystemStatusStore } from 'src/stores/system-status';
import { useNotify } from 'src/composables/useNotify';
import { HttpError } from 'src/lib/http-error';

export default defineComponent({
  name: 'LoginPage',

  setup() {
    return {
      systemStatusStore: useSystemStatusStore(),
      notify: useNotify(),
    };
  },

  data: () => ({
    email: '',
    loading: false,
    sent: false,
    emailRules: [
      (v: string) => !!v || 'E-Mail-Adresse erforderlich',
      (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || 'Ungültige E-Mail-Adresse',
    ],
  }),

  computed: {
    smtpConfigured(): boolean {
      return this.systemStatusStore.adapters.smtp.configured;
    },
  },

  methods: {
    async onSubmit(): Promise<void> {
      this.loading = true;
      try {
        await api.post('/auth/magic-link/request', { email: this.email });
        this.sent = true;
      } catch (e) {
        if (e instanceof HttpError) {
          this.notify.error(e.userMessage);
        }
      } finally {
        this.loading = false;
      }
    },
  },
});
</script>
```

### Frontend: AuthVerifyPage

`apps/web/src/pages/AuthVerifyPage.vue`:

```vue
<template>
  <q-card class="q-pa-lg">
    <q-card-section class="text-center">
      <q-spinner-dots v-if="state === 'loading'" size="3em" color="primary" class="q-mb-md" />
      <q-icon v-else-if="state === 'success'" name="check_circle" size="3em" color="positive" class="q-mb-md" />
      <q-icon v-else name="error" size="3em" color="negative" class="q-mb-md" />

      <div class="text-h6">
        <span v-if="state === 'loading'">{{ $t('auth.verify.loading') }}</span>
        <span v-else-if="state === 'success'">{{ $t('auth.verify.success') }}</span>
        <span v-else>{{ $t('auth.verify.failure') }}</span>
      </div>

      <div v-if="state === 'failure'" class="text-body2 q-mt-md text-grey-7">
        {{ failureReason }}
      </div>

      <q-btn
        v-if="state === 'failure'"
        :label="$t('auth.verify.tryAgain')"
        color="primary"
        class="q-mt-md"
        :to="{ name: 'login' }"
      />
    </q-card-section>
  </q-card>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { api } from 'src/lib/api-client';
import { useAuthStore } from 'src/stores/auth';
import { HttpError } from 'src/lib/http-error';

type VerifyState = 'loading' | 'success' | 'failure';

export default defineComponent({
  name: 'AuthVerifyPage',

  setup() {
    return {
      authStore: useAuthStore(),
    };
  },

  data: () => ({
    state: 'loading' as VerifyState,
    failureReason: '',
  }),

  async mounted() {
    const token = (this.$route.query.token as string | undefined) ?? '';
    if (!token) {
      this.state = 'failure';
      this.failureReason = 'Kein Token in der URL';
      return;
    }

    try {
      const res = await api.post<{ user: { id: string; email: string } }>(
        '/auth/magic-link/verify',
        { token },
      );

      // Sync the auth store
      this.authStore.user = res.data.user;
      this.state = 'success';

      // Brief delay so user sees the success state, then redirect
      setTimeout(() => {
        void this.$router.push({ name: 'inbox' });
      }, 800);
    } catch (e) {
      this.state = 'failure';
      if (e instanceof HttpError) {
        this.failureReason = e.userMessage;
      } else {
        this.failureReason = 'Unbekannter Fehler';
      }
    }
  },
});
</script>
```

### Frontend: InboxPage

`apps/web/src/pages/InboxPage.vue`:

```vue
<template>
  <q-page padding>
    <div class="row q-mb-md">
      <div class="col">
        <h1 class="text-h5 q-my-none">{{ $t('inbox.title') }}</h1>
        <p class="text-body2 text-grey-7 q-mt-xs">
          {{ $t('inbox.greeting', { email: authStore.user?.email ?? '' }) }}
        </p>
      </div>
    </div>

    <q-banner v-if="!systemStatusStore.allConfigured" class="bg-warning text-dark q-mb-md">
      <template v-slot:avatar>
        <q-icon name="warning" />
      </template>
      <div>{{ $t('inbox.setupIncomplete') }}</div>
      <template v-slot:action>
        <q-btn flat :label="$t('inbox.openInstaller')" :to="{ name: 'installer' }" />
      </template>
    </q-banner>

    <q-card>
      <q-card-section>
        <div class="text-h6">{{ $t('inbox.todoTitle') }}</div>
      </q-card-section>
      <q-card-section>
        <q-banner class="bg-info text-white">
          <template v-slot:avatar>
            <q-icon name="construction" />
          </template>
          Diese Seite wird in Spec 39 (Activity Feed) und Spec 40 (Push Notifications) inhaltlich gefüllt.
        </q-banner>
      </q-card-section>
    </q-card>
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useAuthStore } from 'src/stores/auth';
import { useSystemStatusStore } from 'src/stores/system-status';

export default defineComponent({
  name: 'InboxPage',

  setup() {
    return {
      authStore: useAuthStore(),
      systemStatusStore: useSystemStatusStore(),
    };
  },
});
</script>
```

### Frontend: Route Guards

`apps/web/src/router/guards.ts`:

```typescript
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
  router.beforeEach(async (to, _from) => {
    const auth = useAuthStore();
    const systemStatus = useSystemStatusStore();

    // If auth state hasn't been hydrated yet (rare — boot file does this),
    // wait for it to settle. Loading state is handled by Pinia's `loading`.
    if (auth.user === null && !auth.loading) {
      // Boot may have completed without a session — re-check before deciding redirect
      // (only on first navigation to avoid loops)
    }

    // 1. Unconfigured system → force installer
    //    Postgres + Redis must be configured for ANYTHING to work.
    if (!systemStatus.requiredCoreReady && to.name !== 'installer') {
      return { name: 'installer' };
    }

    // 2. Authenticated user trying to access auth-only routes (login) → redirect to inbox
    if (auth.isAuthenticated && to.name && UNAUTH_ONLY_ROUTE_NAMES.has(to.name as string)) {
      return { name: 'inbox' };
    }

    // 3. Unauthenticated user trying to access protected routes → redirect to login
    if (!auth.isAuthenticated && to.name && !PUBLIC_ROUTE_NAMES.has(to.name as string)) {
      return { name: 'login' };
    }

    // Otherwise, proceed
    return true;
  });
}
```

Update `apps/web/src/router/index.ts`:

```typescript
import { defineRouter } from '#q-app/wrappers';
import { createRouter, createMemoryHistory, createWebHistory, createWebHashHistory } from 'vue-router';
import routes from './routes';
import { registerGuards } from './guards';

export default defineRouter(function () {
  const createHistory = process.env.SERVER
    ? createMemoryHistory
    : process.env.VUE_ROUTER_MODE === 'history'
      ? createWebHistory
      : createWebHashHistory;

  const Router = createRouter({
    scrollBehavior: () => ({ left: 0, top: 0 }),
    routes,
    history: createHistory(process.env.VUE_ROUTER_BASE),
  });

  registerGuards(Router);

  return Router;
});
```

### Frontend: AuthStore Logout

Update `apps/web/src/stores/auth.ts` — `logout()` action is already stubbed in Spec 30. Replace:

```typescript
async logout(): Promise<void> {
  try {
    await api.post('/auth/logout');
  } catch {
    // Ignore errors — local cleanup must always happen
  }
  this.user = null;
},
```

This was already in Spec 30. Verify it works.

### Frontend: MainLayout Logout Wiring

Already done in Spec 30 — the `logout()` method calls `authStore.logout()` then redirects to `login`. Verify it functions correctly with the real backend.

### Frontend: i18n keys

`apps/web/src/i18n/de/auth.ts` — extend with new keys:

```typescript
export default {
  login: {
    title: 'Anmelden',
    subtitle: 'Erhalte einen einmaligen Anmelde-Link per E-Mail',
    emailLabel: 'E-Mail-Adresse',
    submitButton: 'Magic Link senden',
    successMessage: 'E-Mail mit Anmelde-Link versendet. Bitte prüfe dein Postfach.',
    smtpNotConfigured: 'E-Mail ist nicht konfiguriert. Der Anmelde-Link wird im Server-Log angezeigt (Dev-Modus).',
    checkServerLog: 'Anmelde-Link im Server-Log',
    checkServerLogHint: 'Schaue in der Konsole, in der `apps/api` läuft, nach einer Zeile mit "Magic link generated".',
    useDifferentEmail: 'Andere E-Mail verwenden',
  },
  verify: {
    loading: 'Anmeldung wird überprüft...',
    success: 'Erfolgreich angemeldet. Weiterleitung...',
    failure: 'Anmelde-Link ungültig oder abgelaufen.',
    tryAgain: 'Erneut versuchen',
  },
};
```

`apps/web/src/i18n/de/inbox.ts` (new file):

```typescript
export default {
  title: 'Inbox',
  greeting: 'Angemeldet als {email}',
  setupIncomplete: 'Einrichtung unvollständig — einige Funktionen sind nicht verfügbar.',
  openInstaller: 'Einrichtung öffnen',
  todoTitle: 'Aktuelle Aufgaben',
};
```

Update `apps/web/src/i18n/de/index.ts`:

```typescript
import app from './app';
import nav from './nav';
import auth from './auth';
import installer from './installer';
import errors from './errors';
import inbox from './inbox';

export default {
  app,
  nav,
  auth,
  installer,
  errors,
  inbox,
};
```

Mirror in `en/` (English placeholder values).

## Acceptance Criteria

### Login flow
- [ ] Visiting `/auth/login` shows the login form
- [ ] Submitting a valid email calls POST `/api/auth/magic-link/request` with the email
- [ ] On 202 response, form swaps to "email sent" banner
- [ ] On error, Notify toast appears (and form stays interactive)
- [ ] When SMTP is unconfigured, login page shows warning banner before submit and "check server log" hint after submit
- [ ] Already-authenticated user visiting `/auth/login` is redirected to `/inbox`

### Verify flow
- [ ] Visiting `/auth/verify?token=valid` calls POST `/api/auth/magic-link/verify` with the token
- [ ] On success: shows success state, populates auth store, redirects to `/inbox` after ~800ms
- [ ] On failure (expired/invalid token): shows failure state with reason and "Try again" button
- [ ] No token in URL: shows failure with "no token" message
- [ ] After successful verify, the session cookie is set (visible in DevTools Application tab)

### Route guards
- [ ] Unauthenticated visit to `/projects` redirects to `/auth/login`
- [ ] Unauthenticated visit to `/inbox` redirects to `/auth/login`
- [ ] Unauthenticated visit to `/articles/:id` redirects to `/auth/login`
- [ ] Authenticated visit to `/auth/login` redirects to `/inbox`
- [ ] If Postgres or Redis are unconfigured, ALL routes except `/installer` redirect to `/installer`
- [ ] Authenticated user can navigate freely between `/inbox`, `/projects`, etc.

### Inbox page
- [ ] After login, user lands at `/inbox`
- [ ] Page shows user email in greeting
- [ ] If system status incomplete, banner with "Open installer" button visible

### Logout
- [ ] Clicking logout in user dropdown calls POST `/api/auth/logout`
- [ ] Auth store user is cleared
- [ ] User is redirected to `/auth/login`
- [ ] Even if API call fails, local state is still cleared (test by stopping API)

### i18n
- [ ] All visible auth/inbox strings come from `t()`
- [ ] No console warnings about missing keys

## Testing Strategy

Manual smoke tests (the main proof points):

1. **Happy path login**:
  - Visit `/auth/login` (or any protected route — should redirect)
  - Enter your email, submit
  - Check API server logs for "Magic link generated for ..." (dev mode) or check inbox (production with SMTP)
  - Open the verify URL → success → redirect to `/inbox`
  - Verify "logged in as <email>" greeting

2. **Logout**:
  - From `/inbox`, click user dropdown → Logout
  - Verify redirect to `/auth/login`
  - Visit `/inbox` directly → should redirect back to `/auth/login`

3. **Invalid token**:
  - Visit `/auth/verify?token=garbage`
  - Verify failure state with reason

4. **Expired token**:
  - Get a valid magic link, wait 16+ minutes, then try to verify
  - Verify failure state

5. **No token**:
  - Visit `/auth/verify` (no query string)
  - Verify failure state with "no token" reason

6. **Already authenticated visiting login**:
  - From `/inbox`, manually navigate to `/auth/login`
  - Verify redirect to `/inbox`

7. **Pre-installer check**:
  - Force `system.requiredCoreReady = false` (e.g., temporarily stop Redis)
  - Visit any route → verify redirect to `/installer`
  - Restart Redis, refresh — guard recomputes after auth store re-fetches status

8. **SMTP-unconfigured UX**:
  - Unset `SMTP_USER` env var, restart API
  - Visit login, verify warning banner appears
  - Submit email, verify "check server log" hint appears
  - Verify the magic link works when fetched from API logs

## Open Questions / Decisions Made

**Decision 1: No password fallback or password-reset flow.**
Magic-link is the only auth path. If Marcel ever wants password fallback (some users prefer it), that's a separate spec. For internal use today, magic-link is enough.

**Decision 2: 800ms delay before redirecting after verify.**
Lets the user briefly see the "success" state. Without delay, the redirect happens so fast it looks like the verify never happened. 800ms is the sweet spot — long enough to register, short enough to feel snappy.

**Decision 3: `requireUnauth` only on `/auth/login`, not on `/auth/verify`.**
Reason: a logged-in user might click an old magic link (e.g., from a previous session). The verify page handles this gracefully (re-issues a session for the same user, re-redirects to inbox). No need to block.

**Decision 4: Boot fetch is the only auth state hydration.**
Spec 30's pinia boot file calls `auth.fetchCurrent()` on app start. Spec 31 doesn't add a second hydration anywhere — auth state is hydrated once per page load. If the user's session expires mid-session, the next API call returns 401, the call site handles it (or it bubbles up as an HttpError shown via Notify).

**Decision 5: No global 401 → auto-redirect interceptor.**
The api-client doesn't auto-redirect on 401. Reason: would cause confusing UX if a single 401 (e.g., from a stale stored route) suddenly redirects mid-session. Route guards handle redirects on navigation. API-call 401s are handled by call sites (most show an error toast and let the user retry).

## Discovered During Implementation (Session 2)

### API Contract Deviations Found and Fixed

The spec (and Spec 04's original implementation) had a **protocol mismatch** between the actual API endpoints and what the frontend expected. All five were fixed during Session 2 smoke testing:

1. **`/magic-link/request` was missing** — only `POST /login` existed. Fixed by adding `/magic-link/request` as a new endpoint; `/login` kept as legacy alias.

2. **`POST /magic-link/verify` was missing** — only `GET /verify?token=` (redirect flow) existed. Fixed by adding the JSON endpoint. The spec's "Backend: Verify endpoint behavior" section correctly described the desired API; the implementation just hadn't been built.

3. **`GET /verify` redirect targets were wrong** — redirected to `/login?error=` instead of `/auth/login?error=`. Fixed in `apps/api/src/routes/auth.ts`.

4. **`/me` returned unwrapped `{ id, email }`** — the spec said `{ ok: true, data: { id, email } }`, implementation returned the user object directly. Auth store was updated to parse `res.data.data` (the `{ ok, data }` envelope). The spec's Backend section was updated to match the real response: `{ ok: true, data: { id, email } }`.

5. **`AuthVerifyPage` parsed `res.data.user`** — should be `res.data.data.user` after the `{ ok, data: { user } }` envelope. Fixed in the Vue component.

### `APP_BASE_URL` Must Be the Frontend Origin

`APP_BASE_URL` in `.env` must point to the **frontend** (e.g., `http://localhost:3051`), **not** the API origin. Magic-link emails link to `APP_BASE_URL/auth/verify?token=...` (the frontend verify page). If set to the API URL (`:3050`), clicking the email link lands on a 404 (the API has no `/auth/verify` HTML route).

This is documented in `apps/api/CLAUDE.md` under Auth Patterns.

### Email Shim Must Return `SendEmailResult`

`apps/api/src/lib/email.ts`'s `sendMagicLinkEmail` function originally returned `Promise<void>`. The caller in `issueMagicLink()` checks `.delivered` to decide whether to log the verify URL (dev-mode fallback). The shim must return `Promise<SendEmailResult>` so callers can check `.delivered`.

### `requiredCoreReady` Stub Semantics

The system status store's `requiredCoreReady` getter originally returned `false` when `postgres.verified === null` (null = "not checked yet" in the pre-Spec-32 stub). This caused the route guard to always redirect to `/installer`, blocking all auth smoke testing.

Fix: treat `verified === null` as "not checked / assume ready" for the MVP guard. The gate only blocks when `configured === false` AND `verified` is not null (i.e., an actual connectivity failure).

```typescript
requiredCoreReady: (state): boolean => {
  const postgresReady = state.postgres.configured || state.postgres.verified === null;
  const redisReady = state.redis.configured || state.redis.verified === null;
  return postgresReady && redisReady;
},
```

### CORS Port Collision During Testing

Running the Vite dev server on a different port than `CORS_ORIGIN` (e.g., 3052 vs 3051) silently blocks all API calls with CORS errors — no visible error in the UI, just failed requests. Always test against the port that matches `CORS_ORIGIN` in `.env`.

### Route Guard `to.name` Cast

The spec template used `to.name as string` inside `UNAUTH_ONLY_ROUTE_NAMES.has(...)`. Under strict TypeScript, `RouteRecordName` is `string | symbol`, so the cast is unjustified. The implemented guard narrows with `typeof to.name === 'string'` before the `Set.has()` call. See `apps/web/CLAUDE.md` for details.

**Decision 6: No "remember me" toggle.**
Sessions are 30 days regardless. Vanilla v3 has the same behavior; users don't notice the absence. Adds complexity for marginal value.

**Decision 7: Separate `inbox.ts` i18n bundle.**
Even though Inbox is small, separating it from `app.ts` keeps the per-namespace files focused. Future Inbox features (notifications list, action items) will grow this bundle.

**Decision 8: Backend `requireAuth` middleware enforcement is a hard precondition.**
If the cleanup sweep didn't apply requireAuth to article routes, this spec doesn't proceed until that's done. Frontend security is meaningless without backend enforcement.

## Implementation Order

**Single session, ~5-7h:**

1. Verify cleanup sweep applied `requireAuth` to article routes (Issue #8). If not, do it first.
2. Update `apps/web/src/i18n/de/auth.ts` with new keys
3. Create `apps/web/src/i18n/de/inbox.ts`, mirror in `en/`
4. Update `apps/web/src/i18n/de/index.ts` to export inbox
5. Implement `LoginPage.vue` (replace stub)
6. Implement `AuthVerifyPage.vue` (replace stub)
7. Implement `InboxPage.vue` (replace stub)
8. Create `router/guards.ts`
9. Update `router/index.ts` to call `registerGuards`
10. Manual test: full login → verify → inbox → logout cycle
11. Manual test: protected route redirects when unauthenticated
12. Manual test: SMTP-unconfigured UX
13. Commit: `feat(web): magic-link auth flow + route guards (spec 31)`

Cost: €0.

## Splitting Plan

Not needed — single session.

## Discovered During Implementation

**1. `$route.query` array footgun.**
`LocationQuery` values are typed as `string | null | (string | null)[]`. An array value (duplicate `?token=` params) is not falsy, so `?? ''` doesn't protect you — the array would reach `api.post()` as-is. Fixed with explicit `Array.isArray` check. See `apps/web/CLAUDE.md` for the canonical pattern.

**2. `to.name as string` is an unjustified cast.**
After a `&&` guard, `to.name` is still `string | symbol`. `Set.has(to.name as string)` silences TS but overrides the type system. Fixed with `typeof to.name === 'string'` narrowing — no cast, same runtime behaviour, correct type narrowing.

**3. Placeholder banner text is user-visible and must use `$t()`.**
The spec showed the "coming in Spec 39" construction note as bare template text. Even temporary placeholders that appear in a rendered `<q-banner>` are user-facing and require `$t()`. Added `inbox.comingSoon` key.

## Deviations

**1. `emailRules` messages use `$t()` instead of hardcoded German.**
Spec showed `'E-Mail-Adresse erforderlich'` and `'Ungültige E-Mail-Adresse'` inline. Moved to `auth.login.emailRequired` / `auth.login.emailInvalid` keys. Reason: project rule prohibits hardcoded user-facing strings.

**2. No-token failure reason uses `$t('auth.verify.failure')` instead of `'Kein Token in der URL'`.**
Spec showed a hardcoded German string for the missing-token case. Replaced with the existing `verify.failure` key. If more specificity is needed in the future (e.g. "token missing vs. expired" distinction), add a dedicated `auth.verify.noToken` key.
