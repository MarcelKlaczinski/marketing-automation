# Mini-Discovery — gap_analysis Brief-Source

**Modus: DISCOVERY ONLY. ~10 Min. Keine Code-Changes, keine Spec-Änderungen.**

## Kontext

Theme-63-Discovery hat 156 pending `gap_analysis` Briefs in der `topic_briefs` Tabelle für Toolwiki gefunden — alle mit `cluster_action='append_to_existing'`. Marcel will verstehen:

- Was ist `gap_analysis` als Brief-Source?
- Sind die 156 Briefs qualitativ gut (potenzielles Content-Gold) oder long-tail-Müll?
- Wer/wann generiert sie?
- Warum sind alle pending — fehlt ein Approve-Workflow?
- Falls Workflow fehlt: hat Marcel überhaupt UI-Mittel um sie zu reviewen?

Entscheidung danach: gap_analysis als 63.6 angehen (Approve-Workflow) oder defer'n.

## Discovery-Aufgaben

### Schritt 1 — Was ist gap_analysis konkret?

```bash
# Wo wird gap_analysis als Brief-Source produziert?
grep -rn "gap_analysis\|GapAnalysis\|gapAnalysis" packages/planner/src/ packages/pipelines/src/

# Welche Code-Pfade emittieren Briefs mit source='gap_analysis'?
grep -A 20 "source.*gap_analysis\|gap_analysis.*source" packages/
```

Dokumentieren:
- Welcher Code generiert diese Briefs?
- Wann läuft das? Cron? On-demand? Pipeline-Step?
- Welche Datenquelle nutzt es (article-titles, cluster-embeddings, search-queries)?

### Schritt 2 — Was steht in den 156 Briefs?

```sql
-- Top-30 Sample mit allen relevanten Feldern
SELECT 
  topic_title,
  suggested_title,
  intent_type,
  cluster_action,
  parent_cluster_id,
  metadata,
  created_at
FROM topic_briefs
WHERE source = 'gap_analysis'
  AND project_id = (SELECT id FROM projects WHERE slug = 'toolwiki')
ORDER BY created_at DESC
LIMIT 30;
```

```sql
-- Verteilung über Clusters (welche Hubs werden gefüttert?)
SELECT 
  c.slug AS cluster_slug,
  c.topic_title AS cluster_topic,
  COUNT(tb.id) AS pending_spokes
FROM topic_briefs tb
JOIN clusters c ON tb.parent_cluster_id = c.id
WHERE tb.source = 'gap_analysis'
  AND tb.status = 'pending'
  AND tb.project_id = (SELECT id FROM projects WHERE slug = 'toolwiki')
GROUP BY c.id, c.slug, c.topic_title
ORDER BY pending_spokes DESC
LIMIT 20;
```

```sql
-- Intent-Verteilung
SELECT 
  intent_type,
  COUNT(*) AS count
FROM topic_briefs
WHERE source = 'gap_analysis'
  AND project_id = (SELECT id FROM projects WHERE slug = 'toolwiki')
GROUP BY intent_type
ORDER BY count DESC;
```

Dokumentieren:
- Stichprobe Top-30 Topic-Titles: sehen die nach Quality-Content aus oder long-tail/spammy?
- Welche existierenden Clusters werden gefüttert? Top 20 mit pending-Spoke-Count
- Sind das Themen die Toolwiki's Audience interessieren würden?

### Schritt 3 — Approve-Workflow

```bash
# Gibt es einen Auto-Approve-Mechanismus für gap_analysis?
grep -rn "gap_analysis.*approve\|approve.*gap_analysis\|autoApprove" packages/

# Wie werden andere Brief-Sources approved (trend, comparison)?
grep -A 15 "POST.*briefs.*approve\|approveBrief" apps/api/src/routes/
```

Dokumentieren:
- Gibt es manuelle Approve-Routes für Briefs?
- Hat Marcel im UI eine Möglichkeit Briefs zu reviewen + approven?
- Werden andere Brief-Sources auto-approved, gap_analysis aber nicht? (Inkonsistenz?)

### Schritt 4 — Können die 156 Briefs zu Plan-Items werden?

```bash
# SelectFloor- und SelectOverage-Step: welche Status erwarten sie?
grep -A 10 "status.*approved\|brief.status\|inArray.*status" \
  packages/pipelines/src/planning/steps/select-floor-items.ts \
  packages/pipelines/src/planning/steps/select-overage-items.ts
```

Dokumentieren:
- Akzeptieren die Steps nur `status='approved'`?
- Falls ja: alle 156 pending Briefs sind dem Plan-Generator unsichtbar bis approved

## Format der Rückmeldung an Marcel

```markdown
## gap_analysis — was ist das

[Code-Pfad, Trigger-Mechanik, Datenquelle, in 3-5 Sätzen]

## Inhaltliche Stichprobe (Top-30)

[Liste oder Tabelle der Topic-Titles, mit Marcel-Einschätzbarem Quality-Signal]

## Cluster-Verteilung

[Top-20 Clusters mit pending-Spoke-Count]

## Intent-Verteilung

[knowledge/tutorial/comparison/etc. counts]

## Approve-Workflow-Status

- Auto-Approve: ja/nein/wo?
- Manueller Approve-Endpoint: ja/nein
- UI für Marcel: ja/nein/sichtbar wo?

## Diagnose

[1-3 Sätze: ist gap_analysis Gold oder Müll? Fehlt nur Approve-Workflow?]

## Empfehlung

- Option A: 63.6 Approve-Workflow bauen (Aufwand-Schätzung)
- Option B: gap_analysis als Source deaktivieren (wenn Quality schlecht)
- Option C: defer + nach Theme 63 echte Daten ansehen
```

**NICHT IMPLEMENTIEREN.** Marcel entscheidet danach.

## Anti-Patterns

- Approve-Workflow während Discovery schon bauen
- Brief-Schema ändern
- 62.8 oder 63.x Code anfassen

## Hintergrund

- Theme 63 Discovery hat das hier gefunden
- Memory aktuell sauber bei 9/30
- Findings landen vermutlich entweder als 63.6 oder im Phase-E-Backlog Doc
