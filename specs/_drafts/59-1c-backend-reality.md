# 59.1c Backend Reality Check — Discovery Report

**Generated:** 2026-05-18  
**Based on:** Code inspection of `apps/api`, `packages/adapters/*`, `packages/db`, `apps/web`  
**No code was changed during this investigation.**

---

## Task 1 — System Credentials Verify Endpoint

**File:** `apps/api/src/routes/system.ts`  
**Dispatch location:** `runVerifyByAdapter()` switch statement, line ~203

### Dispatch mechanism

The `adapterEnum` at line 140 is a Zod enum covering 10 adapters:
```typescript
z.enum(["anthropic", "replicate", "r2", "dataforseo", "smtp", "github_app",
        "producthunt", "voyage", "reddit", "github"])
```

`runVerifyByAdapter()` dispatches per-case in a switch. Each adapter's verify function is imported as a **subpath export** from its adapter package (e.g. `@marketing-auto/adapter-anthropic/verify`).

### Currently registered for verify

| Adapter | adapterEnum? | Switch case? | verify.ts in package? | Status |
|---------|-------------|--------------|----------------------|--------|
| `anthropic` | ✅ | ✅ | ✅ | ✅ **Ready** |
| `voyage` | ✅ | ✅ | ✅ | ✅ **Ready** |
| `replicate` | ✅ | ✅ | ✅ | ✅ **Ready** |
| `dataforseo` | ✅ | ✅ | ✅ | ✅ **Ready** |
| `smtp` | ✅ | ✅ | ✅ | ✅ **Ready** |
| `r2` | ✅ | ✅ | ✅ | ✅ **Ready** |
| `github_app` | ✅ | ✅ | ✅ (astro-sync) | ✅ **Ready** |
| `producthunt` | ✅ | ✅ | ✅ | ✅ **Ready** |
| `reddit` | ✅ | ✅ | ✅ (59.1a done) | ✅ **Ready** |
| `github` | ✅ | ✅ | ✅ (59.1b pkg exists) | ⚠️ **Gap** (see Task 2) |

**hackernews** | ❌ | ❌ | ❌ | ❌ **Missing** — public API, no creds; verify optional

### Key finding

59.1a and 59.1b are already fully wired into the verify route. The import of `verifyGitHub` from `@marketing-auto/adapter-github-trending/verify` is already present at line 27 of `system.ts` and dispatched at lines 235–237. **Verify itself is done.** The gap is in the credential set/delete endpoints (see Task 2).

---

## Task 2 — System Credentials Set/Delete Endpoints

**File:** `apps/api/src/routes/system.ts`

### POST /api/system/credentials — payload schema (line ~78)

```typescript
const credentialSchema = z.object({
  service: z.enum(["anthropic", "replicate", "r2", "dataforseo", "smtp",
                    "github_app", "producthunt", "voyage"]),  // ← 8 items
  key: z.string().min(1).max(100),
  value: z.string().min(1).max(10_000),
  metadata: z.record(z.unknown()).optional(),
});
```

❌ **`reddit` and `github` are MISSING from this enum.** Attempts to save credentials for either adapter return a 400 Zod validation error today.

### DELETE /api/system/credentials/:service — validServices (line ~123)

```typescript
const validServices = ["anthropic", "replicate", "r2", "dataforseo", "smtp",
                        "github_app", "producthunt", "voyage"] as const;
```

❌ **Same 8 services — `reddit` and `github` missing.**

### DELETE /api/system/credentials/:service/:key

No enum validation at all — accepts any string. Fine for ad-hoc use.

### DB credential layer

`global_credentials` table uses `service: text()` — **no DB-level enum constraint**. Validation is purely in the TypeScript/Zod layer at the API boundary. No migration is needed to add `reddit`/`github`; only the two Zod/TS arrays in `system.ts` need updating.

### Fix required (minimal, single file)

In `apps/api/src/routes/system.ts`, add `"reddit"` and `"github"` to:
1. `credentialSchema.service` enum (line ~78)
2. `validServices` array (line ~123)

That's the **only change** needed to unblock credential storage for 59.1a/b adapters.

**Verdict:** ⚠️ **Gap** — 2-line fix, ~5 min, can be included in 59.1c.

---

## Task 3 — Per-Source Operational Config

**File:** `packages/db/src/schema/project-config.ts`

### Current SignalSourcesSchema structure

