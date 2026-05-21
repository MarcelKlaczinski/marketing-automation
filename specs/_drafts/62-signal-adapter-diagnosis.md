# Signal-Adapter Diagnose — metrics={} und tote Sources

**Modus: DIAGNOSE ONLY. Keine Fixes, keine Spec-Änderungen. Erst verstehen was wirklich existiert, dann zurück an Marcel mit Befund.**

## Context

Marcel hat im Marketing-Tool nach erfolgreichem Refresh-Fix (Signal-Refresh-Bug heute morgen) zwei weitere Signal-System-Probleme identifiziert:

**Problem B — metrics={} flächendeckend.** DB-Inspektion zeigt: alle bisher gesammelten external_signals haben `metrics = {}` JSONB. Heißt: keine Upvotes, Comments, Engagement-Daten persistiert. Score-Berechnung in 62.4 (`rank/total_in_source` Normalisierung) hat damit blinde Datenbasis.

**Problem D — Tote oder nie verdrahtete Sources:**
- `hackernews`: 2 rows ever (effektiv tot, mal lief mal nicht)
- `reddit`: 0 rows ever (no_credentials by design, OK)
- `github`: 0 rows ever (filter too strict by design, OK)
- `dataforseo_trends`: 0 rows ever (möglicherweise nie implementiert?)

## Codebase-Kontext

- Marketing-Tool: Bun + Hono + Drizzle + Postgres + BullMQ
- Signal-Adapter leben in `packages/adapters/<name>/` (memory says: pattern)
- Adapter-Interface: `class implements ExternalSignalSource<Input>` (62.0a pattern)
- Adapter sind als DI-fetchers-Map in `apps/api/src/lib/signal-fetcher-map.ts` zentralisiert
- `external_signals` Tabelle hat: source, external_id, title, raw_score, metrics jsonb, collected_at, processed_at

## Was zu tun ist

### Schritt 1 — Welche Adapter existieren überhaupt im Code?

```bash
ls packages/adapters/
find packages -name "*adapter*" -type d
grep -rl "class.*implements ExternalSignalSource\|ExternalSignalSource<" packages/
```

Ergebnis: Liste aller existierenden Signal-Adapter-Klassen, mit Pfaden.

### Schritt 2 — Was schreiben die Adapter tatsächlich in metrics?

Pro vorhandenem Adapter:
```bash
# Beispiel-Pfade, anpassen je nach Discovery aus Schritt 1
grep -A 30 "fetch()\|normalize\|metrics" packages/adapters/producthunt/src/index.ts
grep -A 30 "fetch()\|normalize\|metrics" packages/adapters/hackernews/src/index.ts
grep -A 30 "fetch()\|normalize\|metrics" packages/adapters/vendor-rss/src/index.ts
```

Pro Adapter dokumentieren:
- Was wird von der externen API geholt? (Welche Felder)
- Was wird in `metrics` JSONB geschrieben? (Erwartet: votes, comments, etc. — Tatsächlich: vermutlich {} oder fast leer)
- Wenn metrics leer geschrieben: ist das Absicht oder Bug?

### Schritt 3 — HackerNews Audit specifically

HN hat 2 rows ever. Discovery:
```bash
# Adapter existiert?
ls packages/adapters/hackernews/

# Was war der letzte erfolgreiche Run?
# (Aus pipeline_runs oder cost_logs falls vorhanden)
```

Plus DB:
```sql
SELECT * FROM external_signals 
WHERE source = 'hackernews' 
ORDER BY collected_at DESC;

-- Was sagen die 2 existierenden Rows? Sind sie strukturell anders als z.B. ProductHunt-Rows?
```

Plus Cron-State:
```sql
SELECT * FROM cron_state 
WHERE job_name LIKE '%hackernews%' OR job_name LIKE '%hn%';
```

### Schritt 4 — DataForSEO_trends Existenz-Check

```bash
grep -rn "dataforseo_trends\|dataforseo.*trend\|DataforseoTrend" packages/ apps/api/src/
```

Ist das ein implementierter Adapter oder nur ein Source-Name in einer Enum/Schema-Liste der nie ein Adapter zugeordnet wurde?

### Schritt 5 — signal-fetcher-map prüfen

