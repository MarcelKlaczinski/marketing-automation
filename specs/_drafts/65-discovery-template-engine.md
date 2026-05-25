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

---

## 17. Implementation Status

### Day 1-2 (2026-05-25, in-progress arc)

**Landed:**

- DB migration [`0112_templates.sql`](../../packages/db/drizzle/0112_templates.sql) — new `templates` table + 2 snapshot columns on `articles`
- Drizzle schema [`packages/db/src/schema/templates.ts`](../../packages/db/src/schema/templates.ts) with `Template` / `NewTemplate` type exports
- `articles.template_key` / `articles.template_version` mapped as `templateKey` / `templateVersion` in [`packages/db/src/schema/content.ts`](../../packages/db/src/schema/content.ts) — the snapshot fields aren't populated yet (render pipeline still needs touching; deferred per spec §8.2)
- Write helpers [`packages/db/src/helpers/templates-write.ts`](../../packages/db/src/helpers/templates-write.ts) — `upsertTemplate`, `deactivateMissingTemplates`, `syncTemplatesBatch`, `incrementTemplateUsage`
- Read helpers [`packages/db/src/helpers/templates-read.ts`](../../packages/db/src/helpers/templates-read.ts) — `getTemplate` (project-scoped > global fallback), `listActiveTemplates`, `listActiveGlobalTemplates`
- Bootstrap-sync orchestrator [`apps/api/src/lib/template-registry-sync.ts`](../../apps/api/src/lib/template-registry-sync.ts) — `bootstrapAndSyncTemplates()` + `kebabToCamelKey` + `relativeDefinitionPath` pure helpers. DB-failure-tolerant.
- Server startup [`apps/api/src/server.ts`](../../apps/api/src/server.ts) — `bootstrapTemplates()` → `await bootstrapAndSyncTemplates()`
- Tests: [`packages/db/test/templates.test.ts`](../../packages/db/test/templates.test.ts) (13 cases) + [`apps/api/test/lib/template-registry-sync.test.ts`](../../apps/api/test/lib/template-registry-sync.test.ts) (6 cases). All green. Workspace typecheck 0 errors across 26 packages.

**Deviations from spec narrative:**

- Spec §4.1 listed `format_types[]` as the only DB-side mirror of the LLM-facing metadata. The migration also captures `output_format`, `compatible_channels[]`, `generation_class`, `display_name`, `description`, `default_slide_count`, `estimated_cost_usd` — frozen at sync-time so the planner can read template metadata without dynamic-importing the TSX module. The watcher (Day 3) will keep these in sync on file-change.
- Spec §4.1 used pre-shipped `CREATE UNIQUE INDEX ... WHERE is_active = true` syntax. Drizzle's `uniqueIndex().where(sql\`${t.isActive} = TRUE\`)` produces the equivalent SQL — partial-unique semantics preserved (Memory D108 same-predicate-as-targetWhere rule applies when a future helper needs `onConflictDoUpdate`).
- Spec §4.1 implied an `onConflictDoUpdate` path for upsert. The actual implementation uses SELECT-then-INSERT/UPDATE inside `db.transaction()` because Drizzle's composite-key `onConflictDoUpdate` is awkward with a nullable `project_id` discriminator (NULL doesn't match `eq(...)`). Memory D125 / Pattern from `persistPairs()` (Spec 62.3).
- Spec §10 implied per-template directory layout (`packages/social/src/templates/<key>/definition.ts`). The current registry uses the flat layout (`definitions/<camelKey>.ts`). The bootstrap-sync uses convention-based filepath lookup via `kebabToCamelKey()`. Day 3 watcher will need to handle both layouts during migration.
- Spec §4.2 fields landed as `templateKey` / `templateVersion` (TS) → `template_key` / `template_version` (DB columns). Property name matches existing convention; the spec text didn't disambiguate from `social_posts.templateKey`, but a Drizzle table property and a different table's same-named property don't conflict structurally.

**Marcel-decisions used (defaults from §13):**

- Q1: Project-scoped templates default — implemented as `project_id` nullable column (NULL = global, UUID = scoped). Memory D5 multi-tenant exception documented inline.
- Q3: Hot-reload in production — bootstrap-sync now fires on every API startup (idempotent UPSERT + deactivate-missing sweep). Day 3 watcher will make it reactive.
- Q4: Watcher in API-process — bootstrap-sync currently lives in `apps/api`. Day 3 watcher will live alongside it.
- Q5: Malformed template-file handling — bootstrap-sync's `buildSpecsFromInMemoryRegistry()` catches per-template read errors, logs warn, and skips the row (registry stays usable).

**Pending Marcel-Decision sites for Day 3+:**

- Q2 (preview modal vs page) — Day 5
- Q6 (auto-fill data source) — Day 5
- Q7 (cache preview renders) — Day 4
- Q8 (soft vs hard disable) — Day 6
- Q10 (LRU ownership) — Spec 65.6

**Open observations from /review-task:**

