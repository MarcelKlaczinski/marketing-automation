# Discovery Prompt: Social Media Backend + Template Inventory

**Purpose:** Inventory existing Social Media + Remotion infrastructure to plan Theme 57 specs. The user already knows roughly what's there — this prompt extracts the specifics needed to write actionable specs.

**Run with:** `/discover-task social-media-inventory.md`

**Expected runtime:** ~45-60 minutes of code exploration

**Output:** Single Markdown file at `specs/_drafts/57-backend-inventory.md` answering all questions below with specific file paths, function names, and code excerpts. Pure read-only — no implementation.

---

## What we already know (don't re-investigate these)

- Multi-slide carousels via Remotion exist
- Render happens server-side via BullMQ worker
- Manual download only (no auto-publish to social platforms yet)
- Manual trigger per article (no pipeline-step integration yet)
- Templates currently exist but quality varies — some hardcoded, some configurable
- Brand-token-aware templates is the target state
- Endpoint `/api/projects/:slug/social-posts` exists

## What we need to learn

This prompt has 5 investigation areas: Templates, Pipeline, UI, Brand-Integration, Cross-cutting. Output recommendations for splitting Theme 57 into sub-specs.

---

## Area A: Templates Inventory

### A.1 Template Source Files

1. **Where do Remotion templates live?**
  - Path patterns: `packages/social-renderer/`, `packages/remotion/`, `apps/social/`, or similar?
  - List all directories containing `.tsx` or `.jsx` Remotion compositions

2. **What templates exist today?** (Be exhaustive)
  - Each template: name, file path, dimensions (1080x1080? 1080x1350? 1920x1080?), slide count (single/multi)
  - For each: aspect ratio + platform target (Instagram Square, IG Portrait, LinkedIn, Twitter, etc.)
  - Status per template: production-ready / stub / experimental / deprecated
  - **Crucial**: which templates does Marcel actually USE today vs which are leftovers?

3. **Template Composition structure**
  - Each Remotion composition: what's the input prop interface? (e.g. `{ title, slides[], brandTokens }`)
  - Paste the TypeScript interface for at least 2 templates
  - Is there a common `BaseTemplateProps` interface, or does each define its own?

4. **Hardcoded values per template** (this is critical for brand-token migration)
  - For each template, identify hardcoded:
    - Colors (hex codes, color names)
    - Fonts (font-family strings)
    - Logos / images (paths to /public assets)
    - Spacing/sizing values
    - Text strings (labels like "Read more on toolwiki.ai")
  - **Quality question**: which hardcoded values are "essential for visual quality" vs "could be variable without quality loss"?
  - Paste 2-3 examples with the hardcoded snippets

5. **Multi-language support today**
  - Are templates locale-aware (DE vs EN visual variants)?
  - Are text strings inside templates translated, or only the input data?
  - Is there a single "language version" produced per article, or all configured locales?

### A.2 Template Selection Logic

1. **How is template chosen for an article?**
  - User picks manually? Backend logic? Pipeline step?
  - File path to the selection logic
  - Is template selection per-article, per-cluster, per-project?

2. **Template metadata**
  - Is there a `social_templates` DB table?
  - Or are templates registered in code (registry pattern)?
  - Either way, list the schema/registry shape

3. **Per-project template config**
  - Can different projects have different template sets?
  - Or are all projects sharing same templates?
  - Is there a "default template" per project?

---

## Area B: Pipeline / Generation Flow

### B.1 Generation Pipeline

1. **What pipeline name does social rendering use?**
  - Look for `social:carousel`, `social:render`, `article:social`, etc.
  - Path to pipeline definition (steps, adapter, runner)
  - Is it a standalone pipeline or chained after `article:blog`?

2. **Pipeline Steps**
  - For social rendering, what are the steps in order?
  - Examples I'd expect: `content-extraction` (article → slide-data) → `template-render` → `image-export` → `storage-upload`
  - List actual steps with their inputs/outputs

3. **Content Extraction**
  - How does the pipeline turn an article into slide-data?
  - LLM call? Heuristic? Manual template fields?
  - If LLM: which prompt? Paste a snippet
  - Real cost per render? Look at `cost_logs` operation values

