# Phase E — Backlog

_Items deferred from Theme 62 (Content-Planner). Not specs, just structured notes for future work._
_Each item: enough context that future-Marcel or future-Claude-Code can scope it without re-discovering the conversation._

_Last updated: 2026-05-21_

---

## Larger Items (need own spec)

### 1. GitHub Tool-Inventory

**What:** Eigenes Subsystem für etablierte AI-Tools als wiederkehrende Content-Hooks. Nicht im Signal-System.

**Why:** Tools wie `anthropics/claude-code`, `simonw/llm`, `OpenAI/whisper`, `huggingface/transformers` sind nicht "trends" sondern stabile Inventar-Quellen. Toolwiki produziert daraus regelmäßig Content: "Wie installiere ich X", "Was kann X", "X vs Y", "Top-10 Y-Tools 2026".

**Why NOT signal-system:** Trend-Signale beantworten "was ist gerade heiß". Tool-Inventory beantwortet "was schreiben wir regelmäßig drüber". Andere Dimension, sollte konzeptionell getrennt sein.

**Filter-Idee:** `minStars: 100, lastActiveWithinDays: 90, hasTopicTag: [ai, llm, agents, claude, mcp]`. Nicht trending-Filter, sondern established-Filter.

**Output:** Eine neue Tabelle `content_source_inventory` o.ä., die der Planner als zusätzliche Quelle für `ki_wissen` und `cluster`-Items konsumieren kann.

**Dependency:** Eigene Discovery-Phase + Spec. ~2-3 Tage geschätzt.

---

### 2. Distribution-Layer auf Content-Planner

**What:** Wann/wo posten wir das was der Planner generiert?

**Phase 1 (statisch):** Zeit-Schema pro Channel definiert in Settings. Z.B.:
- LinkedIn: Mo 9:00, Mi 9:00, Fr 9:00
- X/Twitter: Mo+Mi+Fr 14:00 + Di+Do 11:00
- Instagram: Mi 12:00, Sa 10:00
- Newsletter: Do 8:00
- Mastodon / Bluesky: 3×/Tag verteilt

**Phase 2 (intelligent):** Engagement-Daten zurückmessen, Posting-Zeit adaptieren basierend auf welche Slots best performen pro Channel.

**Architektur-Trennung wichtig:** Planner-Layer (62.4) = WAS soll generiert werden. Distribution-Layer = WANN und WO soll es publiziert werden.

Ein einziges `social_post` planned_item vom Planner kann zu N Distribution-Events auf M Channels werden (jeweils mit channel-spezifischen Adaptionen: Image-Crop, Caption-Length, Hashtag-Set).

**Open questions** (vor Spec-Phase zu klären):
- Welche Channels priorisieren (LinkedIn, X, Instagram, Mastodon, Bluesky, Newsletter, Email-Liste)?
- Existierende Tools nutzen (Publer, Buffer, etc.) oder selber bauen?
- Pro Channel: was wird adaptiert? (Image-Crop, Caption-Length, Hashtag-Set)
- Wie wird Engagement zurückgemessen?

**Dependency:** Theme 62 produktiv eine Woche gelaufen, damit Content-Stream stabil ist bevor Distribution drauf gebaut wird. ~3-5 Tage geschätzt.

---

### 3. DataForSEO_trends als Signal-Source

**What:** Trending Keywords mit aufsteigender Volumen-Kurve aus DataForSEO. Z.B. "mcp server" wenn das Wort gerade 200% mehr gesucht wird als letzten Monat.

**Why:** Fehlende Dimension im aktuellen Signal-Mix:
- ProductHunt/HN: was launched gerade
- Vendor-RSS: was sagen die Vendoren
- Reddit: was diskutieren Communities
- **DataForSEO_trends: was suchen Leute gerade verstärkt** (Search-Intent-Signal)

**Aktueller Stand:** Source-Enum-Wert `dataforseo_trends` existiert in:
- `RawSignalSchema` z.enum (signal-sources/types.ts:27)
- DB enum `external_signals_source` (drizzle/0036_external_signals.sql:6)
- `signalSourcesSchema` als boolean stub (project-config.ts:166)
- `signal-top-n.ts` case-branch (greift nie)

