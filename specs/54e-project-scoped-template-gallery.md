# Spec 54e — Project-Scoped Template Gallery

**Type:** UI Refactor + Feature Extension
**Estimate:** 3-4h, 3-4 commits
**Depends on:** Spec 54d (Template Preview Gallery — global admin view already done)
**Goal:** Templates sind immer project-abhängig (Brand-Tokens, eligible articles, Kontext). Deshalb wandert die Gallery von `/admin/templates` in die Project-Detail-Tabs.

---

## Context

Die in Spec 54d gebaute global-admin Gallery hat drei Einschränkungen:

1. **Brand-Tokens**: Jedes Project hat eigene Farben/Typografie. Rendered previews ohne projekt-spezifische Brand-Tokens sehen immer nach Fallback-Defaults aus — kein realer Eindruck vom Output.
2. **Eligible Articles**: Die Liste der passenden Artikel ist project-scoped. Im globalen View muss man immer erst ein Projekt auswählen, was UI-Mehraufwand bedeutet.
3. **Template-Kontext**: Welche Templates für ein Projekt sinnvoll sind (z.B. `comparison-stunning` nur wenn Vergleichsartikel existieren) ist per-project auswertbar; global gibt es nur "alle Templates".

**Diese Spec:** `TemplatesPanel` (das in Spec 54d extrahierte Komponenten-Fragment) wird in den Project-Detail-Tab eingebettet und erhält den Project-Kontext. Die globale `/admin/templates`-Route kann gelöscht werden. Genausie wie die Verknüpfung in der Sidebar

---

## Scope

| In Scope | Out of Scope |
|----------|-------------|
| Project-ID/Slug an alle API-Calls übergeben | Neue Template-Typen |
| Brand-Tokens aus Projekt für Preview laden | Automatische Template-Empfehlung |
| Eligible-Article-Filter auf Project scopen | Analytics / Usage-Tracking |
| UI im Project-Detail Tab (bereits verdrahtet in Spec 54d) | Template-Erstellung/-Bearbeitung |
| `GET /admin/templates/eligible-articles` scoped mit `projectId` | Multi-Projekt-Vergleich |

---

## Sub-Section 1: API-Erweiterungen

**Estimate:** 1h, 1 commit
**Files:**
- `apps/api/src/routes/admin.ts` — drei bestehende Endpunkte erweitern

### 1.1 GET /admin/templates

Keine Änderung — Template-Metadaten sind projektunabhängig.

### 1.2 POST /admin/templates/:key/preview — Brand-Tokens aus Projekt

Erweitere den Request-Body um ein optionales `projectId`-Feld:

```typescript
const previewBodySchema = z.object({
  source: z.enum(['fixture', 'sample-article']),
  fixtureKey: z.string().optional(),
  sampleArticleId: z.string().optional(),
  theme: z.enum(['dark', 'light']),
  locale: z.enum(['de', 'en']),
  force: z.boolean().optional(),
  projectId: z.string().uuid().optional(), // NEU
});
```

Wenn `projectId` mitgegeben wird:
1. Lade Brand-Tokens via `db.query.brandTokens.findFirst({ where: eq(brandTokens.projectId, projectId) })`
2. Falls gefunden: merge mit `DEFAULT_BRAND_TOKENS` via `brandTokensSchema.parse(dbTokens.tokens ?? {})`
3. Übergib die gemergten Tokens als `brandTokens`-Override an den Render-Context

Da `render()` in `TemplateDefinition` keinen direkten `brandTokens`-Parameter hat (er ist im `carouselInput` hardcodiert pro Template), muss der Override vor dem `render()`-Aufruf in den Context injiziert werden.

**Lösungsweg** (bevorzugt über Context-Injection):

Füge einen optionalen `brandTokensOverride` in den `RenderContext` ein:

```typescript
// packages/social/src/templates/types.ts
export interface RenderContext<TInput> {
  article: Article;
  input: TInput;
  locale: 'de' | 'en';
  theme: 'dark' | 'light';
  brandTokens?: ParsedBrandTokens; // NEU — optional override
}
```

Jedes Template-`render()` prüft `context.brandTokens ?? DEFAULT_BRAND_TOKENS` statt hartem Default. Initial nur in Templates implementieren, die Brand-Tokens nutzen (`comparisonStunning`, `listCarouselStunning`).

**Cache-Key** muss `projectId` enthalten wenn gesetzt:

```typescript
function previewCacheKey(templateKey: string, fixtureKey: string, theme: string, locale: string, projectId?: string) {
  const parts = ['tmpl-preview:v2', templateKey, fixtureKey, theme, locale];
  if (projectId) parts.push(projectId);
  return parts.join(':');
}
```

Hinweis: Cache-Key-Version von `v1` auf `v2` erhöhen (oder Redis-Keys flushen), da Brand-Token-Injection neue Render-Ergebnisse produziert.

### 1.3 GET /admin/templates/:key/eligible-articles — Project-Filter

Erweitere Query-Parameter um `projectId`:

```typescript
// Query: ?locale=de&projectId=<uuid>
const projectId = c.req.query('projectId');

const whereClause = and(
  eq(articles.locale, locale),
  projectId ? eq(articles.projectId, projectId) : undefined,
);
```

Ohne `projectId` verhält sich der Endpunkt wie bisher (alle Projekte) — das erhält die globale Admin-Gallery.

---

