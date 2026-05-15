═══════════════════════════════════════════════════════════════════
SPEC 54.0 — Content Planner & Topic Sources (ADR)
Architecture Decision Record for Theme 54
═══════════════════════════════════════════════════════════════════

STATUS: Draft
TYPE: Architecture Decision Record (no code changes)
RELATED: Spec 49b/49c/49d (Gap Detection), Spec 50 (Astro Collection Schemas),
         Spec 22.5 (PageSpeed Validation), Spec 43.5x (toolwiki refactoring)

═══════════════════════════════════════════════════════════════════
CONTEXT
═══════════════════════════════════════════════════════════════════

The current content generation pipeline is reactive: it detects gaps in existing
clusters (Spec 49b/c/d) and generates articles to fill them. This works well for
"completing what we started", but cannot answer the question: "what new topics
should we cover?"

For toolwiki.ai specifically, being visible on Google means reacting fast to trends
in the AI tools space — new model releases, new features, new tools launching on
Product Hunt, hot discussions on Hacker News, etc. None of this is currently
surfaced by the platform.

The Ist-Zustand-Analyse (docs/analysis/content-pipeline-ist-zustand-2026-05-15.md)
revealed multiple tech debts that block a clean extension toward trend-based content:

  * No explicit "Topic Brief" contract between detection and generation
    (3-layer implicit contract via gap.metadata + articles row + TopicIntakeStep)
  * EXPECTED_SPOKE_INTENTS is hardcoded → not tenant-aware
  * Gap detection ignores generated articles → false positives once trend-generated
    articles exist
  * Routing logic (which gap-type triggers which article-type) is scattered across
    route handlers, not in a policy class
  * No external signal collection infrastructure (Product Hunt, HN, Reddit, GitHub,
    vendor RSS)
  * Cold-Start cluster creation is the only path to new clusters

GOAL: Define the architecture for a Content Planner that sits between project
configuration (from Cold-Start) and article generation, with multiple Topic Sources
(Gap, Trend, Refresh, Manual) feeding a unified TopicBrief contract that flows
through a central Topic Routing Policy into the existing (mode-aware) Article
Generator.

This ADR does NOT implement anything. It defines the target architecture and
decomposes Theme 54 into specs 54.1–54.9.

═══════════════════════════════════════════════════════════════════
NON-GOAL
═══════════════════════════════════════════════════════════════════

  * No code changes in this spec
  * No new DB migrations in this spec
  * No new API endpoints in this spec
  * No frontend changes (UI redesign is Spec 54.9, after Phase C)
  * No replacement of Cold-Start workflow (Cold-Start stays, but its output becomes
    the input for Content Planner)
  * No fully autonomous trend-to-publish automation (Phase 1 stays human-in-the-loop;
    rule-based automation is future work, but data model is prepared)
  * No expansion to non-toolwiki projects in implementation phase (architecture
    supports k sources, only toolwiki sources built in Phase B)
  * No removal of existing Gap workflow (it is refactored to emit TopicBriefs, but
    stays functional throughout migration)

═══════════════════════════════════════════════════════════════════
SECTION 1: Conceptual Model
═══════════════════════════════════════════════════════════════════

──────────────────────────────────────────────────────────────────
1.1: Three Layers
──────────────────────────────────────────────────────────────────

The new architecture has three distinct layers:

LAYER 1 — Project Configuration (from Cold-Start, versioned)
  Defines the "DNA" of a project: pillars, intent taxonomy, master prompts, topic
  scope, active signal sources, tone of voice. Produced once by Cold-Start, then
  iteratively refined. Consumed by Content Planner to know what to look for.

LAYER 2 — Content Planner (continuous, multiple sources)
  Runs periodically (BullMQ workers) and on-demand (UI). Hosts multiple Topic
  Sources, each emitting TopicBriefs:
    - Gap Analysis (existing, refactored)
    - Trend Discovery (new, Phase B)
    - Refresh Detection (future, prepared)
    - Manual (UI form)
  TopicBriefs are scored, deduped, and queued for human approval (Phase 1) or
  rule-based automation (Phase 2, future).

