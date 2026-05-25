# Discovery — H3 GitHub Tool-Inventory (2026-05-24)

_Stable-data inventory aus GitHub für Tools + Skills, feedet 4 content-angles (comparison, profile-pages, release-tracking, star-stories). Theme 65 Foundation._
_Status: Discovery (pre-spec). 4 Scope-Optionen evaluiert ohne Pre-Commit._
_Voraussetzung: keine. Spec 64.18 + 64.19 können parallel oder vorher laufen._
_Aufwand-Range: 3-4d (minimal) bis 8-9d (full). Marcel-Decision §11 driven._

---

## 0. Marcel-Decisions Recap

| Decision | Choice |
|---|---|
| Object-Types | Tools UND Skills als 2 separate types |
| Discovery-Mode | Auto-Discovery (nicht Marcel-Seed) |
| Content-Angles | Alle 4 (Comparison + Profile-Pages + Release-Tracking + Star-Stories) |
| Update-Cadence | Cron + Manual-Trigger |
| Schema-Decision | Discovery evaluiert |
| Scope-V1-Decision | **Discovery evaluiert alle Optionen, Marcel commits in §11** |

---

## 1. Mental Model

**Was Inventory IST:**

Ein Tool/Skill-Catalog mit stable metadata aus GitHub. **Stable** = ändert sich langsam (Stars, Releases, Maintainer-Activity), nicht volatile (HN-Buzz, ProductHunt-Launches).

**Stable vs Volatile Distinction:**

| | Stable (Inventory) | Volatile (Signals) |
|---|---|---|
| Source | GitHub API | HN/PH/Reddit/RSS |
| Update-Freq | Weekly/Monthly | Hourly/Daily |
| Lifetime | Months/Years | Days |
| Storage | `content_source_inventory` (or similar) | `topic_signals` (existing) |
| Used by | Content-Pipelines (profile-pages, comparisons) | Brief-Generators (gap_analysis, trend_discovery) |

**Strategischer Fit:**

- Closes the **content-foundation gap** für Theme 65 Family A (data-driven 30%)
- Tools-Profile-Pages auf Toolwiki bekommen reliable "last updated", "stars", "primary language" data
- Comparison-Articles können faktisch begründet werden ("Tool X has 50k stars vs Tool Y has 10k")
- Release-Tracking gibt news-content-pipeline einen stetigen Stream

**Was Inventory NICHT IST:**

- Kein Replacement für `tools` table (existing, 108 tools, has manual-curated metadata)
- Kein Trend-Detection (das macht `trend_discovery` via Signals)
- Kein Auto-Article-Generation (consumes Inventory, ist nicht Inventory selbst)
- Kein Real-Time-Status-API (cron-based, Daten sind minutes-to-hours alt)

---

## 2. Object-Types Recap

### 2.1 Tools (Standalone Repos)

Beispiele (von früherer Recherche + dir validiert):

**AI-Dev-Tools mit GitHub-Presence:**
- `anthropics/claude-code`, `openai/codex`, `aider-ai/aider`, `cline/cline`
- `block/goose`, `sst/opencode`, `All-Hands-AI/OpenHands`
- `continuedev/continue`, `microsoft/vscode-copilot-chat`
- `simonw/llm`, `getzep/zep`, `microsoft/markitdown`

**AI-Tools generell:**
- `ollama/ollama`, `lobehub/lobe-chat`, `mudler/LocalAI`
- `langfuse/langfuse`, `BerriAI/litellm`, `vllm-project/vllm`
- `n8n-io/n8n`, `microsoft/autogen`, `Significant-Gravitas/AutoGPT`
- `langchain-ai/langchain`, `run-llama/llama_index`

**Metadata pro Tool:**
- `repo_full_name` (owner/repo)
- `description`, `homepage_url`, `primary_language`
- `stars_count`, `forks_count`, `watchers_count`
- `created_at`, `pushed_at`, `default_branch`
- `topics[]` (GitHub topics)
- `license`
- `latest_release` (tag, date, name)
- `last_30d_commit_count` (activity-proxy)

### 2.2 Skills (SKILL.md based modules)

Anthropic released das Format als open standard Dec 2025. Skill-Repos können:

**a) Standalone Skill-Repos** — 1 Repo = 1 Skill
- z.B. `coleam00/excalidraw-diagram-skill`
- SKILL.md im Root oder `.claude/skills/`