| Source | Config shape | User-editable fields |
|--------|-------------|---------------------|
| `producthunt` | `z.boolean()` — bare flag only | just on/off |
| `hackernews` | `{ enabled, queries[], hitsPerPage, minPoints }` | all 4 |
| `reddit` | `{ enabled, subreddits[], sortMode, timeWindow, minUpvotes, minComments, maxAgeDays, cronPattern }` | all 8 |
| `github` | `{ enabled, topics[], timeWindowDays, minStarsNew, minStarsEstablished, maxAgeDays, cronPattern }` | all 7 |
| `vendor_rss` | `{ enabled, feeds: string[] }` | enabled + feeds array |
| `dataforseo_trends` | `z.boolean()` — bare flag only | just on/off |

### Update path for signalSources

Individual `signal_sources` sub-blocks are **not** updated via a dedicated config endpoint. They go through the general `PATCH /api/projects/:slug` → `projects` table for flags (like `trendsCronEnabled`), and presumably a separate config-version upsert for the full JSONB block. The PATCH route currently handles cron toggles for `reddit` via `redditSignalCronEnabled` (line ~356).

### ❌ Bug: github initial value wrong in project creation

In `apps/api/src/routes/projects.ts` line 236:
```typescript
signalSources: {
  ...
  github: false,   // ← sets a boolean, but Zod schema expects an object
  ...
}
```
The Zod schema defines `github` as a full object with `.default({...})`. Inserting `false` bypasses Zod validation at write time (the value is inserted directly into JSONB without schema parse). The schema's `.default()` only applies when parsing, so existing rows with `github: false` will fail if `SignalSourcesSchema.parse()` is called on them — it expects an object.

### ❌ Gap: `githubSignalCronEnabled` not in PATCH route

`apps/api/src/routes/projects.ts` line ~300–358 handles `redditSignalCronEnabled` and syncs `signal_collector_reddit` to `cron_state`, but **`githubSignalCronEnabled` is absent**. The `signal_collector_github` job type IS in `cronJobTypeEnum` (packages/db/src/schema/cron.ts line 9), but the project PATCH route doesn't toggle it. Result: GitHub signal collection cron cannot be activated from the UI.

**Verdict:** ⚠️ **Gap** — two bugs (project creation wrong init + missing cron toggle). ~30 min fix each.

---

## Task 4 — Vendor-RSS Feeds CRUD

**Storage:** `project_configurations.signal_sources.vendor_rss.feeds` — plain `z.array(z.string().url())` inside the JSONB config block. **No separate table.**

### Available endpoints

No dedicated feed CRUD endpoints exist. The entire `vendor_rss` block (including `feeds` array) would be updated via full config replacement through whatever project config update mechanism exists.

### What's needed for UI

| UI action | Current state |
|-----------|--------------|
| List feeds | ⚠️ Read from project config — config endpoint returns it |
| Add feed (URL validation) | ❌ Missing — no endpoint validates a single URL + verifies feed parses |
| Edit feed (rename/enable toggle) | ❌ Missing — no per-feed metadata (name, enabled flag) in schema |
| Remove feed | ❌ Missing — only full-array replace possible |

The current `vendor_rss.feeds` schema is `string[]` — **no per-feed metadata** (label, enabled toggle, category). If 59.1c needs a proper feed manager (list, add-with-validation, edit, delete), the schema needs to evolve from `string[]` to `{ url, label, enabled }[]`.

### Recommended approach

Option A (minimal): Full-array replace — UI sends the entire new `feeds[]` via a config update call. No per-feed validation. ~0.5d.  
Option B (proper): New `POST/DELETE /api/projects/:slug/signal-sources/vendor-rss/feeds` with URL validation + feed-parse check. Schema change from `string[]` to object array. ~1.5d.

**Verdict:** ❌ **Missing** — depends on desired UX fidelity. Defer to 59.7 unless simple list-replace is acceptable.

---

## Task 5 — HackerNews / Algolia Verify

**File:** `packages/adapters/hackernews/src/`  
Directory contents: `client.ts`, `index.ts`, `signal-source.ts` — **no `verify.ts`**.

`hackernews` is not in `adapterEnum` for `POST /api/system/verify/:adapter`.

### Assessment

HackerNews Algolia search API is **fully public** — no credentials, no auth headers, no API key in config. Two options:

1. **No verify needed** — HN is a public API. If it's unreachable, signal collection fails gracefully with a `pino.warn`. A dedicated verify call adds no user-facing value (there's nothing to "configure").

2. **Reachability ping** — `GET https://hn.algolia.com/api/v1/search?query=test&hitsPerPage=1` → expect 200. Trivial to add, but users have no credentials to verify, so the verify button in a credentials UI makes no sense.