LAYER 3 — Topic Routing Policy + Article Generator (existing, refactored)
  Single entry point: TopicRoutingPolicy.route(brief) decides:
    - Existing cluster? → article (spoke/hub/comparison/...)
    - New cluster needed? → Cluster Creator (multi-article chain)
    - Translation? → Localize Pipeline
    - Refresh? → Re-Generation of existing article
  Article Generator becomes mode-aware:
    'evergreen' | 'timely' | 'pillar' | 'spoke' | 'refresh' | 'translation'.

──────────────────────────────────────────────────────────────────
1.2: Flow Diagram (target state)
──────────────────────────────────────────────────────────────────

  ┌─────────────────────────────────────────────────────────┐
  │         Cold-Start (one-time per project)               │
  │  Produces: ProjectConfiguration (versioned)             │
  │    • content_pillars (existing)                         │
  │    • intent_taxonomy (NEW — was hardcoded)              │
  │    • master_prompts (NEW)                               │
  │    • topic_scope (NEW — keywords, themes, languages)    │
  │    • signal_sources (NEW — which adapters are active)   │
  └────────────────────────┬────────────────────────────────┘
                           │
                           ▼
  ┌─────────────────────────────────────────────────────────┐
  │     Content Planner (continuous, multiple sources)      │
  │                                                         │
  │  Topic Sources (each emits TopicBrief):                 │
  │    [G] Gap Analysis (existing, refactored)              │
  │    [T] Trend Discovery (NEW — Phase B)                  │
  │    [R] Refresh Detector (future, data model prepared)   │
  │    [M] Manual (UI form)                                 │
  │                                                         │
  │  Output: queue of TopicBriefs (scored, deduped)         │
  └────────────────────────┬────────────────────────────────┘
                           │
                           ▼  approved (human or rule)
  ┌─────────────────────────────────────────────────────────┐
  │               Topic Routing Policy                      │
  │  Decides target: existing cluster / new cluster /       │
  │  translation / refresh                                  │
  └────────────────────────┬────────────────────────────────┘
                           │
                           ▼
  ┌─────────────────────────────────────────────────────────┐
  │        Article Generator (existing, mode-aware)         │
  │  modes: evergreen | timely | pillar | spoke |           │
  │         refresh | translation                           │
  └─────────────────────────────────────────────────────────┘

──────────────────────────────────────────────────────────────────
1.3: TopicBrief — The Universal Contract
──────────────────────────────────────────────────────────────────

The TopicBrief is the explicit Zod schema that every Topic Source emits and that
the Topic Routing Policy consumes. It replaces the implicit 3-layer contract
(gap.metadata + articles row + intake).

Conceptual fields (formal schema defined in Spec 54.1):

  IDENTITY
    id                  UUID, unique brief identifier
    project_id          UUID
    source              'gap_analysis' | 'trend_discovery' | 'refresh_detection'
                        | 'manual'
    created_at          timestamptz

  TOPIC
    topic_title         short human-readable label
    primary_keyword     SEO main keyword
    secondary_keywords  string[]
    locale              'de' | 'en' (or multi)
    intent_type         from project's configured taxonomy

  CLUSTER CONTEXT
    cluster_id          UUID (null if new cluster needed)
    cluster_action      'append_to_existing' | 'create_new' | 'translation'
                        | 'refresh' | 'standalone'

  SEO INPUT
    search_volume_de    number | null
    search_volume_en    number | null
    difficulty          number | null
    serp_snapshot       jsonb (top results, featured snippets)

  GENERATION HINTS
    suggested_title     string (LLM-pre-suggested)
    suggested_slug      string
    suggested_meta      string
    hero_image_prompt   string
    generation_mode     'evergreen' | 'timely' | 'pillar' | 'spoke'
                        | 'refresh' | 'translation'

  APPROVAL & AUTOMATION
    approval_required   boolean (Phase 1: always true)
    approval_status     'pending' | 'approved' | 'rejected' | 'auto_approved'
    approved_by         UUID (user) | 'rule:<id>' (Phase 2)
    approved_at         timestamptz

  SOURCE-SPECIFIC METADATA (JSONB, polymorphic by source)
    gap_metadata        when source='gap_analysis'
    trend_metadata      when source='trend_discovery'
                        (trend_score, signals[], freshness)
    refresh_metadata    when source='refresh_detection'