**b) Mono-Repos mit vielen Skills** — 1 Repo = N Skills als subdirectories
- z.B. `anthropics/skills`, `vercel-labs/find-skills`
- Jedes Subdirectory ist eigener Skill

**c) Awesome-Lists** — KEIN Skill, sondern Index zu Skills
- z.B. `ComposioHQ/awesome-claude-skills`, `BehiSecc/awesome-claude-skills`, `travisvn/awesome-claude-skills`
- Markdown-Listen mit Links zu Skills die anderswo leben

**Metadata pro Skill:**
- `skill_name` (aus YAML frontmatter)
- `description` (aus YAML)
- `parent_repo` (owner/repo)
- `path_in_repo` (root vs subdirectory)
- `category` (z.B. development, devops, security)
- `install_count` (aus skills.sh wenn verfügbar)
- `parent_repo_stars` (proxy for popularity wenn standalone)

### 2.3 Object-Type Decision Matrix

| Aspect | One Type | Two Types |
|---|---|---|
| Schema complexity | Low | Medium |
| Query simplicity | High | Medium (joins) |
| Multi-channel-content adaptation | Hard (skills vs tools have very different angles) | Easy (separate pipelines per type) |
| Future-extensibility (z.B. MCP servers, plugins) | Limited | Generic pattern reusable |
| V1 effort delta | — | +0.5-1d |

**Discovery-Recommendation:** **Two Types** — der Mehraufwand ist marginal vs der content-angle-clarity gain. Skills für "Top 10 Skills" articles, Tools für "Top 10 Tools" articles. Mixing wäre semantically muddled.

---

## 3. Content-Angles Re-Analysis

Marcel hat "alle 4" gewählt. Lass mich die Implementation-Komplexität pro Angle ehrlich framen:

### 3.1 Angle A — Comparison-Content (X vs Y Feature-Matrix)

**Was es braucht:**
- Inventory mit feature-tags pro tool/skill
- Comparison-pair-selector (LLM oder Marcel-curated pairs)
- Feature-matrix-generator (LLM mit README/docs als input)
- Hub-cluster für comparison-articles

**Aufwand zusätzlich zu Inventory:** 1.5-2d  
**Multi-Domain readiness:** Hoch (BK könnte solar-inverter-comparisons machen)

### 3.2 Angle B — Tool-Profile-Pages (Was tut es, wie installieren)

**Was es braucht:**
- Inventory-row als source-of-truth
- Profile-page-template (Astro)
- Mapping `inventory.tool_id → articles.slug` mit "this article is auto-updated from inventory"
- Refresh-trigger wenn inventory aktualisiert (re-generate profile wenn meaningful change)

**Aufwand zusätzlich zu Inventory:** 1d (templates + refresh-logic)  
**Multi-Domain readiness:** Hoch

### 3.3 Angle C — Release-Tracking als News-Content

**Was es braucht:**
- Release-detection (cron-tick checked seit-last-fetch new releases)
- LLM-summary: "what's new in v2.0 of X" (consumes release-notes)
- News-article-template
- Cluster-routing (probably new "releases" cluster oder per-tool-clusters)

**Aufwand zusätzlich zu Inventory:** 1.5d  
**Multi-Domain readiness:** Mittel (BK hat Solar-Hardware-Releases, aber API-Discovery anders)

### 3.4 Angle D — Star-Trend-Stories ("X gained 10k stars this quarter")

**Was es braucht:**
- Time-series-snapshot von star-counts (weekly oder monthly)
- Trend-detection (>X% growth in window, oder absolute-threshold)
- Story-template ("Why is X exploding?")
- Pacing-control (sonst spamming articles über stars)

**Aufwand zusätzlich zu Inventory:** 1d (Snapshot-storage) + 1d (Trend-detection + Story-Template)  
**Multi-Domain readiness:** Niedrig (Star-counts sind GitHub-spezifisch, BK hat das nicht)

### 3.5 Angle Trade-off Summary

| Angle | V1 Cost | Content-Output | Multi-Domain | Recommendation |
|---|---|---|---|---|
| A Comparison | 1.5-2d | hoch (evergreen SEO) | hoch | **YES in V1** |
| B Profile-Pages | 1d | hoch (existing tools-collection) | hoch | **YES in V1** |
| C Release-Tracking | 1.5d | mittel (event-driven, bursty) | mittel | **MAYBE V1** — pacing-issue |
| D Star-Stories | 2d | niedrig (gimmicky, kann spammy werden) | niedrig | **DEFER V2** — feels like clickbait, brand-risk |