**Recommendation:** No verify needed. HN should appear in the Signal Sources UI (59.1c) as "always configured" or "public API — no credentials required". It does not belong in the credentials section.

**Verdict:** ✅ **Ready** (no action required — by design)

---

## Task 6 — ProductHunt Verify

### Adapter package

`packages/adapters/producthunt/src/verify.ts` exists:
```typescript
export async function verifyProductHunt(
  apiKey: string,
  apiSecret: string,
): Promise<{ ok: boolean; message: string }>
```
Calls `fetchAccessToken(apiKey, apiSecret)` then pings the GraphQL `/v2/api/graphql` viewer query. ✅

### System route dispatch

`producthunt` is in `adapterEnum` (line 140). Switch case at line 225:
```typescript
case "producthunt":
  if (!creds.api_key || !creds.api_secret) return { ok: false, message: "..." };
  return verifyProductHunt(creds.api_key, creds.api_secret);
```
✅ Fully wired.

### Credential set/delete

`producthunt` is in `credentialSchema.service` enum and `validServices`. ✅

### Status

Everything is in place. The only gap is that the **credentials UI doesn't list ProductHunt** as an adapter yet — it only shows Anthropic, Voyage, DataForSEO, Replicate (line ~48–72 of `SettingsCredentialsPage.vue`).

**Verdict:** ✅ **Ready** in backend — ⚠️ **Gap** in frontend (not listed in `SettingsCredentialsPage.vue` adapters array)

---

## Task 7 — i18n Coverage Gap

**Files:** `apps/web/src/i18n/de/settings.ts` + `apps/web/src/i18n/en/settings.ts`

### Current key structure for credentials/adapters

```
settings.sections.*      — project | brand-tokens | brand-assets | credentials
settings.credentials.*   — title, description, set, verify, remove, keys.*
settings.adapters.*      — intro, disconnect, status.{ verified | configured | notConfigured }
```

**No per-adapter name/description translations exist.** Adapter names are **hardcoded strings** in `SettingsCredentialsPage.vue`'s `data()` array (e.g. `name: "Anthropic Claude"`).

This already violates the CLAUDE.md rule "DO NOT store user-visible label strings in `data()`". The existing page works because the names happen to be product names (not translatable), but it sets a bad pattern to continue.

### What's missing for 59.1c

| Key | Needed? | Current state |
|-----|---------|---------------|
| `settings.sections.signal-sources` | ✅ Yes | ❌ Missing |
| `settings.credentials.adapters.reddit.name` | Depends | ❌ Missing |
| `settings.credentials.adapters.github.name` | Depends | ❌ Missing |
| `settings.credentials.adapters.producthunt.name` | Depends | ❌ Missing |
| Vendor-RSS section labels | ✅ Yes | ❌ Missing |
| HackerNews labels (no-credential flow) | ✅ Yes | ❌ Missing |

### Recommended naming convention

Given adapter names are product names (not translatable DE/EN), two viable approaches:

**A) i18n keys for adapter metadata** — add `settings.adapters.{id}.name` and `settings.adapters.{id}.description` in both `de/` and `en/settings.ts`. Fully i18n compliant.

**B) Keep product names hardcoded in component** — keep `name: "Reddit"` etc. in `data()` but move to a per-adapter labelKey for descriptions only. Simpler but continues the existing violation.

**Recommendation:** Approach A — add per-adapter keys under `settings.adapters.{id}`. It's the least-surprise pattern given the CLAUDE.md rule.

**Verdict:** ⚠️ **Gap** — straightforward i18n additions, ~1-2h total

---

## Task 8 — Frontend Settings Sidebar

**File:** `apps/web/src/pages/settings/SettingsPage.vue`

### Section registration mechanism

Hardcoded `sections` computed in `SettingsPage.vue` (line ~34):
```typescript
sections() {
  return [
    { key: "project" },
    { key: "brand-tokens" },
    { key: "brand-assets" },
    { key: "credentials" },
  ];
}
```

Template iterates `v-for="section in sections"` and renders `router-link` to `/projects/:slug/settings/:key`.

### Route file

`apps/web/src/router/index.ts` — 4 hardcoded children under `path: "settings"`.

### Adding "signal-sources" section

Exactly 4 changes needed:
1. **`SettingsPage.vue`** — add `{ key: "signal-sources" }` to `sections` array
2. **`router/index.ts`** — add `{ path: "signal-sources", name: "settings-signal-sources", component: () => import("src/pages/settings/SettingsSignalSourcesPage.vue") }`
3. **`SettingsSignalSourcesPage.vue`** — create new page component
4. **`de/settings.ts` + `en/settings.ts`** — add `"signal-sources": "Signal-Quellen"` (and EN equivalent) under `sections`

