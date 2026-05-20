# Theme 62 — Content-Planner: Discovery-Prompt für Claude Code

## Auftrag

Wir bauen Theme 62: einen Content-Planner für das Marketing-Tool. Bevor wir Spec 62.0 (Foundation: PipelineRunner + Step-Pause) schreiben, brauche ich eine **belastbare Discovery gegen Code und DB** — keine Paper-Annahmen. Lessons-Learned aus 54er: Implementation-Reports ≠ Production-Reality, daher Phase 1 = DB-Reality-Check via SQL, Phase 2 = Code-Inventur via Grep/Read, Phase 3 = Findings-Report.

**Wichtig:** Du schreibst in dieser Discovery KEINEN Code. Du sammelst Fakten und lieferst am Ende einen Markdown-Findings-Report unter `docs/specs/62-content-planner/00-discovery-findings.md`.

---

## High-Level-Ziel (zur Orientierung, NICHT zu implementieren)

Theme 62 plant pro Projekt (Start: Toolwiki) eine Woche Content vor:
- 1 voller Cluster pro Tag (Hub + Spokes, DE + EN-Sibling)
- ≥1 Comparison pro Woche
- ⌀3 Social Posts pro Tag (Mix: heutiger Cluster + Refresh-Pool + Suggestions)
- ≥3 KI-Wissen-Themen pro Woche
- Floor-Cadence: Ziele sind Minimum, Übererfüllung bei starken Signalen erlaubt
- Hartes globales Budget €50/Woche, +15% Safety-Buffer im Pre-flight
- Step-by-Step-Pause im Debug-Mode (jeder BaseStep pausierbar)
- Production-Mode = batch-fähig, kein Step-Pause
- Cron via UI-Toggle (default off) + on-demand

Wir planen 9 Sub-Specs (62.0–62.8). Die Discovery muss alle informieren.

---

## Phase 1 — DB-Reality-Check (SQL)

Verbinde dich gegen die Marketing-Tool DB. Liefere für jeden Punkt **exakte Befunde** (Tabellennamen wie sie heißen, Spaltennamen, Counts, Beispiel-Rows wo sinnvoll).

### 1.1 Bestätige Existenz und Schema dieser Tabellen
Für jede: `\d <tabelle>` (oder Drizzle-Schema-Datei lesen) + Row-Count + 2 Beispiel-Rows.

- `articles`
- `article_discovery`
- `template_renders`
- `cost_logs`
- `batch_requests`
- `tools`
- `clusters` (falls existent — sonst notieren wie Cluster modelliert sind)

### 1.2 Suche nach Planning/Scheduling-Tabellen
Liste ALLE Tabellen mit Namen die irgendwas mit Plan, Schedule, Goal, Cadence, Calendar enthalten. Auch wenn unbenutzt. Wenn keine: explizit notieren "Keine Planning-Tabellen vorhanden".

### 1.3 Prompt-Storage
Wo leben Prompts heute? File-based in `packages/*/prompts/`? Oder gibt's eine `prompts` Tabelle? Suche nach beidem. Wenn file-based: liste die Prompt-Files (Pfade) und gib für 3 davon die Struktur an (sind sie versioniert? gibt's Metadaten? wie wird der aktive Prompt gewählt?).

### 1.4 Pipeline-Run-Persistenz
Suche nach Tabellen oder Konstrukten, in denen Pipeline-Runs persistiert werden (Status, currentStep, runId, etc.). Spez. Frage: Wenn heute ein BullMQ-Job läuft, wo wird der State außerhalb von Redis abgelegt? Falls nirgends: explizit notieren.

### 1.5 Signal-Snapshots
Gibt's eine Tabelle für persistierte externe Signale (Google Trends, RSS, etc.)? Oder werden Signal-Adapter on-demand ausgeführt ohne Cache? Liste die ExternalSignalSource-Implementierungen (aus `class implements ExternalSignalSource<Input>`).

### 1.6 Cost-Logs Analyse
Aus `cost_logs`:
- Verteilung der `service`-Werte (mit Counts)
- Verteilung der `operation`-Werte
- Durchschnittskosten pro Operation (letzten 30 Tage)
- Maximale Kosten pro Operation
- Wie sind Batch-Calls markiert (61.4: `service="anthropic" operation="batch:<model>"`) — bestätigen
- Letzten 10 Einträge mit Datum

### 1.7 Article-Discovery State
Aus `article_discovery`:
- Counts pro Discovery-Type (Trends / Gaps / Refresh)
- Wie alt sind die Einträge (oldest, newest, p50)
- Verteilung pro Locale falls vorhanden
- Beispiel-Row je Type

---

## Phase 2 — Code-Inventur

### 2.1 Pipeline-Inventur
Liste alle existierenden Pipelines:
- Datei-Pfad
- Pipeline-Name (Konstante)
- Steps (Reihenfolge, Step-Keys)
- Welche Steps machen LLM-Calls (sync vs. batch-fähig)
- Welche Pipelines haben `batchPending`-Signal-Verwendung (61.4)
- Welche Pipelines können heute via `enqueuePipeline(pipelineName)` gestartet werden

