# Spec 42: Stabilization Pass

**Phase:** Hardening (zwischen Spec 41 und Welle 4)
**Estimated Effort:** 1-1.5 days (2 sessions)
**Dependencies:** Spec 41 (cost enforcement)
**Status:** Ready for implementation
**Recommended Model:** Sonnet 4.6 (mostly mechanical fixes + DB-setup; no novel architecture)

---

## Goal

Resolve every finding from the Stabilization Report (2026-05-07). Restore the codebase to a clean state where:
- `bun run typecheck` exits 0 across all workspaces
- `bun run lint` has only intentional violations
- `bun test` runs successfully (after DB setup)
- Cost-enforcement validation can actually be performed (Phase 5 of stabilization test)

This spec is structured as a **linear checklist**. Each section is a self-contained fix with a verification step. Sections are sorted by **dependency order** — DB setup before code fixes, code fixes before re-validation.

The ONE finding deferred to Spec 40 (Push Notifications) is F-008 (Web Push for cost-limit alerts). Documented in Section F but not implemented here.

## Non-Goals

- **No new features** — strictly bug fixes from the stabilization report
- **No refactoring beyond what's necessary** to fix the findings
- **No Spec 40 work** (Push Notifications)
- **No performance optimization** beyond F-011 (bundle warning)

## Detailed Implementation

### Section A — Local Dev Environment Setup (DO FIRST)

The stabilization report's Critical finding F-001 was a setup issue: PostgreSQL `marketing_auto` role didn't exist on the test machine. Without DB, ~75% of tests can't run and Spec 41 cost-enforcement validation is impossible.

This section creates a repeatable local-dev setup that future contributors / fresh machines can use.

#### A.1 Provision PostgreSQL role + database

Create `packages/db/scripts/setup-local-dev.sh`:

```bash
#!/usr/bin/env bash
# Local development PostgreSQL setup for marketing-automation platform.
# Idempotent — safe to run multiple times.
#
# Prerequisites:
#   - PostgreSQL 18 running (e.g. `brew services start postgresql@18`)
#   - psql available on PATH
#
# Reads DB name and credentials from .env at repo root.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found. Copy .env.example to .env first."
  exit 1
fi

# Source .env (basic parsing — assumes KEY=VALUE format, no spaces)
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL not set in .env"
  exit 1
fi

# Parse DATABASE_URL: postgres://USER:PASS@HOST:PORT/DBNAME
# This regex covers the common form. Adjust if your URL has more components.
if [[ "$DATABASE_URL" =~ postgres://([^:]+):([^@]+)@([^:/]+):?([0-9]*)/(.+) ]]; then
  DB_USER="${BASH_REMATCH[1]}"
  DB_PASS="${BASH_REMATCH[2]}"
  DB_HOST="${BASH_REMATCH[3]}"
  DB_PORT="${BASH_REMATCH[4]:-5432}"
  DB_NAME="${BASH_REMATCH[5]%%\?*}"  # strip query params
else
  echo "ERROR: Could not parse DATABASE_URL: $DATABASE_URL"
  exit 1
fi

echo "Setup target:"
echo "  User:     $DB_USER"
echo "  Database: $DB_NAME"
echo "  Host:     $DB_HOST:$DB_PORT"
echo ""

# Create role if missing
ROLE_EXISTS=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$(whoami)" postgres -tAc \
  "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" 2>/dev/null || echo "")

if [[ -z "$ROLE_EXISTS" ]]; then
  echo "Creating role $DB_USER..."
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$(whoami)" postgres -c \
    "CREATE ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASS' CREATEDB"
else
  echo "Role $DB_USER already exists, skipping creation."
fi

# Create database if missing
DB_EXISTS=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$(whoami)" postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" 2>/dev/null || echo "")

if [[ -z "$DB_EXISTS" ]]; then
  echo "Creating database $DB_NAME owned by $DB_USER..."
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$(whoami)" postgres -c \
    "CREATE DATABASE $DB_NAME OWNER $DB_USER"
else
  echo "Database $DB_NAME already exists, skipping creation."
fi

# Grant + extensions
psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;" || true
psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS vector;" || \
  echo "WARNING: vector extension not available. Install pgvector for Spec 24 (internal linking) to work."

echo ""
echo "✓ PostgreSQL setup complete."
echo ""
echo "Next steps:"
echo "  1. Run migrations:        bun run db:migrate"
echo "  2. Apply cost defaults:   bun run apps/api/src/scripts/apply-cost-defaults.ts"
echo "  3. Backfill pillars:      bun run apps/api/src/scripts/backfill-pillar-articles.ts"
echo "  4. Verify with tests:     bun test"
```

Make executable:
```bash
chmod +x packages/db/scripts/setup-local-dev.sh
```

Add a root-level npm script in `package.json`:
```json
{
  "scripts": {
    "db:setup": "bash packages/db/scripts/setup-local-dev.sh",
    "db:migrate": "cd packages/db && bunx drizzle-kit migrate --env-file ../../.env",
    "db:check": "cd packages/db && bunx drizzle-kit check --env-file ../../.env",
    "db:studio": "cd packages/db && bunx drizzle-kit studio --env-file ../../.env"
  }
}
```

#### A.2 Fix `packages/db/package.json` env-file reference (F-010)

Update `packages/db/package.json` so the local scripts work without --env-file flag from inside the workspace:

```json
{
  "scripts": {
    "check": "drizzle-kit check --env-file ../../.env",
    "migrate": "drizzle-kit migrate --env-file ../../.env",
    "push": "drizzle-kit push --env-file ../../.env",
    "studio": "drizzle-kit studio --env-file ../../.env",
    "generate": "drizzle-kit generate --env-file ../../.env"
  }
}
```

#### A.3 Run setup + migrations (one-time)

```bash
bun run db:setup
bun run db:migrate
bun run apps/api/src/scripts/apply-cost-defaults.ts
bun run apps/api/src/scripts/backfill-pillar-articles.ts
```