Complexity: **low** — same pattern as existing sections, no architectural changes. ~0.5d for skeleton + basic layout.

**Verdict:** ✅ **Ready** — adding section is trivial

---

## Summary Verdict

### Gap inventory

| # | Area | Severity | Fix size | Where |
|---|------|----------|----------|-------|
| G1 | `reddit`/`github` missing from credential set/delete enum | 🔴 Critical | ~5 min | `apps/api/src/routes/system.ts` lines 78, 123 |
| G2 | `githubSignalCronEnabled` not handled in project PATCH | 🟡 Medium | ~30 min | `apps/api/src/routes/projects.ts` + cron sync block |
| G3 | New project init sets `github: false` (wrong type in JSONB) | 🟡 Medium | ~5 min | `apps/api/src/routes/projects.ts` line 236 |
| G4 | ProductHunt/Reddit/GitHub not in `SettingsCredentialsPage.vue` | 🟡 Medium | ~1h | `apps/web/.../SettingsCredentialsPage.vue` |
| G5 | HackerNews has no verify (by design — public API) | ✅ None | n/a | Decision: show as "public API, no config" |
| G6 | Vendor-RSS has no per-feed CRUD (URL validate, enable, label) | 🟡 Medium | 0.5–1.5d | Depends on UX scope |
| G7 | `settings.sections.signal-sources` + adapter i18n keys missing | 🟢 Minor | ~1–2h | `apps/web/.../i18n/de/settings.ts` |
| G8 | Settings sidebar doesn't have signal-sources section | 🟢 Minor | ~0.5d | `SettingsPage.vue`, router, new page |

### Effort estimate

| Component | Estimate |
|-----------|----------|
| 59.1c base UI (signal-sources page, credentials wiring) | ~2–3d |
| G1 credential enum fix | +5 min (include in 59.1c) |
| G2 github cron toggle in PATCH | +0.5h (include in 59.1c) |
| G3 github false→object fix | +5 min (include in 59.1c) |
| G4 credentials UI + new adapters | +1h (include in 59.1c) |
| G6 vendor-rss feed CRUD (proper) | +1–1.5d (OPTIONAL — defer to 59.7) |
| G7 i18n | +1–2h (include in 59.1c) |

**Total with vendor-rss deferred:** 59.1c base ~3d + backend fixes ~2h = **3–3.5d total**  
**Total with vendor-rss full CRUD:** ~4.5–5d (recommend deferring)

### Recommended approach

1. **Include in 59.1c**: G1, G2, G3, G4, G7, G8 — all small fixes that unblock the UI
2. **HackerNews**: Show in signal-sources UI as "public API" chip with no configure button
3. **Vendor-RSS**: Include feed list (read-only from config) + full-array replace via a simple textarea/list input; defer per-feed CRUD (label, enable flag) to 59.7
4. **ProductHunt signal source**: ProductHunt adapter is a class-based signal source but uses OAuth (api_key + api_secret). Should appear in both credentials section (for the OAuth keys) AND signal-sources section (for the enable toggle). The credential-save gap (G1 doesn't block ProductHunt — it's already in the enum) means the Verify button works but Save via UI currently works too (producthunt is in the allowlist).

---

## Appendix — Key File Locations

| Concern | File |
|---------|------|
| Verify endpoint + dispatch | `apps/api/src/routes/system.ts:140–238` |
| Credential set/delete enum | `apps/api/src/routes/system.ts:78,123` |
| signal_sources Zod schema | `packages/db/src/schema/project-config.ts:69–178` |
| Project PATCH + cron sync | `apps/api/src/routes/projects.ts:247–360` |
| cronJobTypeEnum | `packages/db/src/schema/cron.ts:4–10` |
| Signal collector worker | `apps/api/src/workers/signal-collector.ts` |
| GitHub adapter package | `packages/adapters/github-trending/src/` |
| Reddit adapter verify | `packages/adapters/reddit/src/verify.ts` |
| ProductHunt verify | `packages/adapters/producthunt/src/verify.ts` |
| HackerNews adapter (no verify) | `packages/adapters/hackernews/src/` |
| Settings sidebar sections | `apps/web/src/pages/settings/SettingsPage.vue:34–41` |
| Settings router | `apps/web/src/router/index.ts:96–126` |
| Credentials page adapters list | `apps/web/src/pages/settings/SettingsCredentialsPage.vue:48–72` |
| Settings i18n (DE) | `apps/web/src/i18n/de/settings.ts` |