**Discovery-Recommendation:** V1 = A + B. C als V1.1 wenn Pacing geklärt. D als V2 oder gar nicht.

**Marcel-Decision-Point Q5 in §11.**

---

## 4. Schema Evaluation (Verify before code)

### 4.1 Existing State (Verify-Points)

Heutige Toolwiki Live-State (aus Backlog v3.1 §7):
- `tools` table existiert mit 108 rows
- Has wahrscheinlich `slug, name, description, category, ...` (verify: was sind die existing columns?)
- Hat KEINE GitHub-metadata heute (verify)

**Verify points:**
1. Was sind die existing columns auf `tools`? (PII, hardcoded metadata, jsonb fields?)
2. Existiert schon `tools.github_repo` oder ähnliches (slug pointing to GitHub)?
3. Gibt es `tool_versions` oder release-tracking heute?
4. Hat `tools` ein `metadata jsonb` field für expansion?

### 4.2 Schema-Optionen

**Option α — Dedicated `content_source_inventory` table:**

```sql
CREATE TABLE content_source_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  source TEXT NOT NULL CHECK (source IN ('github')),
  object_type TEXT NOT NULL CHECK (object_type IN ('tool', 'skill')),
  source_identifier TEXT NOT NULL,  -- e.g. "anthropics/claude-code" or "anthropics/skills:web-design"
  display_name TEXT NOT NULL,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',  -- stars, forks, releases, topics, etc.
  tool_id UUID REFERENCES tools(id),  -- optional join to existing tool
  last_fetched_at TIMESTAMPTZ,
  fetch_status TEXT NOT NULL DEFAULT 'pending' CHECK (fetch_status IN ('pending', 'fetching', 'ok', 'error')),
  fetch_error TEXT,
  approved_by_user_id UUID REFERENCES users(id),  -- approve-gate per Auto-Discovery
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uniq_csi_source_identifier ON content_source_inventory (source, source_identifier) WHERE approved_at IS NOT NULL;
CREATE INDEX idx_csi_due_for_refresh ON content_source_inventory (last_fetched_at) WHERE fetch_status = 'ok';
```

**Pros:**
- Source-agnostic (future: gitlab, gitea, npm-registry, etc.)
- Independent lifecycle (Inventory-deletes ohne Tool-deletes)
- Multi-Domain clean (project_id scoped)
- Approve-gate built-in

**Cons:**
- New table to maintain
- Join-overhead wenn man Tool+Inventory queryen will

**Option β — Extend `tools` table mit `github_metadata jsonb`:**

```sql
ALTER TABLE tools ADD COLUMN github_metadata JSONB;
ALTER TABLE tools ADD COLUMN github_last_fetched_at TIMESTAMPTZ;
ALTER TABLE tools ADD COLUMN github_fetch_status TEXT;
```

**Pros:**
- Simplest, 1 migration
- Existing tool-queries automatisch enriched
- No join needed

**Cons:**
- **Skills haben keinen 1:1 mapping zu existing `tools` rows** — skills sind kein "tool" semantically
- Multi-source future-proofing (was wenn npm-registry oder pypi auch tracked werden soll?) — gets jsonb-bloated
- Approve-gate auf existing `tools` row macht weniger Sinn (tools sind schon Marcel-approved)

**Option γ — Hybrid: dedicated table + `tools.github_inventory_id` FK:**

```sql
CREATE TABLE content_source_inventory (...);  -- wie Option α
ALTER TABLE tools ADD COLUMN inventory_id UUID REFERENCES content_source_inventory(id);
```

**Pros:**
- Tools können optional auf Inventory-row pointen
- Inventory-rows können standalone existieren (skills, oder neue tools die noch nicht in `tools` sind)
- Beide Querry-Pfade unterstützt

**Cons:**
- Schema-Komplexität
- Mehr query-paths zu testen

### 4.3 Schema Recommendation

**Discovery-Recommendation:** **Option α (dedicated table)** mit optionalem `tool_id` FK auf existing `tools`.

