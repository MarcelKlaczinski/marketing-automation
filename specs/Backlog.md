# Backlog

Items that are intentionally NOT being worked on right now, but should not be forgotten. Each entry has:

- **Status**: `parked` (decision made: not now), `under-review` (uncertain), `archived` (decided against)
- **Last reviewed**: when it was last touched
- **Trigger**: what would re-activate this item

When an item moves to active development, write a Spec for it and remove it from this file.

---

## B-001: `projects.pipelineTemplate` field is unused

**Status**: parked
**Last reviewed**: 2026-05-07
**Origin**: Discussion in transcripts during Phase 4 Wave 4 work

**Summary**: The `pipeline_template` enum (educational / affiliate_review / local_business / programmatic_seo) is stored on every project and exposed in the project-create UI, but no code reads it. All projects run identical Cold-Start prompts, Outline templates, and Schema.org strategies regardless of template value.

**Why parked**: Removing the field means migration + UI removal for a value that's only descriptive. Implementing template-specific behavior is ~1-2 days of work without a concrete second-tenant use case to validate the variation points. Leaving it in is harmless metadata.

**Known bug** (deferred fix, not in scope): the Spec 34 project-update validator uses `z.enum(['educational', 'commercial', 'editorial'])` which doesn't match the actual DB enum. Updating `pipelineTemplate` via the UI would fail. Low impact (Marcel sets it once at project creation, never changes).

**Trigger to revisit**:
- A second tenant onboards with a fundamentally different strategy (e.g., music-school as `local_business` vs KI-Wissensraum as `educational`), AND
- The need to vary pipeline behavior between them is concrete (not "would be nice")

**When activated**:
- Fix the Spec 34 validator bug first
- Write a Spec defining which prompts / steps / schemas vary per template
- Don't try to make all four templates work simultaneously — start with the two tenants that actually exist

---

## B-002: Approvals workflow

**Status**: parked
**Last reviewed**: 2026-05-07
**Origin**: `approvals` table exists in schema (Spec 01) but is unused

**Summary**: The DB has an `approvals` table tracking `(article_id | social_post_id, action, comment, user_id)` for review workflows. No code writes to it, no UI reads it.

**Why parked**: Single-user system. Approvals only make sense when there's a separation between content-author and content-approver. Marcel currently is both.

**Trigger to revisit**:
- Marcel adds an editor / virtual assistant who drafts but doesn't publish, OR
- Marcel-as-author wants explicit approve-gates before pipelines proceed (e.g., "outline review must be approved before drafting")

**When activated**:
- Decide whether approvals are blocking (gate pipelines) or advisory (just log)
- UI: approval queue, approval history per article, approve/reject/comment actions
- Backend: extend trigger-helpers to optionally gate on approval-state

---

## B-003: Social posts (Instagram, TikTok, LinkedIn, Twitter)

**Status**: parked
**Last reviewed**: 2026-05-07
**Origin**: `social_posts` table + enums exist (Spec 01), repurpose-pipeline mentioned in early Phase 1 docs

**Summary**: Schema supports social-post management (carousel, reel, single_image, story formats × 4 platforms). Adapter for Instagram Graph exists. No UI, no pipeline currently generates social posts from articles.

**Why parked**: Marcel hasn't decided if social distribution is strategic for KI-Wissensraum. Building a feature that's never used is waste. Plus: each platform has its own approval/auto-post quirks (Instagram especially).

**Trigger to revisit**:
- Marcel publishes 10+ articles and wants to extend reach via social, OR
- A tenant onboards where social IS the primary channel

**When activated**:
- Spec the article → social post pipeline (one article → 1 LinkedIn carousel + 1 Instagram + 1 Twitter thread)
- Spec the social-posts kanban UI similar to articles
- Reactivate Instagram adapter (probably needs auth refresh)

---

## B-004: Briefing UI

**Status**: parked
**Last reviewed**: 2026-05-07
**Origin**: `briefings` table exists (Spec 03), daily briefing generation pipeline implemented but no UI surfaces it

**Summary**: Daily briefings (markdown summaries of project state) are generated and stored. Currently consumed only via email digest (Spec 11.5).

**Why parked**: Email digest covers the use case. A separate UI for browsing historical briefings would be nice-to-have but not blocking.

**Trigger to revisit**:
- Marcel finds himself searching email archives for past briefings, OR
- A tenant prefers in-app reading over email

**When activated**:
- Simple list page `/briefings` with markdown rendering
- Filters: project, date range
- Maybe Inbox-page integration: "today's briefing" section

---

## B-005: Analytics integration (GA4 + Search Console)

**Status**: parked
**Last reviewed**: 2026-05-07
**Origin**: Out-of-scope mentions in early Phase 1 architecture

**Summary**: Search Console + GA4 credential adapters exist conceptually but no pull-pipeline integrates real-traffic data into the platform. The `articles.publishedAt` is set but actual page-view counts, click-through rates, ranking positions are not tracked.

**Why parked**: KI-Wissensraum is too new to have meaningful analytics data. Premature analytics infrastructure.

**Trigger to revisit**:
- KI-Wissensraum has 6+ months of published content with measurable traffic, OR
- Affiliate-review tenants onboard (where revenue-per-article tracking matters)