──────────────────────────────────────────────────────────────────
1.4: Topic Routing Policy — Decision Table
──────────────────────────────────────────────────────────────────

Single class with single entry point. Replaces scattered logic in route handlers.
Decision matrix:

  cluster_action        → Pipeline triggered
  ────────────────────────────────────────────────────────────────
  append_to_existing    → Article Outline Pipeline
                          (mode from brief.generation_mode)
  create_new            → Cluster Creator (master chain)
                          → Hub article + N spoke briefs
  translation           → Article Localize Pipeline
  refresh               → Article Re-Generation Pipeline (mode='refresh')
  standalone            → Article Outline Pipeline (no cluster, rare case)

──────────────────────────────────────────────────────────────────
1.5: Project Configuration — Versioned First-Class Entity
──────────────────────────────────────────────────────────────────

Decision: Project Configuration becomes a versioned entity (own table
project_configurations, not just JSONB on projects).

Rationale:
  * Master prompts will be iteratively refined; A/B-testing later
  * Each generated article should record which config version produced it
    (auditability)
  * Rollback path if a config change degrades quality

Conceptual fields (formal schema in Spec 54.2):

  project_configurations:
    id                      UUID PK
    project_id              UUID FK → projects
    version                 integer (incremented per project)
    status                  'draft' | 'active' | 'archived'
    created_at              timestamptz
    activated_at            timestamptz | null
    archived_at             timestamptz | null

    intent_taxonomy         jsonb (per pillar, replaces hardcoded
                            EXPECTED_SPOKE_INTENTS)
    master_prompts          jsonb (system prompts per generation
                            step + mode)
    topic_scope             jsonb (allowed keywords/themes,
                            languages, exclusions)
    signal_sources          jsonb (active adapters per project:
                            producthunt, hackernews, reddit,
                            github, vendor_rss, dataforseo_trends)
    automation_rules        jsonb (Phase 2, empty in Phase 1)

Articles get nullable column: project_config_version_id

═══════════════════════════════════════════════════════════════════
SECTION 2: Decomposition into Specs
═══════════════════════════════════════════════════════════════════

Theme 54 is split into 9 implementation specs, organized in 4 phases.
Foundations first (Phase A) — accept that no user-visible feature ships until
Phase B starts.

──────────────────────────────────────────────────────────────────
2.1: Phase A — Foundations
──────────────────────────────────────────────────────────────────

SPEC 54.1 — TopicBrief & Source Abstraction
  Goal: Introduce TopicBrief as explicit Zod schema + DB table. Refactor existing
  Gap workflow to emit TopicBriefs instead of writing articles/cornerstone_specs rows
  directly. Backward-compat: existing UI still works.
  Touches: packages/db, apps/api/routes/projects.ts, apps/api/lib/gap-service.ts
  Closes: Tech Debt #11 (no explicit Brief object)
  Estimate: 1–1.5 days

SPEC 54.2 — Project Configuration & Configurable Taxonomy
  Goal: Introduce project_configurations table (versioned). Move
  EXPECTED_SPOKE_INTENTS into config. Refactor Cold-Start phases 2b/3/4 to write
  a v1 config on project creation. Existing projects get auto-migrated v1 from
  current state.
  Touches: packages/db, packages/adapters/astro-sync, apps/api/lib/gap-service.ts,
           Cold-Start code
  Closes: Tech Debt #2 (hardcoded intents)
  Estimate: 1.5–2 days

SPEC 54.3 — Topic Routing Policy & Gap-Fixes
  Goal: Implement TopicRoutingPolicy class (Section 1.4 matrix). Refactor /generate
  and /automate routes to call policy. Fix gap-detection to include
  source='generated' articles. Make /suggest side-effect on satelliteKeywords
  explicit (no implicit writes).
  Touches: apps/api/routes/projects.ts,
           packages/adapters/astro-sync (detect-content-gaps)
  Closes: Tech Debt #1 (gap detection ignores generated), #5 (implicit routing),
          #6 (Path B side-effect), #7 (cornerstoneKeyword matching)
  Estimate: 2 days

──────────────────────────────────────────────────────────────────
2.2: Phase B — Trend Discovery (toolwiki focus)
──────────────────────────────────────────────────────────────────

