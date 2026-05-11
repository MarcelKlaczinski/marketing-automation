# Marketing-Tool Diagnose-Report
*Generiert: 2026-05-11 — Branch: master*

---

## Executive Summary

| Check | Status | Notiz |
|-------|--------|-------|
| C.1 Recent imports vorhanden | ✅ | 3 Runs heute; head_commit_sha vorhanden |
| C.1 Letzter Run war echter Re-Import | ⚠️ | 15:33-Run = No-op (gleiche SHA wie 15:26) |
| C.2 Alte DE-Cluster-Rows gelöscht | ❌ | `musikgenerierung-2026` + `wissensmanagement-2026` noch aktiv (haben Members!) |
| C.2 has_hub für betroffene Cluster | ❌ | Alle 6 Cluster: `has_hub=false` — kein einziges Hub-Article zugewiesen |
| C.3 Articles cluster_key aktuell | ⚠️ | DE-Articles: alte DE-Keys; EN-Articles: neue EN-Keys — spiegelt Frontmatter |
| C.4 Cursor-Article cluster_role='hub' | ✅ | `cursor-vs-github-copilot-2026` → role=hub, joined zu `ai-coding-tools-2026` |
| D.1 onConflictDoUpdate hat cluster fields | ✅ | clusterKey, clusterRole, intentType alle im `set:` |
| D.2 SyncClusters in Pipeline registriert | ✅ | An Position 6 (nach LinkTranslationPairs) |
| D.3 SyncClusters löscht orphans | ❌ | **Keine delete-Logik vorhanden** — orphaned Cluster-Rows bleiben ewig |
| D.4 Bridge liefert projectId an SyncClusters | ✅ | Bridge korrekt verdrahtet |
| E.1 source_sha matched Astro HEAD | ⚠️ | Spalte heißt `head_commit_sha`; Abgleich mit Astro-Repo nötig |

---

## Detaillierte Outputs

### C.1 — Recent astro_import_runs (toolwiki)

```
id                                   | status    | started_at                    | finished_at                | head_commit_sha                          | articles_inserted | articles_updated | articles_unchanged
-------------------------------------+-----------+-------------------------------+----------------------------+------------------------------------------+-------------------+------------------+--------------------
ed9cca3f-99d8-45a5-ad85-4f9f8c46340b | succeeded | 2026-05-11 15:33:52 +02       | 2026-05-11 15:33:53 +02    | 60cbbb1b67c9f101fd99df236af9c1ef6b7e0154 | 0                 | 0                | 268
f3335826-ae4b-4f73-b9cd-9936029e21a3 | succeeded | 2026-05-11 15:26:10 +02       | 2026-05-11 15:26:12 +02    | 60cbbb1b67c9f101fd99df236af9c1ef6b7e0154 | 0                 | 14               | 254
5d696c4f-b3fc-4e4f-942c-f76c94988c3c | succeeded | 2026-05-11 15:20:47 +02       | 2026-05-11 15:20:51 +02    | d36d8ed08c3d634000cf9eda3924375dc4ca3153 | 0                 | 47               | 221
56f8eb5a-01fe-4b4b-8cee-3ddc6506e4ea | succeeded | 2026-05-11 11:40:48 +02       | 2026-05-11 11:40:50 +02    | 12dcd4dc4b460c2b99ceadcf850e7895ddf4df7b | 0                 | 0                | 268
89b4c0bc-7f59-4146-af7b-e3b174b22b9d | succeeded | 2026-05-08 19:45:25 +02       | 2026-05-08 19:45:37 +02    | be3691c4f4cbd9dfee2587e0ed66bc66eb9a111e | 268               | 0                | 0
```

**Beobachtung:** 
- 15:33 (268 unchanged, 0 updated) ist ein **No-op** — identische SHA wie 15:26. FilterChangedFiles sah keine geänderten gitSha-Werte → UpsertArticles und SyncClusters bekamen 0 zu tun.
- 15:26 (14 updated) und 15:20 (47 updated) haben tatsächlich importiert, verschiedene SHAs.
- Schema: Spalte heißt `head_commit_sha` (nicht `source_sha`).

---

### C.2 — Clusters Table Stand