Verify:
```bash
psql "$DATABASE_URL" -c "\\dt"  # should list ~25 tables
psql "$DATABASE_URL" -c "SELECT count(*) FROM projects;"  # 1+ if you have ki-wissensraum imported
psql "$DATABASE_URL" -c "SELECT slug, cost_limits FROM projects;"  # should show non-empty cost_limits
```

#### A.4 Document in CLAUDE.md

Add to `apps/api/CLAUDE.md` or root `CLAUDE.md`:

```markdown
## Local DB Setup

Fresh machine? Run:
\`\`\`bash
bun run db:setup    # provisions role + database
bun run db:migrate  # applies all migrations
bun run apps/api/src/scripts/apply-cost-defaults.ts  # applies cost limits to existing projects
\`\`\`

Verify with `bun test` from any package — DB-touching tests should pass.

## Env-file gotcha

Drizzle-kit subcommands (check, migrate, push, studio, generate) need `--env-file ../../.env`
when run from `packages/db`. The npm scripts in packages/db/package.json have this baked in,
so always use `bun run check` (not `bunx drizzle-kit check`).
```

#### A.5 Verification

```bash
# All four should work after setup:
bun run db:check                                       # exits 0
bun test                                                # most tests pass (no role-missing errors)
psql "$DATABASE_URL" -c "SELECT count(*) FROM project_pause_states;"  # exists, 0 rows
```

If any of these fail, do not proceed to Section B until fixed. Stabilization-test Phase 5 depends on this.

---

### Section B — Critical Code Fixes

#### B.1 (F-005): `/api/*` catch-all returning 401 instead of 404

**Problem:** `app.route("/api", articleRoutes)` mounts article routes at the API root. Combined with `articleRoutes.use(requireAuth)`, every undefined `/api/*` path hits the auth middleware first → 401.

**File:** `apps/api/src/server.ts` (around line 36)

**Patch:**

Find:
```typescript
app.route("/api", articleRoutes);
```

Replace with:
```typescript
app.route("/api/articles", articleRoutes);
```

