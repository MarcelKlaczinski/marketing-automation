# Discovery — Template Engine (Pre-Theme-65 Foundation)

_Filesystem-based template registry mit Hot-Reload + Settings-UI Preview + Versioning via Snapshot._
_Status: Discovery (pre-spec). Voraussetzung für Theme 65 Sub-Specs 65.6–65.10._
_Aufwand-Hypothese: 5-7d Engine-only, danach 65.6 ist reduziert auf ~1d Registry-Extension._
_Renderer: Remotion (Marcel-Decision)._

---

## 0. Marcel-Decisions Recap

| Decision | Choice |
|---|---|
| Renderer | Remotion (stay, baue Engine darauf) |
| Source-of-Truth | Hybrid (Filesystem + DB-metadata) |
| Hot-Reload | Filesystem-watcher |
| Preview | Settings-UI live-render mit variable-inputs |
| Versioning | Snapshot bei render in `articles.template_version` |
| Designer-Workflow | Mockup-Image → Claude Code re-creates as Component |
| Template-Type V1 | Carousel-Slides (Bilder mit Text-Overlays via Resvg/Sharp) |

---

## 1. Mental Model

**Was die Engine IST:**

Ein **Discovery + Registration + Render + Preview** Layer zwischen Marcel's Authoring-Workflow und dem existing Carousel-Render-Pipeline.

```
Marcel-Workflow:
1. Mockup-Image in Claude Design Tool erstellen
2. Claude Code: "build this as a template" → generiert TSX-Komponente in packages/social/src/templates/<key>/
3. Filesystem-Watcher detected new file
4. Registry refreshed → template ist live
5. Marcel öffnet Settings-UI → Preview-Page → sieht Render mit Sample-Data
6. Falls OK: Marcel kann Template in Recurring-Definition-Form auswählen
```

**Was die Engine NICHT IST:**

- Kein No-Code-Template-Builder (Drag&Drop)
- Kein LLM-generated-Templates (Marcel + Claude Code authoring)
- Kein Multi-Renderer-Layer (nur Remotion in V1, Satori als V1.5 evaluation)
- Kein DB-stored Layout-Spec (Templates sind TSX-Code, DB hat nur Metadata)
- Kein Theme-65-Sub-Spec — Engine ist Theme-65-Foundation, V1 ist Carousel-only

**Strategischer Fit:**

- Unblockt Theme 65 65.7 (Family A Templates) + 65.8 (Family B Templates)
- Reduziert 65.6 Effort von 2d auf ~1d (nur Registry-Extension nötig, Engine ist da)
- Etabliert Designer-Workflow für Marcel (Claude Code als Authoring-Tool)
- Multi-Domain-readiness: BK kann andere Templates haben (per-project filter in Registry)

---

## 2. Existing State (Verify-Points)

Annahmen die Implementor verifizieren muss:

### 2.1 Existing Carousel-Templates (Spec 51a v2.1)

**Hypothesen:**

1. Templates leben in `packages/social/src/templates/*` als TSX-Komponenten
2. Es gibt einen existing `TemplateRegistry` (Spec 54a) mit fixed-list approach
3. Render-Path geht über BullMQ social-render worker (Spec 51a)
4. Slot-Map + Content-Bounds pattern existiert per Template
5. Override-Schema in `src/templates/overrides/<template-key>.overrides.ts`

**Verify points:**

1. Wo genau ist der TemplateRegistry? (`packages/social/src/template-registry/` vermutet)
2. Hat er heute eine `getTemplate(key)` API, oder ist es ein static Object-Export?
3. Wie wird das slot-map heute generated? Per-template `definition.ts`?
4. Hat der social-render worker einen template-loading mechanism oder ist er hardcoded?

### 2.2 Existing Render-Pipeline

**Hypothesen:**

- Render-Step nimmt template-key + content-data → renders 7 slides → Sharp-merge → R2-upload
- Memory D20 Adapter-Shape: Renderer macht R2 + cost-tracking intern, returnt lean shape

**Verify points:**