**When activated**:
- GA4 BigQuery export integration OR Data API direct queries
- Search Console URL Inspection API + Performance API
- Per-article dashboard: views, CTR, avg-position over time
- Cluster-level rollups
- Probably its own page `/analytics` with cross-filter to projects/clusters/articles

---

## B-006: Multi-user / editor role

**Status**: parked
**Last reviewed**: 2026-05-07
**Origin**: `userRoleEnum` has `owner | editor` (Spec 01)

**Summary**: Schema supports two roles but the system treats every user as owner. No editor-specific permission gates, no UI for adding/removing users from a project.

**Why parked**: Marcel is the sole user. Adding multi-user without a real second user is theater.

**Trigger to revisit**:
- Marcel hires an editor / VA, OR
- A tenant onboards where multi-user is required (agency-style usage)

**When activated**:
- Permission middleware on every endpoint (currently `requireAuth` is sufficient because every authed user is owner)
- User-management UI in Settings
- Project-membership join table (currently no FK between users and projects)
- Approvals (B-002) becomes much more relevant alongside this

---

## B-007: Cron infrastructure

**Status**: parked
**Last reviewed**: 2026-05-07
**Origin**: Multiple specs mention "run via cron" (Spec 03 briefings, Spec 40 notification pruning, Spec 22 PageSpeed re-checks)

**Summary**: Several pipelines should run on schedule but currently run only on manual trigger or HTTP admin endpoints. BullMQ supports scheduled jobs but no infrastructure registers them.

**Why parked**: Manual weekly cleanup works for current scale. Building cron infra without urgent need is overengineering.

**Trigger to revisit**:
- Marcel forgets to run pruning for 2+ weeks and notification table grows large, OR
- KI-Wissensraum live with daily briefings expected automatically, OR
- Multiple tenants each needing their own schedule

**When activated**:
- BullMQ `Queue.add(..., { repeat: { cron: '0 8 * * *' } })` for scheduled jobs
- Admin UI to view/edit schedules
- Per-project schedule overrides

---

## B-008: Performance pass for large projects

**Status**: parked
**Last reviewed**: 2026-05-07
**Origin**: Stabilization Report F-008 (articles list pagination), Spec 36 acknowledged

**Summary**: Several endpoints assume small data volumes:
- `/api/articles` returns ALL articles for a project (no pagination)
- `/api/clusters` joins all clusters + cornerstones (no pagination)
- Articles Kanban renders all cards in one pass (no virtualization)
- Cost-aggregation endpoint runs 7 sequential queries (could be 1)

**Why parked**: KI-Wissensraum currently has < 50 articles. Performance is fine.

**Trigger to revisit**:
- Any project crosses 100 articles OR 5+ active projects, OR
- Page load times exceed 1s on inbox/articles pages

**When activated**:
- Cursor-based pagination for articles + clusters list endpoints
- Virtual scrolling for Kanban (vue-virtual-scroller)
- Combined cost-aggregation query
- Indexes audit for hot paths

---

## B-009: Production deploy infrastructure

**Status**: parked
**Last reviewed**: 2026-05-07
**Origin**: Currently dev-only setup

**Summary**: System runs locally on Marcel's machine. No production deployment exists.

**Why parked**: Premature for a system still under heavy iteration. Local-first development is faster.

**Trigger to revisit**:
- Marcel wants to access from multiple devices reliably, OR
- A second tenant onboards (means actual customer-facing uptime expectations), OR
- Cost of NOT having backups becomes too high

**When activated**:
- HTTPS termination (Caddy or Cloudflare in front of API)
- Postgres backup strategy (pg_dump cron + offsite)
- Redis persistence config
- Process supervisor (systemd or pm2)
- VAPID keys regenerated (per Spec 40 deploy checklist)
- DELETE FROM push_subscriptions WHERE endpoint LIKE '%localhost%'
- Logs aggregation (Loki, or just rsyslog)
- Monitoring (uptime + cost-limit-pause alerts)

---

## B-010: pgvector for internal linking

**Status**: under-review
**Last reviewed**: 2026-05-07
**Origin**: Spec 24 (internal linking) uses pgvector, Spec 42 setup script enables extension

**Summary**: pgvector is enabled and the `articles.embedding` column exists. Whether the internal-linking pipeline actually uses it correctly to find semantic-similar articles needs verification.

**Why under-review**: Last touched in Spec 24 implementation. With Spec 42 stabilization complete, worth a quick check whether the linking actually produces good results in practice on KI-Wissensraum.

**Trigger to validate**:
- After 10+ articles published, check if internal-link suggestions are sensible
- Use the cluster link-rebuild trigger (Spec 24) on a real cluster, inspect the results

**When activated** (if quality is poor):
- Tune the cosine-similarity threshold
- Consider re-embedding with a different model
- Add manual override mechanism for "always link to X from Y"

---

## How to use this file

- **Adding an item**: number it B-NNN sequentially. Don't reuse numbers.
- **Updating an item**: bump `Last reviewed`. Add notes inline if state changed.
- **Activating an item**: write a Spec, link the spec from the backlog item, then remove the item from this file. The spec history captures the reasoning.
- **Archiving an item**: change status to `archived`, add 1-line reason. Keep in this file for context (don't delete).
- **Quarterly review**: scan the file, ensure each `parked` item still makes sense. Update `Last reviewed`.