## Sub-Section 2: Frontend — TemplatesPanel projektbewusst machen

**Estimate:** 1h, 1 commit
**Files:**
- `apps/web/src/components/admin/templates/TemplatesPanel.vue`
- `apps/web/src/components/admin/templates/TemplateCard.vue`
- `apps/web/src/components/admin/templates/TemplatePreviewModal.vue`

### 2.1 TemplatesPanel — `projectId` prop

```typescript
props: {
  projectId: { type: String, default: null }, // null = globaler Modus
},
```

Prop wird an `TemplatePreviewModal` weitergegeben. `TemplateCard` braucht keinen direkten Zugriff.

### 2.2 TemplatePreviewModal — `projectId` an API-Calls übergeben

In `loadPreview()`:
```typescript
await api.post(`/admin/templates/${templateKey}/preview`, {
  source: this.activeSource,
  fixtureKey: this.fixtureKey,
  theme: this.activeTheme,
  locale: this.activeLocale,
  force: this.force,
  ...(this.projectId && { projectId: this.projectId }), // NEU
});
```

In `loadEligibleArticles()`:
```typescript
await api.get(`/admin/templates/${this.templateKey}/eligible-articles`, {
  params: {
    locale: this.activeLocale,
    ...(this.projectId && { projectId: this.projectId }), // NEU
  },
});
```

### 2.3 Herkunfts-Indikator im Modal

Wenn `projectId` gesetzt: zeige ein `q-chip` mit "Project: <slug>" neben dem Theme-Toggle, damit klar ist dass Brand-Tokens aus einem konkreten Projekt kommen.

Da `TemplatesPanel` im Project-Detail Tab den `projectId` kennt, ist kein globaler Store nötig.

### 2.4 ProjectDetailPage — projectId übergeben

In `ProjectDetailPage.vue` (Templates-Tab):
```html
<TemplatesPanel :project-id="project.id" />
```

`project.id` ist bereits verfügbar (wird für andere Tabs genutzt).

### 2.5 Globale Admin-Gallery unverändert lassen

`TemplatesIndexPage.vue` verwendet `<TemplatesPanel />` ohne `projectId` — bleibt so. Fixture-only Modus ohne Brand-Token-Override.

---

## Sub-Section 3: i18n

**Estimate:** 15min, keine eigene Commit

Keine neuen Keys nötig — bestehende Keys aus Spec 54d decken den erweiterten Flow ab.

Optional (nice-to-have):
- `admin.templates.projectBrandTokens: "Projekt-Brand-Tokens aktiv"` — für den Chip in 2.3

---

## Migration / Backwards Compatibility

- Cache-Keys: `v1`-Keys werden stale sobald Brand-Tokens greifen. Da Redis TTL 1h hat, laufen sie natürlich ab. Optional: `FLUSHDB` oder prefix-basierten Flush nach Deploy.
- `RenderContext`-Erweiterung um `brandTokens` ist optional (backwards-compatible) — Templates ohne Brand-Token-Support ignorieren das Feld einfach.
- Keine DB-Migration nötig.

---

## Out-of-scope Follow-ups (als Backlog notiert)

- **Template-Empfehlung per Projekt**: Zeige pro Projekt welche Templates bereits genutzt wurden und welche noch eligible articles hätten (`GET /projects/:id/template-suggestions`)
- **Brand-Token-Preview live**: Slider in der Gallery die Brand-Farben on-the-fly ändern ohne neuen Render (CSS-Variable-Injection für Nicht-Remotion-Previews)
- **Template-Nutzungshistorie**: Welche Templates wurden wann für welchen Artikel gerendert (aus `social_posts`-Tabelle ableitbar)

---

## Deviations from Spec

### Brand-token lookup: no separate table
Spec §1.2 referenced `db.query.brandTokens.findFirst(...)` implying a dedicated `brandTokens` table. In reality, brand tokens are stored as a jsonb column on the `projects` table (`projects.brandTokens`). The implementation used the existing `getBrandTokens(projectId)` service from `apps/api/src/lib/brand-asset-service.ts`, which already handles the `projects` lookup and merges `DEFAULT_TYPOGRAPHY` defaults. This is better than a direct DB query because it reuses the canonical service.

### `BrandTokens` type (not `ParsedBrandTokens`) in `RenderContext`
The spec used `ParsedBrandTokens` in the `RenderContext` snippet. The actual field is typed as `BrandTokens` from `packages/social/src/compositions/list-carousel/types.ts` (= `z.infer<typeof brandTokensSchema>`). The API side still uses `ParsedBrandTokens` from `brand-asset-service.ts` — these are structurally compatible and the spread operator merges them without issue.

---

## Akzeptanzkriterien

- [ ] Im Project-Detail Tab "Templates" wird `projectId` an alle API-Calls übergeben
- [ ] Preview-Render eines Templates mit gesetztem `projectId` nutzt die Brand-Tokens des Projekts (falls vorhanden)
- [ ] Eligible-Article-Liste ist auf das aktuelle Projekt gefiltert
- [ ] Cache-Key enthält `projectId` wenn gesetzt
- [ ] Globale Admin-Gallery (`/admin/templates`) funktioniert weiterhin ohne `projectId` (fixture-only)
- [ ] Chip/Indikator im Modal zeigt an, dass Projekt-Brand-Tokens aktiv sind
- [ ] Kein TypeScript-Fehler (strict), kein hardcodierter String ohne `$t()`