4. **Rendering Mechanism**
  - Does it use `@remotion/renderer`'s `renderMedia()` or `renderFrames()`?
  - Server-side Node.js process? Or Lambda/Vercel function?
  - Output format: PNG, JPG, MP4 (for animated carousels)?
  - Output dimensions configurable per render or fixed per template?

5. **Storage**
  - Where do rendered files go? S3? Local filesystem? Cloudflare R2?
  - Path structure: `/storage/social/<projectId>/<articleId>/<templateId>/<slideN>.png`?
  - Are old renders preserved or overwritten?

### B.2 Trigger Mechanisms Today

1. **Manual Trigger Endpoints**
  - `POST /api/articles/:id/social-render` or similar?
  - Body shape: which params? `{ templateId, locale, slides? }`?
  - Sync (returns rendered URLs) or async (returns runId)?

2. **Automated Triggers**
  - Any auto-trigger after `article:blog` completes?
  - Pipeline chain hooks? Background job?
  - Config flag per-project (`autoRenderSocial: boolean`)?

3. **Re-render Mechanism**
  - Can Marcel re-render an article's social posts (e.g. after editing body)?
  - Or are renders one-shot?
  - Version tracking for renders?

---

## Area C: Frontend UI Today

### C.1 Legacy UI Inventory

Per Spec 56.1, the legacy UI was deleted but `legacy-snapshot` branch exists. Investigation needs to look at both current (new) and legacy state.

1. **Search current `apps/web/src` for social-related components**
  - Pages, components, composables matching: `social`, `carousel`, `remotion`, `slide`, `post`
  - List file paths + brief description of what each does

2. **What's MISSING in the new UI?**
  - Per audit findings from 56.5, the Article Detail tabs are: Body / Frontmatter / Versions / Runs / Cost
  - Is there a "Social" tab? No (would be added in Theme 57)
  - Article Tools manual triggers panel includes social rendering? Check existing categories (Pipeline/Content/Deploy)
  - Sidebar nav has Social entry? No, by design

3. **Check `legacy-snapshot` branch for social UI patterns**
  - `git show legacy-snapshot:apps/web/src/...` for social files
  - What did the old UI look like?
  - What workflows did it support?
  - Don't re-implement old UI as-is — just understand what worked

### C.2 Existing Endpoints UI Could Consume

1. **List `/api/projects/:slug/social-posts` endpoint shape**
  - GET, POST, PATCH, DELETE methods?
  - Filters: by article, by template, by status?
  - Pagination?

2. **Other social-related endpoints**
  - `/api/articles/:id/social-*`?
  - `/api/social-templates`?
  - `/api/social-renders/:id/download`?

3. **SSE event types**
  - Does pipeline-events channel include `social.rendered`, `social.failed`?
  - If not, would need to add for live UI updates

---

## Area D: Brand-Token Integration (the path to dynamic templates)

### D.1 Current State

1. **Do any templates already consume `brand_tokens`?**
  - Search template files for: `brandTokens`, `brand_tokens`, `colors.primary`, `typography.headingFont`
  - List templates that ARE brand-aware and templates that are NOT

2. **Brand-token shape in templates**
  - When a template uses brand tokens, how does it receive them?
  - Path: API → render-worker → Remotion composition input prop?
  - Paste example of brand-token consumption

3. **Quality vs flexibility trade-offs**
  - For the templates that don't use brand tokens — WHY?
  - Are colors carefully designed for contrast/legibility?
  - Are fonts chosen for visual harmony?
  - **Investigator's judgment**: which 1-2 templates would be safe to make brand-aware first?

### D.2 Brand-Asset Integration

1. **How are uploaded brand assets (logos, hero images) used in templates today?**
  - Hardcoded paths like `/public/logo.svg`?
  - Or referenced from `brand_assets` table?
  - Per-project asset slots (logo, hero, watermark, etc.)?

2. **Asset slot conventions**
  - Does each template declare which asset slots it needs?
  - E.g. "Template X requires: logo (square), hero (16:9), watermark (small)"
  - Or is it implicit / hardcoded?

---

## Area E: Cross-cutting

### E.1 Cost Tracking

