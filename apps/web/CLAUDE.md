# Web App (Quasar PWA) Conventions

## Responsive Layout Rule (Desktop-Optimized)
Design and test at 1280px desktop width first. Mobile (375px+) must be functional and usable, but desktop is the primary target.
Use Quasar's `q-page-container` with responsive padding. Sidebar collapses to hamburger below 1024px.

## PWA Requirements
- Service Worker registered via Quasar PWA mode
- Web Push via VAPID keys (stored in .env)
- Offline shell for /inbox screen (cached articles list)
- Add-to-Homescreen prompt after 3rd visit

## Component Patterns
- **Options API** in all `.vue` components (`<script lang="ts">` + `defineComponent`). NO `<script setup>`, NO Composition API in components.
- **Composition API only in composables** (`src/composables/useXxx.ts`).
- `data: () => ({...})` arrow shorthand — NOT `data() { return {...} }`.
- Composables in `src/composables/` for shared reactive logic.
- Components in `src/components/` — PascalCase noun naming (`AdapterStatusCard.vue`).

## i18n Structure
Locale bundles live in `src/i18n/de/` (full) and `src/i18n/en/` (stub).
Each namespace is a separate file (`app.ts`, `nav.ts`, `auth.ts`, `home.ts`, etc.) imported in `de/index.ts` and `en/index.ts`.
When adding a new namespace: create the file in both `de/` and `en/`, wire into both index files.
Type augmentation in `src/boot/i18n.ts` makes `$t()` type-safe — if a key isn't in `de/`, the IDE will warn.

## HTTP Client
- All API calls go through `src/lib/api-client.ts` (`api` Axios instance).
- Error handling uses `src/lib/http-error.ts` (`HttpError` class with `originalCause`, NOT `cause`).
- 5xx and network errors auto-surface via Quasar Notify in the interceptor.
- 4xx (including 401) are NOT auto-handled — the call site or route guard handles them.

## Screen Inventory (Phase 4)
Routes defined in `src/router/routes.ts`:
1. `/`               — Home / dashboard
2. `/inbox`          — Approval queue (Spec 33)
3. `/projects`       — Project list (Spec 34)
4. `/projects/:slug` — Project detail (Spec 34)
5. `/projects/:slug/cold-start` — Cold start wizard (Spec 35)
6. `/projects/:slug/articles`   — Articles list (Spec 36)
7. `/articles/:id`   — Article detail/review (Spec 36)
8. `/cost`           — Cost dashboard (Spec 37)
9. `/activity`       — Activity log (Spec 38)
10. `/settings`      — Settings (Spec 39)
11. `/auth/login`    — Login (Spec 31, AuthLayout — no sidebar)
12. `/auth/verify`   — Magic link verify (Spec 31, AuthLayout)
13. `/installer`     — First-run installer (Spec 32, InstallerLayout — full width, no sidebar)

## Route Guards
Global navigation guards live in `src/router/guards.ts` as `registerGuards(router: Router)`, called from `router/index.ts` after `createRouter()`. Do not add per-component auth checks — all redirect logic belongs in guards. Public routes: `login`, `auth-verify`, `installer`. Unauth-only routes: `login`.

## Common Mistakes to Avoid
- DO NOT use `<script setup>` or Composition API in `.vue` components — Options API only
- DO NOT use Quasar v1 patterns (we're on v2)
- DO NOT use raw `localStorage` — use Quasar's `LocalStorage` plugin for everything except auth cookies
- DO NOT use localStorage for auth — session is an httpOnly cookie set by the API
- DO NOT hardcode user-facing strings — all visible text (including `aria-label`) must go through `$t()`; use `:aria-label="$t('...')"` not `aria-label="..."`; this applies to placeholder/construction banners too
- DO NOT add a new i18n namespace without wiring it into both `de/index.ts` and `en/index.ts`
- DO NOT name `originalCause` as `cause` in error subclasses — `Error.cause` is a reserved built-in (same rule as backend)
- DO NOT cast `to.name as string` in route guards — `RouteRecordName` is `string | symbol`, so the cast is unjustified. Use `typeof to.name === 'string'` to narrow properly before passing to `Set.has()` or string operations
- DO NOT use `$route.query['param'] as string` — `LocationQuery` values are `string | null | (string | null)[]`. An array value (duplicate query params) is not falsy and won't be caught by `?? ''`. Always check `Array.isArray(raw) ? raw[0] ?? '' : raw ?? ''`
- DO NOT forget `as string` cast when using `$t()` in Quasar validator rule functions — the rule signature requires `(v: string) => true | string`, and `$t()` may return a broader type; the cast is justified here
- DO NOT assume API responses are unwrapped objects — all API endpoints return `{ ok: true, data: <payload> }`. When storing auth data: `const user = res.data.data` (outer `.data` = Axios response body, inner `.data` = the `{ ok, data }` envelope's payload). Type the generic as `{ ok: boolean; data: T }` to make this explicit: `api.get<{ ok: boolean; data: User }>('/auth/me')`
- DO NOT assume `system.requiredCoreReady` returns `true` in dev when adapters aren't configured — the getter treats `verified === null` (stub/not-checked) as ready, but `configured === false` + `verified !== null` (actual failure) as not-ready. Ensure the Spec-32 stub leaves `verified: null`, not `verified: false`
- DO NOT write `hint="some text"` on `q-input` — Quasar `hint` is user-visible and must use `:hint="$t('...')"`. The bare attribute form looks like HTML metadata but renders below the field.
- DO NOT hardcode a locale string in `toLocaleString()` — use `this.$i18n.locale === 'de' ? 'de-DE' : 'en-US'` so date formatting follows the active language
- DO NOT use `q-stepper` for wizard flows that need a modern look — it produces strong Material Design / Google aesthetics. Use a custom sidebar-nav + content layout (`InstallerLayout` pattern from Spec 32) instead: left panel with numbered step list, right panel with form, page-level footer for Back/Next navigation
