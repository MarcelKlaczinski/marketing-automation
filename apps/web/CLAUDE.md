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
- **`setup()` in Options API components is for composable calls only** — do not call `ref()`, `computed()`, `watch()`, or any other Composition API primitive inside `setup()`. Reactive primitives belong in `data:{}` and `computed:{}`. `setup()` may only call composables (e.g. `useCostSummary()`) and return their results.
- **MaybeRef pattern for composables** — when a composable accepts a value that an Options API component might want to pass as a plain string/number (not a Ref), type the parameter as `MaybeRef<T>` and call `unref()` at usage sites. This lets Options API components pass literal values without calling `ref()` (a Composition API primitive): `useCostSummary("month")` instead of `useCostSummary(ref("month"))`. See `src/composables/useCostSummary.ts` for the canonical example.

## i18n Structure
Locale bundles live in `src/i18n/de/` (full) and `src/i18n/en/` (stub).
Each namespace is a separate file (`app.ts`, `nav.ts`, `auth.ts`, `home.ts`, etc.) imported in `de/index.ts` and `en/index.ts`.
When adding a new namespace: create the file in both `de/` and `en/`, wire into both index files.
Type augmentation in `src/boot/i18n.ts` makes `$t()` type-safe — if a key isn't in `de/`, the IDE will warn.

## Animation System

Global animation utilities live in `src/css/animations.scss` (imported by `app.scss`).

**CSS custom properties** (available everywhere):
```css
--ease-out:    cubic-bezier(0.23, 1, 0.32, 1)   /* entries, button press */
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)  /* on-screen movement */
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)   /* drawers/sheets */
```

**Stagger pattern** — for lists that should cascade in:
```html
<div class="stagger-list">
  <div v-for="item in items" class="stagger-item">...</div>
</div>
```
Delays: 0/45/90/135/180/215/245ms. Keep delays short — 30-80ms per item is the sweet spot.

**Rules when writing new CSS transitions:**
- Always specify exact properties — never `transition: all`
- Use `var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1))` (with inline fallback for scoped styles)
- Gate hover animations: `@media (hover: hover) and (pointer: fine) { :hover { ... } }`
- Button/pressable `:active` state: `transform: scale(0.97)`, 160ms

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
14. `/projects/:slug/brand/assets`     — Asset browser (Spec 52b)
15. `/projects/:slug/brand/colors`     — Color token editor (Spec 52b)
16. `/projects/:slug/brand/typography` — Typography token editor (Spec 52b)
17. `/projects/:slug/social/admin`     — Social posts admin + batch re-render (Spec 52b)

## Brand UI (Spec 52b)

### Project context store (`src/stores/project-context.ts`)
Pinia store that tracks the active project slug/id and persists the selection via `LocalStorage` (key: `ma_current_project_slug`). Brand pages depend on `currentProjectSlug` being set — if it's `null` the sidebar Brand section is hidden.

- `loadProjects()` — fetches `/api/projects` on first mount; called in `MainLayout.vue`
- `setProject(slug)` — sets active project + persists
- `clearProject()` — resets to null

### Brand components
| Component | Location | Notes |
|-----------|----------|-------|
| `ProjectSelector` | `src/components/projects/` | `q-btn-dropdown` (exists but removed from header in Spec 52b); can be re-added to the sidebar or other surfaces |
| `BrandPanel` | `src/components/projects/` | 4-card nav panel shown in the Brand tab of ProjectDetailPage; navigates to brand sub-pages |
| `OklchSlider` | `src/components/brand/` | L/C/H sliders for one color token; lazy-loads culori; emits hex string. Handlers typed `(v: number \| null)` — null-guard required |
| `ContrastChecker` | `src/components/brand/` | Shows AA/AAA chips; lazy-loads culori `wcagContrast`; catches invalid hex gracefully |
| `AssetCard` | `src/components/brand/` | Shows single brand asset with hover actions (Override/Reset/Delete) |
| `AssetUploadModal` | `src/components/brand/` | Drag-drop + file input; posts multipart to `/brand-assets/upload` |

