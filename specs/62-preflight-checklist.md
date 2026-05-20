# Theme 62 — Pre-flight Checklist

_Operative Vorarbeiten, die vor Spec 62.0a abgeschlossen sein müssen._
_Diese Checklist ist KEIN Spec — sie ist eine Reihe kleiner Validierungs- und Operations-Tasks._

---

## Warum überhaupt

Discovery (`00-discovery-findings.md`) hat drei operative Risiken aufgedeckt, die Theme 62 ins Knie schießen, wenn wir sie nicht vorher adressieren:

1. **Batch-API ist field-untested** — `batch_requests=0` und `pipeline_runs.batch_pending=0` bedeutet: die Mechanik existiert im Code, ist aber in der Production noch nie durchgelaufen. Theme 62 Step-Pause baut direkt darauf auf.
2. **Signal-Daten sind 5 Tage alt** — der `signal-collector` Cron ist in `apps/api/src/workers/index.ts:180-182` aktuell `// disabled`. Ohne frische Signals plant der Planner blind.
3. **Refresh-Detector ist nie gelaufen** — `refresh_suggestions` hat 0 Rows. Die Social-Mix-Quelle "Refresh-Pool" ist deshalb leer. Marcel will Refresh-Pool als 1 von 3 Quellen für Social-Posts nutzen.

Alle drei sind **vor Spec 62.0a** zu lösen. Reihenfolge unten ist nach Risiko sortiert.

---

## Task 1 — Batch-API End-to-End Smoke-Test (Risiko 1)

**Ziel:** Beweisen, dass die Spec-61.4-Pipeline `sync → batch → suspend → resume → complete` in der echten DB+Anthropic-Round-Trip durchläuft.

**Step-Auswahl:** `article:outline` (kleinster LLM-Step im Cluster-Flow, eh überall im Einsatz, niedrige Kosten).

**Setup:**

1. Test-Project anlegen (oder bestehendes Toolwiki nutzen) und `projects.llmMode='batch'` setzen via SQL.
   ```sql
   UPDATE projects SET llm_mode = 'batch' WHERE slug = 'toolwiki';
   -- oder: dedizierter test-project, falls Toolwiki Pause stört
   ```

2. Sicherstellen, dass `batch-processor.worker.ts` läuft (Cron-Job für `submit-pending` alle 30 Min und `process-results` alle 6h aktiv).
   ```bash
   # in apps/api ausführen oder via worker status check
   ```

3. **Trigger** einen `article:outline` über das übliche HTTP-Trigger-Endpoint (kein direkter `runPipeline`, da Batch nur via BullMQ-Suspend-Flow geht).

**Verification — was MUSS passieren:**

- [ ] `pipeline_runs` row entsteht mit `status='batch_pending'` und `batch_checkpoint` JSONB (nicht NULL).
- [ ] `batch_checkpoint.stepKey` = `"outline"`, `batchRequestId` = UUID.
- [ ] `batch_requests` row entsteht mit `status='pending'`, korrekte `anthropic_custom_id` = `{pipelineRunId}:outline`.
- [ ] BullMQ-Job ist NICHT in retried/failed — er ist completed-without-error (Spec-61.4-Semantik).
- [ ] Nach 30-Min-Submit-Tick: `batch_requests.status='in_progress'`, `anthropic_batch_id` gesetzt.
- [ ] Nach Anthropic-Completion (kann bis zu 24h dauern, in Praxis oft < 1h): `batch_requests.status='completed'`, `response_body` populated.
- [ ] `resumePipeline()` wird vom batch-processor aufgerufen → `pipeline_runs.status='queued'` → re-enqueued.
- [ ] Pipeline läuft restliche Steps durch, endet mit `status='completed'`.
- [ ] **Ein `cost_logs` Row entsteht** mit `service='anthropic' operation='batch:claude-opus-4-6'` (oder welches Modell auch immer) und `cost_eur > 0`.

**Wenn etwas failed:**
- Bug in `batch-processor.worker.ts` → Issue aufmachen, **Theme 62 blockiert bis fix**.
- Bug in `resumePipeline()` (`engine/batch-resume.ts:15`) → gleiches.
- `custom_id`-Parsing-Fehler → gleiches.

**Reset nach erfolgreichem Test:**
- `projects.llmMode` zurück auf `sync` für Toolwiki (Default-Production-Mode bleibt sync bis Theme 62.8 Batch-Approval freigibt).
- Optional: Test-Project droppen.

**Owner:** Marcel
**Estimate:** 1–2h Setup + Wait-Time (Anthropic Batch SLA).

---

## Task 2 — Signal-Collector Cron reaktivieren (Risiko 2)

**Ziel:** Frische Signale (last 24h) bevor Planner-Engine erstmals läuft.

**Steps:**

1. **Code-Inspektion:** `apps/api/src/workers/index.ts:180-182` — vermutlich auskommentierter Cron-Registration-Block.

