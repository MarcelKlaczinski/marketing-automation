# Signal-Refresh Diagnose — "Signals abrufen" Button feuert ins Leere

**Modus: DIAGNOSE ONLY. Keine Fixes, keine Code-Changes. Erst Ursache verstehen, dann zurück an Marcel mit Befund + Fix-Optionen.**

## Symptom

Marcel hat im UI auf der Trends-Page den "Signals abrufen"-Button geklickt. Erwartet: neue external_signals Rows. Tatsächlich: 0 neue Rows in den letzten 2 Stunden, alle Sources zeigen letzte collected_at = gestern 17:43.

Plus weiteres Detail aus DB-Inspektion:
- producthunt: 56 total, letzte 24h, alle vom gestrigen Batch
- vendor_rss: 88 total, letzte 24h, alle vom gestrigen Batch
- hackernews: 2 total ever (effektiv tot)
- reddit / github / dataforseo_trends: 0 rows ever
- 67 unprocessed signals (Synthesizer-Cron aus, Hybrid-Modus per Followup)

## Kontext (was Marcel über die Codebase weiß)

- Marketing-Tool: Bun + Hono + Drizzle + Postgres + BullMQ
- Spec 62.3 hat `POST /api/projects/:slug/signals/refresh` Endpoint definiert mit Body `{force?: boolean}`
- Spec 62.4-followup (5-Task-Session, gemerged) hat den Trends-Button in zwei Buttons gesplittet:
  - "Signals abrufen" → ruft refresh-Endpoint
  - "Pending Signals synthetisieren" → ruft synthesize-Endpoint
- Composable `triggerCollect` wurde in `useTrendsList.ts` ergänzt
- Hybrid-Cron-Modus: signal-collector crons (PH/HN/RSS) sind ON (00:15/00:30/00:45 UTC daily), Synthesizer-Cron OFF (manuell)

## Vier Hypothesen die Marcel + ich gemeinsam aufgestellt haben

**H1: Staleness-Check skippt Refresh.** `refreshSignalsForProject()` aus Spec 62.3 hat `signal_max_age_hours` Logik. Wenn last_collected > NOW() - INTERVAL '24h', returnt Source `status='fresh'` ohne API-Call. ProductHunt-Daten sind ~24h alt — könnte exakt am Threshold liegen. Frontend-Button feuert nicht `force: true`, also wird Stale-Check nicht umgangen.

**H2: Endpoint-Wiring-Mismatch.** Frontend `triggerCollect` ruft einen anderen Pfad auf als Backend bereitstellt. Z.B. ein altes `synthesize`-Endpoint statt neues `signals/refresh`. Würde erklären warum Click-Effect ausbleibt.

**H3: Worker-Sync.** Wie beim social_post-Bug von gestern — Frontend ruft, Endpoint feuert, aber Worker mit aktuellem Code läuft nicht. Refresh-Code lebt in `packages/planner` (Spec 62.3.5/62.3), Worker muss das Package laden.

**H4: Adapter-Failures werden silent verschluckt.** Spec 62.3 sagt: "keine Source bricht die Funktion ab, Result-Object hat per-source-Status." Vielleicht failen alle Adapter mit transient errors aber kein Logging zeigt das. HN mit 2 Rows ever + Reddit/GitHub mit 0 ever passen zu diesem Bild.

## Was zu tun ist (in dieser Reihenfolge)

### Schritt 1 — Frontend-Backend-Kommunikation prüfen

```bash
grep -A 15 "triggerCollect\|triggerSynthesize" apps/web/src/composables/useTrendsList.ts
grep -A 5 "Signals abrufen\|signals/refresh\|signals/collect" apps/web/src/pages/trends/TrendsListPage.vue
grep -rn "signals/refresh\|signals/collect" apps/api/src/routes/
```

**Findings dokumentieren:**
- Welchen Pfad ruft `triggerCollect` genau auf?
- Existiert der Endpoint im Backend?
- Wird `force: true` gesendet?

### Schritt 2 — Refresh-Endpoint-Code lesen

```bash
# Finde die Route-Handler-Datei
find apps/api/src/routes -name "signals*" -o -name "*refresh*"
```

Lies den Handler. Antworten:
- Welcher Body-Schema wird erwartet?
- Wie wird `force` durchgereicht zu `refreshSignalsForProject()`?
- Gibt es Logging das uns sagen würde was passiert ist?
- Wird das Response-Object (`SignalRefreshResult` aus Spec 62.3 §4.1) im Frontend angezeigt? Oder verschluckt?

### Schritt 3 — Staleness-Check Code lesen

```bash
find packages/planner -name "signal-refresh*"
```