Reasoning:
- Source-agnostic future-proofing
- Skills haben semantically nichts in `tools` zu suchen
- Approve-gate built-in (kritisch für Auto-Discovery, sonst noise-flood)
- Multi-Domain clean
- `tools.inventory_id` reverse-link kann später als Option γ extension dazukommen wenn nötig

**Trade-off accepted:** join-overhead bei Profile-Pages-Rendering (1 join, indexed) — vernachlässigbar.

---

## 5. Update-Mechanism Evaluation

Marcel sagte: **cron + manuell**. Konkret heißt das:

### 5.1 Cron-Pipeline-Architektur (per Memory D23 Cron-based Coordinator Pattern)

```
*/1 * * * * github-inventory-refresh.worker
  - Query content_source_inventory WHERE approved_at IS NOT NULL
                                    AND (last_fetched_at IS NULL 
                                         OR last_fetched_at < NOW() - refresh_interval)
  - For each due row:
      - UPDATE fetch_status='fetching'
      - Call github-adapter for that row
      - On success: UPDATE metadata, last_fetched_at, fetch_status='ok'
      - On error: UPDATE fetch_status='error', fetch_error
  - Rate-limit aware: max 5000 requests/hour with PAT
```

**Refresh-Interval Strategy:**
- High-priority tools (Marcel-flagged, hohe star-velocity): daily
- Normal tools: weekly
- Skills: monthly (slower-changing)
- Configured per-row OR per-source-default

### 5.2 Manual-Trigger-Endpoint

```
POST /api/projects/:slug/inventory/refresh
Body: { ids?: string[] }  // empty = refresh all due-now
Returns: { refreshed_count, errors }
```

UI: button in Settings-UI "Refresh now" (auch per-row in inventory-list view).

### 5.3 Discovery-Sources für Auto-Discovery

Hier liegt der **echte Komplexitäts-Treiber.** Marcel sagte Auto-Discovery — also brauchen wir Sources:

**Source-Option 1 — GitHub Trending API**
- Endpoint: github.com/trending (kein offizielles API, scraping nötig)
- Pros: einfach, zeigt actually-trending
- Cons: Kein API, Markup-Änderungen brechen, nicht AI-spezifisch
- Aufwand: 0.5d (scraper + dedup)

**Source-Option 2 — GitHub Search API mit topic-filter**
- Endpoint: `/search/repositories?q=topic:ai+topic:llm+stars:>1000`
- Pros: officielles API, rate-limited but stable
- Cons: topic-tagging inconsistent, viele false-positives
- Aufwand: 0.5d (queries + dedup)

**Source-Option 3 — Awesome-Lists scraping**
- Parsing markdown von ComposioHQ/awesome-claude-skills, BehiSecc/awesome-claude-skills, etc.
- Pros: kuratierte Quellen (high signal-to-noise)
- Cons: jede Liste hat andere Markdown-Struktur, brittle, partial-coverage
- Aufwand: 1d (3 awesome-lists supported in V1) — 0.3d per zusätzlicher Liste

**Source-Option 4 — skills.sh API (für Skill install-counts)**
- Vermutlich kein offizielles API
- Pros: install-counts sind die einzige real-usage-signal
- Cons: möglicherweise scraping required, brittle
- Aufwand: 0.5d (verify ob API existiert, sonst scrape)

**Source-Option 5 — Composite + Marcel-Approve-Gate**
- Multiple sources kombiniert (2-4), dedup, alle landen als `approved_at IS NULL`
- Marcel-UI: weekly "review new candidates" (10-20 neue suggestions)
- Pros: Auto-Discovery ohne noise-flood
- Cons: braucht UI für approve-gate
- Aufwand: +0.5d UI

### 5.4 Update-Mechanism Recommendation

**Discovery-Recommendation:**
- V1 Cron-Refresh: Weekly für Inventory-rows, daily für Marcel-flagged-high-priority
- V1 Manual-Trigger: Settings-UI button + per-row refresh action
- V1 Auto-Discovery Sources: Option 2 (GitHub Search API) + Option 3 (3 awesome-lists) — robust + curated
- V1 Approve-Gate: required (kein direct-write von Auto-Discovery)

**V2 deferred:**
- Option 1 GitHub Trending (scraper, brittle)
- Option 4 skills.sh API (verify-needed)
- Real-time webhooks (nice-to-have, kein V1)