```
name                       | has_hub | pillar                | members
---------------------------+---------+-----------------------+---------
code-assistants-2026       | false   | coding-development    | 2
code-comparisons-2026      | false   |                       | 2
knowledge-management-2026  | false   | business-productivity | 4
music-generation-2026      | false   | audio-music           | 3
musikgenerierung-2026      | false   | audio-music           | 3
wissensmanagement-2026     | false   | business-productivity | 4
```

**Beobachtungen:**
- Alle 6 Cluster existieren und haben Members.
- `musikgenerierung-2026` und `wissensmanagement-2026` sind **nicht orphaned** — DE-Articles zeigen noch auf sie.
- **has_hub=false für alle 6** — kein Hub-Article in keinem dieser Cluster.
- `code-assistants-2026`: nur 2 Members, locale=en only → DE-Articles nutzen `code-assistenten-2026`.

---

### C.3 — Articles für Music + Knowledge Tools

```
slug         | locale | cluster_key               | cluster_role | joined_cluster_name
-------------+--------+---------------------------+--------------+---------------------------
mem-ai       | de     | wissensmanagement-2026    | spoke        | wissensmanagement-2026
mem-ai       | en     | knowledge-management-2026 | spoke        | knowledge-management-2026
notion-ai    | de     | wissensmanagement-2026    | spoke        | wissensmanagement-2026
notion-ai    | en     | knowledge-management-2026 | spoke        | knowledge-management-2026
reflect      | de     | wissensmanagement-2026    | spoke        | wissensmanagement-2026
reflect      | en     | knowledge-management-2026 | spoke        | knowledge-management-2026
stable-audio | de     | musikgenerierung-2026     | spoke        | musikgenerierung-2026
stable-audio | en     | music-generation-2026     | spoke        | music-generation-2026
suno         | de     | musikgenerierung-2026     | spoke        | musikgenerierung-2026
suno         | en     | music-generation-2026     | spoke        | music-generation-2026
tana         | de     | wissensmanagement-2026    | spoke        | wissensmanagement-2026
tana         | en     | knowledge-management-2026 | spoke        | knowledge-management-2026
udio         | de     | musikgenerierung-2026     | spoke        | musikgenerierung-2026
udio         | en     | music-generation-2026     | spoke        | music-generation-2026
```

**Beobachtung:** DB ist ein treuer Spiegel des Astro-Frontmatters: DE-Articles haben deutsche Cluster-Keys, EN-Articles englische. Alle `cluster_role='spoke'` — keine Hub-Articles in diesen Clustern.

---

### C.4 — Cursor/Windsurf/Codeium Comparisons

```
slug                                | locale | cluster_role | cluster_key           | joined_cluster_name
------------------------------------+--------+--------------+-----------------------+-----------------------
cursor-vs-github-copilot-2026       | de     | hub          | ai-coding-tools-2026  | ai-coding-tools-2026
cursor-vs-github-copilot-2026       | en     | hub          | ai-coding-tools-2026  | ai-coding-tools-2026
cursor-vs-windsurf-vs-codeium-2026  | de     | spoke        | code-comparisons-2026 | code-comparisons-2026
cursor-vs-windsurf-vs-codeium-2026  | en     | spoke        | code-comparisons-2026 | code-comparisons-2026
```

**Beobachtung:** `cursor-vs-github-copilot-2026` hat korrekt `cluster_role='hub'` und ist im `ai-coding-tools-2026` Cluster. Aber: `ai-coding-tools-2026` taucht in C.2 nicht auf (nicht in der abgefragten Liste) → separate Cluster-Row existiert, wurde aber nicht gezeigt. Das `code-comparisons-2026` Cluster in C.2 hat `has_hub=false`.

---

### C.5 — Distinct cluster_key Werte (tools collection)