Then in `apps/api/src/routes/articles.ts`, remove the `/articles` prefix from each route definition (they're now relative to the mount point):

```typescript
// Before:
articleRoutes.get('/articles', async (c) => {...});
articleRoutes.get('/articles/:id', async (c) => {...});
articleRoutes.post('/articles/:id/generate-outline', async (c) => {...});

// After (paths are relative to mount):
articleRoutes.get('/', async (c) => {...});
articleRoutes.get('/:id', async (c) => {...});
articleRoutes.post('/:id/generate-outline', async (c) => {...});
```

**Important:** the `/api/articles?projectSlug=foo` GET endpoint stays the same from the client's perspective — only the internal mounting changes. Check all routes in `articles.ts` that previously had `/articles/...` paths and strip the prefix.

**Audit:** Look for OTHER catch-all-mount-on-broad-prefix issues across the codebase:
```bash
grep -n "app.route" apps/api/src/server.ts
```

For each `app.route("/api", X)` or `app.route("/api/v1", X)` etc.: verify that X's routes don't shadow other prefix-specific routes. The fix is the same — mount on a specific prefix.

**Verification:**
```bash
# Before: 401
# After:  404
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3050/api/does-not-exist
# Expected: 404

curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3050/api/articles?projectSlug=ki-wissensraum -H "Cookie: ..."
# Expected: 200 (or 401 if no cookie — but NOT before reaching the route)

curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3050/api/auth/wrong-path
# Expected: 404
```

#### B.2 (F-002): `count` destructure trap in pillars.ts and clusters.ts

**Problem:** Drizzle types `select(...).from(...).where(...)` as `Result[]` (array). Destructuring `const [{ count }] = ...` triggers TS2339 because the first element could be `undefined`.

**File 1:** `apps/api/src/routes/clusters.ts:181`

Find:
```typescript
const [{ count }] = await db.select({
  count: sql<number>`count(*)::int`,
}).from(articles).where(eq(articles.clusterId, id));
```

Replace with:
```typescript
const result = await db.select({
  count: sql<number>`count(*)::int`,
}).from(articles).where(eq(articles.clusterId, id));
const count = result[0]?.count ?? 0;
```

**File 2:** `apps/api/src/routes/pillars.ts:119`

Find:
```typescript
const [{ count }] = await db.select({
  count: sql<number>`count(*)::int`,
}).from(clusters).where(eq(clusters.pillarId, id));
```

Replace with:
```typescript
const result = await db.select({
  count: sql<number>`count(*)::int`,
}).from(clusters).where(eq(clusters.pillarId, id));
const count = result[0]?.count ?? 0;
```

**Audit:** Find all similar patterns:
```bash
grep -rn "const \[{.*count.*}\]" apps/api/src/routes/
grep -rn "const \[{.*}\] = await db" apps/api/src/routes/
```

Fix any other matches with the same `result[0]?.field ?? defaultValue` pattern.

**Verification:**
```bash
bun run typecheck  # no TS2339 errors in clusters.ts or pillars.ts
```

#### B.3 (F-003): `exactOptionalPropertyTypes` violation in pillars store

**Problem:** Optional chaining `body.data?.clusterCount` produces `number | undefined`. Assigning to a `clusterCount?: number` property violates strict optional typing.

**File:** `apps/web/src/stores/pillars.ts:68`

Find:
```typescript
async delete(slug: string, id: string): Promise<{ deleted: boolean; clusterCount?: number }> {
  try {
    await api.delete(`/pillars/${id}`);
    await this.fetchForProject(slug);
    return { deleted: true };
  } catch (e) {
    if (e instanceof HttpError && e.body && typeof e.body === 'object' && 'error' in e.body) {
      const body = e.body as { error: string; data?: { clusterCount: number } };
      if (body.error === 'pillar_has_clusters') {
        return { deleted: false, clusterCount: body.data?.clusterCount };
      }
    }
    throw e;
  }
},
```

Replace with:
```typescript
async delete(slug: string, id: string): Promise<{ deleted: boolean; clusterCount?: number }> {
  try {
    await api.delete(`/pillars/${id}`);
    await this.fetchForProject(slug);
    return { deleted: true };
  } catch (e) {
    if (e instanceof HttpError && e.body && typeof e.body === 'object' && 'error' in e.body) {
      const body = e.body as { error: string; data?: { clusterCount: number } };
      if (body.error === 'pillar_has_clusters') {
        // Conditionally include clusterCount to satisfy exactOptionalPropertyTypes
        const clusterCount = body.data?.clusterCount;
        return clusterCount !== undefined
          ? { deleted: false, clusterCount }
          : { deleted: false };
      }
    }
    throw e;
  }
},
```

**Verification:**
```bash
cd apps/web && bun run typecheck  # no TS2375 in pillars.ts
```

#### B.4 (F-004): Spec 37 Decision 10 — `availablePillars` from cluster scan

**Problem:** `ClusterCard.vue` derives `availablePillars` from `allClusters`, missing empty pillars (no clusters yet) as move targets.

**Step 1:** Update `ClusterCard.vue` to accept `allPillars` prop.

**File:** `apps/web/src/components/clusters/ClusterCard.vue`

Find the `props` block:
```typescript
props: {
  cluster: { type: Object as PropType<Cluster>, required: true },
  allClusters: { type: Array as PropType<Cluster[]>, required: true },
  isFirst: { type: Boolean, default: false },
  isLast: { type: Boolean, default: false },
},
```

Replace with:
```typescript
props: {
  cluster: { type: Object as PropType<Cluster>, required: true },
  allClusters: { type: Array as PropType<Cluster[]>, required: true },
  allPillars: { type: Array as PropType<Pillar[]>, required: true },
  isFirst: { type: Boolean, default: false },
  isLast: { type: Boolean, default: false },
},
```

Add the import for `Pillar`:
```typescript
import type { Pillar } from 'src/stores/pillars';
```

Replace the `availablePillars` computed:
```typescript
// Old:
availablePillars() {
  const otherPillarIds = new Set<string>();
  const result: Array<{ id: string; name: string }> = [];
  for (const c of this.allClusters) {
    if (c.pillarId === this.cluster.pillarId) continue;
    if (otherPillarIds.has(c.pillarId)) continue;
    otherPillarIds.add(c.pillarId);
    if (c.pillarName) result.push({ id: c.pillarId, name: c.pillarName });
  }
  return result;
},

// New:
availablePillars(): Pillar[] {
  return this.allPillars.filter((p) => p.id !== this.cluster.pillarId);
},
```

The template usage stays the same (`v-for="otherPillar in availablePillars"`) since `Pillar` has `id` and `name` already.

**Step 2:** Update `PillarSection.vue` to forward the prop.

**File:** `apps/web/src/components/clusters/PillarSection.vue`

Find the `props` block:
```typescript
props: {
  pillar: { type: Object as PropType<Pillar>, required: true },
  clusters: { type: Array as PropType<Cluster[]>, required: true },
  allClusters: { type: Array as PropType<Cluster[]>, required: true },
  isFirst: { type: Boolean, default: false },
  isLast: { type: Boolean, default: false },
  slug: { type: String, required: true },
},
```

Add `allPillars`:
```typescript
props: {
  pillar: { type: Object as PropType<Pillar>, required: true },
  clusters: { type: Array as PropType<Cluster[]>, required: true },
  allClusters: { type: Array as PropType<Cluster[]>, required: true },
  allPillars: { type: Array as PropType<Pillar[]>, required: true },
  isFirst: { type: Boolean, default: false },
  isLast: { type: Boolean, default: false },
  slug: { type: String, required: true },
},
```

Update the `<ClusterCard>` template invocation:
```vue
<ClusterCard
  v-for="(cluster, idx) in clusters"
  :key="cluster.id"
  :cluster="cluster"
  :all-clusters="allClusters"
  :all-pillars="allPillars"
  :is-first="idx === 0"
  :is-last="idx === clusters.length - 1"
  @rename="(p) => $emit('cluster-rename', p)"
  ...
/>
```

**Step 3:** Update `ClustersManagementPage.vue` to pass `allPillars` to `PillarSection`.

**File:** `apps/web/src/pages/ClustersManagementPage.vue`

Find the `<PillarSection>` template invocation:
```vue
<PillarSection
  v-for="(pillar, idx) in pillars"
  :key="pillar.id"
  :pillar="pillar"
  :clusters="clustersByPillar[pillar.id] ?? []"
  :all-clusters="allClusters"
  :is-first="idx === 0"
  :is-last="idx === pillars.length - 1"
  :slug="slug"
  ...
/>
```

Add `:all-pillars="pillars"`:
```vue
<PillarSection
  v-for="(pillar, idx) in pillars"
  :key="pillar.id"
  :pillar="pillar"
  :clusters="clustersByPillar[pillar.id] ?? []"
  :all-clusters="allClusters"
  :all-pillars="pillars"
  :is-first="idx === 0"
  :is-last="idx === pillars.length - 1"
  :slug="slug"
  ...
/>
```

**Verification:**
1. `bun run typecheck` — no errors
2. Manual: Create a new empty pillar via UI. Open a cluster's "Change Pillar" submenu. Verify the new empty pillar is listed.

---

### Section C — Cost-Enforcement Completeness (F-007)

**Problem:** Pipeline-step adapter calls use operation-strings like `article-outline`, `voice-questions-generation`, etc. — none of which exist in `COST_ESTIMATES_EUR`. `estimateCostEur()` falls back to 0, so adapter-level cost checks always pass. Only the route-level checks (which use the spec-41 names) actually enforce limits.

**Solution:** Single Source of Truth for operation strings + populate estimates for all existing operations.

#### C.1 Create operation-constants module

Create `packages/cost-tracker/src/operations.ts`:

```typescript
/**
 * Single source of truth for cost operation identifiers.
 *
 * Use these constants in:
 *   - Pipeline step adapter calls (operation: COST_OPS.X)
 *   - Trigger-helper costEstimate (operation: COST_OPS.X)
 *   - Cost log inserts (operation: COST_OPS.X)
 *
 * Adding a new operation:
 *   1. Add a constant here
 *   2. Add an estimate to COST_ESTIMATES_EUR in estimates.ts
 *   3. Use the constant — never hard-code the string
 */

export const COST_OPS = {
  // === Article generation pipeline ===
  ARTICLE_OUTLINE: 'article-outline',
  ARTICLE_DRAFT: 'article-draft',
  ARTICLE_SELF_REVIEW: 'article-self-review',

  // === Cold-start phase 1: Voice ===
  COLD_START_VOICE_QUESTIONS: 'voice-questions-generation',
  COLD_START_VOICE_SYNTHESIS: 'voice-synthesis',

  // === Cold-start phase 2: Competitor analysis ===
  COLD_START_COMPETITOR_QUESTIONS: 'competitor-questions-generation',
  COLD_START_COMPETITOR_ANALYSIS: 'competitor-analysis',

  // === Cold-start phase 3: Cluster plan ===
  COLD_START_CLUSTER_CANDIDATES: 'cluster-candidates-generation',
  COLD_START_CLUSTER_SYNTHESIS: 'cluster-plan-synthesis',
  COLD_START_CLUSTER_KEYWORDS: 'cluster-keyword-overview',

  // === Cold-start phase 4: Cornerstone ===
  COLD_START_CORNERSTONE_SPECS: 'cornerstone-specs-generation',

  // === Cold-start phase 5: Go-live ===
  COLD_START_GO_LIVE_CHECKLIST: 'cold-start-go-live-checklist',

  // === Schema extension ===
  SCHEMA_RICH_DETECTION: 'schema-rich-detection',
  SCHEMA_FAQ_BUILD: 'schema-faq-build',
  SCHEMA_HOWTO_BUILD: 'schema-howto-build',

  // === Internal linking (Spec 24) ===
  INTERNAL_LINK_ANALYSIS: 'internal-link-analysis',
  INTERNAL_LINK_REBUILD: 'internal-link-rebuild',

  // === Hero image (Replicate) ===
  HERO_IMAGE: 'hero-image-generation',

  // === DataForSEO ===
  DATAFORSEO_SERP_ANALYSIS: 'serp-analysis',
  DATAFORSEO_KEYWORD_RESEARCH: 'keyword-research',
  DATAFORSEO_BACKLINK_CHECK: 'backlink-check',

  // === Briefing (Spec 03) ===
  BRIEFING_GENERATION: 'briefing-generation',

  // === SMTP ===
  SMTP_MAGIC_LINK: 'magic-link-email',
  SMTP_BRIEFING: 'briefing-email',
} as const;

export type CostOp = typeof COST_OPS[keyof typeof COST_OPS];

/**
 * Set of all valid operation strings — used at runtime to validate that an unknown
 * operation isn't being logged.
 */
export const VALID_COST_OPS = new Set<string>(Object.values(COST_OPS));
```

#### C.2 Update `COST_ESTIMATES_EUR`

Update `packages/cost-tracker/src/estimates.ts`:

```typescript
import { COST_OPS, type CostOp } from './operations';

export const COST_ESTIMATES_EUR: Record<string, Partial<Record<CostOp, number>>> = {
  anthropic: {
    [COST_OPS.ARTICLE_OUTLINE]: 0.30,
    [COST_OPS.ARTICLE_DRAFT]: 1.50,
    [COST_OPS.ARTICLE_SELF_REVIEW]: 0.80,

    [COST_OPS.COLD_START_VOICE_QUESTIONS]: 0.10,
    [COST_OPS.COLD_START_VOICE_SYNTHESIS]: 0.20,

    [COST_OPS.COLD_START_COMPETITOR_QUESTIONS]: 0.05,

    [COST_OPS.COLD_START_CLUSTER_CANDIDATES]: 0.20,
    [COST_OPS.COLD_START_CLUSTER_SYNTHESIS]: 0.30,
    [COST_OPS.COLD_START_CLUSTER_KEYWORDS]: 0.15,

    [COST_OPS.COLD_START_CORNERSTONE_SPECS]: 0.40,
    [COST_OPS.COLD_START_GO_LIVE_CHECKLIST]: 0.10,

    [COST_OPS.SCHEMA_RICH_DETECTION]: 0.10,
    [COST_OPS.SCHEMA_FAQ_BUILD]: 0.10,
    [COST_OPS.SCHEMA_HOWTO_BUILD]: 0.10,

    [COST_OPS.INTERNAL_LINK_ANALYSIS]: 0.30,
    [COST_OPS.INTERNAL_LINK_REBUILD]: 0.20,

    [COST_OPS.BRIEFING_GENERATION]: 0.10,
  },
  replicate: {
    [COST_OPS.HERO_IMAGE]: 0.10,
  },
  dataforseo: {
    [COST_OPS.DATAFORSEO_SERP_ANALYSIS]: 0.20,
    [COST_OPS.DATAFORSEO_KEYWORD_RESEARCH]: 0.05,
    [COST_OPS.DATAFORSEO_BACKLINK_CHECK]: 0.30,
    [COST_OPS.COLD_START_COMPETITOR_ANALYSIS]: 0.20, // per competitor
  },
  smtp: {
    [COST_OPS.SMTP_MAGIC_LINK]: 0.001,
    [COST_OPS.SMTP_BRIEFING]: 0.001,
  },
};

/**
 * Returns the estimated EUR cost for a service+operation pair.
 * Returns 0 (with warning) if the operation is unknown — callers should treat
 * this as a "no enforcement" condition for that call.
 */
export function estimateCostEur(service: string, operation: string, multiplier = 1): number {
  const serviceEstimates = COST_ESTIMATES_EUR[service];
  if (!serviceEstimates) {
    console.warn(`[cost-estimates] Unknown service: ${service}`);
    return 0;
  }

  const baseEur = serviceEstimates[operation as CostOp];
  if (baseEur === undefined) {
    console.warn(
      `[cost-estimates] No estimate for ${service}.${operation}. ` +
      `Cost check will pass with 0 EUR. Add to operations.ts + estimates.ts.`,
    );
    return 0;
  }

  return baseEur * multiplier;
}
```

#### C.3 Update all pipeline-step adapter calls to use constants

For each file listed in F-007, change the `operation:` string-literal to a `COST_OPS` constant.

**File:** `packages/pipelines/src/article/steps/outline.ts:90`

Find:
```typescript
operation: "article-outline",
```

Replace with:
```typescript
operation: COST_OPS.ARTICLE_OUTLINE,
```

Add import at top of file:
```typescript
import { COST_OPS } from '@marketing-auto/cost-tracker';
```

(Adjust the import path to match your actual package export structure.)

Apply the same pattern to all files from F-007:

| File | Old string | New constant |
|---|---|---|
| `packages/pipelines/src/article/steps/outline.ts:90` | `"article-outline"` | `COST_OPS.ARTICLE_OUTLINE` |
| `packages/pipelines/src/article/steps/draft.ts:90` | `"article-draft"` | `COST_OPS.ARTICLE_DRAFT` |
| `packages/pipelines/src/article/steps/self-review.ts:84` | `"article-self-review"` | `COST_OPS.ARTICLE_SELF_REVIEW` |
| `packages/pipelines/src/cold-start/01-voice-refinement/steps.ts:67` | `"voice-questions-generation"` | `COST_OPS.COLD_START_VOICE_QUESTIONS` |
| `packages/pipelines/src/cold-start/01-voice-refinement/steps.ts:134` | `"voice-synthesis"` | `COST_OPS.COLD_START_VOICE_SYNTHESIS` |
| `packages/pipelines/src/cold-start/02-competitor-analysis/steps.ts:82` | (whatever is there) | `COST_OPS.COLD_START_COMPETITOR_QUESTIONS` |
| `packages/pipelines/src/cold-start/02-competitor-analysis/steps.ts:249` | (whatever is there) | `COST_OPS.COLD_START_COMPETITOR_ANALYSIS` |
| `packages/pipelines/src/cold-start/03-cluster-plan/steps.ts:129` | `"cluster-candidates-generation"` | `COST_OPS.COLD_START_CLUSTER_CANDIDATES` |
| `packages/pipelines/src/cold-start/03-cluster-plan/steps.ts:387` | `"cluster-plan-synthesis"` or `"cluster-keyword-overview"` | `COST_OPS.COLD_START_CLUSTER_SYNTHESIS` or `COST_OPS.COLD_START_CLUSTER_KEYWORDS` |
| `packages/pipelines/src/cold-start/04-cornerstone-list/steps.ts:106` | `"cornerstone-specs-generation"` | `COST_OPS.COLD_START_CORNERSTONE_SPECS` |
| `packages/pipelines/src/schema-extension/steps/detect-rich-types.ts:76` | `"schema-rich-detection"` | `COST_OPS.SCHEMA_RICH_DETECTION` |

**Important:** the `cluster-plan/steps.ts:387` line — the report wasn't certain whether it's `cluster-plan-synthesis` or `cluster-keyword-overview`. The implementer should `cat` the file and pick the correct constant based on what the function does (synthesis vs keyword overview).

#### C.4 Update trigger-helpers.ts to use constants

`apps/api/src/routes/_lib/trigger-helpers.ts` and the article + cold-start trigger endpoints currently use string literals like `'outline-generation'`. These were the **old** Spec 41 names that didn't match anything in the codebase. Change them to use `COST_OPS` constants matching the actual pipeline-step names.

For each trigger endpoint in `apps/api/src/routes/articles.ts`:

```typescript
// Before:
costEstimate: { service: 'anthropic', operation: 'outline-generation' },

// After:
costEstimate: { service: 'anthropic', operation: COST_OPS.ARTICLE_OUTLINE },
```

Apply for all five article triggers:
- `generate-outline` → `COST_OPS.ARTICLE_OUTLINE`
- `generate-draft` → `COST_OPS.ARTICLE_DRAFT`
- `sync` → no Anthropic call, but Astro repo write — typically free, omit costEstimate
- `validate-pagespeed` → no API cost; omit
- `extend-schema` → `COST_OPS.SCHEMA_RICH_DETECTION` (or the multi-call path needs special handling — see below)

For cold-start triggers, similar mapping per phase.

**Edge case — extend-schema:** the schema-extension pipeline can make multiple Anthropic calls (rich-detection, FAQ-build, HowTo-build). The trigger-time cost estimate is a worst-case sum. For the route-level pre-flight check, use the sum of estimates for all three operations:

```typescript
// In the trigger endpoint:
const schemaCostEstimate =
  estimateCostEur('anthropic', COST_OPS.SCHEMA_RICH_DETECTION) +
  estimateCostEur('anthropic', COST_OPS.SCHEMA_FAQ_BUILD) +
  estimateCostEur('anthropic', COST_OPS.SCHEMA_HOWTO_BUILD);

const result = await triggerWithPreRunId({
  // ...
  costEstimate: { service: 'anthropic', operation: COST_OPS.SCHEMA_RICH_DETECTION, multiplier: schemaCostEstimate / estimateCostEur('anthropic', COST_OPS.SCHEMA_RICH_DETECTION) },
  // ... or refactor to accept a raw estimatedCostEur instead of operation+multiplier
});
```

A cleaner approach: extend `triggerWithPreRunId` to accept either `costEstimate: {service, operation}` (uses estimate lookup) OR `costEstimateEur: number` (raw value):

```typescript
export interface TriggerOptions {
  // ...
  costEstimate?:
    | { service: string; operation: string; multiplier?: number }
    | { service: string; estimatedCostEur: number };  // explicit override
}

// In the function body:
if (opts.costEstimate) {
  const cost = 'estimatedCostEur' in opts.costEstimate
    ? opts.costEstimate.estimatedCostEur
    : estimateCostEur(opts.costEstimate.service, opts.costEstimate.operation, opts.costEstimate.multiplier ?? 1);
  // ... call checkCostBudget with cost
}
```

For the schema-extension trigger:
```typescript
costEstimate: { service: 'anthropic', estimatedCostEur: 0.30 }, // 0.10 + 0.10 + 0.10
```

#### C.5 Optional safety: warn-on-unknown-operation guard

In `packages/cost-tracker/src/tracker.ts` (the cost-logging entry point), add a runtime guard:

```typescript
import { VALID_COST_OPS } from './operations';

export async function logCost(opts: {
  projectId: string;
  service: string;
  operation: string;
  costEur: number;
  // ...
}): Promise<void> {
  if (!VALID_COST_OPS.has(opts.operation)) {
    console.warn(
      `[cost-tracker] Unknown operation '${opts.operation}' logged. ` +
      `Add it to operations.ts to enable cost-estimate enforcement for this op.`,
    );
  }
  // ... existing insert logic
}
```

Doesn't break anything — just makes the issue visible in logs. CI / lint could later be configured to fail on these warnings.

#### C.6 Verification

```bash
# 1. No more "no estimate found" warnings during a real (or mocked) Cold-Start run
bun test                                              # all tests pass
grep -rn "operation:.*['\"]" packages/pipelines/src/  # no string-literal operations left

# 2. Run cost coverage check from stabilization-test prompt:
grep -rh "logCost\|cost_logs" packages/ apps/ --include="*.ts" \
  | grep -oE "operation:\s*[A-Z_]+\.[A-Z_]+" \
  | sort -u > /tmp/operations-used.txt
# All entries should match COST_OPS.X — no string literals
```

---

### Section D — Hygiene Fixes

#### D.1 (F-006): Remove unused `ValidService` type

**File:** `apps/api/src/routes/system.ts:120`

Find:
```typescript
type ValidService = typeof validServices[number];
```

Either delete this line, OR use it in a parameter declaration further down. If `validServices` is referenced elsewhere as a runtime check, just deleting is correct.

**Verification:**
```bash
bun run typecheck  # no TS6196 in system.ts
```

#### D.2 (F-009/F-012): Run `biome check --fix` for auto-fixable issues

```bash
# Auto-fix import ordering, formatting, etc.
bunx @biomejs/biome check --write .
```

After this, manually fix the remaining non-auto-fixable violations:

**File:** `apps/api/src/routes/_lib/trigger-helpers.ts:23`

`noExplicitAny` — `enqueue: (input: any)`:

Replace `any` with a more specific type:
```typescript
enqueue: (input: { preRunId: string; projectId: string; [key: string]: unknown }) => Promise<{ jobId: string }>,
```

**File:** `apps/api/src/routes/_lib/trigger-helpers.ts:76,147` and `apps/api/src/routes/clusters.ts:232,240`

`noNonNullAssertion` — `neighbour[0]!`:

Replace with safe access. Example for `neighbour[0]!`:
```typescript
// Before:
const targetPos = neighbour[0]!.position;

// After:
const first = neighbour[0];
if (!first) {
  // Should be unreachable due to earlier length check, but type-system needs it
  return c.json({ ok: true, data: { changed: false } });
}
const targetPos = first.position;
```

**File:** `apps/api/src/lib/system-service.ts:73`

`useNumberNamespace` — `parseInt`:

Replace:
```typescript
// Before:
parseInt(x, 10)

// After:
Number.parseInt(x, 10)
```

**Verification:**
```bash
bun run lint  # exits 0 or only intentional warnings remain
```

#### D.3 (F-011): Bundle-size warning

**File:** `apps/web/quasar.config.ts`

Find the `build` config block and add:
```typescript
build: {
  // ... existing config ...
  vitePlugins: [...],
  extendViteConf(viteConf) {
    // ... existing extensions ...
    if (!viteConf.build) viteConf.build = {};
    viteConf.build.chunkSizeWarningLimit = 700; // KB; MarkdownEditor is ~644 KB
  },
},
```

This silences the warning without code-splitting work. Future improvement: lazy-load CodeMirror language extensions on demand. Out of scope for this spec.

**Verification:**
```bash
cd apps/web && bun run build  # no chunk-size warning, build succeeds
```

---

### Section E — Re-Validation (after Sections A–D complete)

This is the stabilization-test Phase 5 that was skipped due to the missing DB.

#### E.1 Cost-limit pause synthetic test

```bash
# Setup: artificially low limit
psql "$DATABASE_URL" -c "
UPDATE projects
SET cost_limits = jsonb_set(cost_limits, '{monthly,anthropic}', '0.10'::jsonb)
WHERE slug = 'ki-wissensraum';
"

psql "$DATABASE_URL" -c "
INSERT INTO cost_logs (project_id, service, operation, cost_eur, created_at)
SELECT
  (SELECT id FROM projects WHERE slug = 'ki-wissensraum'),
  'anthropic',
  'synthetic-test',
  0.001,
  now()
FROM generate_series(1, 90);
"
```

Trigger an outline:
```bash
ARTICLE_ID=$(psql -t "$DATABASE_URL" -c "
  SELECT id FROM articles
  WHERE status = 'proposed'
    AND project_id = (SELECT id FROM projects WHERE slug = 'ki-wissensraum')
  LIMIT 1
" | xargs)

curl -s -X POST "http://localhost:3050/api/articles/$ARTICLE_ID/generate-outline" \
  -H "Cookie: $COOKIE" -w "\n%{http_code}\n"
```

**Expected:** HTTP 402, response body has `error: "cost_limit_exceeded"`.

Verify pause-state:
```bash
psql "$DATABASE_URL" -c "
SELECT * FROM project_pause_states
WHERE project_id = (SELECT id FROM projects WHERE slug = 'ki-wissensraum');
"
```
**Expected:** 1 row with `reason = 'cost_limit_exceeded'`.

Resume + cleanup:
```bash
curl -s -X POST "http://localhost:3050/api/projects/ki-wissensraum/resume-queues" \
  -H "Cookie: $COOKIE"

psql "$DATABASE_URL" -c "
DELETE FROM cost_logs WHERE operation = 'synthetic-test';
UPDATE projects SET cost_limits = jsonb_set(cost_limits, '{monthly,anthropic}', '100'::jsonb)
WHERE slug = 'ki-wissensraum';
"
```

#### E.2 Idempotency synthetic test

```bash
ARTICLE_ID=$(psql -t "$DATABASE_URL" -c "
  SELECT id FROM articles
  WHERE status = 'proposed'
    AND project_id = (SELECT id FROM projects WHERE slug = 'ki-wissensraum')
  LIMIT 1
" | xargs)

# Two parallel requests
curl -s -X POST "http://localhost:3050/api/articles/$ARTICLE_ID/generate-outline" \
  -H "Cookie: $COOKIE" -o /tmp/r1.json -w "%{http_code}\n" &
curl -s -X POST "http://localhost:3050/api/articles/$ARTICLE_ID/generate-outline" \
  -H "Cookie: $COOKIE" -o /tmp/r2.json -w "%{http_code}\n" &
wait

cat /tmp/r1.json
echo "---"
cat /tmp/r2.json
```

**Expected:**
- One request returns 202 with `deduped: false`
- One request returns 200 with `deduped: true`
- Both responses have the SAME `runId`

Verify in DB:
```bash
psql "$DATABASE_URL" -c "
SELECT count(*) FROM pipeline_runs
WHERE pipeline_name = 'article:outline'
  AND input->>'articleId' = '$ARTICLE_ID'
  AND status IN ('queued', 'running');
"
```
**Expected:** exactly 1.

Cleanup (the worker will fail because no real API key — that's expected):
```bash
psql "$DATABASE_URL" -c "
DELETE FROM pipeline_runs
WHERE input->>'articleId' = '$ARTICLE_ID'
  AND created_at > now() - interval '5 minutes';
"
```

#### E.3 Endpoint smoke (auth + all spec-41 endpoints)

```bash
# All these should now return 200 (or 404/401 with proper error envelope, NOT 500)

curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3050/api/articles?projectSlug=ki-wissensraum" -H "Cookie: $COOKIE"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3050/api/pillars?projectSlug=ki-wissensraum" -H "Cookie: $COOKIE"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3050/api/clusters?projectSlug=ki-wissensraum" -H "Cookie: $COOKIE"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3050/api/cost/aggregations" -H "Cookie: $COOKIE"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3050/api/cost/alerts" -H "Cookie: $COOKIE"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3050/api/pipeline-runs/active" -H "Cookie: $COOKIE"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3050/api/projects/ki-wissensraum/pause-state" -H "Cookie: $COOKIE"

# 404 (not 401) for undefined paths:
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3050/api/does-not-exist" -H "Cookie: $COOKIE"
# Expected: 404
```

#### E.4 Lint + typecheck + tests final pass

```bash
bun run typecheck                    # exits 0
bun run lint                         # exits 0 (or known warnings)
bun test                             # all green
cd apps/web && bun run build         # builds without warnings (or only intentional warnings)
```

---

### Section F — Deferred to Spec 40

#### F.1 (F-008): Web Push notification on cost-limit alert

The TODO at `packages/cost-tracker/src/tracker.ts:43` stays in place. It will be addressed when Spec 40 (Push Notifications) is implemented.

**No action in this spec.** Just leave the TODO comment as-is. When Spec 40 is implemented, that spec is responsible for:
1. VAPID-key infrastructure
2. Subscription management
3. Calling the notification send from inside `tracker.ts` at the cost-limit-exceeded trigger point
4. Removing the TODO comment

---

## Acceptance Criteria

### Section A: Setup
- [ ] `bun run db:setup` script exists, is executable, and idempotent
- [ ] `bun run db:migrate` works from repo root
- [ ] `bun run db:check` works from repo root (env-file auto-included)
- [ ] CLAUDE.md documents the setup workflow

### Section B: Critical Code Fixes
- [ ] B.1: undefined paths under `/api/*` return 404, not 401
- [ ] B.1: `app.route` calls use specific prefixes (no catch-all on `/api`)
- [ ] B.2: `bun run typecheck` shows no TS2339 in clusters.ts or pillars.ts
- [ ] B.2: All `const [{...}] = await db.select(...)` patterns audited and converted
- [ ] B.3: `bun run typecheck` shows no TS2375 in pillars store
- [ ] B.4: ClusterCard accepts `allPillars` prop and uses it for `availablePillars`
- [ ] B.4: Empty pillars appear in "Change Pillar" submenu (manual UI test)

### Section C: Cost-Enforcement Completeness
- [ ] `packages/cost-tracker/src/operations.ts` exists with all `COST_OPS` constants
- [ ] `COST_ESTIMATES_EUR` populated for all operations (no missing keys)
- [ ] All pipeline-step adapter calls use `COST_OPS.X` constants, not string literals
- [ ] All trigger-helper costEstimates use `COST_OPS.X` constants
- [ ] `extend-schema` trigger uses sum of FAQ+HowTo+Detection estimates
- [ ] `triggerWithPreRunId` accepts both `operation`-based and raw `estimatedCostEur` modes
- [ ] `logCost` warns on unknown operation strings
- [ ] No `[cost-estimates] No estimate for X` warnings during a real Cold-Start

### Section D: Hygiene
- [ ] D.1: ValidService type removed from system.ts
- [ ] D.2: `bun run lint` exits 0
- [ ] D.2: noExplicitAny, noNonNullAssertion, useNumberNamespace fixed
- [ ] D.3: chunkSizeWarningLimit configured in quasar.config.ts

### Section E: Re-Validation
- [ ] E.1: Cost-limit pause synthetic test passes (402 response, pause-state row exists)
- [ ] E.1: Resume endpoint clears pause-state
- [ ] E.2: Idempotency test passes (1 row in DB, deduped=true on second request)
- [ ] E.3: All endpoint smoke tests return expected status codes
- [ ] E.4: typecheck, lint, test, build all clean

### Section F: Deferred
- [ ] F-008 TODO remains in tracker.ts with comment referencing Spec 40

## Testing Strategy

Each section's verification is described in-line. The full pass:

```bash
# After all fixes complete:
bun run db:setup
bun run db:migrate
bun run typecheck                                         # green
bun run lint                                              # green
bun test                                                  # green
cd apps/web && bun run build && cd ../..                  # no chunk warning

# Then start API and run E.1 + E.2 + E.3 manually
cd apps/api && bun run dev &
# ... run E.1 + E.2 + E.3 commands ...
```

## Open Questions / Decisions Made

**Decision 1: Section A is mandatory before code fixes.**
Without DB, you cannot verify Sections B/C/E. Don't reorder.

**Decision 2: F-007 fix is C (Both) — constants + populate estimates.**
Single-source-of-truth file (`operations.ts`) prevents future drift. Existing strings retained verbatim — no DB rewrite of `cost_logs.operation` history needed.

**Decision 3: F-008 deferred to Spec 40.**
Spec 41 explicitly excluded notifications. Spec 40 owns Web Push entirely.

**Decision 4: Hygiene fixes (D.2 lint) executed via `biome check --write`.**
Auto-fix is safer than hand-editing 930 errors. Manual fixes only for the few non-autofixable rules.

**Decision 5: Bundle-size warning silenced rather than fixed.**
Lazy-load CodeMirror language extensions is a separate effort. Marcel's setup tolerates 644 KB chunks.

**Decision 6: B.1 fix may surface other latent bugs.**
If `app.route("/api", articleRoutes)` was hiding routes, splitting the mount might reveal that some endpoint URLs were ambiguous. Test all endpoints listed in Section E.3 after the fix.

**Decision 7: C.4 trigger costEstimate API extended to support raw EUR.**
Cleaner than always going through `estimateCostEur(service, operation, multiplier)`. Schema-extension is the first case that needed it.

**Decision 8: A.1 setup script uses `psql` directly, not Drizzle.**
Drizzle can't create roles/databases — that's outside its scope. Bash is the right tool here.

## Implementation Order

**Recommend 2 sessions.**

**Session 1: Setup + Critical Fixes (~5h)**

1. Section A.1–A.5: DB setup script + run migrations + verify (~1h)
2. Section B.1: `/api/*` mounting fix + audit (~1.5h)
3. Section B.2: count-destructure fix in pillars + clusters + audit (~30 min)
4. Section B.3: pillars store optional-property fix (~15 min)
5. Section B.4: ClusterCard allPillars prop chain (~45 min)
6. Section D.1: remove unused ValidService (~5 min)
7. Run typecheck, fix any related issues (~30 min)
8. Commit: `fix: critical bugs from stabilization report (spec 42 part 1)`

**Session 2: Cost-Enforcement Completeness + Hygiene + Validation (~5h)**

1. Section C.1–C.2: operations.ts + estimates.ts (~1h)
2. Section C.3: update all pipeline-step files (~1.5h)
3. Section C.4: update trigger endpoints (~45 min)
4. Section C.5–C.6: warn-on-unknown + verify (~30 min)
5. Section D.2: biome check --write + manual fixes (~1h)
6. Section D.3: bundle warning config (~15 min)
7. Section E.1–E.4: full re-validation (~1h)
8. Commit: `fix: cost-op SoT + hygiene + validation (spec 42 part 2)`

Total: ~10 hours.

## Splitting Plan

2 sessions with `/clear` between. Session 1 is critical-path; Session 2 is consolidation.

If Session 1 reveals additional issues (e.g., the `/api` mount fix surfaces other broken endpoints), defer those to a Section G in this spec (or carry into Spec 43 if the volume warrants).

## Discovered During Implementation

**B.1 — Legacy route with non-matching prefix (Session 1)**

`articleRoutes` contained `POST /projects/:projectSlug/articles/generate` in addition to the `/articles/*` routes. When mounting at `/api/articles`, that route's path starts with `/projects/`, making it unreachable at its original URL (`/api/projects/:slug/articles/generate`). The spec said "strip the /articles prefix from each route" but didn't account for routes in the file that never had that prefix. Required extracting a second named export `legacyArticleRoutes` and mounting it separately at `/api` in `server.ts`. The `/:articleId/continue` route was NOT affected — it was correctly kept on `articleRoutes` since stripping `/articles` preserved its effective URL.

## Deviations

**B.1 — `legacyArticleRoutes` extraction**

Spec said: change mount + strip `/articles` prefix from all routes.  
Actual: also extracted `POST /projects/:projectSlug/articles/generate` into a new `legacyArticleRoutes` Hono instance exported from `articles.ts` and mounted at `/api` in `server.ts`.  
Why: routes that start with `/projects/` cannot live on a router mounted at `/api/articles` — they become unreachable. All effective URLs are identical from the client's perspective.