- The bootstrap-sync writes 5 rows on every cold start (~50ms). When the watcher lands (Day 3), warm-restart syncs should be no-ops (all `unchanged` per the file-hash equality check). Worth verifying live once watcher is in.

### Day 3 (2026-05-25, landed)

**Landed:**

- chokidar@5 added to `apps/api/package.json`
- [`packages/core/src/events/template-events.ts`](../../packages/core/src/events/template-events.ts) — `TEMPLATE_EVENTS_CHANNEL` constant, `templateChangeEventSchema` (Zod), `publishTemplateChangeEvent()` with a lazy IORedis publisher singleton (mirrors the pipeline-events publisher shape from Spec 55.1 Section B)
- [`packages/social/src/templates/registry.ts`](../../packages/social/src/templates/registry.ts) — `replace<T>(template)` for hot-reload + `unregister(key: string)` for test cleanup
- [`apps/api/src/lib/template-registry-sync.ts`](../../apps/api/src/lib/template-registry-sync.ts) — extracted `buildSpecFromTemplate()` pure helper, added `syncOneTemplateFromFile()` (the per-file hot-reload entry point used by both the watcher and the subscriber), `cacheCopyPathFor()` pure helper, `cleanupStaleCacheCopies()` for boot-time + periodic sweep of stale dotfiles
- [`apps/api/src/lib/template-watcher.ts`](../../apps/api/src/lib/template-watcher.ts) — chokidar watcher: `awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }` + 500ms post-settle debounce + `ignored: /(^|[/\\])\..+\.ts$/` for cache-copy dotfile feedback prevention. add/change → `syncOneTemplateFromFile()` with `publish: true`. unlink → DB `is_active=false` sweep + `template.removed` event (in-memory entry kept until restart — Spec 65.0 §13 Q8 default).
- [`apps/api/src/lib/template-change-subscriber.ts`](../../apps/api/src/lib/template-change-subscriber.ts) — worker-process subscriber to `TEMPLATE_EVENTS_CHANNEL`. Calls `syncOneTemplateFromFile()` with `publish: false` (CRITICAL: prevents feedback loops). `template.removed` events log only (no in-memory removal for in-flight render safety).
- [`apps/api/src/server.ts`](../../apps/api/src/server.ts) — boot-time cache-copy cleanup + `startTemplateWatcher()` wiring
- [`apps/api/src/workers/index.ts`](../../apps/api/src/workers/index.ts) — boot-time cleanup + `bootstrapAndSyncTemplates()` + `startTemplateChangeSubscriber()` + `stopTemplateChangeSubscriber()` in shutdown
- [`apps/api/test/lib/template-watcher.test.ts`](../../apps/api/test/lib/template-watcher.test.ts) — 8 cases: `syncOneTemplateFromFile()` end-to-end with temp .ts fixtures (add → update → unchanged → bad-export-throws), `cacheCopyPathFor()` pure helper, `cleanupStaleCacheCopies()` with mtime-stamped fixtures

**Three discoveries that shaped the implementation:**

1. **Bun caches dynamic-import by absolute file PATH, ignoring URL query strings.** Verified live: `await import("file:///foo.ts?v=1")` and `await import("file:///foo.ts?v=2")` return the same cached module even when the file content changed between imports. The spec's §6.1 (d) "Remotion bundle()-re-call" applies to the render path; for the in-memory `templateRegistry` we need a different cache-bust strategy. **Solution:** before each hot-reload, write a sibling dot-prefixed cache-copy named `.<base>.<hash16>.ts` to the same directory and import that fresh filename. Bun's path-based cache keys each unique hash separately. Relative imports inside the copy resolve correctly because it sits in the original's dir. Trade-off: cache-copies accumulate during a session; the boot-time `cleanupStaleCacheCopies({maxAgeMs: 0})` sweep handles the prior-session leftovers. Added as a root CLAUDE.md DO-NOT rule.
2. **`readdir(dir, {withFileTypes: true})` returns inconsistent shapes in Bun.** The Day-3 cleanup helper initially returned 0 deletions until I switched to plain `readdir(dir)` + per-name `Bun.file(path).stat()` per the existing workspace convention (root CLAUDE.md "DO NOT use `{withFileTypes: true}`").
3. **`mtimeMs <= cutoff` (not `<`) is the right boundary** for the cleanup helper. With `<`, `maxAgeMs: 0` (boot-time "delete everything") leaves files freshly written in the same millisecond as the call. `<=` makes the predicate inclusive at the cutoff edge.

**Marcel-decisions used (defaults from §13):**

- Q3 (hot-reload in production): ✓ implemented. Watcher runs unconditionally in `server.ts`; deploy = git-push not docker-rebuild remains viable.
- Q4 (watcher in API process): ✓ watcher lives in `apps/api/src/lib/template-watcher.ts`, single source of truth. Workers consume via Redis pub/sub.
- Q5 (malformed template-file handling): ✓ `syncOneTemplateFromFile()` throws on missing `TemplateDefinition`-shaped export; watcher's catch wrapper logs warn + skips, registry stays usable.

**Architectural deviations from spec narrative:**