```
cluster_key                | count | locales
---------------------------+-------+---------
ai-agents-2026             | 6     | de, en
ai-image-tools-2026        | 6     | de, en
audio-2026                 | 2     | de, en
avatar-voice-2026          | 6     | de, en
bildgenerierung-2026       | 10    | de, en
chatbots-2026              | 8     | de, en
code-assistants-2026       | 2     | en        ← NUR en
code-assistenten-2026      | 6     | de, en
content-2026               | 6     | de, en
content-marketing-2026     | 2     | de, en
knowledge-management-2026  | 4     | en        ← NUR en
music-generation-2026      | 3     | en        ← NUR en
musikgenerierung-2026      | 3     | de        ← NUR de
praesentation-2026         | 4     | de, en
produktivitaet-2026        | 4     | de, en
recherche-2026             | 8     | de, en
sprachen-2026              | 2     | de, en
uebersetzung-2026          | 6     | de, en
video-2026                 | 4     | de, en
video-ki-2026              | 8     | de, en
voice-cloning-2026         | 4     | de, en
wissensmanagement-2026     | 4     | de        ← NUR de
```

**Befund:** Locale-Asymmetrie für musik/knowledge/code-assistants: DE nutzt deutsche Keys, EN nutzt englische Keys. Diese coexistieren als separate Cluster-Rows. Alle anderen Cluster haben beide Locales unter einem Key.

---

### D.1 — UpsertArticlesStep onConflictDoUpdate

```typescript
.onConflictDoUpdate({
  target: [articles.projectId, articles.source, articles.collection, articles.locale, articles.slug],
  set: {
    title: ...,
    ...
    // Spec 49a: cluster metadata
    clusterKey: (typed.clusterKey as string | null) ?? null,    ✅
    clusterRole: (typed.clusterRole as "hub" | "spoke" | null) ?? null,  ✅
    intentType: (typed.intentType as string | null) ?? null,    ✅
    ...
  }
})
```

**Status: ✅** — Alle drei Cluster-Felder sind im `set:` vorhanden. Re-Import überschreibt diese Werte korrekt.

---

### D.2 — Pipeline Steps Registrierung

```typescript
readonly steps = [
  new ListContentFilesStep(),
  new FilterChangedFilesStep(),
  new ParseFrontmatterBatchStep(),
  new UpsertArticlesStep(),
  new LinkTranslationPairsStep(),
  new SyncClustersFromFrontmatterStep(),  ✅
  new UpdateImportRunStep(),
] as const;
```

**Status: ✅** — SyncClusters ist korrekt in der Pipeline registriert.

---

### D.3 — SyncClustersFromFrontmatterStep: Orphan-Logik

Grep-Output: **leer** — keine delete/DELETE/orphan-Logik gefunden.

**Vollständige Step-Logik:**
1. SELECT distinct `(clusterKey, category)` aus articles WHERE `clusterKey IS NOT NULL`
2. Upsert contentPillars für distinct categories
3. Für jeden clusterKey: SELECT members → upsert cluster row (insert oder update)
4. UPDATE articles SET `clusterId` für alle Members
5. COUNT articles ohne clusterKey (uncategorized)

**Was fehlt:** Kein `DELETE FROM clusters WHERE projectId = ? AND name NOT IN (distinctClusterKeys)`.

**Status: ❌** — Wenn ein Frontmatter einen Cluster-Key umbenennt (z.B. von `musikgenerierung-2026` zu `music-generation-2026`):
- DE-Articles: clusterKey bleibt `musikgenerierung-2026` (Frontmatter unverändert)
- EN-Articles: clusterKey wechselt zu `music-generation-2026`  
- Alter Cluster `musikgenerierung-2026`: behält seine Members → wird NICHT gelöscht
- Keine alte Cluster-Row wird jemals bereinigt, außer durch manuelles SQL

---

### D.4 — Bridge zu SyncClusters

```typescript
if (fromStep.name === "link-translation-pairs" && toStep.name === "sync-clusters-from-frontmatter") {
  return { projectId: pipelineInput.projectId };
}
```

**Status: ✅** — Korrekt. `projectId` wird übergeben.

---

### E.1 — head_commit_sha vs Astro HEAD

| Run | head_commit_sha | articles_updated |
|-----|-----------------|------------------|
| 15:33 | `60cbbb1b...` | 0 (No-op, gleiche SHA wie 15:26) |
| 15:26 | `60cbbb1b...` | 14 |
| 15:20 | `d36d8ed0...` | 47 |