1. What `cost_logs` operations exist for social?
  - `social-render`, `social-content-extraction`, `social-upscale`?
2. Real cost per render? (Marcel cares about this — Remotion server-side renders are CPU not LLM, but content-extraction might call LLM)
3. Anything DataForSEO or third-party tracked for social?

### E.2 Worker Configuration

1. Where is the Remotion worker registered?
  - Path in `apps/api/src/workers/` or separate process?
2. Resource requirements?
  - Remotion server-side rendering can be CPU-intensive
  - Memory limits, parallelization config
3. Render queue:
  - Single concurrent render or parallel?
  - Time per render (single slide vs 10-slide carousel)?

### E.3 Configuration & Settings

1. Per-project social config in `projects` table?
  - Look for columns: `social_*`, `defaultTemplate`, `autoRender`, etc.
2. Existing Settings UI for social?
  - Check `SettingsPage` children — any social section?
3. What SHOULD be configurable per project for social?
  - Default template
  - Output language(s)
  - Auto-render after article complete
  - Asset references

---

## Output Format

Create file `specs/_drafts/57-backend-inventory.md` with this structure:

```markdown
# Theme 57 Backend Inventory (Social Media / Remotion)

**Date:** YYYY-MM-DD
**Investigator:** Claude Code via discovery prompt

## Area A: Templates Inventory

### A.1 Template Source Files
[file paths + structure]

### A.2 Template Selection Logic
[selection mechanism]

[Template Catalog Table]
| Name | Path | Dimensions | Slides | Aspect Ratio | Platform | Status | Brand-Aware | Hardcoded Items |
|------|------|------------|--------|--------------|----------|--------|-------------|-----------------|
| ... | ... | ... | ... | ... | ... | prod/stub | yes/no | colors/fonts/logos |

## Area B: Pipeline / Generation
[step-by-step + paths + cost data]

## Area C: Frontend UI
[current + legacy inventory]

## Area D: Brand-Token Integration
[which templates are brand-aware vs not, plus quality assessment]

## Area E: Cross-cutting
[cost, worker, config]

## Summary

### What works today (in production)
- [list]

### What's stubbed / partial
- [list]

### What's missing entirely
- [list]

### Template Migration Readiness
For each existing template, classify:
- **Safe to make brand-aware now** (low-risk colors/fonts substitution)
- **Needs design review** (hardcoded values are essential to quality)
- **Should be replaced** (not used, outdated, or low-quality)

### Recommended Theme 57 Sub-Spec Split

Based on inventory above, suggest sub-spec breakdown. Options to evaluate:

**Option A: Three sub-specs (Backend / Frontend / Templates)**
- 57.1 Backend additions (endpoints, config, template registry)
- 57.2 Frontend (Social tab in Article Detail, Renders gallery, manual trigger)
- 57.3 Brand-aware Template Migration (per-template work)

**Option B: Two sub-specs (Foundation / Migration)**
- 57.1 Full Social Media UI + Backend
- 57.2 Brand-Aware Template Migration

**Option C: Vertical slices (one template at a time)**
- 57.1 Template X end-to-end (UI + backend + brand-aware)
- 57.2 Template Y end-to-end
- ...

**Investigator's recommendation**: which option fits this codebase best? Why?

### Key open questions for spec author
- [list things you couldn't figure out from code alone — needs user clarification]

### Estimated effort per sub-spec
- [based on patterns from 56.x specs, rough days]
```

---

## Constraints

- **Do not implement anything.** Read-only investigation.
- **Be exhaustive on templates.** Every `.tsx` Remotion composition should be cataloged.
- **Paste actual code.** When asked for hardcoded values, paste the lines verbatim.
- **Check legacy branch.** Use `git show legacy-snapshot:apps/web/src/...` for files that no longer exist on main.
- **Time budget**: ~45-60 minutes. If template catalog alone takes 30 min, that's fine — it's the most valuable output.
- **Quality judgment OK**: When asked "which templates are safe for brand-token migration", use your judgment as an investigator. Don't just say "needs human decision" — make a recommendation with reasoning.

After running this, paste the resulting `57-backend-inventory.md` back here. I'll use it to design Theme 57 sub-spec structure with you.
