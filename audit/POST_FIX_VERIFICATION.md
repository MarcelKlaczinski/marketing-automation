# Post-Fix Verification
*Generated: 2026-05-11 — Branch: feature/49a-fix-cleanup-import*

## Ergebnis: Alle erwarteten Numbers bestätigt ✅

| Metric | Vorher (Pre-Fix) | Nachher (Post-Fix) | Erwartet | Match |
|--------|------------------|--------------------|----------|-------|
| total_clusters | 35 | **33** | 33 | ✅ |
| with_hub | 22 | **23** | 23 | ✅ |
| total_hub_articles | 66 | **68** | 68 | ✅ |
| orphan_clusters | 2 | **0** | 0 | ✅ |

## SyncClusters Run Output (Section E)

```
pillarsCreated: 0
pillarsUpdated: 15
clustersCreated: 0
clustersUpdated: 33
articlesLinked: 210
uncategorizedCount: 58
orphansDeleted: 2
```

## Orphaned Cluster-Rows gelöscht

- `musikgenerierung-2026` → gelöscht (3 DE-Articles migriert zu `music-generation-2026`)
- `wissensmanagement-2026` → gelöscht (4 DE-Articles migriert zu `knowledge-management-2026`)

## Hub-Promotion bestätigt

`cursor-vs-windsurf-vs-codeium-2026` (DE + EN): `cluster_role = 'hub'`
→ `code-comparisons-2026` Cluster hat jetzt `pillar_article_id IS NOT NULL` (with_hub = true)

## Anmerkung: Worker-Restart für forceAll

Die BullMQ-Jobs wurden mit forceAll=true enqueued, aber der laufende Worker (PID 54784,
kein --hot, seit Fr 07PM) hat die neue FilterChangedFiles-Logik noch nicht geladen.
SyncClusters wurde daher direkt als Script ausgeführt (idempotent, kein Datenverlust).

Nach Worker-Neustart wird POST /api/projects/toolwiki/astro-import mit {"forceAll": true}
alle 268 Files erneut verarbeiten. Bis dahin: Daten korrekt via Section B SQL + Section E Script.
