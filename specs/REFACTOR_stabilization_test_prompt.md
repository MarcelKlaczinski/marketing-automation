# Stabilization Test Run — Prompt for Claude Code

You are running a comprehensive stabilization pass on the marketing-automation platform. Your job is to **detect** every bug, type error, broken test, and inconsistency you can find — but **NOT to fix anything**. Your output is a single structured report that another instance will use to build a fix-spec.

---

## Critical constraints

1. **NO calls to paid APIs.** Anthropic, Replicate, DataForSEO, paid SMTP — none of these. All cost-enforcement validation must use synthetic data inserted directly into `cost_logs` via SQL.
2. **NO modifications to production data.** Use a local Postgres/Redis dev environment. If you must mutate `ki-wissensraum` (or any real project), restore the state at the end of the test phase that touched it.
3. **DO NOT FIX bugs you find.** Report them. Fixing comes later from a separate spec.
4. **Continue past failures.** A failing test in package A must not stop testing of package B. Accumulate everything.
5. **Be honest about uncertainty.** If you can't run a phase (e.g., no test runner configured for a workspace), document that in the report rather than fabricating results.

---

## Test phases

### Phase 1 — TypeScript Compile Check (full monorepo)

Run typecheck across every workspace. Capture every error and warning.

  ```bash
# Try the global script first
bun run typecheck 2>&1 | tee /tmp/tc-global.log

# If no global typecheck script, run per-workspace:
for ws in packages/db packages/core packages/pipelines \
          packages/adapter-anthropic packages/adapter-replicate \
          packages/adapter-dataforseo packages/adapter-email \
          apps/api apps/web; do
  echo "===== TYPECHECK: $ws ====="
  cd "$ws" && bun run typecheck 2>&1 | tee /tmp/tc-${ws//\//-}.log
cd - > /dev/null
done
```

For Vue files specifically (apps/web), also run `vue-tsc` if configured.