**Abgleich mit tatsächlichem Astro-HEAD:** Benötigt Zugriff auf das Astro-Repo. Wenn `60cbbb1b` == aktueller HEAD des Astro-Repos, dann war der Import korrekt und der Bug liegt in der Cluster-Logik (DE-Frontmatter nicht geändert + kein Hub-Article).

---

## Diagnose-Hypothese

### Hauptbefund: Das "Problem" ist kein Import-Bug

**Warum cluster counts unverändert nach Re-Import:**

1. **15:33 Run war ein No-op** — gleiche SHA `60cbbb1b` wie 15:26. FilterChangedFiles sieht 268 gitSha-Matches → 0 changed → SyncClusters läuft zwar, findet aber denselben DB-State.

2. **DE-Frontmatter verwendet andere Cluster-Keys als EN** — Dies ist by design (oder ein Astro-Repo-State-Problem):
   - DE: `musikgenerierung-2026`, `wissensmanagement-2026`, `code-assistenten-2026`
   - EN: `music-generation-2026`, `knowledge-management-2026`, `code-assistants-2026`
   - Solange das Astro-Frontmatter für DE-Articles die deutschen Keys hat, erstellt SyncClusters zwei separate Cluster-Rows.

3. **has_hub=false für alle betroffenen Cluster** — Es gibt keine Articles mit `clusterRole='hub'` in diesen Clustern. Entweder:
   - Das Astro-Frontmatter setzt `clusterRole: hub` für keines dieser Articles
   - Oder die Hub-Articles (z.B. ein "Best Music Generation Tools 2026" Artikel) existieren noch nicht

### Echte Bugs gefunden

**Bug 1 (D.3): Keine Orphan-Deletion in SyncClusters** ❌  
Wenn Frontmatter einen Cluster-Key umbenennt und alle Articles migriert sind, bleibt die alte Cluster-Row mit 0 Members ewig in der DB. Aktuell kein Problem (DE-Articles zeigen noch auf alte Keys), aber wird zum Problem sobald DE-Frontmatter ebenfalls auf englische Keys umstellt.

**Bug 2 (Astro-Repo-State): Locale-asymmetrische Cluster-Keys** ⚠️  
Nicht im Marketing-Tool, aber im Astro-Repo: DE-Articles (`suno`, `udio`, etc.) haben noch alte deutsche Cluster-Keys im Frontmatter. Wenn gewünscht ist, dass Cluster bilingual sind (DE+EN unter einem Key), müssen DE-Frontmatter-Files auf englische Keys umgestellt werden.

---

## Empfohlene Aktion

### Sofort-Check (E.1)
```bash
# Im Astro-Repo: HEAD commit prüfen
git -C <astro-repo-path> rev-parse HEAD
# Erwartung: 60cbbb1b67c9f101fd99df236af9c1ef6b7e0154
# Wenn Match: Import war korrekt, Bug liegt in Astro-Frontmatter
```

### Fix 1: Orphan-Deletion zu SyncClusters hinzufügen
Nach Step 3 (alle cluster keys verarbeitet) in `sync-clusters-from-frontmatter.ts`:
```typescript
// Delete cluster rows with no members (orphaned after key rename)
const activeClusterKeys = distinctClusterKeys;
if (activeClusterKeys.length > 0) {
  const orphaned = await db
    .delete(clusters)
    .where(
      and(
        eq(clusters.projectId, projectId),
        notInArray(clusters.name, activeClusterKeys)
      )
    )
    .returning({ id: clusters.id });
  log.info({ orphanedDeleted: orphaned.length }, "Deleted orphaned cluster rows");
}
```

### Fix 2: Astro-Repo DE-Frontmatter migrieren (falls gewünscht)
Falls Cluster bilingual sein sollen (ein Cluster, beide Locales):
- DE-Articles: `musikgenerierung-2026` → `music-generation-2026`
- DE-Articles: `wissensmanagement-2026` → `knowledge-management-2026`  
- DE-Articles: `code-assistenten-2026` → `code-assistants-2026`

### Fix 3: Hub-Articles definieren
Für `has_hub=true` braucht jeder Cluster mindestens ein Article mit `clusterRole: hub` im Astro-Frontmatter. Aktuell sind alle Music/Knowledge/Code-Articles als `spoke` getaggt.
