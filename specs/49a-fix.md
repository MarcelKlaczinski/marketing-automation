# Spec 49a.fix: Cleanup-Korrektur + Robustheit für Frontmatter-Re-Imports

**Phase:** Marketing-Tool Hotfix — adressiert Bugs die beim toolwiki Frontmatter-Cleanup sichtbar wurden
**Estimated Effort:** 2-3 hours (1 session, 5 sections)
**Dependencies:** Spec 49a (Cluster-Auto-Import), audit/CLEANUP_SUMMARY.md, audit/DIAGNOSE_*.md
**Status:** Ready for implementation
**Recommended Model:** Sonnet 4.6
**Repos affected:** marketing-tool (db + adapter-astro-sync)

---

## Context

Nach dem Frontmatter-Cleanup im toolwiki Astro-Repo (5 Commits, push'd) sollte ein Re-Import folgende Effekte zeigen:
- `musikgenerierung-2026` und `wissensmanagement-2026` Cluster-Rows verschwinden (DE-Files migriert auf EN-Keys)
- `cursor-vs-windsurf-vs-codeium-2026` wird zu `clusterRole='hub'`

**Beobachtet**: keiner dieser Effekte ist in der DB sichtbar. Diagnose-Reports (`audit/DIAGNOSE_ASTRO.md`, `audit/DIAGNOSE_MARKETING_TOOL.md`) zeigen drei separate Bugs:

### Bug 1: FilterChangedFiles ohne Force-Override
Wenn DB-Daten durch frühere Bugs korrumpiert sind, aber File-SHAs in Astro-Repo unverändert blieben (z.B. weil nur Schema/Code-Bug, kein Content-Change), filtert FilterChangedFilesStep diese Files als "unchanged" → Upsert wird übersprungen → Korruption bleibt.

### Bug 2: SyncClustersFromFrontmatterStep ohne Orphan-Deletion
Wenn ein clusterKey nirgendwo mehr in Articles vorkommt (z.B. weil DE-Files auf EN-Key migriert wurden), bleibt die alte Cluster-Row mit 0 Members für immer in DB.

### Bug 3: 7 DE-Tool-Files haben veraltete cluster_key in DB
Konkrete Daten-Korruption die manuell korrigiert werden muss.

### Mystery (zu klären): UpsertArticles-Effekt
Files mit `updated_at = 15:20:51` und `git_sha = aktueller Astro-blob` haben trotzdem alten `cluster_key`. Das deutet auf einen 4. potenziellen Bug — entweder im `set:` clause oder in einem Folge-Step der den Wert zurücksetzt.

## Goal

Nach dieser Spec:
- **Section A (Diagnose)**: Mystery aufgeklärt — wir wissen ob UpsertArticles selbst ein Bug hat oder ob ein Folge-Step den Wert überschreibt
- **Section B (Daten-Fix)**: Die 7+7 betroffenen DE-Files haben korrekten `cluster_key` in DB
- **Section C (FilterChangedFiles Robustness)**: `forceAll`-Flag erlaubt zukünftige Backfills
- **Section D (SyncClusters Orphan-Deletion)**: Orphaned cluster-rows werden gelöscht
- **Section E (Re-Verifikation)**: SQL bestätigt Cluster-Stand matcht Erwartung

## Non-Goals

- **Keine UI-Änderung für forceAll-Flag** — kann später als "Re-Import (Force)"-Button hinzugefügt werden
- **Kein full RepoImportPipeline rebuild** — wir fixen gezielt was kaputt ist
- **Keine Migration neuer Schema-Felder** — alles bleibt in existing Tables
- **Keine Behebung der Mixed-Categories** für audio-2026, bildgenerierung-2026, chatbots-2026 — die brauchen Schema-Entscheidung (separate Workstream)

## Pre-flight

```bash
cd <marketing-tool-repo>
git status --porcelain  # clean
git checkout -b feature/49a-fix-cleanup-import
bun test 2>&1 | tail -3  # green baseline
```

**Verify aktueller DB-Stand** (Snapshot vor Fixes):

```sql
-- Snapshot 1: Articles mit alten cluster_keys
SELECT slug, locale, cluster_key, 
       (SELECT name FROM clusters WHERE id = articles.cluster_id) as joined_cluster
FROM articles
WHERE project_id = (SELECT id FROM projects WHERE slug = 'toolwiki')
  AND cluster_key IN ('musikgenerierung-2026', 'wissensmanagement-2026')
ORDER BY slug;

-- Snapshot 2: Cluster-Rows die nach Cleanup orphan sein sollten
SELECT name, pillar_article_id IS NOT NULL as has_hub,
       (SELECT COUNT(*) FROM articles WHERE cluster_id = clusters.id) as members
FROM clusters
WHERE project_id = (SELECT id FROM projects WHERE slug = 'toolwiki')
  AND name IN ('musikgenerierung-2026', 'wissensmanagement-2026');
```

Speichere die Outputs in `audit/PRE_FIX_SNAPSHOT.md` für späteren Vergleich.

## Splitting Plan

5 Sections für `/start-task /review-task` workflow:

```
A — Mystery-Diagnose (UpsertArticles Verhalten verstehen)   ~30min   [task: 49a-fix.1-diagnose]
B — SQL Direct Data-Fix für 14 DE-Files                      ~15min   [task: 49a-fix.2-data]
C — FilterChangedFiles forceAll-Flag                         ~45min   [task: 49a-fix.3-force-all]
D — SyncClusters Orphan-Deletion                             ~45min   [task: 49a-fix.4-orphan-delete]
E — Re-Verifikation + Re-Import                              ~30min   [task: 49a-fix.5-verify]
```

---

## Section A — Mystery-Diagnose (UpsertArticles)

### A.1 Goal

Eindeutig identifizieren ob UpsertArticlesStep oder ein Folge-Step den `cluster_key` nicht auf den neuen Wert updated, obwohl FilterChangedFiles den File weiter geleitet hat.

### A.2 Test-Setup

Erstelle `scripts/diagnose-upsert-cluster-key.ts`:

```typescript
// scripts/diagnose-upsert-cluster-key.ts
// 
// Diagnose-Test: simuliert was beim Re-Import passiert, prüft jeden Step
// für die suno DE Article.

import { articles, db, projects } from "@marketing-auto/db";
import { eq, and } from "drizzle-orm";
import { readFileSync } from "fs";
import { parseMdxContent } from "../packages/adapters/astro-sync/src/import/parse-frontmatter.ts";

const ASTRO = "/Users/marcelklaczinski/WebstormProjects/ki-wissensraum-neu";
const SLUG = "suno";
const LOCALE = "de";
const COLLECTION = "tools";
const PATH = `${ASTRO}/src/content/tools/de/suno.mdx`;
const RELATIVE_PATH = "src/content/tools/de/suno.mdx";

const [project] = await db
  .select({ id: projects.id })
  .from(projects)
  .where(eq(projects.slug, "toolwiki"))
  .limit(1);

if (!project) throw new Error("toolwiki project not found");

console.log("=== STEP 1: DB current state ===");
const [before] = await db
  .select()
  .from(articles)
  .where(
    and(
      eq(articles.projectId, project.id),
      eq(articles.collection, COLLECTION),
      eq(articles.slug, SLUG),
      eq(articles.locale, LOCALE)
    )
  )
  .limit(1);

console.log("clusterKey:", before?.clusterKey);
console.log("clusterRole:", before?.clusterRole);
console.log("gitSha:", before?.gitSha);
console.log("updatedAt:", before?.updatedAt);

console.log("\n=== STEP 2: Parser output ===");
const content = readFileSync(PATH, "utf-8");
const result = parseMdxContent(RELATIVE_PATH, content);
console.log("typed.clusterKey:", result.typed.clusterKey);
console.log("typed.clusterRole:", result.typed.clusterRole);
console.log("typed.intentType:", result.typed.intentType);

console.log("\n=== STEP 3: Simulate UpsertArticles ===");
// Replicate the exact insert from upsert-articles.ts line 44-108
// Without the conflict — direct update if exists:
const updated = await db
  .update(articles)
  .set({
    clusterKey: result.typed.clusterKey ?? null,
    clusterRole: (result.typed.clusterRole as "hub" | "spoke" | null) ?? null,
    intentType: result.typed.intentType ?? null,
    updatedAt: new Date(),
  })
  .where(
    and(
      eq(articles.projectId, project.id),
      eq(articles.collection, COLLECTION),
      eq(articles.slug, SLUG),
      eq(articles.locale, LOCALE)
    )
  )
  .returning({ 
    id: articles.id, 
    clusterKey: articles.clusterKey,
    clusterRole: articles.clusterRole,
  });

console.log("Updated row:", updated[0]);

console.log("\n=== STEP 4: Verify DB after direct update ===");
const [after] = await db
  .select({ 
    clusterKey: articles.clusterKey,
    clusterRole: articles.clusterRole,
  })
  .from(articles)
  .where(
    and(
      eq(articles.projectId, project.id),
      eq(articles.collection, COLLECTION),
      eq(articles.slug, SLUG),
      eq(articles.locale, LOCALE)
    )
  )
  .limit(1);

console.log("After direct update — clusterKey:", after?.clusterKey);

// Revert change so Section B can do it cleanly:
await db
  .update(articles)
  .set({ clusterKey: before?.clusterKey ?? null, updatedAt: before?.updatedAt })
  .where(
    and(
      eq(articles.projectId, project.id),
      eq(articles.collection, COLLECTION),
      eq(articles.slug, SLUG),
      eq(articles.locale, LOCALE)
    )
  );

console.log("\nReverted change. Section B will do final fix.");
```

### A.3 Ausführung

```bash
bun run scripts/diagnose-upsert-cluster-key.ts
```

### A.4 Erwartung + Interpretation

**Wenn STEP 3+4 erfolgreich** (clusterKey wurde geupdated auf "music-generation-2026"):
- → Direct update funktioniert
- → Drizzle und Schema sind OK
- → Bug muss in der **`onConflictDoUpdate` Variante** liegen die UpsertArticlesStep nutzt
- → Wahrscheinlich Closure-Bug: typed wird gecached über Iterationen
- → Oder Section C (forceAll) fixt es ohnehin

**Wenn STEP 3+4 fehlschlägt** (clusterKey bleibt alt selbst bei direct update):
- → Schema-Constraint oder Drizzle-Type-Mismatch
- → Konkretes Code-Investigation nötig
- → Bigger Bug als gedacht

### A.5 Section A Acceptance

- [ ] `scripts/diagnose-upsert-cluster-key.ts` ausgeführt
- [ ] Output gespeichert in `audit/DIAGNOSE_UPSERT.md`
- [ ] Diagnose dokumentiert: direkte Update funktioniert YES/NO
- [ ] Falls NO: Issue eskaliert, Section B-E pausiert bis Root Cause klar
- [ ] Falls YES: weiter zu Section B
- [ ] Commit: `chore(astro-sync): diagnose script for upsert behavior (49a-fix.1)`

---

## Section B — SQL Direct Data-Fix

### B.1 Goal

Direkte Korrektur der 14 betroffenen DE-Tool-Files (cluster_key + cluster_role).

### B.2 Migration

Create migration file:
`packages/db/migrations/0XXX_fix_toolwiki_cluster_keys.sql`

```sql
-- Spec 49a.fix Section B: korrigiere veraltete cluster_key in toolwiki DE-Tool-Files
-- Diese Korruption entstand durch FilterChangedFiles Skip-Gate trotz Frontmatter-Cleanup

-- 1. musikgenerierung-2026 → music-generation-2026 (3 DE-Files)
UPDATE articles
SET cluster_key = 'music-generation-2026',
    updated_at = NOW()
WHERE project_id = (SELECT id FROM projects WHERE slug = 'toolwiki')
  AND collection = 'tools'
  AND locale = 'de'
  AND cluster_key = 'musikgenerierung-2026';

-- 2. wissensmanagement-2026 → knowledge-management-2026 (4 DE-Files)
UPDATE articles
SET cluster_key = 'knowledge-management-2026',
    updated_at = NOW()
WHERE project_id = (SELECT id FROM projects WHERE slug = 'toolwiki')
  AND collection = 'tools'
  AND locale = 'de'
  AND cluster_key = 'wissensmanagement-2026';

-- 3. (Optional, falls Hub-Promotion auch nicht durchgekommen ist:)
-- cursor-vs-windsurf-vs-codeium-2026 → cluster_role 'hub' (2 Files)
UPDATE articles
SET cluster_role = 'hub',
    updated_at = NOW()
WHERE project_id = (SELECT id FROM projects WHERE slug = 'toolwiki')
  AND collection = 'comparisons'
  AND slug = 'cursor-vs-windsurf-vs-codeium-2026'
  AND cluster_role = 'spoke';

-- Side-effect cleanup: articles.cluster_id wird nach Re-Run von SyncClusters 
-- korrekt neu zugewiesen (das passiert in Section E).
```

Update `_journal.json` manuell.

### B.3 Apply

```bash
# Falls Drizzle Push:
bun --filter @marketing-auto/db drizzle-kit push:pg

# ODER direkt psql:
psql "$DATABASE_URL" -f packages/db/migrations/0XXX_fix_toolwiki_cluster_keys.sql
```

### B.4 Verify

```sql
-- Confirm: keine Articles mehr mit alten cluster_keys
SELECT slug, locale, cluster_key, cluster_role
FROM articles
WHERE project_id = (SELECT id FROM projects WHERE slug = 'toolwiki')
  AND cluster_key IN ('musikgenerierung-2026', 'wissensmanagement-2026')
ORDER BY slug;
-- Erwartung: 0 rows

-- Confirm: alle DE+EN auf richtigen Keys
SELECT cluster_key, locale, COUNT(*)
FROM articles
WHERE project_id = (SELECT id FROM projects WHERE slug = 'toolwiki')
  AND cluster_key IN ('music-generation-2026', 'knowledge-management-2026')
GROUP BY cluster_key, locale
ORDER BY cluster_key, locale;
-- Erwartung: music-generation-2026: 3 de + 3 en
--            knowledge-management-2026: 4 de + 4 en

-- Confirm: Hub-Promotion in DB
SELECT slug, locale, cluster_role
FROM articles
WHERE project_id = (SELECT id FROM projects WHERE slug = 'toolwiki')
  AND collection = 'comparisons'
  AND slug = 'cursor-vs-windsurf-vs-codeium-2026';
-- Erwartung: 2 rows, beide cluster_role = 'hub'
```

### B.5 Section B Acceptance

- [ ] Migration-File erstellt + applied
- [ ] 0 articles mit alten cluster_keys
- [ ] DE+EN korrekt verteilt (3+3, 4+4)
- [ ] Hub-Promotion in DB sichtbar
- [ ] Commit: `fix(db): correct toolwiki cluster_key for migrated DE-files (49a-fix.2)`

---

## Section C — FilterChangedFiles forceAll-Flag

### C.1 Goal

Robustheit für zukünftige Frontmatter-Re-Imports — wenn DB-Daten korrupt sind aber Astro-File-SHA unverändert, soll ein Operator forcen können dass alle Files re-prozessiert werden.

### C.2 Files modified

- `packages/adapters/astro-sync/src/import/steps/filter-changed-files.ts`
- `packages/adapters/astro-sync/src/import/pipeline.ts`
- `packages/adapters/astro-sync/src/import/trigger.ts` (oder wo enqueue ist)
- `apps/api/src/routes/projects.ts` (API endpoint accepts forceAll)

### C.3 FilterChangedFiles update

```typescript
// packages/adapters/astro-sync/src/import/steps/filter-changed-files.ts

const InputSchema = z.object({
  projectId: z.string().uuid(),
  files: z.array(FileSchema),
  forceAll: z.boolean().default(false),  // NEW
});

// In der Step-Logic:
for (const file of input.files) {
  const rec = existingByPath.get(file.path);
  if (input.forceAll || !rec || rec.gitSha !== file.sha) {
    changed.push(file);
  } else {
    unchangedCount++;
  }
}

// Log forceAll usage:
if (input.forceAll) {
  log.info(
    { totalFiles: input.files.length },
    "forceAll=true: all files marked as changed regardless of git_sha"
  );
}
```

### C.4 Pipeline-Bridge update

```typescript
// packages/adapters/astro-sync/src/import/pipeline.ts

// Pipeline-Input erweitern:
readonly inputSchema = z.object({
  projectId: z.string().uuid(),
  // ... existing fields ...
  forceAll: z.boolean().default(false),  // NEW
});

// Bridge zu FilterChangedFiles:
if (fromStep.name === "list-content-files" && toStep.name === "filter-changed-files") {
  return {
    projectId: pipelineInput.projectId,
    files: out.files,
    forceAll: pipelineInput.forceAll ?? false,  // NEW
  };
}
```

### C.5 Trigger / API endpoint update

```typescript
// trigger.ts oder wherever enqueueRepoImport is defined:
export interface EnqueueRepoImportInput {
  projectId: string;
  forceAll?: boolean;  // NEW
}

export async function enqueueRepoImport(input: EnqueueRepoImportInput) {
  // ... pass forceAll to pipeline input ...
}
```

```typescript
// apps/api/src/routes/projects.ts (astro-import endpoint)
const importSchema = z.object({
  forceAll: z.boolean().optional().default(false),  // NEW
});

projectRoutes.post(
  "/:slug/astro-import",
  zValidator("json", importSchema.optional()),
  async (c) => {
    const slug = c.req.param("slug");
    const body = c.req.valid("json") ?? { forceAll: false };
    // ... look up project ...
    const { runId, jobId } = await enqueueRepoImport({
      projectId: project.id,
      forceAll: body.forceAll,
    });
    return c.json({ ok: true, data: { runId, jobId } }, 202);
  }
);
```

### C.6 Section C Acceptance

- [ ] forceAll parameter in FilterChangedFiles, Pipeline-Bridge, Trigger, API
- [ ] Default `false` preserves existing behavior (no regression)
- [ ] curl test: `POST /api/projects/toolwiki/astro-import {"forceAll": true}`
  durchläuft alle 268 Files (sichtbar in pipeline-run logs)
- [ ] curl test ohne body: default behavior (nur changed files)
- [ ] Type-check + Tests passieren
- [ ] Commit: `feat(astro-sync): forceAll flag for filter-changed-files (49a-fix.3)`

---

## Section D — SyncClusters Orphan-Deletion

### D.1 Goal

Wenn ein clusterKey nirgendwo mehr in Articles auftaucht, soll die zugehörige Cluster-Row gelöscht werden (statt für immer mit 0 Members in DB zu bleiben).

### D.2 File modified

- `packages/adapters/astro-sync/src/import/steps/sync-clusters-from-frontmatter.ts`

### D.3 Logic-Erweiterung

Nach Step 3 (alle clusterKeys verarbeitet, Articles re-linked), füge neuen Step ein:

```typescript
// nach der existing for-loop über distinctClusterKeys:

// Step 4 (NEW): Lösche orphaned cluster-rows
const activeNames = distinctClusterKeys;
let orphansDeleted = 0;

if (activeNames.length > 0) {
  const orphaned = await db
    .delete(clusters)
    .where(
      and(
        eq(clusters.projectId, projectId),
        notInArray(clusters.name, activeNames)
      )
    )
    .returning({ id: clusters.id, name: clusters.name });
  
  orphansDeleted = orphaned.length;
  
  if (orphansDeleted > 0) {
    log.info(
      { count: orphansDeleted, names: orphaned.map((o) => o.name) },
      "Deleted orphaned cluster rows (no articles reference them)"
    );
  }
}
```

Import addition:
```typescript
import { notInArray } from "drizzle-orm";
```

### D.4 Output-Schema erweitern

```typescript
const OutputSchema = z.object({
  // ... existing ...
  orphansDeleted: z.number(),  // NEW
});

// Im return statement:
return {
  // ... existing ...
  orphansDeleted,
};
```

### D.5 Vorsicht: Cascade-Effects?

Wenn `articles.cluster_id` ON DELETE SET NULL hat: OK, betroffene Articles bekommen cluster_id=NULL und SyncClusters re-linkt sie beim nächsten Run.

Wenn ON DELETE CASCADE: betroffene Articles würden gelöscht — **das wäre ein Bug**. Check:

```sql
SELECT confrelid::regclass, conname, confdeltype 
FROM pg_constraint
WHERE conrelid = 'articles'::regclass AND contype = 'f' AND conname LIKE '%cluster%';
```

Expected: `confdeltype = 'n'` (SET NULL) or `'a'` (NO ACTION).
If 'c' (CASCADE): ABORT, FK constraint muss geändert werden bevor diese Logic safe ist.

### D.6 Unit Test

```typescript
// packages/adapters/astro-sync/test/sync-clusters-orphan-deletion.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { articles, clusters, contentPillars, db, projects } from "@marketing-auto/db";
import { eq } from "drizzle-orm";
import { SyncClustersFromFrontmatterStep } from "../src/import/steps/sync-clusters-from-frontmatter.ts";

describe("SyncClusters Orphan-Deletion", () => {
  let projectId: string;
  const slug = `orphan-test-${Date.now()}`;

  beforeEach(async () => {
    const [p] = await db.insert(projects).values({
      slug,
      name: "Test",
      industry: "ai_education",
      pipelineTemplate: "educational",
    }).returning();
    projectId = p!.id;
  });

  afterEach(async () => {
    // Cleanup in dependency order:
    await db.delete(articles).where(eq(articles.projectId, projectId));
    await db.delete(clusters).where(eq(clusters.projectId, projectId));
    await db.delete(contentPillars).where(eq(contentPillars.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  test("deletes orphan cluster rows (no articles reference them)", async () => {
    // Insert article with clusterKey "active"
    await db.insert(articles).values({
      projectId,
      source: "imported",
      slug: "test-article",
      locale: "de",
      collection: "blog",
      cornerstoneKeyword: "test",
      title: "Test",
      clusterKey: "active",
      clusterRole: "spoke",
      category: "Test",
      status: "published",
    });

    // Insert orphan cluster (no article references it)
    await db.insert(clusters).values({
      projectId,
      name: "orphan-cluster",
      pillar: "Test",
      cornerstoneKeywords: [],
      satelliteKeywords: [],
      status: "approved",
    });

    const step = new SyncClustersFromFrontmatterStep();
    const result = await step.execute({ projectId }, {} as any);

    expect(result.orphansDeleted).toBe(1);

    const remaining = await db.select().from(clusters)
      .where(eq(clusters.projectId, projectId));
    expect(remaining.length).toBe(1);
    expect(remaining[0]!.name).toBe("active");
  });
});
```

### D.7 Section D Acceptance

- [ ] Orphan-Deletion-Logic in SyncClustersFromFrontmatterStep
- [ ] FK constraint check OK (SET NULL oder NO ACTION)
- [ ] Output-Schema enthält `orphansDeleted`
- [ ] Unit test passing
- [ ] Commit: `feat(astro-sync): delete orphan cluster rows on sync (49a-fix.4)`

---

## Section E — Re-Verifikation + Re-Import

### E.1 Goal

Apply alle Fixes auf toolwiki, verify dass DB jetzt sauber ist.

### E.2 Steps

```bash
# 1. Trigger Re-Import mit forceAll=true (nutzt neue API)
curl -X POST http://localhost:3050/api/projects/toolwiki/astro-import \
  -H "Content-Type: application/json" \
  -d '{"forceAll": true}'

# 2. Wait 60-90s

# 3. SQL Verify:
psql "$DATABASE_URL" -c "
SELECT 
  (SELECT COUNT(*) FROM clusters WHERE project_id = (SELECT id FROM projects WHERE slug = 'toolwiki')) as total_clusters,
  (SELECT COUNT(*) FROM clusters WHERE project_id = (SELECT id FROM projects WHERE slug = 'toolwiki') AND pillar_article_id IS NOT NULL) as with_hub,
  (SELECT COUNT(*) FROM articles WHERE project_id = (SELECT id FROM projects WHERE slug = 'toolwiki') AND cluster_role = 'hub') as total_hub_articles,
  (SELECT COUNT(*) FROM clusters WHERE project_id = (SELECT id FROM projects WHERE slug = 'toolwiki') AND name IN ('musikgenerierung-2026','wissensmanagement-2026')) as orphan_clusters
;
"
```

### E.3 Expected Numbers

```
total_clusters:     33  (vorher 35; -2 wegen Orphan-Deletion)
with_hub:           23  (vorher 22; +1 wegen Hub-Promotion in DB)
total_hub_articles: 68  (vorher 66; +2 weil cursor-vs-windsurf DE+EN promoted)
orphan_clusters:    0   (musikgenerierung + wissensmanagement gelöscht)
```

### E.4 Falls Numbers Nicht Stimmen

Run nochmal:
```sql
SELECT name, pillar_article_id IS NOT NULL as has_hub, 
       (SELECT COUNT(*) FROM articles WHERE cluster_id = clusters.id) as members
FROM clusters
WHERE project_id = (SELECT id FROM projects WHERE slug = 'toolwiki')
ORDER BY members DESC;
```

→ Distinct clusters müssen jetzt: kein `musikgenerierung-2026`, kein `wissensmanagement-2026`.

### E.5 Section E Acceptance

- [ ] Re-Import läuft sauber durch (alle 268 Files prozessiert dank forceAll)
- [ ] Erwartete Numbers stimmen (33 / 23 / 68 / 0)
- [ ] `audit/POST_FIX_VERIFICATION.md` schreibt Vor/Nach-Zahlen
- [ ] Commit: `chore: post-fix verification of toolwiki cluster state (49a-fix.5)`

---

## Final Acceptance

- [ ] Alle 5 Sections committed auf `feature/49a-fix-cleanup-import`
- [ ] Section A diagnostiziert UpsertArticles-Mystery (resolved oder als known issue dokumentiert)
- [ ] Section B fixt DB-Korruption
- [ ] Section C macht zukünftige Re-Imports robuster mit forceAll
- [ ] Section D entfernt orphaned cluster rows
- [ ] Section E verifiziert End-State

## Reporting Back

After implementation:
1. **Section A**: Was sagt diagnose-Script — Direct update funktioniert?
2. **Section B**: Migration apply + verify-SQL Output
3. **Section C**: Force-API funktioniert (curl test mit body)
4. **Section D**: Unit test grün, FK constraint check OK
5. **Section E**: Pre vs Post numbers, distinct clusters list
6. **Commit hashes** — 5 commits
7. **Deviations**

## Discovered During Implementation

(empty)

## Deviations

(empty)