5. Wie wird Remotion heute gestartet? `bundle()` + `renderMedia()`? Oder via headless Chrome service?
6. Ist Resvg/Sharp im pipeline oder nur Remotion?
7. Wie lange braucht ein 7-slide carousel render heute? (Performance-baseline für Engine)

### 2.3 Implication für Hot-Reload

**Hypothese:** Remotion `bundle()` cached den Bundle-Output. Filesystem-watcher müsste **invalidate** den cache → next render triggers re-bundle.

**Verify points:**

8. Wie ist Remotion-Bundle-Cache strukturiert?
9. Kann der Cache per-template invalidated werden, oder ist es all-or-nothing?
10. Welche worker-prozesse haben den Bundle im memory? Nur social-render-worker, oder mehrere?

---

## 3. Architecture Overview

```
┌────────────────────────────────────────────────────────────────┐
│ Marcel's Authoring Workflow                                    │
│ 1. Mockup-Image (Claude Design Tool)                           │
│ 2. Claude Code: writes packages/social/src/templates/<key>/    │
│    ├── definition.ts        (slot-map, bounds, llm-schema)     │
│    └── compositions/Clean/  (Remotion JSX)                     │
└─────────────────────────────┬──────────────────────────────────┘
                              │
                              ▼ (file written)
┌────────────────────────────────────────────────────────────────┐
│ Filesystem Watcher (chokidar/Bun fs.watch)                     │
│ - Detects new/changed *.ts(x) in templates/                    │
│ - Debounce 500ms                                               │
│ - Calls TemplateRegistry.refresh()                             │
└─────────────────────────────┬──────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│ TemplateRegistry (in-memory + DB-backed)                       │
│ - Scans templates/ directory                                   │
│ - Imports each definition.ts                                   │
│ - UPSERT template-row in DB (active, lastSeen, fileHash)       │
│ - In-memory cache invalidated                                  │
└─────────────────────────────┬──────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│ Render Layer (existing Remotion pipeline)                      │
│ - Receives template-key + content-data                         │
│ - Registry.getTemplate(key) → loads definition + composition   │
│ - Remotion bundle (cached, invalidated by watcher)             │
│ - Renders 7 slides → Sharp-merge → R2                          │
│ - articles.template_version = git-sha or file-hash             │
└────────────────────────────────────────────────────────────────┘

Separate UI path:
┌────────────────────────────────────────────────────────────────┐
│ Settings-UI Preview Page                                       │
│ - GET /api/templates/list (DB query, active only)              │
│ - POST /api/templates/preview { templateKey, sampleData }      │
│ - Renders via same pipeline → returns PNG                      │
└────────────────────────────────────────────────────────────────┘
```

---

## 4. Schema (DB-side)

Per Memory D5 — multi-tenant exception: templates können global oder per-project sein.

### 4.1 Templates Table

```sql
CREATE TABLE templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE, -- NULL = global template
  template_key TEXT NOT NULL,                                -- 'comparison-grid-5-clean'
  base_template_key TEXT NOT NULL,                           -- 'comparison-grid-5' (without variant)
  variant TEXT,                                               -- 'clean' | 'warm' | NULL if no variant
  file_path TEXT NOT NULL,                                    -- 'packages/social/src/templates/comparison-grid-5/'
  file_hash TEXT NOT NULL,                                    -- SHA256 of definition.ts (for change detection)
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  format_types TEXT[] NOT NULL DEFAULT '{}',                  -- ['top_n_comparison'] from registry config
  usage_count INT NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),            -- last filesystem-scan timestamp
  description TEXT,                                            -- pulled from definition.ts metadata
  preview_image_url TEXT,                                      -- R2 key of cached preview
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uniq_template_key_per_project ON templates (project_id, template_key) WHERE is_active = true;
CREATE INDEX idx_templates_format_types ON templates USING GIN (format_types);
CREATE INDEX idx_templates_lru ON templates (last_used_at NULLS FIRST);
```

**Multi-Tenant-Pattern:** `project_id` NULL = global template (shared across projects), NOT NULL = project-scoped. Memory D5 dokumentiert das als multi-tenant exception.