For each error: file, line, column, error code (TS####), message. Group by file.

### Phase 2 — Lint & Static Analysis

```bash
bun run lint 2>&1 | tee /tmp/lint.log

# If knip is configured (check package.json scripts):
bunx knip 2>&1 | tee /tmp/knip.log || echo "knip not configured"

# Drizzle schema vs migrations consistency
cd packages/db && bunx drizzle-kit check 2>&1 | tee /tmp/drizzle-check.log
cd - > /dev/null
```

Capture lint errors AND warnings. Note unused exports/imports, dead code, duplicate code if knip surfaces them.

### Phase 3 — Unit & Integration Tests (vitest)

```bash
# Try global script
bun run test 2>&1 | tee /tmp/test-global.log

# If no global, per-workspace:
for ws in packages/db packages/core packages/pipelines apps/api apps/web; do
echo "===== TEST: $ws ====="
cd "$ws" && bun run test 2>&1 | tee /tmp/test-${ws//\//-}.log || true
cd - > /dev/null
done
```

For each test failure, classify as:
- **production-bug**: production code is wrong, test correctly catches it
- **test-staleness**: production code changed in recent specs, test wasn't updated
- **flaky**: re-running gives different results (run failing tests 3× to detect)
- **setup-error**: test infrastructure broken (missing fixtures, DB connection, etc.)

If you can't classify with confidence, mark **uncertain** and explain why.

### Phase 4 — API Server Boot + Endpoint Smoke

Start the API server in **test mode without paid API keys**. The cost-enforcement system should still work (it's pure DB + logic). Anthropic/Replicate/etc. calls would fail at the adapter level — that's expected and not a bug.

```bash
# Start API in background
cd apps/api
bun run dev > /tmp/api-server.log 2>&1 &
API_PID=$!
sleep 3  # let it boot

# Verify it's up
curl -sf http://localhost:3050/api/health || echo "API not responding"
```

Authenticate via magic-link (Spec 31.5 — magic-link is logged to console, no email send needed):

```bash
# Trigger magic link
curl -X POST http://localhost:3050/api/auth/magic-link \
-H "Content-Type: application/json" \
-d '{"email":"marcel@..."}'  # use whatever email is the configured admin

# Read magic link from API server log
MAGIC_TOKEN=$(grep -oP "magic-link.*token=\K[a-f0-9-]+" /tmp/api-server.log | tail -1)

# Verify and capture session cookie
COOKIE=$(curl -i "http://localhost:3050/api/auth/verify?token=$MAGIC_TOKEN" 2>&1 | grep -i "set-cookie:" | head -1 | cut -d' ' -f2-)

echo "Session cookie: $COOKIE"
```

Hit each endpoint added in Specs 36, 37, 38, 39, 41. For each:
- HTTP status (expected vs. actual)
- Response shape sanity (does it match the typed contract per spec?)
- Latency (sample, in ms)

Endpoint list:

```bash
SLUG=ki-wissensraum  # or whatever exists locally

# Spec 36 — Articles
curl -s -o /tmp/a1.json -w "%{http_code} %{time_total}s\n" \
"http://localhost:3050/api/articles?projectSlug=$SLUG" -H "Cookie: $COOKIE"
ARTICLE_ID=$(jq -r '.data[0].id // empty' /tmp/a1.json)
curl -s -o /tmp/a2.json -w "%{http_code} %{time_total}s\n" \
"http://localhost:3050/api/articles/$ARTICLE_ID" -H "Cookie: $COOKIE"
curl -s -o /tmp/a3.json -w "%{http_code} %{time_total}s\n" \
"http://localhost:3050/api/articles/$ARTICLE_ID/versions" -H "Cookie: $COOKIE"

# Spec 37 — Pillars + Clusters
curl -s -o /tmp/p1.json -w "%{http_code} %{time_total}s\n" \
"http://localhost:3050/api/pillars?projectSlug=$SLUG" -H "Cookie: $COOKIE"
curl -s -o /tmp/c1.json -w "%{http_code} %{time_total}s\n" \
"http://localhost:3050/api/clusters?projectSlug=$SLUG" -H "Cookie: $COOKIE"

# Spec 38 — Cost
curl -s -o /tmp/co1.json -w "%{http_code} %{time_total}s\n" \
"http://localhost:3050/api/cost/aggregations" -H "Cookie: $COOKIE"
curl -s -o /tmp/co2.json -w "%{http_code} %{time_total}s\n" \
"http://localhost:3050/api/cost/logs?limit=10" -H "Cookie: $COOKIE"
curl -s -o /tmp/co3.json -w "%{http_code} %{time_total}s\n" \
"http://localhost:3050/api/cost/alerts" -H "Cookie: $COOKIE"

# Spec 39 — Activity
curl -s -o /tmp/ac1.json -w "%{http_code} %{time_total}s\n" \
"http://localhost:3050/api/pipeline-runs/active" -H "Cookie: $COOKIE"

# Spec 41 — Pause/Resume
curl -s -o /tmp/ps1.json -w "%{http_code} %{time_total}s\n" \
"http://localhost:3050/api/projects/$SLUG/pause-state" -H "Cookie: $COOKIE"
```

For each, validate response shape against the spec:
- Top-level `{ok: true|false, data?: ..., error?: ...}`
- For paginated/aggregated endpoints, expected fields exist and are non-null where required
- For empty-state endpoints (e.g., no pause), `data: null` is correct, not `{}`

### Phase 5 — Spec 41 Cost Enforcement Validation (synthetic, no API calls)

This phase proves cost-enforcement works without spending real money.

#### 5.1 Cost-limit pause via synthetic spending

```sql
-- Setup: lower the monthly anthropic limit
UPDATE projects
SET cost_limits = jsonb_set(cost_limits, '{monthly,anthropic}', '0.10'::jsonb)
WHERE slug = 'ki-wissensraum';

-- Insert 90 synthetic cost logs at 0.001 EUR each = 0.09 EUR (just under limit)
INSERT INTO cost_logs (project_id, service, operation, cost_eur, created_at)
SELECT
(SELECT id FROM projects WHERE slug = 'ki-wissensraum'),
'anthropic',
'synthetic-stabilization-test',
0.001,
now()
FROM generate_series(1, 90);
```

Now POST to `/api/articles/$ARTICLE_ID/generate-outline`:
- The estimated cost (0.30 EUR per Spec 41 estimates) + 0.09 EUR already-spent = 0.39 EUR
- This exceeds the 0.10 EUR monthly limit → expect HTTP 402

```bash
RESP=$(curl -s -w "\n%{http_code}" \
-X POST "http://localhost:3050/api/articles/$ARTICLE_ID/generate-outline" \
-H "Cookie: $COOKIE" \
-H "Content-Type: application/json")
echo "$RESP"
```

Verify in DB:

```sql
-- Should have a pause-state row now
SELECT * FROM project_pause_states
WHERE project_id = (SELECT id FROM projects WHERE slug = 'ki-wissensraum');

-- Should NOT have a new pipeline_runs row from this trigger
SELECT count(*) FROM pipeline_runs
WHERE project_id = (SELECT id FROM projects WHERE slug = 'ki-wissensraum')
AND created_at > now() - interval '5 minutes'
AND pipeline_name = 'article:outline';
```

**PASS criteria**: HTTP 402 returned, `project_pause_states` row exists, NO new `pipeline_runs` row from the rejected trigger.

**FAIL criteria**: HTTP 202 returned, OR a new `pipeline_runs` row was created. Either is a critical bug — cost enforcement bypassed.

Test the resume endpoint:

```bash
curl -s -X POST "http://localhost:3050/api/projects/ki-wissensraum/resume-queues" \
-H "Cookie: $COOKIE" \
-w "\n%{http_code}"
```

Verify pause-state is gone:

```sql
SELECT count(*) FROM project_pause_states
WHERE project_id = (SELECT id FROM projects WHERE slug = 'ki-wissensraum');
-- Expected: 0
```

Cleanup:

```sql
DELETE FROM cost_logs WHERE operation = 'synthetic-stabilization-test';
UPDATE projects
SET cost_limits = jsonb_set(cost_limits, '{monthly,anthropic}', '100'::jsonb)
WHERE slug = 'ki-wissensraum';
```

#### 5.2 Idempotency check (no real API call needed)

Two simultaneous POST requests to the same endpoint:

```bash
ARTICLE_ID=$(psql -t -c "SELECT id FROM articles WHERE status = 'proposed' AND project_id = (SELECT id FROM projects WHERE slug = 'ki-wissensraum') LIMIT 1" | xargs)

# Fire two requests in parallel
curl -s -X POST "http://localhost:3050/api/articles/$ARTICLE_ID/generate-outline" \
-H "Cookie: $COOKIE" -w "\n%{http_code}\n" -o /tmp/r1.json &
curl -s -X POST "http://localhost:3050/api/articles/$ARTICLE_ID/generate-outline" \
-H "Cookie: $COOKIE" -w "\n%{http_code}\n" -o /tmp/r2.json &
wait

cat /tmp/r1.json /tmp/r2.json
```

**PASS**: One returns 202 with `deduped: false`, other returns 200 with `deduped: true`. Both have the SAME `runId`.

**FAIL**: Both return 202 with different `runId`s. Idempotency broken. Critical.

Verify in DB:

```sql
SELECT count(*) FROM pipeline_runs
WHERE pipeline_name = 'article:outline'
AND input->>'articleId' = '$ARTICLE_ID'
AND status IN ('queued', 'running');
-- Expected: exactly 1
```

Cleanup (worker may have processed and failed due to no API key — that's fine):

```sql
-- Don't delete legitimate older runs. Only the test ones from the last 2 minutes:
DELETE FROM pipeline_runs
WHERE input->>'articleId' = '$ARTICLE_ID'
AND created_at > now() - interval '2 minutes'
AND status IN ('queued', 'failed');
```

#### 5.3 Cost-Estimate Coverage Audit (read-only)

Verify every operation that an adapter logs to `cost_logs` has a corresponding entry in `COST_ESTIMATES_EUR`:

```bash
# Find all unique operation strings used in cost-logging across the codebase
grep -rh "logCost\|cost_logs\|costLogs" packages/ apps/ \
--include="*.ts" \
| grep -oE "operation:\s*['\"][^'\"]+['\"]" \
| sort -u > /tmp/operations-used.txt

# Find all operations defined in estimates
grep -A 100 "COST_ESTIMATES_EUR" packages/core/src/cost/estimates.ts \
| grep -oE "['\"][a-z][a-z0-9-:]*['\"]" \
| sort -u > /tmp/operations-defined.txt

diff /tmp/operations-used.txt /tmp/operations-defined.txt
```

For each operation in the codebase missing from estimates: this is a **silent zero** in `estimateCostEur()` — the operation doesn't trigger pre-flight cost checks. Document each as a finding.

### Phase 6 — Frontend Static Validation

Without running the browser:

```bash
cd apps/web

# Vue-specific type check
bun run typecheck 2>&1 | tee /tmp/web-tsc.log
# Or if vue-tsc is the typecheck:
bunx vue-tsc --noEmit 2>&1 | tee /tmp/web-vue-tsc.log

# Build check (catches more than typecheck)
bun run build 2>&1 | tee /tmp/web-build.log

# Inspect spec-41-related files for required code patterns:
echo "=== Phase 2.2 confirmation card check ==="
grep -n "confirmation-card\|phase2_2_started\|MAX_COMPETITORS" \
apps/web/src/components/cold-start/Phase2CompetitorAnalysis.vue \
|| echo "MISSING: Spec 41 phase 2.2 confirmation pattern"

echo "=== Polling 401 handling check ==="
grep -n "401\|403\|status === 401" \
apps/web/src/composables/useActiveRunsPolling.ts \
apps/web/src/composables/usePipelineRunPolling.ts \
|| echo "MISSING: Spec 41 polling 401 handling"

echo "=== Polling cache-friendly since rounding ==="
grep -n "ROUND_TO\|Math.floor.*ROUND" \
apps/web/src/composables/useActiveRunsPolling.ts \
|| echo "MISSING: Spec 41 since rounding"

echo "=== Project pause banner ==="
ls apps/web/src/components/common/ProjectPauseBanner.vue 2>/dev/null \
&& echo "OK" || echo "MISSING: ProjectPauseBanner.vue"

echo "=== Idempotency: deduped handling ==="
grep -rn "deduped" apps/web/src/ \
|| echo "MISSING: deduped UI handling"

echo "=== Spec 37: availablePillars from pillars-list (not allClusters) ==="
grep -A 5 "availablePillars" apps/web/src/components/clusters/ClusterCard.vue
# Expected: derives from a 'pillars' or 'allPillars' prop, not 'allClusters'
# If it derives from allClusters: this is the known Spec 37 Bug (Decision 10 not applied)
```

### Phase 7 — Code Quality Spot Checks

```bash
# Check that triggerWithPreRunId is used consistently across all trigger endpoints
grep -rn "enqueue.*Pipeline\|enqueueArticle\|enqueueColdStart" apps/api/src/routes/ \
| grep -v "import"

# Each match should be wrapped in triggerWithPreRunId per Spec 41.
# Direct enqueue calls outside that helper = bypass of cost+idempotency = bug.

# Check that adapters call assertCostBudget before paid API calls
for adapter in adapter-anthropic adapter-replicate adapter-dataforseo; do
echo "=== $adapter ==="
grep -rn "assertCostBudget\|checkCostBudget" packages/$adapter/src/ \
|| echo "MISSING: cost check in $adapter"
done

# Check that worker error-handler recognizes CostLimitExceededError
grep -rn "CostLimitExceededError\|cost_limit_exceeded" packages/pipelines/src/ \
|| echo "MISSING: worker error-handler for cost errors"

# Verify migration files are sequenced and exist
ls packages/db/migrations/ | sort
cat packages/db/migrations/_journal.json | jq '.entries | length'

# Find any TODO/FIXME comments added recently (Spec 36+)
grep -rn "TODO\|FIXME\|XXX\|HACK" apps/ packages/ --include="*.ts" --include="*.vue" \
| grep -v "node_modules" \
| head -50
```

### Phase 8 — Cleanup

```bash
# Stop API server
kill $API_PID 2>/dev/null || true

# Verify no leftover test data in DB
psql -c "SELECT count(*) FROM cost_logs WHERE operation = 'synthetic-stabilization-test';"
# Expected: 0
psql -c "SELECT count(*) FROM project_pause_states;"
# Expected: 0 (or whatever pre-test state was)
```

---

## Output: STABILIZATION_REPORT.md

Generate a single file at `/tmp/STABILIZATION_REPORT.md` with the following structure. Be precise and machine-parseable — no narrative essays, just structured findings.

```markdown
# Stabilization Report

**Generated:** [ISO timestamp]
**Total findings:** [count]
**Critical:** [count] | **Major:** [count] | **Minor:** [count] | **Hygiene:** [count]

---

## Summary by Severity

### Critical (cost/correctness; must fix before any new feature)
- F-001: [one-line summary] (Phase 5.1)
- F-007: [one-line summary] (Phase 1)
- ...

### Major (broken feature, but not cost/correctness)
- F-003: ...

### Minor (works but suboptimal)
- F-012: ...

### Hygiene (cleanup, unused code, lint warnings)
- F-019: ...

---

## Detailed Findings

### F-001: [short title]

**Severity:** Critical
**Phase detected:** 5.1 — Cost-limit pause synthetic test
**Type:** production-bug | test-staleness | flaky | setup-error | spec-deviation
**Files affected:**
- `path/to/file.ts:42-58`
- `path/to/other.vue:120`

**What I observed:**
[Concrete output / DB state / response. Quote actual command output.]

```
[Verbatim output, error message, stack trace, or DB query result]
```

**What was expected:**
[What the spec says should happen, with reference: "Per Spec 41 Decision 1, ..."]

**Hypothesis for root cause:**
[1-2 sentences. Be honest if uncertain — say "uncertain, possibly X or Y".]

**Reproduction steps:**
1. [exact command/click sequence]
2. ...

**Suggested fix area** (DO NOT IMPLEMENT):
[Brief: "in `assertCostBudget` add ...". This is a hint for the fix-spec author, not a fix.]

---

### F-002: ...

[Same structure]

---

[... continue for every finding ...]

---

## Phase Completion Status

| Phase | Status | Findings |
|---|---|---|
| 1 — TypeScript | completed / skipped (reason) / failed (reason) | F-001, F-002, F-003 |
| 2 — Lint | completed | F-004 |
| 3 — Tests | completed | F-005..F-009 |
| 4 — Endpoint Smoke | partial (couldn't auth) | F-010 |
| 5 — Spec 41 Validation | completed | F-011, F-012 |
| 6 — Frontend Static | completed | F-013 |
| 7 — Code Quality | completed | F-014..F-018 |
| 8 — Cleanup | completed | (none) |

---

## Things I Could Not Test

- [Anything skipped because of missing infrastructure, missing API keys for non-paid services, etc. Be transparent.]

---

## Environment

- Node/Bun version
- Postgres version
- Redis version
- Branch / commit hash
- Date / time of run

---
```

**Strict output format rules:**
- Each finding MUST have a unique `F-NNN` ID
- File paths MUST include line numbers when applicable
- Quote actual command output verbatim (don't paraphrase)
- If uncertain about classification, mark as **uncertain** and explain
- DO NOT include speculation about findings you didn't actually observe
- DO NOT add findings just to fill the report — empty is fine

---

## What you should NOT do

- ❌ Do not fix any bugs you find
- ❌ Do not modify production data outside the explicit synthetic-test cleanup
- ❌ Do not call paid APIs (Anthropic, Replicate, DataForSEO, paid SMTP)
- ❌ Do not skip phases without documenting why in "Things I Could Not Test"
- ❌ Do not invent findings — only report what you observed
- ❌ Do not commit any changes to git

## When you're done

Output the path to the generated report:

```
Report written to: /tmp/STABILIZATION_REPORT.md
Total findings: [N]
Critical findings requiring immediate attention: [list of F-NNN IDs]
```
