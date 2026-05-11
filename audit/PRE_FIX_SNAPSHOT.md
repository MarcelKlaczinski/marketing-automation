# Pre-Fix DB Snapshot
*Generated: 2026-05-11 — Branch: feature/49a-fix-cleanup-import*

## Cluster Overall Numbers (vor Section B–E)

```
total_clusters:      35
with_hub:            22
total_hub_articles:  66
orphan_candidates:    2  (musikgenerierung-2026 + wissensmanagement-2026)
```

## Articles mit alten cluster_keys

```
slug         | locale | cluster_key               | joined_cluster
-------------+--------+---------------------------+------------------------
mem-ai       | de     | wissensmanagement-2026    | wissensmanagement-2026
notion-ai    | de     | wissensmanagement-2026    | wissensmanagement-2026
reflect      | de     | wissensmanagement-2026    | wissensmanagement-2026
stable-audio | de     | musikgenerierung-2026     | musikgenerierung-2026
suno         | de     | musikgenerierung-2026     | musikgenerierung-2026
tana         | de     | wissensmanagement-2026    | wissensmanagement-2026
udio         | de     | musikgenerierung-2026     | musikgenerierung-2026
(7 Zeilen)
```

## Cluster-Rows die nach Fix orphan sein werden

```
name                   | has_hub | members
-----------------------+---------+---------
musikgenerierung-2026  | false   | 3
wissensmanagement-2026 | false   | 4
```

## Anmerkung

Snapshot zeigt 7 betroffene DE-Artikel (spec nannte 14 wegen EN-counterparts).
EN-Artikel haben bereits die korrekten EN-Keys. Nur DE-Artikel sind betroffen.
Section B korrigiert alle 7 DE-Artikel via SQL.