**Speziell prüfen:**
- ClusterGenerationPipeline (54.12) — komplette Step-Liste
- TranslationPipeline (54.10)
- ArticleRefreshPipeline (58.1)
- SocialRenderPipeline (Remotion)
- BlogPipeline / ComparisonPipeline / UseCasePipeline (61.1–61.3)

### 2.2 BaseStep / PipelineRunner Architektur
- Wo lebt `BaseStep` (Pfad)?
- Welche Methoden hat sie? (`run`, `shouldRun`, `skipOutput`, …)
- Wie wird heute ein Step ausgeführt — gibt's einen zentralen Runner oder ruft jede Pipeline Steps direkt auf?
- Wie ist `batchPending` heute implementiert? Liefere den exakten Code-Pfad (typischerweise irgendwo "if step returns batchPending Signal → Pipeline suspend → custom_id-Persistenz → resume on completion").
- Wie funktioniert Resume? `enqueuePipeline()` mit welchem Mechanismus an genau die richtige Stelle zurückzukommen?

### 2.3 LLM-Adapter
- Welche Adapter existieren (Anthropic, evtl. weitere)?
- Wie wird heute zwischen Sync und Batch entschieden?
- Gibt's bereits einen `forceSync`-Param oder müssen wir den einführen?
- Cost-Logging-Hook: wo wird `cost_logs` geschrieben (im Adapter? im Step? im Runner?)

### 2.4 Signal-Adapter
- Welche `ExternalSignalSource<Input>` Implementierungen gibt's?
- Sind sie alle aktuell befüllt? (Letzte erfolgreiche Ausführung pro Source)
- Welche externen APIs werden konsumiert (Google Trends, RSS, X, …)?
- Wie werden Auth/API-Keys gehalten (via `getEnv()`?)

### 2.5 Discovery-Module
- `ContentDiscoveryUI` (56.6) — welche Backend-Endpoints konsumiert sie?
- Trends, Gaps, Refresh — gibt's für jeden ein Discovery-Modul auf Backend-Seite?
- Wie würde ein **ComparisonDiscovery**-Modul aussehen, das es noch nicht gibt? Welche Inputs bräuchte es (Tool-Paare, Co-Mentions, …)?

### 2.6 Sibling-Locale-Logik
- Wo lebt aktuell die `translationKey`-Logik?
- Wie wird heute der EN-Sibling erzeugt (gleiche Pipeline mit anderem Locale? eigene Pipeline?)
- 60.7-Lesson: "Sibling-Skip silent" — bestätige wo das passiert, und beschreibe wie ein Planner das proaktiv im Plan-Schritt detecten könnte

### 2.7 BullMQ-Queue-Inventur
- Liste alle Queues + Worker-Files in `apps/api/src/workers/`
- Concurrency-Settings pro Queue
- Attempts pro Queue (insbesondere: welche sind `attempts=1` für paid jobs?)
- Rate-Limits

### 2.8 UI-Layer (Marketing-Tool Frontend)
- Wo leben Vue-Pages (Options API)?
- Wie sieht die aktuelle Cmd+K-Integration aus (welche Aktionen)?
- Wo lebt Cron-Konfiguration heute (falls existent)?
- Gibt's bereits irgendeinen Kalender-View?
- Wo ist Settings-UI (für Cron-Toggle später)?

---

## Phase 3 — Gap-Analyse & Findings

### 3.1 Liefere eine Tabelle "Vorhanden vs. Fehlend" für Theme 62
Spalten: Komponente | Status (vorhanden / teilweise / fehlt) | Pfad falls vorhanden | Bemerkung

Bewerte mindestens:
- PipelineRunner mit generischem Suspend/Resume
- Step-Level Pause-Mechanik (jenseits batchPending)
- Step-Pause-Persistenz (Input + Output je Step)
- Resume-Action-Handler (approve/edit-output/edit-prompt/edit-input/abort/promote-golden/extract-for-optimization)
- Prompt-Versionierung als systematische Struktur
- Golden-Set Definition
- `project_goals` Tabelle
- `goal_overage_policies` Tabelle
- `weekly_plans` Tabelle
- `planned_items` Tabelle
- `pipeline_runs` Tabelle
- `step_pauses` Tabelle
- `step_optimization_requests` Tabelle
- `prompt_versions` Storage
- `signal_snapshots` Tabelle
- `content-planner` BullMQ-Queue + Worker
- `PlanWeekPipeline`
- `CostEstimator`-Modul mit Pre-flight aus cost_logs
- ComparisonDiscovery-Modul
- Goal-Editor-UI
- Weekly-Plan Kalender-UI
- Approval-Flow-UI
- Debug-Run Step-Inspector-UI (mit JSON-Editor, Prompt-Editor, 7 Actions inkl. extract-for-optimization)
- Cron-Toggle in Settings
- Quarantäne-View
- Notification (Mail) bei Plan-Ready