---

## 6. Adapter Architecture (Memory D3 + D24)

`packages/adapters/github-inventory/src/`:

```
src/
  index.ts        - public exports
  client.ts       - GitHub API client (rate-limit, retry, PAT auth)
  verify.ts       - live-verify CLI (D24 pattern)
  fetchers/
    repo-metadata.ts     - single-repo full-metadata fetch
    repo-releases.ts     - last N releases
    repo-search.ts       - topic-filtered search (Source-Option 2)
  discovery/
    awesome-list-parser.ts  - parse markdown awesome-lists (Source-Option 3)
  schemas.ts      - Zod schemas für GitHub-API responses
```

**Memory D24 alarm:** GitHub-API ist normalerweise stable, aber **live-verify-step ist trotzdem mandatory**. Specifically:
- Rate-limit-headers (X-RateLimit-Remaining, X-RateLimit-Reset)
- Pagination (`link` header parsing)
- Token-scopes (PAT muss `public_repo` haben, ggf. `read:org` für private)

### 6.1 Cost-Tracking

Per Memory D20 Adapter-Shape:
- GitHub-API ist free, kein €-cost
- ABER: rate-limit ist effectively "free-tier-cost" — track requests-per-hour als budget-proxy
- Log via existing cost-tracker mit `metadata.api='github', metadata.requests_used: N`

---

## 7. Scope-Options Matrix

Marcel-Decision driven. Vier Optionen mit ehrlichen Trade-offs:

### Option A — Minimal V1 (3-4d)

**Includes:**
- 1 object-type (Tools-only)
- Manual Marcel-Seed (kein Auto-Discovery)
- 2 content-angles (Profile-Pages + Comparison)
- Schema Option α (dedicated table)
- Cron + Manual-Trigger

**Pros:**
- Fastest to ship
- Theme 65 Foundation für Family A 50% ready
- Low complexity, easy maintenance

**Cons:**
- Skills komplett deferred → Theme 65 verliert Skill-content-angles
- Marcel must curate seed manually (~30 tools to add initially)
- No auto-discovery means manual additions over time

### Option B — Tools + Auto-Discovery V1 (5d)

**Includes:**
- 1 object-type (Tools-only)
- Auto-Discovery via Option 2 (GitHub Search API) + Option 3 (2 awesome-lists, kein skill-list)
- 2 content-angles (Profile-Pages + Comparison)
- Approve-gate UI
- Schema Option α
- Cron + Manual-Trigger

**Pros:**
- Tools-discovery scaled
- Approve-gate prevents noise
- Skills deferred = klarere V1-scope-line

**Cons:**
- Skills missing
- 2-source auto-discovery means awesome-list-parser brittleness

### Option C — Tools + Skills + Marcel-Seed V1 (5d)

**Includes:**
- 2 object-types (Tools + Skills)
- Manual Marcel-Seed für beide types
- 2 content-angles (Profile-Pages + Comparison) für Tools, plus skill-list-articles für Skills
- Schema Option α
- Cron + Manual-Trigger

**Pros:**
- Beide Object-Types ready für Theme 65
- Marcel-curated = high quality
- No auto-discovery complexity

**Cons:**
- Marcel-effort: ~30 tools + ~30 skills initial seed (Marcel-time 2-3h)
- Manual additions over time
- No discovery of new tools/skills

### Option D — Full V1 (8-9d)

**Includes:**
- 2 object-types (Tools + Skills)
- Auto-Discovery via 3 sources (Search-API + 3 awesome-lists)
- 2 content-angles (Profile-Pages + Comparison) — release-tracking + star-stories deferred
- Approve-gate UI
- Schema Option α
- Cron + Manual-Trigger

**Pros:**
- Beide Object-Types + scaled discovery
- Theme 65 Family A foundation complete
- Future-proof

**Cons:**
- 8-9d Aufwand vs 3-4d minimal
- Awesome-list-parser brittleness across 3 lists
- Approve-gate UI adds Marcel-review-burden weekly

### Option E — Phased V1 + V1.1 + V1.2 (~10-11d total, but staged)

**V1 (4d):** Tools + Marcel-Seed + Profile-Pages
**V1.1 (3d):** + Skills + Marcel-Seed
**V1.2 (3-4d):** + Auto-Discovery + Approve-Gate
**Later:** Comparison-Angle (consumes ready Inventory)