SPEC 54.4 — External Signal Adapters & Storage
  Goal: Adapter interface ExternalSignalSource (extensible for k sources per
  project). Implement toolwiki sources: Product Hunt (GraphQL), Hacker News
  (Algolia), Reddit (gezielte subreddits), GitHub Trending, Vendor RSS (Anthropic,
  OpenAI, Google AI, Mistral, etc.). New DB table external_signals (raw, deduped,
  tagged). BullMQ worker for scheduled fetching. Active sources per project read
  from project_configurations.signal_sources.
  Touches: packages/adapters/* (new adapters), packages/db, BullMQ worker setup
  Estimate: 3 days

SPEC 54.5 — Trend Scoring & Topic Synthesis
  Goal: Composite Trend Score computation (search volume growth from DataForSEO
  Trends + community buzz + official announcement + SERP volatility - existing
  coverage). LLM-based synthesis: cluster similar signals into topic candidates
  ("GPT-5", "gpt5", "GPT 5" → one topic). Emit TopicBriefs with
  source='trend_discovery' and suggested cluster_action (append_to_existing /
  create_new). Existing-coverage check via embeddings (articles table already has
  embedding column).
  Touches: packages/pipelines (new trend-synthesis pipeline), apps/api
  Estimate: 2 days

SPEC 54.6 — Trend Discovery UI (minimal, replaceable)
  Goal: Bare-minimum UI to test the trend pipeline. Single view "Trending Topics"
  showing candidates with score, sources, suggested cluster, estimated generation
  cost. Approve/Dismiss buttons → routes through 54.3 policy. Data model prepared
  for rule-based automation (approval_required flag, automation_rules JSONB ready).
  UI is explicitly throwaway — replaced by 54.9.
  Touches: apps/web (new view), apps/api (approval endpoint)
  Estimate: 1 day

──────────────────────────────────────────────────────────────────
2.3: Phase C — Cluster Creator & Generation Modes
──────────────────────────────────────────────────────────────────

SPEC 54.7 — Cluster Creator (Multi-Article Workflow)
  Goal: When TopicRoutingPolicy decides cluster_action='create_new', invoke Cluster
  Creator. Creates cluster row (with pillar mapping or proposal), generates hub
  cornerstone_spec, plans N spoke briefs (reusing Cold-Start phase 3 logic),
  orchestrates as master pipeline_chain (chain of chains). Initializes
  internal-linking strategy.
  Touches: packages/pipelines (new cluster-creator pipeline), apps/api
  Estimate: 2.5 days

SPEC 54.8 — Article Generator Mode-Parameter
  Goal: Add 'mode' field to TopicBrief, respected by DraftStep/OutlineStep/
  HeroImageStep. Prompt variations for 'timely' (primary-source enforcement,
  fresher tone, dateModified strategy), 'pillar' (hub format), 'refresh' (update
  existing). Frontmatter defaults per mode. HeroImage style variations per mode.
  Touches: packages/pipelines/article/steps/*
  Estimate: 1.5 days

──────────────────────────────────────────────────────────────────
2.4: Phase D — Frontend Redesign
──────────────────────────────────────────────────────────────────

SPEC 54.9 — Quasar UI Refactoring on New Architecture
  Goal: Complete redesign of Quasar frontend based on the new architecture.
  Project Configuration UI, unified Topic Brief inbox (Gap + Trend + Refresh +
  Manual), Cluster Creator wizard, monitoring dashboards. Replaces 54.6 minimal UI
  and overhauls GapsPanel, Inbox, etc.
  Touches: apps/web (extensive)
  Estimate: 4–5 days (separate planning recommended)

═══════════════════════════════════════════════════════════════════
SECTION 3: Migration Strategy
═══════════════════════════════════════════════════════════════════

──────────────────────────────────────────────────────────────────
3.1: Backward Compatibility Principle
──────────────────────────────────────────────────────────────────

Throughout Phase A and B, the existing Gap workflow MUST stay functional.
No big-bang cut-over. Concretely:

  * Spec 54.1: Gap detection writes TopicBriefs AND keeps writing content_gaps rows
    (dual-write). UI still reads content_gaps. Existing endpoints stay alive.
  * Spec 54.2: Existing projects get auto-migrated v1 config on first server boot
    after deployment. Config defaults match current hardcoded values.
  * Spec 54.3: New TopicRoutingPolicy is called by refactored routes, but old route
    signatures stay (deprecation only after 54.9 lands).

──────────────────────────────────────────────────────────────────
3.2: Data Migration Steps
──────────────────────────────────────────────────────────────────

  Migration 1 (with 54.1): CREATE TABLE topic_briefs
  Migration 2 (with 54.2): CREATE TABLE project_configurations
                           + ADD COLUMN articles.project_config_version_id
                           + Seed v1 config for each existing project
  Migration 3 (with 54.4): CREATE TABLE external_signals

──────────────────────────────────────────────────────────────────
3.3: Cold-Start Integration
──────────────────────────────────────────────────────────────────

Cold-Start is NOT rewritten as part of Theme 54. But:

  * Spec 54.2 adds a final step to Cold-Start: write ProjectConfiguration v1 from
    phase outputs
  * Spec 54.7 reuses Cold-Start phase 3 logic (cluster keyword expansion) inside
    Cluster Creator

This means Cold-Start retains its current role as project bootstrap, while its
outputs become more structured.

═══════════════════════════════════════════════════════════════════
SECTION 4: Open Decisions Resolved
═══════════════════════════════════════════════════════════════════

D1. Cold-Start scope: Cold-Start stays as project-bootstrap, NOT integrated into
    Topic Sources. Its output becomes Project Configuration consumed by Content
    Planner. [resolved per user direction]

D2. Project Config storage: Option (ii) — own project_configurations table with
    versioning. [resolved per user direction]

D3. Autonomy level: Phase 1 = human approval; data model prepared for Phase 2
    (rule-based) via approval_required flag and automation_rules JSONB.
    [resolved per user direction]

D4. Out-of-scope tech debts: Pragmatic — fix when in the way, not as separate specs.
    [resolved per user direction]

D5. Frontend refactoring: Separate Spec 54.9 after Phase C. Spec 54.6 ships a
    minimal, replaceable UI. [resolved per user direction]

D6. Primary target project: toolwiki.ai for Phase B implementation. Architecture
    supports k sources per project for future expansion.
    [resolved per user direction]

D7. Spec language: English. [resolved per user direction]

═══════════════════════════════════════════════════════════════════
SECTION 5: Open Questions (deferred to per-spec discussion)
═══════════════════════════════════════════════════════════════════

These do not block 54.0 acceptance but must be answered in the respective
implementation specs:

Q1 (for 54.1): TopicBrief storage — own table topic_briefs vs. union view across
  sources? Recommendation: own table for clean queryability and history.

Q2 (for 54.2): How is config v1 seeded for existing projects? Snapshot from current
  hardcoded values + per-project derived data (intent types observed in their
  articles).

Q3 (for 54.4): Rate limits and caching strategy across signal sources? Reddit API
  has aggressive limits, Product Hunt GraphQL is gentler. Likely needs per-adapter
  scheduling.

Q4 (for 54.5): Trend Score weighting — calibrate against historical toolwiki data
  or start with reasonable defaults and tune via UI? Recommendation: defaults +
  observability.

Q5 (for 54.6): How are dismissed trend topics remembered to avoid resurfacing?
  Add dismissed_signals table or flag on topic_briefs?

Q6 (for 54.7): How is a new pillar proposed when a trend topic doesn't fit any
  existing pillar? Auto-create draft pillar or block until human creates one?

Q7 (for 54.8): Are 'mode' values mutually exclusive or combinable (e.g. timely +
  spoke)? Recommendation: mutually exclusive enum; combinations handled via
  additional flags.

Q8 (general): Cost budgeting — should Content Planner enforce per-project monthly
  spend caps before triggering trend generation? Not in scope for Theme 54, but
  data model should not preclude it.

═══════════════════════════════════════════════════════════════════
SECTION 6: Tech Debt Tracking (from Ist-Zustand-Analyse)
═══════════════════════════════════════════════════════════════════

Tech debts identified in the Ist-Zustand report and their resolution in Theme 54:

  #1  Gap detection ignores generated articles        → 54.3
  #2  EXPECTED_SPOKE_INTENTS hardcoded                → 54.2
  #3  Automation chains only for 2/4 gap types        → 54.3 / 54.7
  #4  ContentGapMetadata JSONB unversioned            → 54.1 (replaced by TopicBrief)
  #5  Tight coupling gap-type → article-type          → 54.3
  #6  DataForSEO Path B implicit side-effect          → 54.3
  #7  cornerstoneKeyword matching fragile             → 54.3
  #8  No external trend sources                       → 54.4 / 54.5
  #9  Cluster creation not in gap workflow            → 54.7
  #10 Article Discovery post-draft only               → NOT in scope (tangential,
                                                         fix when needed)
  #11 No explicit Brief object                        → 54.1

═══════════════════════════════════════════════════════════════════
SECTION 7: Success Criteria for Theme 54
═══════════════════════════════════════════════════════════════════

After all 9 specs land, the platform must be able to:

1. Daily scheduled job pulls fresh signals from Product Hunt, Hacker News, Reddit,
   GitHub, vendor RSS for toolwiki.
2. Trend Discovery synthesizes signals into ~5–10 scored topic candidates per day,
   deduplicated against existing coverage.
3. Marcel sees candidates in UI, sees source attribution, score, suggested cluster
   mapping, estimated cost.
4. One click "Approve" routes through TopicRoutingPolicy:
     * Existing cluster → article generation (timely mode)
     * New cluster → Cluster Creator (hub + N spokes)
5. Gap workflow continues working identically (no UI regression for existing users).
6. Project Configuration is editable per project; intent taxonomy differs between
   toolwiki and any future project.
7. Each generated article records its project_config_version_id for audit.
8. Architecture supports adding a new signal source for a non-toolwiki project
   (e.g. automotive trends) by implementing ExternalSignalSource interface — no
   core code changes required.

═══════════════════════════════════════════════════════════════════
ACCEPTANCE (this ADR)
═══════════════════════════════════════════════════════════════════

This is an architecture decision record, not an implementation spec.
Acceptance means:

  * [ ] All 9 sub-specs (54.1–54.9) referenced and scoped
  * [ ] All 7 resolved decisions documented
  * [ ] All 8 deferred open questions captured for follow-up
  * [ ] All 11 tech debts from Ist-Zustand mapped to specs
  * [ ] Migration strategy preserves backward compatibility
  * [ ] Diagram in Section 1.2 reflects target state
  * [ ] Saved to specs/54-0-content-planner-adr.md
  * [ ] No code changes in this PR

═══════════════════════════════════════════════════════════════════
ESTIMATED EFFORT (Theme 54 total, rough)
═══════════════════════════════════════════════════════════════════

  Spec 54.0 (this ADR):          done
  Spec 54.1 (TopicBrief):        ~1.5 days
  Spec 54.2 (Project Config):    ~2 days
  Spec 54.3 (Routing Policy):    ~2 days
  Spec 54.4 (Signal Adapters):   ~3 days
  Spec 54.5 (Trend Scoring):     ~2 days
  Spec 54.6 (Minimal UI):        ~1 day
  Spec 54.7 (Cluster Creator):   ~2.5 days
  Spec 54.8 (Generator Modes):   ~1.5 days
  Spec 54.9 (UI Redesign):       ~4–5 days (separate plan)

  Phase A total:                  ~5.5 days
  Phase B total:                  ~6 days
  Phase C total:                  ~4 days
  Phase D total:                  ~4–5 days

  Theme 54 total focused work:    ~20 days
  Plus +30% discovery buffer:     ~26 days realistic
  Spread over 6–8 weeks

═══════════════════════════════════════════════════════════════════
NICHT IN DIESER SPEC
═══════════════════════════════════════════════════════════════════

  * Implementation of any of 54.1–54.9 (each gets its own spec)
  * Cold-Start rewrite (only its output schema is touched in 54.2)
  * Tech Debt #10 fix (Article Discovery post-draft) — tangential, fix when blocking
  * Cost-budgeting / spend caps (Q8) — orthogonal feature
  * Multi-tenant signal-source marketplace (future)
  * Non-toolwiki signal source implementations (future, after 54.4 proves the
    adapter interface)
  * A/B testing of master prompts (future, builds on ProjectConfiguration
    versioning)
  * Refresh Detection implementation (data model prepared in 54.1, source itself
    is a future spec)

═══════════════════════════════════════════════════════════════════
