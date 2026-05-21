# Discovery — Headlines in PlannerPage Kalender-Ansicht

**Modus: DISCOVERY ONLY. Keine Fixes, kein Code. Erst verstehen welche Daten verfügbar sind, dann zurück mit Befund + Fix-Optionen.**

## Was Marcel will

Im PlannerPage-Kalender sollen die planned_items mit ihrem **echten Topic / Headline** angezeigt werden statt nur Content-Type-Label.

Beispiele was gewünscht ist:
- Cluster-Item: "Claude Skills vs ChatGPT Custom Instructions" (statt "Cluster #42")
- KI-Wissen-Item: "Was sind MCP Server" (statt "KI-Wissen")
- Comparison-Item: "Claude Code vs Cursor" (statt "Comparison")
- Social-Post-Item: vermutlich Article-Title oder Topic des Source-Articles

## Discovery-Aufgaben (in dieser Reihenfolge)

### Schritt 1 — Was zeigt der Kalender aktuell an?

```bash
grep -A 50 "plannedItem\|PlannedItem\|item\\.contentType\|<PlannerCalendar" \
  apps/web/src/components/planner/ apps/web/src/pages/planner/
```

Pro Item-Card im Kalender dokumentieren:
- Welche Felder werden aktuell angezeigt?
- Wo kommt der Display-Text her? (i18n? hardcoded? aus item-Daten?)

### Schritt 2 — Was bekommt das Frontend vom Backend für planned_items?

```bash
# Endpoint-Response-Shape
grep -A 30 "getWeeklyPlan\|GET.*plans/.*\|plannedItemsSchema" \
  apps/api/src/routes/ packages/shared/src/types/

# Frontend-Composable
grep -A 30 "useWeeklyPlan\|fetchWeeklyPlan" \
  apps/web/src/composables/planner/
```

Pro planned_item Feld dokumentieren:
- Was kommt in der API-Response an?
- Welche Fremd-IDs (topic_brief_id, article_id, etc.) sind im Item enthalten?

### Schritt 3 — Welche Headline-Quelle pro Item-Type?

**Cluster-Items:** Cluster hat Hub (1 Article) + Spokes (5-8 Articles). planned_items für Cluster zeigt vermutlich nur den Hub.

```bash
# topic_briefs Schema — gibt's title/headline/displayName?
grep -A 30 "topicBriefs\|topic_briefs" packages/db/src/schema/

# Was speichert ein Cluster-Brief?
psql -c "SELECT id, source, slug, seed_topic, metadata FROM topic_briefs LIMIT 3" 
# Falls SQL nicht direkt möglich: 
grep -A 20 "comparisonDiscovery\|clusterCreator\|seedTopic" packages/planner/src/
```

Dokumentieren:
- Hat topic_briefs ein Feld wie `title`, `headline`, `displayName`, `humanReadable`?
- Oder nur Slug/seedTopic (technisch)?
- Falls nur Slug: ist Slug bereits human-readable (z.B. "claude-skills-vs-chatgpt") oder kryptisch?

**KI-Wissen-Items:** Kommen aus trend_discovery briefs.
```bash
grep -A 30 "trendDiscovery\|trend_discovery" packages/planner/src/ packages/db/src/schema/
```

**Comparison-Items:** Kommen aus comparison_discovery (62.3) — Tool-A + Tool-B + Use-Case.
```bash
grep -A 30 "comparisonDiscovery\|ComparisonBrief" packages/planner/src/
```

**Social-Post-Items:** Kommen aus existing articles + suggestions.
```bash
grep -A 20 "SelectSocialPostItems\|socialPostSource" packages/planner/src/
```

### Schritt 4 — Computed Headline möglich?

Falls topic_briefs kein dediziertes Headline-Feld hat, ist eine Headline aus Slug oder seedTopic ableitbar?

Beispiel-Slug `claude-skills-vs-chatgpt-custom-instructions` → Headline `"Claude Skills vs ChatGPT Custom Instructions"` (capitalize + dashes-to-spaces).

Vermutlich machbar, aber:
- Spezielle Tokens (AI, KI, vs, etc.) müssen evtl. case-preserved werden
- Slug-zu-Headline-Helper existiert vielleicht schon? Grep:
```bash
grep -rn "slugToTitle\|humanizeSlug\|prettifySlug\|capitalizeSlug" \
  packages/ apps/
```

## Format der Rückmeldung an Marcel

**Strukturierter Befund:**

```markdown
## Aktuelle Kalender-Display

[Welche Felder zeigt jede Item-Card aktuell — Screenshot oder Codeblock]

## Verfügbare Headline-Quellen pro Item-Type

| Item-Type | Aktueller Display | Bessere Quelle verfügbar? | Backend-Change nötig? |
|---|---|---|---|
| Cluster | "Cluster" | topic_brief.X (Feld nennen) | nein / kleine API-Erweiterung |
| KI-Wissen | "KI-Wissen" | ... | ... |
| Comparison | "Comparison" | ... | ... |
| Social-Post | "Social Post" | ... | ... |

## Fix-Optionen mit Trade-offs

### Option A: Pure Frontend-Refactor (~30 Min)
- Wenn Headlines schon im API-Response sind, nur Display ändern
- Wenn Slugs verfügbar: humanize-helper

### Option B: Backend-API erweitern (~2-3h)
- Wenn Headlines aus joinedTables geholt werden müssen
- planned_items endpoint join mit topic_briefs, etc.

### Option C: Headline-Generation als Plan-Step (~half day)
- Wenn aktuell keine Headlines existieren und LLM-Call nötig
- Schritt vor PersistPlan, generiert Display-Headlines

## Empfehlung

Marcel + Claude geben Aufwand-vs-Wert-Einschätzung.
```

**NICHT IMPLEMENTIEREN.** Marcel entscheidet welche Option er will.

## Anti-Patterns

- Headlines berechnen während der Discovery
- Backend-Schema ändern
- Bestehende Item-Display-Logik refactoren
- "Wenn-wir-schon-dabei-sind"-Polish

## Hintergrund

- 62.6 + 62.7 sind gemerged, Theme 62 fast komplett
- Marcel hat im Debug-Modus Wochenplan durchgeklickt und sieht jetzt dass Kalender unleserlich ist
- 62.5.1 (Batch-Cost) und 62.8 (Production-Run) kommen als nächstes — Headlines sind orthogonal, kann parallel oder zwischendurch landen

Spec-Referenzen:
- Spec 62.4 — planned_items schema + planner_engine
- Spec 62.5 — PlannerPage + Kalender-UI
- Spec 62.3 — topic_briefs (cluster + trend + comparison discovery)