**Was fehlt:** Echter Adapter im `packages/adapters/dataforseo-trends/` Pattern. `trendsExplore()` Funktion existiert in `adapters/dataforseo/src/index.ts` aber dient nur SERP-Volatility-Berechnung im TrendSynthesizer, nicht als Signal-Generator.

**Cost-Considerations:** DataForSEO Trends-Endpoints sind eher teuer ($0.06 pro Call). Bei z.B. 20 Trending-Keywords/Tag: $1.20/Tag = $36/Monat. Vor Implementation Budget-Diskussion + welche Keywords gequeryt werden sollen.

**Dependency:** Eigene Strategy-Diskussion + Spec. ~1-2 Tage geschätzt nach Strategy-Entscheidung.

---

## Smaller Open Notes

### Reddit-Auth aktivieren wenn Key ankommt

- Reddit-Adapter ist code-complete (`packages/adapters/reddit/src/index.ts:78`)
- Wartet nur auf OAuth-Credentials
- Sobald Key da: einfacher `global_credentials` Insert, kein Code-Change nötig
- Toolwiki `signal_sources.reddit.enabled: false` flippen + `signal_collector_reddit` cron-state row anlegen
- Subreddit-Liste in Toolwiki-Config definieren (`signal_sources.reddit.subreddits: []` aktuell leer)
- ~10 Min Aufwand wenn Credentials vorliegen

### HackerNews-Filter-Tuning (falls Volumen unzureichend nach Cron-Fix)

- HN-Cron-Bug ist gefixt (2026-05-21, Diagnose-Chat)
- Wenn nach 1-2 Wochen klar wird dass HN trotzdem nur 0-3 Items/Tag liefert: Filter prüfen
- HN-Config in Toolwiki: `minPoints: 5`, Worker hardcoded `maxAgeDays: 30`
- Algolia HN-API hat 4 queries × 50 hitsPerPage = 200 mögliche Hits/Run — falls weniger ankommt, Query-Konfiguration prüfen
- ~30 Min Diagnose + Tuning

### ProductHunt votes-Key-Mismatch (cosmetic)

- Adapter schreibt `metrics.votes` (camelCase)
- Planner-Heuristik liest `votes_count` (snake_case) zuerst, mit Fallback auf `votes`
- Funktioniert wegen Fallback, aber primärer Lookup misst's nie
- ~30 Min Fix wenn 62.4 wieder berührt wird (z.B. bei 62.5.1 Batch-Cost-Spec)
- Approach: Adapter auf `votes_count`/`comments_count` (snake_case) umstellen, Planner-Fallback für existing rows kann erhalten bleiben

### GitHub `enabled:true` in signalSources JSON inkonsistent mit cron-state

- Toolwiki: `signal_sources.github.enabled: true`
- Aber: `signal_collector_github.is_active: false` in cron_state
- Cron-Flag ist der echte Trigger, JSON-enabled ist tot-content
- Cosmetic — ~5 Min beim Project-Create-Default aligning (Spec 59.1c hat das vermutlich erzeugt)

### 62.5.1 Batch-aware Cost Estimation ✅ Implemented

Done in session between 62.7 und 62.8 (2026-05-21). Siehe Spec-Eintrag in root `CLAUDE.md` für vollständige Implementations-Notizen. Toolwiki bleibt in sync mode; Batch-Discount aktiviert sich automatisch sobald `projects.llm_mode = 'batch'` gesetzt wird.

---

## How to use this doc

Wenn ein neues Backlog-Item entsteht aus einer Theme-62-Session: hier dokumentieren statt im Memory speichern. Memory ist für Patterns/Lessons, dieses Doc für Backlog/Decisions.

Wenn ein Item zum Spec-Status reift: Spec-Datei in `specs/` anlegen, Eintrag hier mit Link zur Spec versehen oder entfernen.

Prioritäts-Reihenfolge ist NICHT fix — Marcel entscheidet nach Theme-62-Abschluss anhand realer Plan-Daten was wichtigster Hebel ist.
