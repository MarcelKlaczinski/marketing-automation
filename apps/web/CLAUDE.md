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
- `data: () => ({...})` arrow shorthand — NOT `data() { return {...} }`. **Exception**: when `data()` must read `this` to initialize from props (e.g. `this.project.domain`), use the method form `data() { return {...} }` — arrow functions don't bind `this`.
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
- DO NOT pass `{ async: false }` to `marked.parse()` or cast its return `as string` — use type narrowing instead: `const r = marked.parse(src); return typeof r === 'string' ? r : '';`. The TypeScript overload signature returns `string | Promise<string>` even in sync mode, so narrowing is required but the cast is not.
- DO NOT import from `@codemirror/view`, `@codemirror/state`, or `@codemirror/commands` without adding them as direct dependencies — they are not reliably available via transitive resolution from `codemirror`. Install explicitly: `bun add @codemirror/view @codemirror/state @codemirror/commands`
- DO NOT store a CodeMirror `EditorView` in Vue reactive `data()` and then pass it directly to typed functions — Vue's reactive proxy wrapper makes the stored type structurally incompatible with `EditorView` even when `markRaw` is used. Pattern: cast at call-site with `this.editorView as unknown as EditorView` and add a justification comment explaining the `markRaw` proxy-typing mismatch
- DO NOT call a method from `data()` — component methods are not yet attached when `data()` runs. If you need a helper to build the initial state from props, inline the logic directly in `data()` or extract it as a module-level function that accepts the prop value as a parameter. Calling `this.buildForm()` in `data()` will error at runtime (TS2722 "Cannot invoke an object which is possibly undefined").
- DO NOT use `HttpError.message` in user-facing notifications — use `HttpError.userMessage` instead. `.message` is the raw constructor string; `.userMessage` is a getter that extracts `body.message`, `body.error`, maps common status codes (401, 403, 404) to readable strings, and falls back gracefully for network errors.
- DO NOT duplicate constants from `src/lib/article-status.ts` (e.g. `STATUS_TO_GROUP`, `STATUS_GROUP_COLORS`) — import them. The file is the single source of truth for status↔group and status↔color mappings across all article components.
- DO NOT render raw DB enum values (status, outcome, etc.) directly in `:label`, `:caption`, or text interpolations — they bypass the `$t()` requirement. Pattern: define a module-level `Record<string, string>` map from enum value → i18n key path, then call `this.$t(map[value]) as string` with a fallback to the raw value. See `SCHEMA_STATUS_KEYS` / `schemaStatusLabel()` in `ArticleValidationPanel.vue` for the canonical example.
- DO NOT place `q-tooltip` as a sibling element with `:target="true"` before its intended host — in Vue 3 fragment templates there is no single parent to attach to. Always nest `q-tooltip` as a direct child inside the element it should appear on (button, icon, etc.).
- DO NOT use `data()` method form just to access a Pinia store — stores are singletons. Use arrow shorthand with a lazy thunk: `const s = () => useArticlesStore()` inside `data: () => { ... }`, then call `s()` inside closures. This satisfies the arrow shorthand rule without reading `this`.
- DO NOT use `vue-chartjs` chart components without calling `Chart.register(...)` for every Chart.js element used — tree-shaking requires explicit registration per component file. Missing registration silently renders a blank canvas. Pattern: import the needed elements (e.g. `ArcElement, Tooltip, Legend`) and call `Chart.register(...)` at module level before the `defineComponent` call.
- DO NOT assume Chart.js tick/tooltip callbacks have narrowed numeric types — `ChartOptions` types the y-axis `ticks.callback` value as `number | string` even on a `LinearScale` (which only emits numbers), and `ctx.parsed.y` in tooltip callbacks is typed `number | null`. Null-guard with `?? 0` or `== null` check; cast `v as number` when it's provably a LinearScale and add a justification comment.