### culori type declarations
No `@types/culori` package exists. Both `apps/api` and `apps/web` have hand-written declarations at `src/types/culori.d.ts`. Do not remove these files.

### q-slider event type
`@update:model-value` on `q-slider` emits `number | null`. All handlers must accept `number | null` and guard with `if (v == null) return`. Typed as `(v: number)` causes TS errors.

### oklch → hex normalization
The DB stores brand colors as CSS `oklch()` strings (e.g. `oklch(64% 0.16 248)`). `OklchSlider` expects a hex input. Use `toHexSafe()` (module-level async function) in the page's `loadTokens()` to convert before setting `localColors`:
```ts
async function toHexSafe(value: string | undefined): Promise<string | undefined> {
  if (!value) return undefined;
  if (value.startsWith("#")) return value;
  const { formatHex, converter } = await import("culori");
  const toRgb = converter("rgb");
  const rgb = toRgb(value);
  return rgb ? (formatHex(rgb) ?? value) : value;
}
```
See `ColorSettingsPage.vue` for the canonical usage pattern.

### q-card navigation
`q-card` in Quasar v2 does NOT support a `:to` prop for router-link navigation. Use `@click="$router.push({ name: 'route-name', params: { slug } })"` with `clickable` and `v-ripple` attributes instead. See `BrandPanel.vue`.