- Spec §6.1 evaluated four cache-bust strategies and recommended (d) Remotion bundle re-call. That fits the RENDER pipeline, not the in-memory registry. Day 3 implements an orthogonal strategy (sibling dotfile copies) for the registry side. The Remotion bundle path remains as-is — when a re-rendered template lands, the existing `bundle()` call paths pick up the fresh module on next render (no integration needed; Remotion's bundler imports fresh each time it builds).
- Spec §5.3 sketched a `templates:changed` channel; the actual event payload schema adds `type: 'template.added' | 'template.changed' | 'template.removed'` discriminator + `fileHash: string | null` + `projectId: string | null` (Memory D5 multi-tenant). Added as a Zod schema in the same file as the publisher so the subscriber can `safeParse()` defensively.
- Spec §5.2 sketched no `ignored` regex; the cache-copy approach mandates one (`/(^|[/\\])\..+\.ts$/`) — without it the watcher fires on every cache-copy write, infinite-looping. Added to the watcher's chokidar options.

**Pending Marcel-Decision sites for Day 4+:**

- Q2 (preview modal vs page) — Day 5
- Q6 (auto-fill data source) — Day 5
- Q7 (cache preview renders) — Day 4
- Q8 (soft vs hard disable) — partial: unlink → soft DB-flag is implemented; UI surfacing deferred to Day 6
- Q10 (LRU ownership) — Spec 65.6

**Test deltas:** apps/api 364 pass / 6 skip / 0 fail (was 356 after Day 1-2). Workspace typecheck 0 errors across 26 packages.

**Known limitations (carry-overs to Day 4+):**

- The cache-copy dotfiles in `packages/social/src/templates/definitions/` accumulate during a session. Boot-time cleanup handles prior sessions but a long-running prod instance with frequent template edits accumulates files (small, ~few KB each, max ~50/day at Marcel's edit cadence). Day 6 should add a periodic sweep timer (~hourly) if this becomes an operational concern.
- The in-memory `templateRegistry.replace()` swap is not synchronized with active renders. A render that starts at T0 reading template-V1 and finishes at T2 after watcher swaps to V2 produces V1 output. Acceptable for V1 (render durations are seconds; edits during render are rare).
- Spec §10 promised per-template directory layout (`<key>/definition.ts`). Day 3 still uses the flat `definitions/<camelKey>.ts` layout. Day 6 or later: extend `relativeDefinitionPath` to check both shapes.

### Day 4 (2026-05-25, landed)

**Landed:**

- [`apps/api/src/lib/template-preview-service.ts`](../../apps/api/src/lib/template-preview-service.ts) — `previewTemplate()` returning a discriminated-union `PreviewResult | PreviewError`, `cleanupStalePreviewDirs()` for boot-time sweep of `apps/api/renders/preview/preview-*/` dirs, `resolveProjectIdBySlug()` route helper. Lazy-imports `@marketing-auto/social/render-server` so Remotion + headless Chrome stay off the API cold-boot path.
- [`apps/api/src/routes/projects/templates.ts`](../../apps/api/src/routes/projects/templates.ts) — `POST /:slug/templates/:templateKey/preview`. Zod body `{ sampleData: Record<string, unknown>, theme?, locale?, brandTokensOverride? }`. Exhaustive switch over `PreviewError` variants → 4xx/5xx mapping. Auth-gated.
- [`apps/api/src/server.ts`](../../apps/api/src/server.ts) — mount + boot-time `cleanupStalePreviewDirs({ maxAgeMs: 0 })`.
- **Uniformity fix:** `RenderServerFn` strict union + required `renderServerFn` field on `TemplateDefinition` ([packages/social/src/templates/types.ts](../../packages/social/src/templates/types.ts)). All 5 templates self-declare their render-server export ([comparisonGrid4](../../packages/social/src/templates/definitions/comparisonGrid4.ts), [comparisonGrid3](../../packages/social/src/templates/definitions/comparisonGrid3.ts), [verdictPerUseCase](../../packages/social/src/templates/definitions/verdictPerUseCase.ts), [singleToolSpotlight](../../packages/social/src/templates/definitions/singleToolSpotlight.ts), [proConVerdict](../../packages/social/src/templates/definitions/proConVerdict.ts)). Preview service reads `template.renderServerFn` — single source of truth, no parallel hardcoded map. TS catches mismatches at compile time.
- Tests: 7 service-level (3 error-paths + 2 `resolveProjectIdBySlug` + 2 `cleanupStalePreviewDirs`) + 4 HTTP route (401 / 404-project / 404-template / 400-zod) + **2 RUN_VISUAL-gated actual-Remotion-renders** (PNG-magic-byte + size + cached-bundle latency). apps/api 375 pass / 8 skip / 0 fail / 18.25s default-suite. Workspace typecheck 0 errors across 26 packages.

**Three discoveries that reshaped the implementation:**

1. **Bun caches dynamic-import by absolute file path, NOT URL** — same trap as Day 3, but Day 4 didn't trigger it (render-server module is loaded once and reused). The Day-3 root CLAUDE.md DO-NOT rule already covers it; mentioning here for cross-reference.
2. **`mockFixtures[X].input` is `buildInput`-output shape, NOT composition-input shape.** Initial Day-4 implementation tried to feed `fixture.input` (Grid4Context / ToolContext) straight to `renderComparisonGrid4` (expects `ComparisonGrid4Input` with `generated: { eyebrow, headline, tools[].verdictStrong, ... }`). Composition crashed at `g.eyebrow` undefined. **Fix:** dropped the fixture-path; required `sampleData` to be the full composition-input shape; Day-5 UI will build a convenience layer (§7.3 "auto-fill from last brief") on top of the raw API. The two shapes can't be auto-transformed without re-implementing each template's `render()` merge logic.
3. **`Bun.file(path).stat()` on a directory returns invalid `mtimeMs`.** `Bun.file` is file-only; for directory metadata use `node:fs/promises.stat()`. The Day-4 preview-dir cleanup needed this fix.

**Uniformity rationale (Marcel's "einheitlich"-question):**

Production-render uses `template.render(context)` which dynamic-imports `@marketing-auto/social/render-server` and calls e.g. `socialModule.renderComparisonGrid4(compositionInput)`. Day-4 preview uses `previewTemplate({sampleData})` which dynamic-imports the same module and dispatches via `template.renderServerFn`. Both end up at the same render-server function with the same composition-input shape. Before the uniformity fix, the dispatch name lived in TWO places: each template's own `render()` method (hardcoded) AND `RENDER_FN_MAP` in the preview service. After the fix, the field is on `TemplateDefinition` itself — adding a new template means one field + one render-server export, TS enforces the link. This is the Memory D125 "two-source enum gotcha" pattern, applied to function-name strings.

**Production-vs-Preview convergence path (still open for Day 6+):**

The remaining structural difference is that `template.render(context)` orchestrates `buildInput → generateContent → merge → renderServerFn`, while the preview path goes straight to `renderServerFn(sampleData)`. Day 5 UI populates sampleData from one of: (a) raw JSON editor, (b) a future `/preview-examples` endpoint that runs `buildInput` + `generateContent` server-side against a synthetic Article, (c) a copy from the last `template_renders` row of the same template. (a) and (c) are 1-day UI work; (b) bridges to the production orchestration but doesn't merge it.

**Marcel-decisions confirmed (defaults from §13):**

- Q7 (cache preview renders): default "No V1, ephemeral renders only" — implemented. Slides live under `apps/api/renders/preview/preview-<uuid>/`, swept at every API boot via `cleanupStalePreviewDirs({ maxAgeMs: 0 })`. No R2 upload, no DB row.

**Pending Marcel-Decision sites for Day 5+:**

- Q2 (preview modal vs page) — Day 5
- Q6 (auto-fill data source) — Day 5
- Q8 (soft vs hard disable) — partially deferred; soft is implemented via `is_active=false` sweep, UI surfacing still in Day 6.

**Known limitations (carry-overs):**

- `RUN_VISUAL=1` gate documented in `packages/social/CLAUDE.md` and now mirrored at `apps/api/test/lib/template-preview-render.test.ts`. CI should set `RUN_VISUAL=1` for full coverage; default fast-suite runs skip.
- No retry/timeout policy on Remotion render. If headless Chrome hangs, the request hangs. Day 6 polish could add a 30s wall-clock timeout via `AbortController`.

### Day 5 (2026-05-25, landed)

**Landed (frontend Settings-UI + backend GET + persistent rendering):**

Backend:
- [`apps/api/src/routes/projects/templates.ts`](../../apps/api/src/routes/projects/templates.ts) — new `GET /:slug/templates?formatType=` returns project-scoped + global rows merged via `listActiveTemplates()` from Day 1-2. Each row carries `scope: "global" | "project"` discriminator + `lastPreview: { previewUrls, renderedAt } | null` (filesystem-probed per row).
- [`apps/api/src/lib/template-preview-service.ts`](../../apps/api/src/lib/template-preview-service.ts) — persistence rewrite: `sessionId` is now deterministic `<projectSlug>/<templateKey>`; render writes to `<cwd>/renders/preview/<projectSlug>/<templateKey>/slide-NN.png`; re-renders `rm -rf` the dir before writing so leftover slides from a prior longer render don't leak. `PreviewResult.renderedAt: string` added. New `loadPersistedPreviewState({projectSlug, templateKey})` helper (filesystem probe). `cleanupStalePreviewDirs` renamed to `cleanupLegacyPreviewSessions` — now only sweeps Day-4 `preview-<uuid>/` legacy dirs, leaves the new persistent paths alone.
- Server boot now calls `cleanupLegacyPreviewSessions()` (not `cleanupStalePreviewDirs({maxAgeMs:0})`).

Frontend:
- [`apps/web/src/pages/settings/SettingsTemplatesPage.vue`](../../apps/web/src/pages/settings/SettingsTemplatesPage.vue) — list page with format-type + scope filters, template cards with thumbnail (from `lastPreview.previewUrls[0]` when set), "Preview" + stubbed "Disable" buttons. Cache-busted thumbnail URL `?v=<renderedAt>` so re-renders don't show stale PNGs from browser cache.
- [`apps/web/src/components/settings/TemplatePreviewModal.vue`](../../apps/web/src/components/settings/TemplatePreviewModal.vue) — `q-dialog` with split layout. Pre-loads `initialPreviewUrls` + `initialRenderedAt` props on open so the user sees the last persistent render immediately. Emits `rendered` event after a fresh render so the page can patch its `items[]` without a full refetch. "Zuletzt gerendert" hint above the slides (locale-aware `toLocaleString`).
- [`apps/web/src/composables/settings/useTemplatesList.ts`](../../apps/web/src/composables/settings/useTemplatesList.ts) — `MaybeRefOrGetter` inputs so Options-API callers can pass `() => this.projectSlug` directly.
- [`apps/web/src/composables/settings/usePreviewTemplate.ts`](../../apps/web/src/composables/settings/usePreviewTemplate.ts) — raw `fetch` (not `apiPost`) to preserve the structured `{ error, message }` 400 response.
- [`apps/web/src/lib/template-sample-data.ts`](../../apps/web/src/lib/template-sample-data.ts) — auto-fill examples for ALL 5 templates (comparison-grid-3, comparison-grid-4, verdict-per-use-case, single-tool-spotlight body-slide, pro-con-verdict). Adapted from `packages/social/scripts/visual-render-all.ts`.

Structural reshuffle:
- [`SettingsProjectPage.vue`](../../apps/web/src/pages/settings/SettingsProjectPage.vue) no longer mounts `TemplateOverridesSection` (Spec 57.3). That section moved to the new SettingsTemplatesPage so Templates is the single home for everything template-related (registry browser + preview + per-project overrides). Project settings stays focused on project basics.
- [`SettingsPage.vue`](../../apps/web/src/pages/settings/SettingsPage.vue) sidebar gets `"templates"` between brand-assets and credentials.
- [`router/index.ts`](../../apps/web/src/router/index.ts) new `settings-templates` route at `/projects/:slug/settings/templates`.
- i18n: new `settings.templates.*` namespace in [de/settings.ts](../../apps/web/src/i18n/de/settings.ts) + [en/settings.ts](../../apps/web/src/i18n/en/settings.ts) (~55 keys × 2 languages).

**Three discoveries that reshaped Day 5:**

1. **`q-page` requires a `q-layout` ancestor** — other settings sub-pages (Inventory, Project, Planner) use a plain `<div class="page-name">` because the parent `SettingsPage.vue` is just a grid wrapper, not a Quasar layout. Day-5 V1 used `<q-page>` and threw `QPage needs to be a deep child of QLayout` in the console on every mount. Fixed to match the existing convention. Worth noting because the same trap will hit any future settings sub-page that's copy-pasted from a layout-rooted page.
2. **`mockFixtures[X].input` ≠ composition-input shape** — Day-4 already documented this for the preview-service; Day 5 ran into it again when building auto-fill examples. The shape needed in the JSON editor is the FULL composition input (`{ slideIndex, locale, theme, generated: {...}, brandTokens? }`), NOT the `buildInput`-output shape stored in `TemplateDefinition.mockFixtures` (`{ tools: [...] }`-style Context). The hardcoded sample-data in `template-sample-data.ts` is the right level — copy from `visual-render-all.ts`, not from `mockFixtures`. Same gotcha will hit anyone wiring a new template's auto-fill: don't reach for `mockFixtures`, copy the composition-input shape from the canonical visual harness.
3. **Browser cache + deterministic URLs** — when re-render overwrites bytes at the same URL, the browser keeps showing the old PNG (cached). Cache-bust via `?v=<renderedAt>` query string on every `<img src>`. Done in both the card thumbnail (`cacheBustedThumb()` in the page) and the modal slide grid (`cacheBustedUrl()` in the modal). Worth a CLAUDE.md note for future persistent-render features.

**Marcel-decisions confirmed:**

- Q2 (preview modal vs page): ✓ modal implemented (split JSON-editor + preview grid in `q-dialog`).
- Q6 (auto-fill source): "last brief" deferred — V1 ships hardcoded examples per template (5/5 covered). Brief-data → composition-input transform is a separate spec because briefs don't carry composition shape; bridging needs server-side logic.
- Q7 (cache preview renders): UPDATED from default "No V1, ephemeral only" → **persistent on-disk per `(projectSlug, templateKey)`** per Marcel's request mid-session. Re-render overwrites at the same path. Browser cache-bust handles the URL→bytes mismatch. No R2 layer (filesystem is enough for V1; CDN sits in front of `/renders/*` in prod).

**Architectural deviations from spec narrative:**

- Spec §7.1 sketched "ephemeral renders, no persistence" (default Q7). Day 5 changed this to **persistent renders with re-render overwrite** based on Marcel's explicit request: "gerendert speichern dass man es persistent anschauen kann, neu rendern überschreibt dann". Practical reason: without persistence the user has to re-render every time they revisit the Settings page (5-15s wait per template). With persistence they see the last render instantly.
- Spec §7.3 sketched "auto-fill from last brief". Day 5 ships hardcoded sample-data per template instead. Briefs are stored in `topic_briefs.*` columns that don't map 1:1 to composition input shapes; bridging requires per-template transform logic that's out of scope for a Settings UI session. Hardcoded examples cover the "show me what a render looks like" use case fully.
- Spec §7.2 sketched a separate "Disable" button per card. Day 5 ships it as a stubbed `disabled` button with a `q-tooltip` flagging Day 6 — the PATCH `templates.is_active=false` endpoint isn't implemented yet (Spec 65.0 §13 Q8 "Soft DB flag" default still applies, just deferred by one day).

**Pending Marcel-Decision sites for Day 6+:**

- Q8 (soft vs hard disable): UI stub exists; PATCH endpoint + active-mark workflow is Day 6.

**Test deltas:** apps/api 378 pass / 8 skip / 1 fail (the fail is the pre-existing flaky `briefs/bulk-approve > briefIds.length = 500` from Spec 64.17 — 5000ms DB-batch timeout on local dev, unrelated to Day 5). Workspace typecheck 0 errors across 26 packages. The new GET endpoint has 4 dedicated route tests (auth gate, 404, list-happy-path verifies all 5 canonical keys appear, GIN-filter `formatType=use-case` narrows correctly).

**Known limitations (carry-overs):**

- Disable workflow is stubbed pending Day 6.
- No frontend automated tests for the new page/modal (the web app has no component-test infrastructure). Verified manually via Marcel's `/projects/<slug>/settings/templates` walk-through.
- Long-running Remotion render has no client-side timeout — if the API hangs, the modal shows "Rendering …" forever. Day 6 polish could add an `AbortController` with a 30s ceiling.

### Day 5 fix-up (2026-05-25, same day)

Three issues surfaced from Marcel's first end-to-end walk-through:

1. **Logos fehlten** — Settings-Cards + Modal-Preview zeigten nur die deterministic-initials-avatars (MJ / DE / SD blau-grün-violett-Kreise) statt echter Brand-Logos. Production renders go through `buildToolLookup()` which fills `iconSvg`; preview skipped that step. **Fix:** new `enrichToolIcons(renderInput, projectId)` in [`template-preview-service.ts`](../../apps/api/src/lib/template-preview-service.ts) walks the parsed sampleData for any object with a `slug` field (handles three shapes: `generated.tools[]` for grid-3/grid-4, `tools[]` top-level for verdict-per-use-case, `body.tool` singular for single-tool-spotlight, `generated.iconSlug` convenience for pro-con-verdict) and calls `resolveToolIcon(projectId, slug)` — same chain as production (`simple-icons → iconify → lobe-icons → deterministic avatar`). Resolved SVGs fill `iconSvg`; caller-supplied `iconSvg` always wins. Per-slug failures degrade silently (avatar fallback).

2. **`verdict-per-use-case` Render failed: "Cannot read properties of undefined (reading 'eyebrow')"** — sample-data shape was wrong. I had copied the legacy `verdict-cards/` directory shape (`tools[]` + `verdicts[]` at top level) when the correct schema is from `verdict-per-use-case/` (Spec 60.4 single-still composition): `generated.useCases[]` of `{ label, winnerName, icon* }` plus standard `headline`/`headlineEm`/`subline`/etc. Fixed in [`template-sample-data.ts`](../../apps/web/src/lib/template-sample-data.ts). Debug script verified all 4 (comparison-grid-3, verdict-per-use-case, single-tool-spotlight, pro-con-verdict) render cleanly with the corrected shapes.

3. **"Default-JSON sollte sinnvolleren Content haben" + "Die drei Schulen" Headline merkwürdig** — sample-data updated for all 5 templates with punchier marketing-style headlines (`"Die besten KI-Bildgeneratoren / Midjourney, DALL·E oder Stable Diffusion?"` statt der editorial `"Die drei Schulen"`). Tool entries now carry `slug` fields (`midjourney`, `openai`, `recraft`, `ideogram`, `stability`) so Issue #1's icon-resolver kicks in. The persistent-render path means a Marcel-side hard refresh + click-Render is needed before the new headlines visually overwrite the old PNG at `<projectSlug>/<templateKey>/slide-NN.png`.

4. **Marcel reported `single-tool-spotlight` "Render produced 0 slides" + `pro-con-verdict` "'includes' of undefined"** — both PASSED in my service-level debug script with the current sample-data. Likely a stale Vite HMR situation where the browser's old `template-sample-data.ts` carried fields that didn't match the composition schemas. Documented workaround: hard refresh (Cmd+Shift+R). No backend fix needed.

5. **State-leak across template switches in the Preview Modal** — when Marcel clicks Preview on Template A, then Close, then Preview on Template B, the Modal stays MOUNTED because the page's `v-if="activeTemplate"` is still true (Close only flips `previewOpen=false`). The modal's `data().jsonText` retains Template A's sample-data. The watch handler `if (!this.jsonText) onAutoFill()` skipped the re-fill because jsonText was non-empty — so Marcel rendered Template B with Template A's JSON shape → composition-schema mismatch → same `Cannot read properties of undefined (reading 'eyebrow')` error as point 2 above. **Fix:** new watcher on `templateKey` prop in [`TemplatePreviewModal.vue`](../../apps/web/src/components/settings/TemplatePreviewModal.vue) — resets jsonText + transient state when the parent swaps the prop, then re-runs onAutoFill if the modal is currently open. Pattern: any modal that pre-populates from a prop AND keeps state across opens needs a prop-change watcher to invalidate the state.

**.gitignore extended** — `/renders/preview/` and `/apps/api/renders/` added because the new persistent-render path writes PNGs there. Old block had only the visual-render-all `mock-*` paths.

**Layout "Content klebt oben" deferred** — the comparison-grid-3 (and probably the other compositions) use `gridTemplateRows: "auto auto 1fr auto"` with tool-cards stacked compactly at the top of the 1fr row, leaving a vertical void between cards + footer. This is a real composition-layout concern that ALL templates likely share. Out of scope for Day 5 because:
- Composition changes affect production renders, not just preview
- Spec 59.3.5 (Layout-Shift-Free) baseline tests would need re-baselining for each template
- The four affected compositions each need individual visual review

Flagged for Day-6 polish as a coordinated cross-template layout pass.

**Verified post-fix:**
- 15 preview tests pass / 2 RUN_VISUAL renders pass / workspace typecheck 0 errors across 26 packages
- Debug script confirms all 4 service-level renders work end-to-end with the new sample-data + auto-icon-resolve

### Day 6 (2026-05-25, landed)

Four polish tasks from §17 backlog shipped; cross-template layout pass deferred per Marcel ("den layoutpass schieben wir bis mehr templates da sind, eventuell großes einheitliches refactoring, nichts für jetzt").

**1. Soft-disable PATCH endpoint + UI activation (Q8 default)**
- New helper `setTemplateActive({projectId, templateKey, isActive})` in [packages/db/src/helpers/templates-write.ts](../../packages/db/src/helpers/templates-write.ts) — project-scoped row wins over global; falls back to global only if no project-scoped row exists. Returns discriminated `{updated, scope: "project" | "global" | null}`.
- New endpoint `PATCH /api/projects/:slug/templates/:templateKey` in [apps/api/src/routes/projects/templates.ts](../../apps/api/src/routes/projects/templates.ts) — Zod body `{isActive: boolean}`, returns 404 with `templateKey` field on `updated === 0`, 200 with `{templateKey, isActive, scope}` on success.
- `listActiveTemplates` extended with optional `includeInactive` flag (default false preserves pre-Day-6 contract). GET endpoint extended with `?includeInactive=true` via `z.coerce.boolean().optional()`.
- Partial unique index `templates_active_key_per_project_uniq WHERE is_active = TRUE` makes the flip structurally safe — flipping to `false` removes the row from the active-key uniqueness scope.
- New composable [`useTemplateActions.ts`](../../apps/web/src/composables/settings/useTemplateActions.ts) wraps the PATCH via raw fetch (not `apiPatch`) so the structured 404-body error stays available — returns discriminated `SetActiveSuccess | SetActiveFailure`.
- [SettingsTemplatesPage.vue](../../apps/web/src/pages/settings/SettingsTemplatesPage.vue) adds: third filter group with "Include Inactive" checkbox, inactive-badge chip in card header, dashed-border + 0.55-opacity visual state for inactive cards, Enable/Disable buttons (mutually exclusive via `v-if="tpl.isActive"`), `pendingTemplateKeys` Set (rebuilt on mutate per Vue reactivity rule) for in-flight click-disable, Quasar notify for success + structured error caption.
- i18n keys added under `settings.templates.filters.includeInactive` + `card.{enable, disable*Success, *Failed, inactiveBadge}` in DE+EN.

**2. Article snapshot wire-up — `articles.template_key` / `template_version`**

The two columns existed since Day 1-2 but went unwritten until Day 6. Now all 4 `template_renders` INSERT sites stamp the snapshot via the shared helper:
- New helper [`markArticleTemplateSnapshot({articleId, templateKey, templateVersion})`](../../packages/db/src/helpers/articles-write.ts) — pure write, updates `articles.template_key` + `template_version` + `updated_at`.
- Wired at 4 sites — [`social-generation.step.ts`](../../packages/pipelines/src/article/steps/social-generation.step.ts) (pipeline auto-render), [`social-posts.ts`](../../apps/api/src/routes/social-posts.ts) (generate-templates endpoint + re-render endpoint, latter fetches projectId fresh), [`admin.ts`](../../apps/api/src/routes/admin.ts) (admin manual render, uses `articleRow.projectId`).
- All 4 call sites wrap the snapshot write in try-catch with `log.warn` — best-effort, never breaks the render flow. Reflects Marcel-Decision §8 "current wins" — the article row always points at the most recently rendered template's file_hash.

**3. Periodic cache-copy + preview-dir sweep**

[apps/api/src/server.ts](../../apps/api/src/server.ts) adds a `setInterval` at hourly cadence calling `cleanupStaleCacheCopies` + `cleanupLegacyPreviewSessions` with `maxAgeMs = PERIODIC_SWEEP_MS = 3600000`. Separated from boot-time cleanup which uses `maxAgeMs: 0` to wipe legacy artifacts on every restart. `.unref()` on the interval prevents process-exit blocking.

**4. Remotion render abort controller (120s — Marcel pushed back on 30s)**

[apps/api/src/lib/template-preview-service.ts](../../apps/api/src/lib/template-preview-service.ts) wraps `renderFn(renderInput)` in `Promise.race` against a 120-second `setTimeout` with constant `RENDER_TIMEOUT_MS = 120_000`. 120s ceiling justified: covers Remotion's cold-bundle init + headless Chrome boot + LLM-bound sample-data renders. Original spec sketch said 30s; Marcel feedback: "ich würde den render timeout schon höher setzen der warum so eng?" — value chosen to give the slowest cold-start path generous headroom while still rejecting genuinely-stuck renders. Note: Remotion's `renderStill` doesn't reliably surface cancel signals across backends, so user-facing response returns within budget but Chrome processes may dangle briefly (cleaned up by OS lifecycle).

**Spec deviations §10 (5 entries):**
- Spec §17 didn't enumerate `includeInactive` query-param + the watcher widening on the composable — both added because the UI checkbox needs a server round-trip to surface the previously-filtered inactive rows.
- The original "PATCH endpoint" sketch hand-waved scope resolution; the actual contract is "project-scoped row wins over global, falls back to global only if no project-scoped row exists" — surfaced via the discriminated `scope` return field so the UI can show which scope was flipped.
- `useTemplateActions.ts` uses raw `fetch` instead of `apiPatch` because the 404 response body includes the structured `templateKey` field that `apiPatch` drops by throwing `Error(body.error)` only — same posture as `usePauseActions.ts` (Spec 62.6) for the 409 `impact` field.
- Snapshot write is wrapped at all 4 INSERT sites in try-catch + `log.warn` — Marcel-Decision §8 said the snapshot is best-effort, never block render. Re-render-from-admin uses `articleRow.projectId` (already in scope) instead of re-querying.
- Periodic sweep uses `.unref()` on the interval — without it the process would refuse to exit cleanly in tests / signal-handler graceful-shutdown paths.

**Verified:** workspace typecheck 0 errors across web + api + pipelines + db; apps/api 379 pass / 8 skip / 0 fail; packages/db 99 pass / 0 fail. Pre-existing `buildSystemPrompt > throws when project context is missing` failure in `packages/pipelines/test/prompts.test.ts` is environment drift (skills submodule not populated locally) — orthogonal to Day 6.

### Day 6 polish (2026-05-25, same day)

Marcel: "mach mal die inputs für settingstemplate noch passend zur app schicker". The Day-6 filter row shipped with native `<select>` + `<input type=checkbox>` elements; rebuilt with Quasar components to match the canonical settings-toolbar pattern from [`SettingsInventoryPage.vue`](../../apps/web/src/pages/settings/SettingsInventoryPage.vue:67) (3× `q-select dense outlined dark emit-value map-options` + 1× `q-checkbox dark dense`).

Concrete changes in [`SettingsTemplatesPage.vue`](../../apps/web/src/pages/settings/SettingsTemplatesPage.vue):
- Format-type select: `clearable` replaces the "All formats" sentinel option — clearing returns the model to `null`, identical semantics, cleaner option-list.
- Scope select: same `q-select` shape, options built via new `scopeSelectOptions` computed returning `Array<{label: string; value: "all" | "global" | "project"}>`.
- Include-Inactive toggle: `q-checkbox v-model="includeInactive" dark dense` replaces the bespoke `<input :checked @change>` pair — drops the `onToggleIncludeInactive` method since q-checkbox handles boolean two-way binding natively.
- Two new computeds: `formatTypeSelectOptions` (wraps the existing `formatTypeOptions` string list with `$t()`-resolved labels) + `scopeSelectOptions`.
- ~30 lines of native-control CSS dropped (`.filter-group`, `.filter-label`, `.filter-checkbox-label`, custom `accent-color` styling, etc.). Replaced with `.filter-select { min-width: 200px; }` so the longest format-type label ("tool-spotlight") doesn't truncate, plus a `.filter-checkbox { margin-left: auto; }` so the toggle right-aligns into the toolbar baseline.

Visual outcome: filter row is now byte-equivalent to the inventory page's toolbar — same outlined dark inputs, same dense baseline height, same hover/focus glow. No behavior change.

Verified: workspace typecheck 0 errors in `@marketing-auto/web`.

### Day 7+ (backlog, not started)

— cross-template layout pass to fill canvas height (deferred per Marcel until more templates land — see Day-5 fix-up §4; candidate for a unified design-token refactor across all 5 templates rather than piecemeal); PATCH endpoint test (auth gate, 404, success, scope discrimination).