### 3.2 Risiken & Stolpersteine
Aus deinem Discovery-Befund: welche Annahmen aus der Paper-Discovery stimmen NICHT? Was wird komplizierter als erwartet? Beispiele die du speziell prüfen sollst:

- Greift `batchPending` heute wirklich nur in Step-Mitte oder gibt's da Edge-Cases?
- Sind Steps idempotent genug, dass ein Resume nach Edit-Input keine Side-Effects doppelt produziert?
- Wenn ein Step "Approve" bekommt aber sein Output ist JSONB mit Key-Order-Bug (60.0b-Lesson) — wie persistieren wir das deterministisch?
- Gibt's Cross-Pipeline-Dependencies, die ein Wochenplan-Scheduler beachten muss (z.B. SocialRender braucht fertiges Article-Render, also nicht beide am gleichen Tag wenn Articles länger dauern)?
- Wie verhalten sich heute Failures innerhalb einer Pipeline — wird der ganze Run gekillt oder gibt's Step-Level-Retry?
- 60.7 Multi-locale silent-skip: ist das ein Bug oder ein Feature, das der Planner ersetzen soll?

### 3.3 Konkrete Quickwin-Bestätigung
Bestätige (oder widerlege mit Befund) folgende Quickwins für Spec 62.0:

1. Dry-Run-Modus für Plan-Generierung (LLM-Calls geskippt, nur Cost-Estimate) — implementierbar mit aktueller Adapter-Architektur?
2. Sibling-Locale-Aware Planning vorab im Plan-Step — wirklich machbar oder strukturelle Hürde?
3. Failed-Step-Quarantäne (Rest der Items läuft weiter) — kollidiert das mit aktuellem BullMQ-Pattern?

### 3.4 Vorschlag zur Reihenfolge
Aus deinem Discovery-Befund: ist die geplante Sub-Spec-Reihenfolge sinnvoll oder gibt's eine Dependency die wir übersehen?

Geplant:
- 62.0 Foundation (PipelineRunner + Step-Pause)
- 62.1 Prompt-Versionierung + Golden-Set + `step_optimization_requests`
- 62.2 Goals + Cadence-DSL
- 62.3 Signal-Refresh + Cost-Estimator + ComparisonDiscovery
- 62.4 Planner-Engine (PlanWeekPipeline)
- 62.5 Kalender-UI + Approval-Flow
- 62.6 Debug-Run Step-Inspector (inkl. extract-for-optimization)
- 62.7 Cron-Trigger + Quarantäne-View
- 62.8 Production-Run + Batch-API-Integration

Offene Frage explizit beantworten: **Sollten 62.0 und 62.1 zusammengelegt werden**, weil Step-Pause-Persistenz und Prompt-Versionierung beide "Foundation für alles andere" sind und sich gegenseitig brauchen?

---

## Output-Format

Schreibe alle Findings in `docs/specs/62-content-planner/00-discovery-findings.md` mit folgender Struktur:

```markdown
# Theme 62 — Discovery Findings

## Executive Summary
[3–5 Sätze: was existiert, was fehlt grob, welche Risiken]

## Phase 1 — DB-Reality-Check
[je Sub-Punkt 1.1–1.7 mit Befund]

## Phase 2 — Code-Inventur
[je Sub-Punkt 2.1–2.8 mit Befund]

## Phase 3 — Gap-Analyse & Findings
### 3.1 Vorhanden vs. Fehlend (Tabelle)
### 3.2 Risiken & Stolpersteine
### 3.3 Quickwin-Bestätigung
### 3.4 Reihenfolge-Empfehlung (inkl. 62.0+62.1 Merge-Frage)

## Empfehlungen für Marcel
[konkrete Fragen die Marcel beantworten muss, bevor Spec 62.0 geschrieben werden kann]
```

---

## Constraints

- **Kein Code schreiben.** Nur Discovery + Findings.
- **Keine Annahmen.** Wenn unklar, im Findings dokumentieren: "Nicht klar aus Discovery, Klärung nötig: …".
- **Konkrete Pfade nennen.** Wenn du sagst "PipelineRunner existiert", dann mit `apps/api/src/…/runner.ts:42` o.ä.
- **SQL-Counts und Beispiel-Rows immer real, nicht erfunden.** Lieber "DB-Query failed: <reason>" als geratene Zahlen.
- **Maximal 1 Stunde Discovery-Zeit.** Wenn ein Sub-Punkt nach 10 Min nicht klar ist: dokumentieren als "Tiefere Investigation in eigenem Schritt nötig" und weiter.

---

## Nach Discovery

Marcel reviewt deine Findings, beantwortet die offenen Fragen aus "Empfehlungen für Marcel", danach schreiben wir gemeinsam Spec 62.0 (oder 62.0+62.1 merged, je nach deiner Empfehlung).
