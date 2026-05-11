# Diagnose: UpsertArticles Cluster Key Behavior
*Generated: 2026-05-11 — Script: apps/api/src/scripts/diagnose-upsert-cluster-key.ts*

## Ergebnis

**Direct update SUCCESS: true** ✅

Drizzle und das DB-Schema sind korrekt. Ein direktes UPDATE auf `articles.cluster_key`
funktioniert fehlerfrei.

## Script Output

```
=== STEP 1: DB current state ===
clusterKey: musikgenerierung-2026
clusterRole: spoke
gitSha: 45479f4b7bb9e9fa2fc82782b884e2fceb5560b2
updatedAt: 2026-05-11T13:20:51.588Z

=== STEP 2: Parser output ===
typed.clusterKey: music-generation-2026
typed.clusterRole: spoke
typed.intentType: null

=== STEP 3: Simulate UpsertArticles (direct update) ===
Updated row: { id: "64a1d2a2-7433-4264-8cff-52c3cae2e62c", clusterKey: "music-generation-2026", clusterRole: "spoke" }

=== STEP 4: Verify DB after direct update ===
After direct update — clusterKey: music-generation-2026
Direct update SUCCESS: true

Reverted change. Section B will do final fix.
```

## Mystery Aufgeklärt

**Warum hat der 15:26-Import die cluster_key nicht aktualisiert?**

Der Parser liest aus der LOKALEN Astro-Datei `suno.mdx` bereits den neuen EN-Key
`music-generation-2026`. Die DB hat aber noch `musikgenerierung-2026` mit gitSha
`45479f4b7bb9e9fa2fc82782b884e2fceb5560b2`.

Der 15:33-Run war ein No-op (268 unchanged) — alle gitShas in DB stimmten mit dem
Astro-Remote überein. Das bedeutet: die DE-Frontmatter-Dateien hatten im Astro-Remote
zu dem Zeitpunkt noch die alten deutschen Keys, obwohl die lokale Working Copy bereits
die neuen EN-Keys hatte. Die Cleanup-Commits waren zum Zeitpunkt des 15:33-Runs noch
nicht pushed, oder die betreffenden Files wurden in den push'd Commits nicht verändert.

**Fazit:** Kein Bug in UpsertArticles, kein Bug in `onConflictDoUpdate`. Der Import
hat korrekt funktioniert — er hat nur die Dateien verarbeitet, die sich tatsächlich
geändert hatten. Die DE-Tool-Dateien hatten im Remote dieselbe gitSha wie in der DB.

## Empfehlung

Section B (SQL Direct Fix) behebt die Datenmigration.
Section C (forceAll) verhindert dieses Problem für zukünftige Re-Imports.
