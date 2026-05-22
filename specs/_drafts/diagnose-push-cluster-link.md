# Diagnose — Push Cluster Link Error (FK violation on pipeline_runs.project_id)

**Modus: DIAGNOSE ONLY. Keine Code-Changes. ~20-30 Min.**

## Symptom

Marcel sieht periodisch Notification:

```
Pipeline failed - localhost
cluster:link-rebuild: insert or update on table "pipeline_runs"
violates foreign key constraint "pipeline_runs_project_id_proje..."
```

Notification kommt während parallele Claude-Code-Streams arbeiten — vermutlich getriggert durch astro-sync oder ähnliche Background-Aktivität.

## Was wir wissen aus früherer Diagnose (2026-05-21)

- Pipeline: `cluster:link-rebuild`
- Triggered von: `enqueueClusterLinkRebuild({ triggerType: "auto_after_sync" | "manual_cli" | "manual_http" })`
- Auto-fires aus adapter-astro-sync nach content syncs
- jobId Pattern: `link-rebuild-${clusterId}` (BullMQ dedup)
- Worker location: `packages/pipelines/src/internal-linking/`

## Hypothesen

**H1: Cluster mit orphaned project_id**
- `clusters.project_id` zeigt auf ein projects-row das nicht (mehr) existiert
- Worker liest cluster.project_id → propagiert in pipeline_runs INSERT
- FK rejected
- Möglich durch alte test-fixtures, gelöschtes Test-Project, oder migrierte Daten

**H2: NULL project_id in cluster row**
- cluster.project_id = NULL
- Worker setzt pipeline_runs.project_id = NULL
- FK violation (oder NOT NULL violation je nach Schema)

**H3: Wrong project_id resolution**
- Worker bekommt clusterId, sollte project_id aus cluster row laden
- Stattdessen: nutzt einen anderen project_id (z.B. aus job.data ohne Validation)
- Mismatch: clusters.project_id vs job.data.projectId

**H4: Race-Condition mit Project-Delete**
- Project wurde gerade gelöscht
- linkRebuild-Job war schon enqueued
- Job läuft → versucht pipeline_runs INSERT → project existiert nicht mehr
- Unwahrscheinlich aber möglich bei Test-Fixture-Cleanup

**H5: Job-Data hat stale projectId**
- BullMQ jobId Pattern `link-rebuild-${clusterId}` dedupiert
- Wenn ein älterer Job mit alter projectId noch in der Queue ist und ein neuer kommt für denselben cluster → dedup behält den alten Job
- Wenn projects-row zwischendrin gelöscht/migriert → FK violation

## Diagnose-Schritte

### Schritt 1 — Failed Pipeline-Runs identifizieren

```sql
SELECT 
  id,
  pipeline_name,
  status,
  project_id,
  error_message,
  created_at,
  input
FROM pipeline_runs
WHERE pipeline_name = 'cluster:link-rebuild'
  AND status = 'failed'
ORDER BY created_at DESC
LIMIT 20;
```

**Achten auf:**
- Wie oft schlägt es fehl? Pattern (täglich, stündlich)?
- Welche project_id wird versucht zu setzen? Oder ist es NULL?
- error_message zeigt vollen Stack-Trace mit FK-Detail

### Schritt 2 — Orphaned Clusters finden

```sql
-- Welche clusters haben project_id die nicht in projects existiert?
SELECT 
  c.id,
  c.slug,
  c.project_id,
  c.status,
  c.created_at,
  c.updated_at
FROM clusters c
LEFT JOIN projects p ON c.project_id = p.id
WHERE p.id IS NULL
  AND c.project_id IS NOT NULL;
```

**Erwartung wenn H1:** N orphaned clusters mit project_id die zu deleted projects pointen.

### Schritt 3 — Clusters mit NULL project_id

```sql
SELECT 
  id, slug, project_id, status, created_at
FROM clusters
WHERE project_id IS NULL;
```