Lies die `refreshSignalsForProject()` Implementation. Antworten:
- Wie genau ist `signal_max_age_hours` Threshold implementiert?
- Wenn alle Sources `status='fresh'` zurückgeben: wie sieht das `SignalRefreshResult.sourceResults` aus?
- Wie wird das im Frontend dargestellt?

### Schritt 4 — Worker-Status verifizieren

Wann wurde der Worker zuletzt neu gestartet? Lädt er das aktuelle planner-package?

```bash
# Worker-Process-Info (anpassen je nach Deploy-Setup)
ps aux | grep worker
# Oder PM2 / systemd / docker status
# Oder Letzte Log-Zeile aus Worker-Output
```

### Schritt 5 — Live-Test mit Network-Inspection

Wenn Marcel das beim Diagnose-Chat triggern kann:
1. Browser DevTools öffnen, Network-Tab
2. "Signals abrufen" Button klicken
3. Welcher Request geht raus? Status-Code? Request-Body? Response-Body?
4. Was zeigt der Response konkret an Source-Status?

Wenn nicht: das ist die Aufgabe für Marcel zwischen Diagnose und Fix.

### Schritt 6 — DB-State nach Theoretischem Refresh

Falls Refresh tatsächlich gelaufen ist und nichts persistiert hat: hat dedup geblockt? Check via:

```sql
-- Last 5 ProductHunt items + ihre external_id
SELECT source, external_id, title, collected_at 
FROM external_signals 
WHERE source = 'producthunt'
ORDER BY collected_at DESC LIMIT 5;

-- Plus: was würde der nächste API-Call von ProductHunt liefern?
-- Wenn das die gleichen external_ids wären → dedup hat sie gefiltert, kein "Fehler"
```

## Format der Rückmeldung an Marcel

**Nach den Schritten 1-4 oder bis ein eindeutiges Bild da ist:**

1. **Verified Cause:** welche der 4 Hypothesen ist es? (Oder eine 5. die in Discovery aufkam?)
2. **Evidence:** konkrete Code-Snippets, Log-Outputs, DB-Findings
3. **Fix-Optionen mit Trade-offs:**
  - Quick-Fix (kleinste mögliche Änderung)
  - Proper-Fix (sauber, eventuell Spec-Change nötig)
  - Wenn Symptom = "by design": klare Aussage statt Fix
4. **NICHT IMPLEMENTIEREN.** Marcel entscheidet welcher Fix.

## Anti-Patterns (Bitte vermeiden)

- Spec-Änderungen vorschlagen bevor Ursache identifiziert
- Mehrere Fixes parallel implementieren
- "While we're at it..."-Scope-Creep — andere Signal-Issues (B/C/D) sind NICHT Teil dieser Diagnose
- Synthesizer-Cron-Themen ansprechen (das ist bereits Hybrid-Modus-Entscheidung)

## Bekannte Hintergrund-Info

- Marcel + ich haben gestern ähnlichen Bug im SelectSocialPostItemsStep diagnostiziert, da war's ein Worker-Sync-Issue (Restart erst nach Test-Trigger). Worker-Restart-Status ist immer Verdacht #1.
- Reddit hat keine Credentials konfiguriert (erwartet, nicht akut)
- GitHub-Filter ist zu strikt (erwartet, separates Theme)
- DataForSEO_trends Adapter scheint nie verdrahtet zu sein — das ist eine eigene Frage, nicht jetzt

Spec-Referenzen:
- Spec 62.3 — Signal-Refresh-Mechanik
- Spec 62.4-followup §10.3 — Trends-Button-Split
- `packages/planner/src/signal-refresh.ts`
- `apps/api/src/routes/` (Signals-Route)
- `apps/web/src/composables/useTrendsList.ts`
- `apps/web/src/pages/trends/TrendsListPage.vue`

## Resolution (2026-05-21)

**Verified cause:** H1 — Staleness-Gate (`signal_max_age_hours=24`) skipped all 3 enabled
sources because last batch was 21.55h old. Frontend sent `force: false` by default AND
discarded the `SignalRefreshResult` response, so the user saw zero feedback.

**Implemented:** Option 3 (UI-only, no backend change).

- `useTrendsList.ts`: `triggerCollect()` now accepts `{ force?: boolean }`, returns the
  parsed `SignalRefreshResult`, exposes `lastRefreshResult` ref.
- `TrendsListPage.vue`: per-source status panel renders after each click. When every
  result is `status: "fresh"` (gate blocked all sources), a secondary "Trotzdem
  erzwingen" button re-calls with `force: true`.
- i18n: new `trends.refresh.*` namespace (DE + EN).

**Backend:** untouched. The `force` parameter, the `SignalRefreshResult` shape, and
the per-source `status` enum already existed from Spec 62.3.

**Lesson captured:** `apps/web/CLAUDE.md` → "DO NOT call `await apiPost(...)` and drop
the response for endpoints that return per-source operation status".