2. **Per `cron_state` aktivieren** (Discovery sagt: Runtime-Toggle existiert per Spec 56.6):
   ```sql
   -- Liste vorhandene cron_state rows
   SELECT cron_job_type, project_id, is_active, cron_pattern, last_run_at, next_run_at
   FROM cron_state
   WHERE cron_job_type LIKE '%signal%';
   ```

  - Falls Row existiert: `UPDATE cron_state SET is_active=true WHERE …`
  - Falls keine Row: Insert via SettingsProjectPage.vue Cron-Toggle UI (sauberer als raw SQL, hängt von cron_job_type enum coverage ab).

3. **Reddit + GitHub Adapter aktivieren** (Discovery 1.5: beide haben `count=0` und `last_collected=never`).
  - Credentials in `global_credentials` einpflegen (Reddit: client_id+client_secret+user_agent; GitHub: PAT).
  - In `signal-collector.ts:220-272` sind die Registrierungen schon da, fehlt nur Auth + Project-Enable.

4. **Manuell triggern** via "Run Now"-Button (existiert in `CronStatusDisplay.vue`) — vermeide Wartezeit auf nächsten Tick.

**Verification:**
- [ ] Nach Run: `external_signals` enthält neue Rows mit `collected_at > now() - interval '1 hour'`.
- [ ] Min. 4 Sources aktiv (producthunt + hackernews + vendor_rss + reddit/github).
- [ ] Keine Errors im `pipeline_runs` für `signal-collector`-Jobs.

**Owner:** Marcel
**Estimate:** 30 Min, falls Credentials parat. Sonst +30 Min für Reddit/GitHub-Account-Setup.

---

## Task 3 — Refresh-Detector erstmalig laufen lassen (Risiko 3)

**Ziel:** `refresh_suggestions` Tabelle befüllen, damit Social-Mix-Quelle "Refresh-Pool" nicht leer ist.

**Was wir wissen:**
- Worker existiert: `apps/api/src/workers/refresh-detector.ts`
- DB-Tabelle existiert: `refresh_suggestions` (0 Rows), `refresh_dismissed`
- Cron schreibt nichts aktuell (kommentar in Discovery: "the cron writes nothing currently").

**Steps:**

1. **Code-Check:** öffnen `refresh-detector.ts` und prüfen:
  - Welche Inputs verarbeitet er (`articles` letzte X Tage? Performance-Metriken? Word-Count-Threshold?)?
  - Gibt es einen Cron-Registration-Block der disabled ist (analog signal-collector)?
  - Schreibt der Worker tatsächlich in `refresh_suggestions` oder nur in Logs?

2. **Falls Code-Bug:** Issue aufmachen, fixen. Refresh-Detector ist nicht Theme-62-Scope, aber Vorbedingung.

3. **Falls nur Cron disabled:** analog Task 2 reaktivieren über `cron_state` + Run Now.

4. **Manuell triggern** und verifizieren dass mindestens 5–10 Rows in `refresh_suggestions` entstehen (Toolwiki hat 306 Articles, sollte für eine erste Population reichen).

**Verification:**
- [ ] `refresh_suggestions` hat > 0 Rows.
- [ ] Rows referenzieren existierende `article_id`s.
- [ ] Mindestens eine sinnvolle "Reason" (Quality-Drop, Stale-Content, etc.) populated.

**Wenn der Worker substanzielle Logik vermisst:** Refresh-Detection in eigene Issue ziehen, Theme 62 erstmal MIT leerem Refresh-Pool starten — Planner muss dann robust mit 0-Refresh-Items umgehen (was er ohnehin können sollte). In Spec 62.4 als explicit case berücksichtigen: `if refresh_pool.length === 0 → fall back to more Suggestions-Pool items`.

**Owner:** Marcel
**Estimate:** unknown — hängt davon ab was der Worker macht. 1–3h grober Schätzer.

---

## Task 4 — pagespeed-validation excluden (Operative Hygiene)

**Hintergrund:** Discovery Punkt 9: `article:pagespeed-validation` hat 19/19 = 100% Failure-Rate. Theme 62 darf diesen Step nicht in geplante Items aufnehmen, sonst failed jeder Wochenplan.

**Lösung:** In Spec 62.0a explizit dokumentieren, dass `PlanWeekPipeline` einen statischen Pipeline-Blacklist hat:
```ts
const PLANNER_EXCLUDED_PIPELINES = [
  "article:pagespeed-validation",  // 100% failure rate, separate issue
  "article:pagespeed-api-validation",  // 0 runs, untested
];
```

**Owner:** wird in 62.0a Spec mitgenommen, kein separater Pre-flight-Task.

---

## Done-Definition für Pre-flight

Bevor Spec 62.0a startet:

- [ ] Task 1: Batch-Smoke-Test grün (mindestens 1 erfolgreicher `article:outline` mit Batch-Round-Trip)
- [ ] Task 2: Signal-Collector läuft, mindestens 3 Sources frisch (< 24h alte Rows)
- [ ] Task 3: Refresh-Detector lief mindestens 1× — entweder `refresh_suggestions > 0` ODER explizite Entscheidung "Refresh-Pool startet leer, Planner muss damit umgehen"

