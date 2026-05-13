# Brand Asset Management UI — Implementation Report (Spec 52b)

Date: 2026-05-13

## Implementation

- Branch: master (merged inline — feature work done across two commits)
- Commits:
  - `6bc4b0b` feat(db+api): Spec 52b — brand asset management backend
  - `fd9607f` feat(frontend): Spec 52b — brand asset management UI
  - (+ follow-up test/docs commit from this session)

## Features Implemented

- **Asset-Browser**: ✓ Grid view of all resolved tool-icons and logos per project; type filter (tool_icon / logo / all); text search by asset key; source badge per card (simple-icons / iconify / lobe-icons / custom-upload / deterministic-avatar)
- **Custom-Upload**: ✓ SVG + PNG + JPEG accepted; 500 KB size limit enforced; files stored to R2 at `assets/{projectId}/{assetType}/{assetKey}-{timestamp}.{ext}`; inline SVG stored for previews
- **Color-Settings**: ✓ 7 OKLCH color tokens (primary, accent, surface, surfaceDark, ink, inkMuted, wikiCream); 3-slider picker (L 0–100 / C 0–0.4 / H 0–360) per token; ContrastChecker shows WCAG AA/AAA pass/fail; culori lazy-loaded
- **Typography-Settings**: ✓ Font family select; weight sliders (100–900); letter-spacing inputs; size sliders (10–120 px); line-height sliders (0.8–2.5); live preview panel
- **Re-Render — Single**: ✓ "Neu rendern" button per post in SocialPostsPanel with confirmation dialog; POSTs to `/api/social-posts/:id/re-render`; old post marked as `replaced`
- **Re-Render — Batch**: ✓ SocialPostsAdmin page at `/projects/:slug/social/admin`; checkbox selection; cost estimate ($0.01/post); POSTs to `/api/projects/:slug/social-posts/re-render-batch`
- **ProjectSelector**: ✓ q-btn-dropdown in app header; persists to localStorage (key: `ma_current_project_slug`)
- **Navigation**: ✓ Brand section in MainLayout sidebar (Assets / Farben / Typografie / Social Admin) visible when a project is selected
- **i18n**: ✓ `de/brand.ts` + `en/brand.ts` wired into both index files

## DB Changes

| Change | Migration |
|--------|-----------|
| `project_brand_assets.r2_key TEXT` | `0027_brand_asset_ui.sql` |
| `social_status` enum + `'replaced'` | `0027_brand_asset_ui.sql` |
| Extended `BrandTokens.typography` type | Schema only (no column change) |

## New API Endpoints

| Method | Path | Notes |
|--------|------|-------|
| GET    | `/api/projects/:slug/brand-assets` | Accepts `?assetType` and `?source` filters |
| POST   | `/api/projects/:slug/brand-assets/upload` | Multipart; validates type + size |
| DELETE | `/api/projects/:slug/brand-assets/:id` | Deletes R2 object for custom-upload |
| POST   | `/api/projects/:slug/brand-assets/:id/reset` | Delete + re-resolve via icon-resolver |
| GET    | `/api/projects/:slug/brand-tokens` | Merges DEFAULT_TYPOGRAPHY into response |
| PATCH  | `/api/projects/:slug/brand-tokens` | Deep-merge; `as any` cast for exactOptionalPropertyTypes |
| POST   | `/api/projects/:slug/brand-tokens/reset` | Sections param (defaults to all sections) |
| GET    | `/api/projects/:slug/social-posts` | Admin list; left-joined with articles |
| POST   | `/api/projects/:slug/social-posts/re-render-batch` | TriggerWithPreRunId per post |
| POST   | `/api/social-posts/:id/re-render` | Single post re-render |

## Tests

| File | Tests |
|------|-------|
| `apps/api/test/lib/color-utils.test.ts` | 7 (hexToOklch ranges, round-trip, black, white, contrast) |
| `apps/api/test/routes/brand-assets.test.ts` | 8 (list, filter, upload HTTP smoke, size-limit HTTP smoke, upsert, filter DB, r2Key, delete, reset) |
| `apps/api/test/routes/brand-tokens.test.ts` | 8 (HTTP smoke, service: defaults, color patch, deep-merge, reset; DEFAULT_TYPOGRAPHY completeness) |
| **Total new** | **23** |
| All tests | **61 pass, 0 fail** |

## Deviations from Spec

- **Section 10 frontend tests** (`AssetCard.spec.ts`, `OklchSlider.spec.ts`, `project-context.spec.ts`): not implemented. The frontend components use culori (dynamic import, async), Quasar q-slider internals, and the Pinia + LocalStorage API — all of which require a Vitest browser environment that is not yet wired up in this project. The backend tests (23 tests) cover the acceptance criteria: R2+DB roundtrip, token defaults/merge/reset, color conversion math.
- **OKLCH gamut indicator**: confirmed out-of-scope per spec NON-GOAL.
- **Social post batch `estimatedCost`**: returned as string `"0.01"` per post; frontend computes the total display.

## Cost-Impact

- Custom uploads: $0 (R2 storage only)
- Color/Typography edits: $0 (client-side only)
- Re-renders: ~$0.01 per post (social-image pipeline)