**Key fields explanation:**

- `template_key` ist unique per project (oder global)
- `file_hash` ermöglicht detection ob TSX-content geändert (Hot-Reload-Trigger)
- `format_types` = welche format-types dieses template nutzen können (Theme 65 Registry-Layer-1)
- `usage_count` + `last_used_at` für LRU-Strategy (65.6)
- `last_seen_at` = last filesystem-scan, useful für "template not found in filesystem" cleanup

### 4.2 Articles Extension

```sql
ALTER TABLE articles ADD COLUMN template_version TEXT;
ALTER TABLE articles ADD COLUMN template_key TEXT;
```

`template_version` = git-sha when rendered OR file-hash if not git-tracked.

**Pattern:** Snapshot bei render (Marcel-Decision). Wenn template später geändert → existing articles bleiben referenziert mit old version, neue renders nutzen current version.

---

## 5. Filesystem Watcher Design

### 5.1 Bun-native vs chokidar

**Bun.fs.watch:**
- Native, kein Dependency
- API ist simpler aber weniger feature-rich
- Memory: ~5MB
- Cross-platform: works on macOS/Linux (Windows hat eigene caveats)

**chokidar:**
- npm-Package, battle-tested
- Mehr Features: ignoreInitial, awaitWriteFinish (= debounce gegen partial-writes)
- Memory: ~15-20MB
- Cross-platform: solid

**Recommendation:** **chokidar** für die V1 — `awaitWriteFinish` Pattern ist wichtig wenn Claude Code mehrere Files in sequence schreibt (z.B. `definition.ts` + `compositions/Clean/index.tsx`). Bun-native würde mehrere events feuern.

### 5.2 Watch Path Setup

```typescript
// apps/api/src/lib/template-registry/watcher.ts
import chokidar from 'chokidar';
import { templateRegistry } from './registry';
import { logger } from '@marketing-auto/shared';

export function startTemplateWatcher() {
  const watcher = chokidar.watch(
    'packages/social/src/templates/**/*.{ts,tsx}',
    {
      ignored: /(^|[\/\\])\../, // dotfiles
      persistent: true,
      ignoreInitial: true,       // don't fire events on startup
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    },
  );

  let refreshTimeout: NodeJS.Timeout | null = null;
  
  const triggerRefresh = () => {
    if (refreshTimeout) clearTimeout(refreshTimeout);
    refreshTimeout = setTimeout(async () => {
      logger.info('Template filesystem change detected, refreshing registry');
      await templateRegistry.refresh();
    }, 500); // additional debounce against rapid file-bursts
  };

  watcher
    .on('add', triggerRefresh)
    .on('change', triggerRefresh)
    .on('unlink', triggerRefresh);

  return watcher;
}
```

### 5.3 Watcher Lifecycle

**Where it runs:**
- In API-process (Hono app) — single watcher, refreshes registry-cache
- Workers consume registry-cache via shared Redis pub/sub (registry publishes "templates-changed", workers invalidate local cache)

**Why not in each worker:**
- Multiple watchers = multiple events for same file change
- Workers should be deterministic (input → output), filesystem-watching is API-process-concern

### 5.4 Multi-Process Cache Invalidation

```
API-process (with watcher):
  filesystem-change → registry.refresh() → DB updated + Redis PUBLISH 'templates:changed'

BullMQ social-render-worker:
  SUBSCRIBE 'templates:changed' → in-memory cache invalidated
  Next render-job triggers registry.getTemplate(key) → re-fetches from DB + filesystem
```

**Redis Pub/Sub:** Pattern ist konsistent mit existing tool-architecture (Memory D3: workers in `apps/api/src/workers/`, env via `getEnv()`).

---

## 6. Registry API