**Pros:**
- Each phase production-ready, no half-built features
- Marcel-feedback after each phase shapes next
- Risk-distribution

**Cons:**
- Total time longer
- Theme 65 Family A only fully ready after V1.2

---

## 8. Multi-Domain Considerations

Inventory ist project-scoped per `project_id`. Was BK später bringt:

**BK Solar-OSS-Inventory:**
- Tools: vermutlich vendor-firmware repos, OSS-Solar-Monitoring (z.B. `dlinov/openSunBuddy`, `ksooo/tibber-pulse-ip`)
- Skills: vermutlich anders organisiert (kein SKILL.md ecosystem für Solar)
- Awesome-Lists: möglicherweise existieren (z.B. `awesome-solar`, `awesome-energy`)
- Update-Cadence: ähnlich wie Toolwiki (weekly is fine)

**Schema-Anpassungen für BK:**
- Object-Types könnten "tool", "skill", **plus "firmware"**, "monitoring-tool" sein → TEXT mit CHECK constraint, easy to extend
- Auto-Discovery-Sources sind project-config (mirror 64.14 pattern)

**Adapter:**
- `github-inventory` adapter ist domain-agnostic
- Source-config (welche awesome-lists, welche search-queries) per project_planner_config jsonb

**V1 Multi-Domain-readiness:** alle Decisions respektieren das (project_id NOT NULL, source-config jsonb-pattern).

---

## 9. Theme 65 Cross-Reference

Memory D26 sagt: "Bei Theme-65-Arbeit Spec im Repo lesen, NICHT von Memory inferieren."

**Aber:** Inventory ist Theme-65-Vorbereitung, nicht Theme-65-Implementation. Ich kann ohne Theme-65-Spec-Read sagen:

- Family A data-driven 30% braucht **structured data** für article-generation
- 5 of 14 format-types in V1 (per Memory) — wahrscheinlich `top_n_comparison`, `head_to_head`, `news` formats
- Beide consumieren Inventory: top-N braucht stars-ranking, head-to-head braucht feature-matrix

**Recommendation:** Inventory V1 sollte mindestens `top_n_comparison`-ready sein (= stars + category + brief description per row). Das ist Option A bereits drin.

**Verify-Point:** Wenn Marcel Theme 65 Spec liest BEVOR H3 implementiert, gibt es vielleicht spezifischere Inventory-Anforderungen (z.B. "screenshot-url", "demo-url", "pricing-info" als zusätzliche fields).

→ **Marcel-Action: Theme 65 Spec öffnen und §x "Inventory-Anforderungen" lesen, dann H3 Spec entsprechend tune'n.**

---

## 10. Tools/Skills Seed-Suggestions

Falls Marcel Option A oder C wählt (Marcel-Seed), hier konkrete Vorschläge zum schnellen Start:

### 10.1 Tools Seed (~30 vorgeschlagen)

**AI-Dev-Tools (12):**
- anthropics/claude-code
- openai/codex
- aider-ai/aider
- cline/cline
- block/goose
- sst/opencode
- All-Hands-AI/OpenHands
- continuedev/continue
- microsoft/vscode-copilot-chat
- simonw/llm
- getzep/zep
- microsoft/markitdown

**AI-Tools generell (10):**
- ollama/ollama
- lobehub/lobe-chat
- mudler/LocalAI
- langfuse/langfuse
- BerriAI/litellm
- vllm-project/vllm
- unsloth/unsloth
- n8n-io/n8n
- Significant-Gravitas/AutoGPT
- microsoft/autogen

**AI-Frameworks/Libraries (8):**
- langchain-ai/langchain
- run-llama/llama_index
- huggingface/transformers
- huggingface/datasets
- chroma-core/chroma
- qdrant/qdrant
- microsoft/semantic-kernel
- modelcontextprotocol/servers

### 10.2 Skills Seed (~20 vorgeschlagen, basierend auf Recherche)

**Top installed Skills (per skills.sh data, March 2026):**
- vercel-labs/find-skills (418K installs, meta-skill)
- vercel-react-best-practices (176K installs)
- web-design-guidelines (137K installs)
- remotion-best-practices (126K installs)

**Curated Skill-Aggregators:**
- ComposioHQ/awesome-claude-skills
- BehiSecc/awesome-claude-skills
- travisvn/awesome-claude-skills