Tasks 1–3 sind unabhängig voneinander, können parallel laufen.

---

## Findings & Ausführungsstand (2026-05-20)

### Task 1 — Batch-API End-to-End ✅
Smoke-Test grün. `article:outline` lief `sync → batch → suspend (`status='batch_pending'`) →
Anthropic submit (`msgbatch_01WbPDYQgDD1UefiovS1Xk5z`) → process-results → resume → completed`,
`cost_logs` Row für `batch:claude-sonnet-4-6` €0.0276 geschrieben. Gesamtkosten Smoke: €0.12.

**3 Spec-61.4-Bugs in-flight gefixt** (siehe `specs/61.4-batch-api-worker.md` §Deviations D8/D9/D10):
- Vault-aware credential-loading in `batch-processor.worker.ts` (`getAnthropicClient()` war env-only)
- `anthropicCustomId` separator `:` → `_` (Anthropic rejects pattern `^[a-zA-Z0-9_-]{1,64}$`)
- Fence-tolerant JSON parsing im OutlineStep batch-resume (Sonnet 4.6 hat kein Batch-Prefill)

**Cosmetic Issue** (nicht-blockend, Theme-62-Runner-Refactor): originaler Outline-Substep-Run bleibt
nach Resume orphan in `status='running'`, neuer Substep wird angelegt. Cleanup-Logik fehlt.

### Task 2 — Signal-Collector Cron ✅
4 Adapter (`producthunt`, `hackernews`, `vendor_rss`, `github`) fire clean. 2 Sources liefern frische
Daten: `producthunt` 20 + `vendor_rss` 34 neue Rows. HN: `onConflictDoNothing` blockt re-fetched
Hot-Stories (working as designed). GitHub: `topicCount: 10, uniqueRepos: 0` — Filter zu strikt
(`minStarsNew: 20` + `timeWindowDays: 7`), tunbar in `project_configurations.signal_sources.github`.
Reddit übersprungen (keine Credentials).

Per Marcel-Entscheidung: alle 4 `cron_state`-Rows nach Verifizierung wieder `is_active=false`
gesetzt — Crons bleiben für diese Spec-Phase aus, alles wird manuell getriggert.

### Task 3 — Refresh-Detector ✅ (mit Patch)
**Worker vermisste komplette Persist-Logik** — `detectStaleArticles()` machte nur SELECT + SSE-Event,
schrieb nie in `refresh_suggestions`. Plus zwei weitere Bugs:
- Filter `isNotNull(lastRefreshedAt) AND lastRefreshedAt < cutoff` schloss alle Articles ohne
  `lastRefreshedAt` aus (211 von 271 published Articles in toolwiki)
- `coalesce(lastRefreshedAt, publishedAt, updatedAt)` ignorierte `frontmatterUpdatedAt`, das
  Astros `updated:`-Frontmatter-Feld trägt — Marcels echter Edit-Marker
- Re-Runs räumten obsolete Rows nicht auf — bereits gefixte Articles blieben in der UI sichtbar

Patches in `apps/api/src/workers/refresh-detector.ts`:
- `coalesce(frontmatterUpdatedAt, lastRefreshedAt, publishedAt, updatedAt)` als Effective-Freshness
- INSERT in `refresh_suggestions` mit `source='time'`, idempotent via `onConflictDoNothing((article_id, source))`
- Auto-Dismiss-Pass: alle aktiven Time-Suggestions die nicht mehr im stale-Set sind, kriegen
  `dismissed_at = NOW()`
- Gleiche Filter-Logik gespiegelt in `/refresh-candidates` Endpoint damit die beiden UI-Sektionen
  ("Refresh-Empfehlungen" + "Refresh-Warteschlange") nicht divergieren

Bonus während Discovery: neuer `GET /:slug/refresh-detection/status` Endpoint (existierte vorher
nicht, Frontend bekam 404 → swallowed → Label dauerhaft "Noch nie erkannt"); UX-Mini-Fixes auf
`RefreshSuggestionCard.vue` (Refresh-Button + "Mit KI analysieren"-Button für `source='time'` Rows).

### Out-of-Scope für Theme 62, aber als Follow-up notiert
- Cosmetic Spec-61.4: orphan outline-substep nach Resume
- GitHub-Signal-Filter zu strikt (per-project konfigurierbar via `signal_sources.github`)
- HN-Hot-Story-Dedup: kein `last_seen_at` Tracking, gleiche Story zählt nur 1× ever
- Regression-Tests fehlen für OutlineStep batch-resume + refresh-detector INSERT-Pfad
  (Spec 62.0a wird die ohnehin brauchen)
- Hardcoded `~€0.40` / `~€0.03` Cost-Hints in Refresh-Cards (pragmatisch, matched existing convention)