### TypographyForm indexing
`form[key]` where `key: keyof TypographyForm` returns `string | number`. Use the `numericField(key)` helper to safely extract the numeric value for slider `:model-value` bindings.

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
- DO NOT render raw DB enum values (status, outcome, etc.) directly in `:label`, `:caption`, or text interpolations — they bypass the `$t()` requirement. Two valid patterns: (A) **explicit map** — `const STATUS_MAP: Record<string, string> = { pending: "briefs.approvalStatus.pending", ... }` then `this.$t(STATUS_MAP[value]) as string` in computed (use when enum values don't follow a predictable namespace); (B) **dynamic key path** — `this.$t(\`namespace.group.${value}\`) as string` in computed (use when every enum value maps to `namespace.group.<value>` and all values are covered in i18n). Pattern B is more concise; use it when adding a new status group to i18n (e.g. `briefs.approvalStatus.*`, `clusters.generationStatus.*`). See `approvalStatusLabel` in `BriefDetailPage.vue` (pattern B) and `SCHEMA_STATUS_KEYS` in `ArticleValidationPanel.vue` (pattern A).
- DO NOT place `q-tooltip` as a sibling element with `:target="true"` before its intended host — in Vue 3 fragment templates there is no single parent to attach to. Always nest `q-tooltip` as a direct child inside the element it should appear on (button, icon, etc.).
- DO NOT prefix `api.*` call paths with `/api` — the `api` Axios instance in `src/lib/api-client.ts` has `baseURL: ".../api"` already. Adding `/api/...` to the path produces a double-prefix (`/api/api/...`) and a silent 404. All paths must start with the resource directly (e.g. `/social-posts/:id/re-render`, not `/api/social-posts/:id/re-render`). Direct `fetch()` calls that build the URL from `VITE_API_BASE_URL` are not affected — they get the full base URL including `/api`.
- DO NOT use `data()` method form just to access a Pinia store — stores are singletons. Use arrow shorthand with a lazy thunk: `const s = () => useArticlesStore()` inside `data: () => { ... }`, then call `s()` inside closures. This satisfies the arrow shorthand rule without reading `this`.
- DO NOT use `vue-chartjs` chart components without calling `Chart.register(...)` for every Chart.js element used — tree-shaking requires explicit registration per component file. Missing registration silently renders a blank canvas. Pattern: import the needed elements (e.g. `ArcElement, Tooltip, Legend`) and call `Chart.register(...)` at module level before the `defineComponent` call.
- DO NOT assume Chart.js tick/tooltip callbacks have narrowed numeric types — `ChartOptions` types the y-axis `ticks.callback` value as `number | string` even on a `LinearScale` (which only emits numbers), and `ctx.parsed.y` in tooltip callbacks is typed `number | null`. Null-guard with `?? 0` or `== null` check; cast `v as number` when it's provably a LinearScale and add a justification comment.
- DO NOT mix `display: flex` and `display: -webkit-box` in the same CSS rule — `-webkit-line-clamp` (for text truncation) requires `display: -webkit-box` which overrides a preceding `display: flex`, breaking flex child alignment. If you need both a flex row (icon + text) and line-clamping, wrap the text in a separate inner element and apply `-webkit-line-clamp` only to that inner wrapper.
- DO NOT write `transition: all` or bare `transition: opacity 0.15s` in new CSS — use explicit properties with `var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1))`. The inline fallback is required in `<style scoped>` blocks where the CSS variable defined in `animations.scss` may not resolve. Avoid `ease-in` on any UI element — it starts slow and feels sluggish.
- DO NOT use `$tc()` for pluralization — it was removed in vue-i18n v10 with `legacy: false`. Use `$t(key, { n: count }, count)` instead: the named-args object is the second argument, the plural count is the third. Example: `$t('trends.days', { n: days }, days)` for a string like `"{n} day | {n} days"`. Using `$tc()` fails silently at runtime (returns undefined) and TypeScript won't catch it because the type augmentation in `boot/i18n.ts` only covers `$t`.
- DO NOT rely on Quasar's default `q-transition--scale` dialog animation looking polished — it starts from `scale(0)` which looks like elements spawn from nothing. `animations.scss` overrides this globally to `scale(0.95)` with custom easing. If you add a dialog with a different `transition-show` prop, apply the same `scale(0.95)` start manually or leave the default `scale` to inherit the fix.
- DO NOT use German typographic quotation marks (`„..."`) inside double-quoted TypeScript string literals in i18n files — `"z.B. „Mehr Pricing-Fokus""` is a TypeScript syntax error (the `"` ends the string mid-literal, `„` is treated as identifier). Use single-quoted outer strings for values that contain German quotation marks: `'z.B. "Mehr Pricing-Fokus"'`. Or use escaped double quotes `\"`. Caught during Spec 54.12 Session 5 compilation.
- DO NOT add a new i18n namespace under `clusters.*` without also adding a corresponding `fullCluster:` block in both `de/clusters.ts` AND `en/clusters.ts` — the type augmentation in `boot/i18n.ts` enforces that `de` is the source of truth; missing keys in `en` cause type errors at every call site.
- DO NOT export `createPinia()` directly from `src/stores/index.ts` — Quasar's boot process does `import store from 'src/stores/index'` and expects the `store()` factory wrapper from `quasar/wrappers`. Plain export causes `SyntaxError: does not provide export named 'default'` at boot. Pattern: `import { store } from 'quasar/wrappers'; export default store(() => createPinia())`.
- DO NOT use `window` in composables — use `globalThis` for SSR safety. `globalThis.innerWidth` is `undefined` server-side; guard with `?? 0`. `globalThis.addEventListener/removeEventListener` work in both browser and SSR without guard.
- DO NOT write a module-level `Record<string, string>` map with hardcoded user-visible labels (type names, status labels, etc.) — these bypass the `$t()` requirement. Pattern: map the enum/type value → i18n key path string (`"dashboard.pipeline.types.blog"`), then call `this.$t(map[value]) as string` in the computed property. The i18n key lookup works with hyphenated keys (`"cold-start"`) — vue-i18n splits on `.` only, so `'dashboard.pipeline.types.cold-start'` resolves correctly.
- DO NOT rely on `hide-dropdown-icon` prop on `q-btn-dropdown` to suppress the internal arrow icon — Quasar renders `<i class="q-btn-dropdown__arrow">arrow_drop_down</i>` regardless. Use `:deep(.q-btn-dropdown__arrow) { display: none; }` in scoped CSS to hide it. If you render your own custom chevron SVG, apply this fix to avoid a doubled arrow.
- DO NOT use TanStack Query (`useQuery`) for ephemeral search/filter queries whose debounced input lives in `data()` — you cannot pass a reactive `data()` value as a queryKey to `setup()` without breaking Options API rules. Use a `watch` watcher with `setTimeout` debounce and direct `apiGet()` calls instead. This is acceptable because search results don't benefit from a shared cache. See `CommandPalette.vue` for the canonical pattern.
- DO NOT add `scroll-snap-type` to a scroll container without also adding `scroll-snap-align: start` and a fixed `min-width` to each child — the parent setting alone produces no visible snapping. On mobile horizontal-scroll lanes, child items need `min-width: calc(100vw - Xpx); flex-shrink: 0; scroll-snap-align: start` to snap-to-card correctly. See `PipelineStatusLane.vue` mobile CSS.
- DO NOT assume default button/icon sizes (32px, 36px) meet touch-target requirements on mobile — WCAG and Apple HIG require ≥ 44×44px tap targets. Add `@media (max-width: 767px) { .btn { min-height: 44px; width: 44px; } }` overrides for all interactive elements that appear on mobile (icon buttons, nav items, filter chips).
- DO NOT define an inline module-level helper function inside a `.vue` file that calls Composition API primitives (`ref`, `computed`, `useInfiniteQuery`, etc.) — this is the same violation as calling them directly in `setup()`. The function is not a composable just because it's defined outside `setup()`; Vue's hook context only makes it valid if it's called from within `setup()`. The fix is always to move it to `src/composables/useXxx.ts`. Pattern caught during Spec 56.2: `function useBriefSection(...)` defined at module level inside `BriefsPage.vue` and extracted to `src/composables/useBriefsSection.ts`.
- DO NOT wrap `route.params.X` in `computed(() => route.params.X)` as a TanStack Query key in route-mounted components — Vue Router remounts the component entirely when the route param changes, so the param is static for the component's lifetime. A plain `const id = route.params.X as string` is correct. Using `computed()` for this is a Composition API violation in `setup()` and unnecessary. Only reactive query keys (e.g. filter state) need `computed()` — and those belong in a composable, not inline in `setup()`.
- DO NOT render DB enum values that represent categories/sources as raw strings even in `mono`-styled metadata spans — values like `brief.source` (`gap_analysis`, `trend_discovery`) and `brief.clusterAction` (`create_new`, `append_to_existing`) are DB enums that must be translated via `$t()`. The `mono` class is a visual hint, not a reason to skip i18n. Add keys under `briefs.source.*` and `briefs.clusterAction.*`. Caught in Spec 56.2 review: `BriefCard.vue` and `BriefDetailPage.vue` both rendered `brief.source` raw.
- DO NOT write a module-level helper function in a `.vue` file that produces user-facing strings — module-level functions have no access to `this.$t()`. If the helper formats a value that will be shown to the user (e.g. relative timestamps, labels), inline the logic inside a `computed` property where `this.$t()` is available. Caught in Spec 56.3 review: `formatRelative()` in `FormSection.vue` had hardcoded German strings; fixed by moving the logic into `relativeSavedAt` computed.
- DO NOT store numeric values in form data when using `FormInput` — `FormInput.modelValue` is typed as `String`, so `v-model` on number inputs requires storing strings in form data and calling `parseFloat()`/`parseInt()` on save. Storing `number` in form data causes TS2322 "Type 'number' is not assignable to type 'string'". Pattern: `initialData: () => ({ budget: String(project.value?.budget ?? 0) })` + `onSave: (d) => api.patch({ budget: parseFloat(d.budget) })`.
- DO NOT use `?? undefined` when binding optional string props — with `exactOptionalPropertyTypes`, `string | undefined` is not assignable to `string` (the inferred prop type). Use `?? ''` instead: `:last-saved-at="form.lastSavedAt.value ?? ''"`. The empty string is falsy so `v-if="lastSavedAt"` guards still work correctly. Caught in Spec 56.3: `:last-saved-at="form.lastSavedAt.value ?? undefined"` caused TS2379 across all FormSection usages.