**Erwartung wenn H2:** N clusters ohne project association.

### Schritt 4 — Failed link_rebuild_runs (falls separate Tabelle existiert)

```sql
SELECT 
  table_name 
FROM information_schema.tables 
WHERE table_name LIKE '%link_rebuild%' OR table_name LIKE '%link%';
```

Falls `link_rebuild_runs` oder ähnlich existiert:

```sql
SELECT 
  id, cluster_id, project_id, status, error_message, created_at
FROM link_rebuild_runs
WHERE status = 'failed'
ORDER BY created_at DESC LIMIT 10;
```

### Schritt 5 — Worker-Code lesen

```bash
# Wo wird pipeline_runs.project_id gesetzt im cluster:link-rebuild Worker?
grep -rn "cluster:link-rebuild\|linkRebuild\|enqueueClusterLinkRebuild" packages/pipelines/src/internal-linking/

# Plus: wie wird projectId resolved?
grep -B 5 -A 20 "linkRebuild.*project\|cluster.*project_id" packages/pipelines/src/internal-linking/
```

**Achten auf:**
- Wird `clusters.project_id` aus DB geladen oder aus job.data übernommen?
- Validation vor INSERT?
- Default-Werte?

### Schritt 6 — BullMQ Queue inspizieren

```bash
# Sind alte/stale Jobs in der cluster-link-rebuild Queue?
# Redis CLI oder BullMQ Dashboard
```

Falls möglich via BullMQ admin UI oder Redis direct:
```
KEYS bull:cluster-link-rebuild:*
LRANGE bull:cluster-link-rebuild:wait 0 -1
```

**Achten auf:**
- Stale jobs für nicht-existente cluster IDs?
- Jobs mit alter Job-Data?

### Schritt 7 — astro-sync Trigger nachvollziehen

```bash
grep -rn "enqueueClusterLinkRebuild" packages/
```

**Achten auf:**
- Wo überall wird link-rebuild triggered?
- Welche project_id wird übergeben?
- Sync-Job vs manual CLI vs HTTP — verschiedene Quellen?

## Format der Rückmeldung

```markdown
## Failed Pipeline-Runs

[Tabelle aus Schritt 1, anonymisiert wenn nötig]

- Anzahl failed: N
- Frequenz: ~M pro Tag
- error_message Pattern: [konsistent / variierend]

## Orphaned Clusters

[Aus Schritt 2 — wenn welche existieren]

- N orphaned clusters
- Beispiel: cluster_id=X, project_id=Y (gelöscht)

## NULL project_id Clusters

[Aus Schritt 3 — wenn welche existieren]

## Worker-Code Behavior

[Aus Schritt 5]
- Wie wird project_id resolved?
- Fehlt Validation vor INSERT?

## Diagnose

[Welche Hypothesen treffen zu? Konkrete Ursache?]

## Fix-Optionen (NUR Skizze, keine Implementation)

[2-3 mögliche Fix-Pfade abhängig vom Befund]
```

## Anti-Patterns

- Cluster-Code anfassen
- Pipeline-Runs anfassen
- BullMQ Jobs canceln/löschen
- Orphaned-Cleanup ohne Marcel-Approval
- Migration vorschlagen

## Hintergrund

- Notification feuert mehrmals täglich für Marcel
- Background-Stream-Activity triggert vermutlich
- 64.x Specs sind aktuell deployed/in-progress (cluster_spoke, max-Limit)
- Memory D140: Pipeline-Router Discriminated Union — pre-existing, kein 64.x-spezifischer Bug erwartet
- Phase-E Item "Push Cluster Build Link Error" ist als Mid-Priority #6 dokumentiert

Spec-Referenzen:
- Phase-E Backlog #6
- Diagnose 2026-05-21 (gestern, unverbunden mit Cluster-Routing-Diagnose)
- internal-linking Pipeline-Code in packages/pipelines/src/internal-linking/