```bash
# Wo werden Adapter zentral registriert?
grep -A 30 "buildSignalFetcherMap\|signalFetcherMap\|signalFetchers" apps/api/src/lib/
```

Welche Adapter sind dort aktiv verdrahtet? Fehlt einer?

### Schritt 6 — Score-Berechnung in 62.4

Wie wird `metrics` JSONB von der Score-Heuristik gelesen?
```bash
grep -rn "metrics\.\|raw_score\|computeSignalTopN" packages/planner/src/
```

Falls die Score-Heuristik gar nicht auf `metrics` zugreift sondern nur `raw_score`: ist `raw_score` korrekt befüllt?

## Format der Rückmeldung an Marcel

**Strukturierter Befund pro Adapter:**

```markdown
## Adapter Inventory

| Adapter | Implementation existiert | Verdrahtung in signal-fetcher-map | metrics gefüllt | letzter erfolgreicher Run |
|---|---|---|---|---|
| producthunt | ✓ | ✓ | ? | ... |
| hackernews | ?  | ? | ? | ... |
| vendor_rss | ? | ? | ? | ... |
| reddit | ? | ? (no creds) | — | nie |
| github | ? | ? (filter too strict) | — | nie |
| dataforseo_trends | ? | ? | — | nie |

## Findings per Adapter

### ProductHunt
- API liefert: votes_count, comments_count, makers...
- Adapter persistiert in metrics: ...
- Diagnose: ...

### HackerNews
- ...

(etc.)

## Score-Heuristik (62.4)

- Liest metrics oder raw_score?
- Wenn metrics: welche Felder erwartet?
- Wenn raw_score: wer befüllt ihn?
```

**Plus pro Finding:**
- Severity: Bug / Feature-Lücke / By-Design
- Fix-Aufwand grob: 30min / few hours / day+
- Dependencies zu anderen Specs/Themen

**NICHT IMPLEMENTIEREN.** Marcel + ich entscheiden welche Fixes wir in welcher Reihenfolge angehen.

## Anti-Patterns (Bitte vermeiden)

- Adapter-Code "wenn-wir-schon-dabei-sind" refactoren
- Neue Adapter implementieren
- DataForSEO-Strategie diskutieren (out of scope, eigene Strategie-Diskussion)
- Score-Heuristik in 62.4 ändern (das ist Plan-Pipeline, hier nur Diagnose-Quelle)
- Synthesizer-Themen ansprechen (Hybrid-Mode-Entscheidung, separate)

## Hintergrund

- Signal-Refresh-Bug von heute morgen (H1: Staleness-Gate + missing UI feedback) ist gefixt
- Theme 62 Foundation + Planner-UI ist gemerged
- 62.6 Debug-UI läuft parallel in anderem Chat
- Reddit/GitHub: bewusst inactive bis später (Phase E)

Spec-Referenzen:
- Spec 62.3 — Signal-Refresh + ComparisonDiscovery
- Spec 62.4 — Planner-Engine (score normalization)
- 62.0a Lesson D14: Signal adapters as classes implementing ExternalSignalSource

## Resolution (2026-05-21)

**HN-Schedule-Fix landed** in [apps/api/src/workers/cron-orchestrator.ts](../../apps/api/src/workers/cron-orchestrator.ts) via `catchUpStaleSignalCollectors()` — a startup hook that idempotently enqueues a `collect-adapter` for any active `signal_collector_*` row whose last `external_signals` row is > 24h old. Per-day deterministic `jobId` (`<jobType>_<projectId>_catchup_<YYYY-MM-DD>`) dedups multiple worker restarts within a UTC day at the BullMQ level. Applies to all signal collectors (not HN-specific) since the root cause is generic BullMQ missed-fire on offline worker. Verified end-to-end via triple worker:restart — HN adapter ran, dedup engaged on subsequent restarts. Documented as pattern in `apps/api/CLAUDE.md` "Runtime Cron Toggle Pattern → Startup catch-up for missed daily fires".

**Other findings from this diagnosis remain unaddressed** (open for separate decisions):
- `dataforseo_trends` phantom enum value (no adapter)
- ProductHunt `votes_count` vs `votes` key mismatch in planner heuristic (Fallback rettet's; suboptimal)
- HN Algolia returns suspiciously few hits (3 raw across 4 queries × 30d) — adapter tuning question
- vendor_rss `metrics={}` (by-design; documented)