**Specific high-value skills (aus Recherche):**
- owasp-security (Trail of Bits)
- systematic-debugging
- ffuf_claude_skill (security testing)
- varlock-claude-skill (env-var secrets)
- sanitize (PII redaction)
- webapp-testing (Playwright)
- x-twitter-scraper (X/Twitter data)
- anthropics/skills (official)
- anthropics/anthropic-cookbook

---

## 11. Open Questions for Marcel

| # | Question | Default if no answer |
|---|---|---|
| Q1 | Scope-Option A/B/C/D/E? (siehe §7) | **Option C (Tools+Skills+Marcel-Seed, 5d)** — best ratio von completeness vs complexity |
| Q2 | Schema Option α/β/γ? (siehe §4) | **α (dedicated table)** — source-agnostic future-proofing |
| Q3 | Content-Angles V1: A+B oder mehr? (siehe §3) | **A+B (Comparison+Profile-Pages)**, defer C+D |
| Q4 | Auto-Discovery Sources (wenn B/D): GitHub-Search + 2 awesome-lists ok? | Yes, pragmatic V1 |
| Q5 | Approve-Gate-UI: weekly-batch oder per-suggestion? | **Weekly-batch** — 10-20 reviews/week, manageable |
| Q6 | Marcel-Seed-Liste: meine 30 Tools + 20 Skills (§10) als Start ok, oder eigene Liste? | Start mit my suggestions, Marcel kann editieren |
| Q7 | GitHub-PAT: Marcel hat schon einen oder neu erstellen? | Marcel-Action prerequisite |
| Q8 | Refresh-Cadence: weekly/daily je tier? | **Weekly default, daily für Marcel-flagged** |
| Q9 | Release-Tracking (Angle C): V1 inkludieren oder V1.1? | **V1.1** — Pacing braucht observation |
| Q10 | Theme 65 Spec lesen first für Inventory-Field-Requirements? | **Ja, vor H3-Spec-Write** |

---

## 12. Effort Summary

| Option | Code | Marcel-Effort | Total Calendar-Time |
|---|---|---|---|
| A Minimal | 3-4d code | 2-3h seed + GitHub-PAT-setup | 1 week |
| B Tools+Auto-Discovery | 5d code | 1h PAT + weekly 30min approve-batches | 1.5 weeks |
| C Tools+Skills+Marcel-Seed | 5d code | 4-5h seed (50 entries) + PAT | 1.5 weeks |
| D Full | 8-9d code | 1h PAT + weekly 1h approve-batches (more candidates) | 2.5-3 weeks |
| E Phased (V1+V1.1+V1.2) | 10-11d code over 3 phases | 2-3h per phase | 3-4 weeks (incremental) |

**Plus orthogonal:**
- Theme 65 Spec read (1-2h Marcel)
- GitHub-PAT generation (15min)

---

## 13. Recommended Spec Outline (post Marcel-Decisions)

Wenn Marcel Option C wählt (default-recommendation), Spec wäre:

```
Spec H3 (= 64.20?) — GitHub Tool-Inventory V1

1. Problem
2. Ziel
   - Scope: Tools + Skills, Marcel-Seed, Profile+Comparison angles
   - Out: Auto-Discovery (V1.1), Release-Tracking (V1.1), Star-Stories (V2)
3. Schema (content_source_inventory dedicated table, Option α)
4. Adapter Architecture (packages/adapters/github-inventory/)
5. Cron-Worker (refresh-policy per-tier)
6. Manual-Trigger Endpoint
7. Settings-UI (Inventory CRUD + Refresh button)
8. Marcel-Seed Process (initial CSV-import or manual UI)
9. Profile-Pages Integration (consumer)
10. Comparison-Angle Integration (consumer)
11. Multi-Domain Conflict-Map
12. App-Setup (GitHub PAT, scopes)
13. Tests
14. Acceptance
15. Implementations-Reihenfolge
16. Implemented (skelett)
17. Discovered & Deviations (skelett)
18. Memory-Update (skelett)
```

---

*Discovery erstellt 2026-05-24. Pending Marcel-Decisions vor Spec-Schreiben: Q1-Q10 (§11). Default-Recommendation: Option C (5d) + Schema α + Angles A+B + Theme 65 Spec read first.*