```typescript
// packages/social/src/template-registry/registry.ts
export interface TemplateMetadata {
  key: string;
  baseKey: string;
  variant?: string;
  filePath: string;
  formatTypes: string[];
  description?: string;
  isActive: boolean;
  fileHash: string;
}

export interface TemplateInstance {
  metadata: TemplateMetadata;
  // Dynamic import-result (cached)
  definition: TemplateDefinition;  // slot-map, bounds, llm-schemas
  composition: ComponentType<any>; // Remotion JSX component
}

export class TemplateRegistry {
  async refresh(): Promise<{ added: number; changed: number; removed: number }>;
  async listAll(filters?: { formatType?: string; projectId?: string }): Promise<TemplateMetadata[]>;
  async getTemplate(key: string): Promise<TemplateInstance | null>;
  async getEligibleForFormat(formatType: string): Promise<TemplateMetadata[]>;
  async incrementUsage(key: string): Promise<void>;
}
```

**Key behaviors:**

- `refresh()` walks filesystem, computes file-hash, UPSERTs DB rows, marks "not seen" rows as `is_active=false`
- `getTemplate(key)` dynamic-imports the TSX module (Node.js dynamic-import cache cleared per refresh)
- `incrementUsage(key)` for LRU tracking

### 6.1 Dynamic Import Cache Problem

**Issue:** Node.js / Bun caches dynamic imports per process. Hot-reload requires cache clear.

**Bun-specific:** Bun's `import()` cache cannot be cleared via traditional `delete require.cache[]` (ESM, not CommonJS).

**Solutions evaluated:**

a) **Version-busting URL params:** `import('./templates/x.tsx?v=' + Date.now())` — works but creates memory leak (each import adds to cache forever)

b) **Worker-restart on registry refresh:** clean but kills running jobs

c) **Process-level template-loader subprocess:** workers spawn isolated subprocess per render that imports fresh — heavy but predictable

d) **Remotion `bundle()` re-call:** Remotion has its own bundle mechanism. Calling `bundle(entry)` again creates fresh bundle. **Memory-cost manageable since Remotion bundles are pre-render-time, not per-render-time.**

**Recommendation:** **(d) Remotion bundle()-re-call.** Registry refresh → invalidate cached bundles → next render triggers fresh bundle. Memory-leak avoided because Remotion bundles can be garbage-collected when reference dropped.

---

## 7. Preview Mechanism (Settings-UI)

### 7.1 Backend Endpoint

```typescript
// apps/api/src/routes/projects/templates.ts
POST /api/projects/:slug/templates/:templateKey/preview
Body: { sampleData: Record<string, unknown> }
Returns: { previewUrl: string, renderDurationMs: number }
```

**Behavior:**
1. Validate template-key against registry
2. Validate sampleData against template's schema (per definition.ts)
3. Call render-pipeline in "preview-mode" (no R2 upload, returns inline base64 OR temporary R2 with TTL)
4. Return PNG-URL

**Preview-Mode flag:** Render-pipeline accepts `previewMode: true` → skips persistence, returns ephemeral output.

### 7.2 Frontend Page

`apps/web/src/pages/settings/TemplatesPage.vue`:

```
┌─────────────────────────────────────────────┐
│ Templates                                   │
├─────────────────────────────────────────────┤
│ Filter: [Format-Type ▾] [Active/Inactive]   │
│                                             │
│ ┌──────────────────────────────────────┐    │
│ │ comparison-grid-5-clean              │    │
│ │ Family: A | Format: top_n_comparison │    │
│ │ Last used: 2 days ago | Uses: 14     │    │
│ │ [Preview] [Disable]                  │    │
│ └──────────────────────────────────────┘    │
│                                             │
│ ┌──────────────────────────────────────┐    │
│ │ story-arc-clickbait-dramatic         │    │
│ │ Family: B | Format: story_arc_...    │    │
│ │ Last used: never | Uses: 0           │    │
│ │ [Preview] [Disable]                  │    │
│ └──────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

**Preview-Modal:**

```
┌─────────────────────────────────────────┐
│ Preview: comparison-grid-5-clean        │
├─────────────────────────────────────────┤
│ Sample Data:                            │
│ ┌────────────────────────────────────┐  │
│ │ {                                  │  │
│ │   "headline": "Top 5 KI-Tools",    │  │
│ │   "tools": [                       │  │
│ │     { "name": "Claude", ... },     │  │
│ │     ...                            │  │
│ │   ]                                │  │
│ │ }                                  │  │
│ └────────────────────────────────────┘  │
│ [Auto-fill from last brief] [Render]    │
│                                         │
│ ┌────────────────────┐                  │
│ │                    │                  │
│ │   PREVIEW IMAGE    │                  │
│ │     (1080x1350)    │                  │
│ │                    │                  │
│ └────────────────────┘                  │
└─────────────────────────────────────────┘
```

Vue Options API (Memory D1), JSON-editor (Monaco oder simpler `<q-input type="textarea">`), live-preview rendering.

### 7.3 Auto-Fill Sample Data

**Convenience feature:** Marcel klickt "Auto-fill from last brief" → Backend findet last brief of compatible format-type → populates sample-data input.

Saves Marcel from hand-crafting sample-data JSON.

---

## 8. Versioning Strategy

Marcel-Decision: **Snapshot bei render in `articles.template_version`. Current version always wins.**

### 8.1 Version Computation

```typescript
function computeTemplateVersion(filePath: string): Promise<string> {
  // Option A: Git SHA of file (if in git-tracked repo)
  // Option B: SHA256 of file contents (fallback)
  
  const gitSha = await tryGetGitSha(filePath);
  if (gitSha) return `git:${gitSha}`;
  
  const fileContent = await fs.readFile(filePath, 'utf-8');
  return `hash:${sha256(fileContent)}`;
}
```

Stored as `git:abc123...` or `hash:xyz789...` for clarity.

### 8.2 Article-Side

```typescript
// In article-creation step
const article = await db.insert(articles).values({
  // ... other fields
  template_key: brief.templateKey,
  template_version: await computeTemplateVersion(template.filePath),
});
```

**Backward-Compat:** Wenn Marcel template editiert → existing articles haben old version dokumentiert. Re-render eines articles (Refresh-Queue) nutzt current version. **Kein automatischer re-render bei template-changes.**

### 8.3 No Backward-Render-Compat (deliberate)

Marcel said: "current version always wins". Heißt:

- Template-V2 wird live → next render uses V2
- Existing articles bleiben in DB with V1 reference (audit trail)
- Wenn Marcel article manuell re-rendert → V2 wird used
- **Kein "render this article with template-V1"** support — würde altes filesystem state oder DB-stored templates voraussetzen

**Trade-off accepted:** Simplicity over historical-accuracy. Article-rendered-images sind eh persistent in R2.

---

## 9. Designer-Workflow Detail

Marcel sagte: "Designer-Tool-Output ist Mockup/Image — Claude Code re-creates as Component."

### 9.1 Concrete Workflow

```
Step 1: Marcel öffnet Claude Design Tool oder Figma oder ähnliches
Step 2: Designed Carousel-Slide-Mockup (1080x1350, 4:5)
Step 3: Exportiert als PNG/JPG → speichert lokal
Step 4: Öffnet Claude Code
Step 5: "Build this carousel template — here's the mockup [attached image]"
Step 6: Claude Code:
   a. Liest Memory + CLAUDE.md (Engine-spec + template-conventions)
   b. Liest existing template als reference (z.B. comparison-grid-5-clean)
   c. Schreibt:
      - packages/social/src/templates/<new-key>/definition.ts
      - packages/social/src/templates/<new-key>/compositions/Clean/index.tsx
      - packages/social/src/templates/<new-key>/compositions/Clean/slides/*.tsx
      - packages/social/src/templates/<new-key>/llm-prompt.de.ts
      - packages/social/src/templates/<new-key>/llm-prompt.en.ts
Step 7: Filesystem-Watcher detected → Registry refreshed
Step 8: Marcel öffnet Settings-UI → /settings/templates → sees new template
Step 9: Marcel clickt "Preview" → live-render mit sample data
Step 10: Falls OK → template ready for recurring-definitions to consume
```

### 9.2 Constraints für Claude Code

Was Claude Code per definition.ts beim Template-Schreiben respektieren MUSS:

- Slot-map convention (existing pattern)
- Content-bounds (max-chars per slot)
- Format-types[] (welche format-types eligible)
- LLM-schema (Zod schemas for slot-content generation)
- Vue Options API (irrelevant — templates sind Remotion, kein Vue, aber dokumentieren falls Marcel verwechselt)

**packages/social/CLAUDE.md** sollte erweitert werden mit:
- "How to author a new template" section
- Conventions list (file structure, slot-naming, prompt-conventions)
- Examples (link to comparison-grid-5-clean as reference)

### 9.3 LLM Prompt-Generation für Templates

**Open Question:** Soll Claude Code beim Template-erstellen auch LLM-Prompts schreiben?

Mein Take: **Ja**, gemeinsam. Template + Prompt sind gekoppelt (prompt-output muss in slots passen).

**Pattern:** Claude Code analyses mockup-image für visual-content → derived slot-content-requirements → schreibt prompt der diese constraints respektiert.

---

## 10. Multi-Domain Considerations

Engine ist project-scoped per `templates.project_id`. Was BK später bringt:

**BK Solar-Templates:**
- Comparison-grid für Solar-Module-Vergleiche
- "Mein Setup als Solar-Anfänger" lifestyle templates
- Andere brand-colors, andere typography

**Schema-Anpassungen für BK:**
- Templates sind project-scoped per `project_id`
- Globale Templates (project_id NULL) können von beiden Projekten genutzt werden
- Aber: brand-specific design wird per-project sein (Toolwiki = AI-aesthetic, BK = Energy-aesthetic)

**Watcher-Logik bleibt agnostic:** filesystem-scan registriert alle templates, project_id wird per-template in `definition.ts` declared (oder als global wenn nicht specified).

---

## 11. Effort Estimate

| Komponente | Aufwand |
|---|---|
| DB Schema + Migration | 0.5d |
| TemplateRegistry implementation (filesystem-scan + DB-sync) | 1d |
| Filesystem-Watcher (chokidar setup + debounce + Redis pub/sub) | 1d |
| Dynamic-Import + Remotion bundle re-call mechanism | 1d |
| Preview-Endpoint (POST /preview with preview-mode flag) | 0.5d |
| Settings-UI TemplatesPage (list + preview-modal) | 1.5d |
| Auto-fill sample-data feature | 0.5d |
| Article snapshot `template_version` integration | 0.5d |
| Tests (registry-refresh, watcher-debounce, preview-render) | 0.5d |
| **Total** | **~7d** |

**Plus orthogonal:**
- packages/social/CLAUDE.md extension für Designer-Workflow (1-2h Marcel + Claude Code)

**Marcel-Manual-Effort:**
- Authoring first template via new workflow als verification (~30min Marcel)
- Settings-UI walkthrough + bug-report cycle

---

## 12. Risk Analysis

| Risk | Severity | Mitigation |
|---|---|---|
| Remotion bundle re-call leaks memory in long-running worker | Medium | Bundle-cache size monitoring + worker-recycling (M9 territory) |
| Filesystem-watcher fires too often (esp. during git checkout) | Low | chokidar awaitWriteFinish + 500ms debounce + 500ms additional delay |
| Dynamic-import resolves stale module despite refresh | Medium | Force-version-busting via cache-bypass param if Remotion bundle doesn't fully invalidate |
| Multi-process registry-cache out-of-sync (API has fresh, worker has stale) | High | Redis pub/sub `templates:changed` mandatory, not optional |
| TypeScript path resolution differs between dev and prod | Medium | Verify-test in CI: registry-refresh works after build |
| Marcel writes template that violates slot-bounds | Low | Preview-mode catches it (render fails or text overflows visibly) |
| Hot-reload doesn't work in production (only dev) | Medium | This is a real concern — see §13 Open Question Q3 |
| Memory leak via watcher in long-running API process | Low | chokidar is production-grade, monitored heap |

---

## 13. Open Questions for Marcel

| # | Question | Default if no answer |
|---|---|---|
| Q1 | Project-scoped templates default, global as exception? Oder vice versa? | **Project-scoped default** (BK + Toolwiki haben unterschiedliche brand-aesthetics) |
| Q2 | Settings-UI: Preview-Modal oder dedicated Page? | **Modal** für quick-preview, Page für detailed-edit (V1.1) |
| Q3 | Hot-Reload only in dev, oder auch production? | **Production yes** — Marcel-Workflow erfordert das, deploy = git-push not docker-rebuild |
| Q4 | Filesystem-watcher in API-process oder eigener "registry-process"? | **API-process** (single point of truth, simpler) |
| Q5 | Was wenn template-file is malformed (TypeScript-error)? | **Log + skip + alert Marcel via notification** (D27 pattern) |
| Q6 | Sample-data auto-fill: from last brief OR random fixture? | **Last brief** (more realistic, but allow random fallback) |
| Q7 | Should preview-renders be cached (CDN/R2)? | **No V1**, ephemeral renders only (data may be sensitive) |
| Q8 | Template-disable: soft (DB flag) oder hard (move file to disabled/)? | **Soft (DB flag)** — file stays for git-history |
| Q9 | Multi-renderer support (future Satori): plan now or later? | **Later** (V1.5 evaluation if render-cost becomes issue) |
| Q10 | LRU-strategy lives in Engine or 65.6? | **65.6 owns LRU** — Engine provides usage_count, Strategy is consumer |

---

## 14. Implementation Order

**Day 1-2:** DB Schema + Registry-Core (without watcher)
- Migration
- TemplateRegistry class with filesystem-scan + DB-sync
- Unit tests for registry-refresh

**Day 3:** Watcher + Multi-Process Sync
- chokidar setup
- Redis pub/sub for cache-invalidation
- Integration test: file-change → registry-refreshed → render uses new

**Day 4:** Preview Mechanism
- POST /preview endpoint with preview-mode flag
- Render-pipeline preview-mode branch
- Sample-data validation

**Day 5:** Settings-UI
- TemplatesPage with list + filter
- Preview-Modal with JSON-editor + render-button
- Auto-fill feature

**Day 6:** Article-Versioning + Polish
- Article schema extension
- Version-computation helper
- Integration tests
- CLAUDE.md extensions for Designer-Workflow

**Day 7:** Marcel-Verify
- First template authoring via new workflow
- Bug-fix iteration

---

## 15. Recommended Spec Outline (post-Decisions)

```
Spec 65.0 — Template Engine (Pre-Theme-65 Foundation)

1. Problem (recurring content authoring blocked without Engine)
2. Ziel
   - Scope: Filesystem-based template registry, hot-reload, preview, versioning
   - Out: Multi-renderer, no-code builder, LLM-generated templates
3. Schema (templates table + articles extension)
4. Filesystem-Watcher Architecture
5. Registry API + Dynamic-Import Strategy
6. Preview Endpoint + Settings-UI Page
7. Article Versioning Snapshot
8. Designer-Workflow + CLAUDE.md Extensions
9. Multi-Domain Considerations
10. Tests
11. Acceptance Criteria
12. Implementations-Reihenfolge
13. Implemented (skelett)
14. Discovered & Deviations (skelett)
15. Memory-Update (skelett)
```

---

## 16. Decision Tree für Marcel

**Wenn alle Defaults OK:**

→ Spec wird 65.0 (Pre-Theme-65)
→ ~7d Aufwand
→ Reduziert 65.6 von 2d auf ~1d (Engine ist da, nur Registry-Extension nötig)
→ Total Theme 65 Sequenz: Engine (7d) → 65.1+65.4 parallel (4d) → 65.2+65.3 (6d) → 65.5+65.6 reduced (4d) → 65.7+65.8 templates (18d) → 65.9+65.10 (8d) → 65.11+65.12 (9d) = ~56d

**Falls Marcel andere Decisions trifft (Q1-Q10), Spec wird leicht angepasst.**

---

*Discovery erstellt 2026-05-25. Pending Marcel-Decisions Q1-Q10 (§13). Default-Recommendation: alle defaults akzeptieren → Spec 65.0 schreiben.*
