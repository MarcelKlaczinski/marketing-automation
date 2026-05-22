# Spec: Schema-Konsolidierung — Toolwiki-Astro-Repo

_Branch: `feature/schema-consolidation`_
_Codebase: `ki-wissensraum-neu` (Astro-Repo, toolwiki.ai)_
_Status: Draft._
_Aufwand: ~2-3 Wochen, 5 Sprints._
_Vorbedingung: Phase-1-Discovery-Audit `docs/discovery/content-schema-synthesis.md` im Repo committed._
_Parallel-Branch: `feature/multi-domain-datamodel` (Marketing-Tool-Repo)._

---

## 1. Problem

Aus Phase-1-Discovery-Audit (`docs/discovery/content-schema-synthesis.md`):

1. **Schema-Leichen:** ~30% der optionalen Frontmatter-Felder werden in 0/10 Sample-Files genutzt. Beispiele: Blog-`pubDate`/`description`, Tools-`lastReviewed`/`lastReviewedBy`/`pricingVerifiedAt`/`logoStrategy`/`logoSvg`.
2. **Naming-Bruch bei Daten:** `date`+`updated` (Blog, regex-String) vs. `updatedAt` (alle anderen, `isoDate`).
3. **Comparison-Felder im Blog-Schema dupliziert:** `toolSlugs`, `winner`, `verdict`, `testMethodology`, `useCaseVerdicts` deklariert, in 0-4/10 Sample-Blogposts gelebt; live nur in `comparisons`-Collection.
4. **Drei Category-Modelle:** Blog-`category` Enum (englische Labels), ki-wissen-`category` Enum (deutsche Labels auch in EN-Files), Tools-`category` freier String. Keine zentrale Definition, keine DE/EN-Mappings.
5. **Hartcoded Toolwiki-Lock-In:** `relatedPillars` als striktes 12-Werte-Enum in `content.config.ts:259-272`.
6. **`next[]` Strings statt Slug-Refs:** ki-wissen-Learning-Graph bricht bei Umbenennung.
7. **Bucket-D Hartcode-Imports:** `HubCarousel` (50× im Blog, 1 Prop), 11 Interactive-Components in ki-wissen (1 `locale`-Prop), 2 Dead-Imports (`ToolCard`, `ClusterBox`). Plus 10 Files mit Inline-JSON-LD-Snippets.
8. **Kein geteiltes Zod-Package:** Repo definiert eigene Zod-Schemas, Tool definiert separate. Schema-Drift möglich.

**Constraint von Marcel (hart):** Keine SEO-Daten dürfen verloren gehen. Keine URL-Änderungen. Keine Sitemap-Differenzen. JSON-LD-Output identisch.

## 2. Ziel

Toolwiki-Astro-Repo so refactoren, dass es:
- das gemeinsame `@marketing-auto/content-schema` Package nutzt (single source of truth zwischen Tool und Repo)
- drei Category-Modelle in eines konsolidiert via `categories`-Collection
- Schema-Leichen entfernt
- Frontmatter und Layout-Konventionen sauber trennt (Bucket-D-Lift)
- Soft-Slug-Refs statt hartcoded Enums

— ohne URL-Brüche, ohne JSON-LD-Verlust, ohne Build-Regressions.

**In Scope:**

- Schema-Leichen entfernen (8 Felder, 0/10 Coverage)
- Datums-Harmonisierung (`date`/`updated` → `publishedAt`/`updatedAt`)
- Comparison-Felder aus Blog-Schema entfernen
- Categories-Collection einführen (drei Modelle → eines)
- `URL_SLUG_MAP` durch Categories-Collection-Lookup ersetzen
- `relatedPillars` 12-Werte-Enum → Soft-Slug-Reference auf `ki-wissen`-Collection
- `next[]` Strings → typed Slug-Refs
- `ki-wissen.category` deutsche Werte → locale-neutrale Slugs
- Bucket-D1: HubCarousel ins BlogLayout, `showHubCarousel` Frontmatter-Flag
- Bucket-D3: Inline JSON-LD aus 10 ki-wissen-Files in Layout-Renderer liften
- Bucket-D4: Dead Imports aufräumen
- `@marketing-auto/content-schema` importieren

**Out of Scope:**

- Bucket-D2 (Interactive-Components dynamisieren) — Phase-1 sagt explizit Status quo lassen
- Aside-Block-Components — Phase-1: Markdown+Tailwind ist editorial schneller
- Special-Landings refactor
- GitHub-Actions-CI-Setup (BK bekommt's, Toolwiki später)
- BK-Astro-Repo bootstrappen (separater Branch)
- Slug-Umbenennungen (würden 301-Redirects erfordern → nicht erlaubt)

## 3. SEO-Schutz-Protokoll

**Hart, gilt für jeden Sprint.** Kein Merge ohne grünen Snapshot-Diff.

### 3.1 Pre-Sprint-1-Baseline

Erste Aktion im Branch. Erstellt unter `__snapshots__/seo-baseline/`:

- `sitemap.xml.txt` — Vollständige Sitemap als Plain-Text
- `urls.txt` — Alle URLs aus `getStaticPaths()`-Outputs (`pnpm build && find dist -name "*.html" | sort`)
- `jsonld-samples/` — JSON-LD-Output pro Page-Template (3-5 Samples pro Collection: blog, tools, comparisons, usecases, ki-wissen, tool-categories, special-landings, authors)
- `hreflang-samples/` — `<link rel="alternate" hreflang>` Outputs pro Sample-Page

Skript: `scripts/snapshot-seo-baseline.sh` — automatisierter Generator. Output wird ins Repo committed als Branch-Baseline.

### 3.2 Pro-Sprint-Acceptance

Nach jedem Sprint:
- `scripts/snapshot-seo-diff.sh` läuft + zeigt Diff
- URL-Liste muss byte-identisch zur Baseline sein (kein einziger Unterschied)
- Sitemap-`<lastmod>` darf nur für intentionale Editions abweichen
- JSON-LD-Output muss semantisch equivalent sein (Whitespace, Key-Order erlaubt; alle Felder müssen drin sein)
- Hreflang-Output identisch

Bei Differenz: Stop, manuelle Review, falls intentional dokumentieren, sonst Rollback.

### 3.3 Pre-Commit-Gate für Codemods

- Codemod-Scripts haben **Pflicht-Dry-Run-Mode**
- Output zeigt Diff pro File
- Marcel reviewed Output bevor Commit
- Bei `URL_SLUG_MAP`-Migration zusätzlich: bidirektionaler Roundtrip-Test (`toUrlSlug(fromUrlSlug(x)) === x` für alle heutigen URLs)

### 3.4 Risiko-Matrix pro Sprint

| Sprint | SEO-Risiko | Mitigation |
|---|---|---|
| S1.1 (Schema-Leichen) | Niedrig | Page-Template-Grep-Check vor Removal |
| S1.2 (Datums-Harmo) | Mittel | Sitemap-Snapshot, Codemod 1:1 |
| S1.3 (Comparison-Felder raus) | Niedrig | Build-Test |
| S1.4 (Dead Imports) | Null | rein Code-Cleanup |
| S2.1 (HubCarousel-Lift) | Niedrig | Funktional identisch, Code-Pfad ändert |
| S2.2 (JSON-LD-Lift) | **Hoch** | Byte-genauer Snapshot-Diff, manuelle Review |
| S3.1-3.4 (Categories) | Mittel | Stufenweise, alt parallel halten |
| S3.5 (URL_SLUG_MAP raus) | **Hoch** | Roundtrip-Test, Marcel reviewed |
| S4.1 (relatedPillars) | Niedrig | superRefine erlaubt heutige Werte |
| S4.2 (next[] Slugs) | Niedrig | Renderer macht weiterhin gleiche Labels |
| S5.1 (Schema-Package) | Niedrig | Build-Test, Snapshot-Frontmatter-Output |

## 4. Architektur

### 4.1 Sprint 1 — Schema-Leichen + Datums-Harmonisierung (Woche 1)

**S1.1 Schema-Leichen entfernen** (3-4h)

Aus `src/content.config.ts` entfernen:

Blog-Schema:
- `pubDate` (0/10 Coverage, Legacy)
- `description` (0/10 Coverage, Legacy — `excerpt` ist die gelebte Variante)

Tools-Schema:
- `lastReviewed`, `lastReviewedBy` (0/10)
- `pricingVerifiedAt` (0/10)
- `logoStrategy`, `logoSvg` (0/10)
- `canonical`, `noindex`, `preconnect`, `imagePrompt`, `clusterOrder`, `parentSlug` falls 0/10 — Phase-1-Tabelle prüfen, einige davon sind Universal-Extended-Schema-Leichen die in BK relevant sein können → behalten falls semantisch nützlich

**Pre-Removal-Check:** `grep -r "frontmatter.pubDate\|frontmatter.lastReviewed\|..." src/` — falls Page-Template das Feld liest → nicht entfernen, sondern markieren für späteren Cleanup.

Astro-Build muss durchlaufen. Commit pro Schema-Section.

**S1.2 Datums-Harmonisierung** (1-2 Tage)

Ziel-Felder: `publishedAt`, `updatedAt` (ISO `YYYY-MM-DD`).

Codemod-Script: `scripts/migrate-date-fields.mjs`

Transformationen:
- Blog-Files: `date:` → `publishedAt:`, `updated:` → `updatedAt:`, `updatedReason:` bleibt
- Comparisons: `comparedAt:` bleibt (Domain-Feld), `updatedAt:` bleibt
- Tools: `updatedAt:` bleibt
- Ki-wissen, usecases, etc.: `updatedAt:` bleibt

56 Blog-Files transformieren.

Zod-Schema in `content.config.ts` aktualisieren: `date`/`updated` raus, `publishedAt`/`updatedAt` rein.

**JSON-LD-Renderer aktualisieren:** Date-Field-Reads in `BlogPost.astro`-Layout (oder analog) müssen `publishedAt`/`updatedAt` lesen. Snapshot-Test: JSON-LD-Output byte-identisch zu vor S1.2.

**Sitemap-Renderer aktualisieren:** `<lastmod>` muss aus `updatedAt` ziehen.

**S1.3 Comparison-Felder aus Blog-Schema entfernen** (2-3h)

Aus Blog-Schema-Definition entfernen:
- `toolSlugs`, `winner`, `verdict`, `testMethodology`, `useCaseVerdicts`, `comparedAt`, `listicleType`

Phase-1-Sample zeigt 0-4/10 Coverage. Build-Time-Check:

```bash
grep -r "^toolSlugs:\|^winner:\|^verdict:\|^testMethodology:\|^useCaseVerdicts:\|^comparedAt:\|^listicleType:" src/content/blog/
```

Falls Files das nutzen: prüfen ob sie eigentlich `comparison`-Collection sein sollten (vermutlich ja). Migration: betroffene Files in `comparisons/`-Folder verschieben oder Felder droppen.

**S1.4 Dead Imports aufräumen** (1h)

- `ToolCard` aus 2 `tool-categories`-Files entfernen
- `ClusterBox` aus 6 `ki-wissen`-Files entfernen

Verify: `grep -r "import ToolCard\|import ClusterBox" src/content/` → 0.

**Sprint-1-Acceptance:** Astro-Build läuft, 268 MDX-Files validieren, Sitemap generiert korrekt mit `publishedAt`/`updatedAt`, SEO-Snapshot-Diff zeigt nur intentionale Date-Field-Renames.

### 4.2 Sprint 2 — HubCarousel + JSON-LD Layout-Lift (Woche 1-2)

**S2.1 HubCarousel ins BlogLayout** (3-4h)

`src/layouts/BlogPost.astro` (oder analoger Pfad) ergänzen:

```astro
---
const { entry } = Astro.props;
const showHubCarousel = entry.data.showHubCarousel ?? true;
---

<article>
  <Content />
  {showHubCarousel && <HubCarousel excludeSlug={entry.slug} />}
</article>
```

Schema-Update: `showHubCarousel: z.boolean().default(true)` in Blog-Schema.

Codemod `scripts/lift-hubcarousel.mjs` entfernt aus 50 Blog-Files:
- `import HubCarousel from '@/components/content/HubCarousel.astro';` (Zeile)
- `<HubCarousel excludeSlug="..." />` (Zeile am Body-Ende)

Build-Test: alle 50 Files rendern HubCarousel weiterhin (Snapshot-HTML-Diff: HubCarousel-Output identisch).

**S2.2 Inline JSON-LD aus ki-wissen liften** (1-2 Tage)

**HOHES SEO-RISIKO.** Byte-genauer Snapshot-Diff pflicht.

10 ki-wissen-Files mit `<script type="application/ld+json">` identifizieren:

```bash
grep -l "application/ld+json" src/content/ki-wissen/
```

Pro File:
1. JSON-LD-Inhalt parsen, Struktur identifizieren (HowTo/Article/FAQPage)
2. In Frontmatter strukturieren:
   ```yaml
   schemaType: 'HowTo'
   howToSteps:
     - name: 'Schritt 1: Modell auswählen'
       text: 'Wähle ein vortrainiertes Sprachmodell...'
     - name: 'Schritt 2: Prompt formulieren'
       text: '...'
   ```
3. JSON-LD-Body aus MDX entfernen

`src/layouts/KiWissenLayout.astro` ergänzen: liest `schemaType` + zugehörige strukturierte Felder, emittiert JSON-LD.

Schema-Update: optionale Felder in ki-wissen-Schema (`schemaType`, `howToSteps`, etc.).

**Pattern-Achtung (Tool-D143):** Schema-Extension-Pipeline-Ownership beachten. FAQPage/HowTo gehört in Toolwiki zu Schema-Extension-Pipeline, nicht zum Body-Step. Diese Inline-JSON-LD-Blöcke sind die **Bridge** — sie liefern Source-Daten für die Tool-Pipeline-Schema-Extension. Beim Lift ins Layout: sicherstellen, dass die Strukturierung in Frontmatter den Tool-side Schema-Extension-Konsumenten nicht bricht.

**Per-File-Review-Pflicht:** Marcel reviewed jedes der 10 transformierten Files. JSON-LD-Output byte-genau snapshotten:
- Vor Lift: `pnpm build && cat dist/de/<file>/index.html | grep -A 500 'application/ld+json'` → speichern
- Nach Lift: gleicher Befehl → diffen
- Erlaubt: Whitespace-Diff, Key-Order-Diff
- Nicht erlaubt: Wert-Diff, fehlende Felder

**Sprint-2-Acceptance:** Blog-Files haben keinen HubCarousel-Import im Body, ki-wissen-Files haben keinen Inline-JSON-LD-Script mehr, JSON-LD-Output semantisch identisch (per-File-Review durch Marcel signed-off).

### 4.3 Sprint 3 — Categories-Collection (Woche 2)

**Vorbedingung Sync-Punkt:** Branch A Sprint 3.2 (Seed-Migration für Toolwiki-Kategorien) ist durch. Slug-Werte werden von dort übernommen — keine Eigen-Definition hier.

**S3.1 Categories-Collection im Repo anlegen** (4-6h)

Neue Collection: `src/content/categories/`.

Schema (definiert in `content.config.ts`):

```ts
const category = defineCollection({
  loader: glob({ pattern: '*.{md,mdx}', base: './src/content/categories' }),
  schema: z.object({
    slug: z.string(),
    scope: z.enum(['tool', 'blog', 'knowledge', 'usecase']),
    parentSlug: z.string().optional(),
    translations: z.record(
      z.object({
        label: z.string(),
        urlSlug: z.string(),
      }),
    ),
    icon: z.string().optional(),
    color: z.string().optional(),
  }),
});
```

Pro Category eine `.md`-Datei. 31 Files anlegen (7 Tool-Top + 13 Tool-Sub + 6 Blog + 5 Knowledge = 31).

Beispiel `src/content/categories/audio-music.md`:
```yaml
---
slug: audio-music
scope: tool
translations:
  de:
    label: 'Audio & Musik'
    urlSlug: 'audio-musik'
  en:
    label: 'Audio & Music'
    urlSlug: 'audio-music'
icon: 'lucide/music'
---
```

**SEO-Constraint:** `urlSlug`-Werte exakt identisch zur heutigen `URL_SLUG_MAP` in `src/lib/url-slugs.ts`. Build-Time-Assert (Test):

```ts
import { URL_SLUG_MAP } from '../src/lib/url-slugs';
import { getCollection } from 'astro:content';

test('Categories-Collection urlSlugs match URL_SLUG_MAP', async () => {
  const cats = await getCollection('categories');
  for (const cat of cats) {
    const mapEntry = URL_SLUG_MAP.toolCategories[cat.data.slug];
    if (mapEntry) {
      expect(cat.data.translations.de.urlSlug).toBe(mapEntry.de);
      expect(cat.data.translations.en.urlSlug).toBe(mapEntry.en);
    }
  }
});
```

**S3.2 Article-Schemas auf Soft-Slug-Reference umstellen** (1 Tag)

- Blog: `category: z.string()` (statt Enum) + `superRefine` gegen Categories-Collection (scope='blog')
- ki-wissen: `category: z.string()` (statt deutsches Enum) + `superRefine` (scope='knowledge')
- Tools: bleibt `z.string()`, jetzt aber `superRefine` (scope='tool')

Pattern: wie heute schon `featuredToolSlugs` validiert wird (Phase-1-Befund).

```ts
const validateCategoryRef = (scope: CategoryScope) =>
  async (val: string, ctx: z.RefinementCtx) => {
    const cats = await getCollection('categories', (c) => c.data.scope === scope);
    const slugs = cats.map((c) => c.data.slug);
    if (!slugs.includes(val)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown category slug "${val}" for scope "${scope}". Known: ${slugs.join(', ')}`,
      });
    }
  };
```

**S3.3 MDX-Files migrieren** (1 Tag)

Codemod `scripts/migrate-categories.mjs` transformiert Werte:

- Blog (6 Mappings, identisch zu Branch A Seed):
    - `'Guides & Tutorials'` → `'guides-tutorials'`
    - `'Tool-Reviews'` → `'tool-reviews'`
    - `'Vergleiche'` → `'comparisons'`
    - `'Trends & Zukunft'` → `'trends-future'`
    - `'Praxis & Use Cases'` → `'practice-use-cases'`
    - `'Ethik & Recht'` → `'ethics-law'`

- ki-wissen (5 Mappings):
    - `'Grundlagen'` → `'fundamentals'`
    - `'Technik'` → `'technology'`
    - `'Ethik & Recht'` → `'ethics-law'`
    - `'Praxis'` → `'practice'`
    - `'Zukunft'` → `'future'`

- Tools: keine Wert-Änderung (Slug-basiert bereits)

80 Files transformieren (56 Blog + 24 ki-wissen).

Build-Test pflicht — Renderer noch nicht umgestellt, Build muss aber funktionieren weil `superRefine` jetzt valide.

**S3.4 Renderer auf Categories-Collection-Lookup umstellen** (1 Tag)

Page-Templates (`/blog/[slug]`, `/ki-wissen/[slug]`, etc.) lesen Category-Label aus Categories-Collection per Locale.

Helper-Funktion `src/lib/categories.ts`:

```ts
import { getCollection } from 'astro:content';

let _categoryIndex: Map<string, CategoryEntry> | null = null;

async function buildIndex() {
  if (_categoryIndex) return _categoryIndex;
  const cats = await getCollection('categories');
  _categoryIndex = new Map(cats.map((c) => [`${c.data.scope}:${c.data.slug}`, c]));
  return _categoryIndex;
}

export async function getCategoryLabel(
  slug: string,
  scope: CategoryScope,
  locale: 'de' | 'en',
): Promise<string> {
  const idx = await buildIndex();
  const entry = idx.get(`${scope}:${slug}`);
  return entry?.data.translations[locale]?.label ?? slug;
}
```

Build-Performance: Cache via Modul-globaler Map analog zu `_toolIndex`-Pattern.

**Snapshot-Test:** Gerendere Category-Labels in HTML byte-identisch zu vor S3.4.

**S3.5 `URL_SLUG_MAP` durch Categories-Collection ersetzen** (1 Tag)

**HOHES SEO-RISIKO.** Roundtrip-Test + Marcel-Review pflicht.

`src/lib/url-slugs.ts` Helper auf Collection-Read umstellen:

```ts
import { getCollection } from 'astro:content';

let _slugMaps: { toUrl: Map<string, ...>; fromUrl: Map<string, ...> } | null = null;

async function buildSlugMaps() {
  if (_slugMaps) return _slugMaps;
  const cats = await getCollection('categories');
  // Build bidirectional maps from translations
  // ...
  return _slugMaps;
}

export async function toUrlSlug(canonicalSlug: string, locale: string, namespace: string) {
  const maps = await buildSlugMaps();
  // Lookup
}
```

Hardcoded `URL_SLUG_MAP` als Konstante entfernen, sobald keine Konsumenten mehr.

**Pre-Commit-Test:**

```ts
test('Roundtrip: toUrlSlug(fromUrlSlug(x)) === x for all current URLs', async () => {
  const allUrls = collectAllUrlsFromBuild();
  for (const url of allUrls) {
    const canonical = await fromUrlSlug(url, locale, namespace);
    const roundtrip = await toUrlSlug(canonical, locale, namespace);
    expect(roundtrip).toBe(url);
  }
});
```

Routing-Pages-Templates testen (5+ Templates).

**Marcel-Review:** Vor Merge zeigt Codemod-Output Diff aller URLs. Marcel approved manuell.

**Sprint-3-Acceptance:** Categories-Collection existiert mit 31 Files, alle 80 MDX-Files migriert, URLs byte-identisch zu vorher (Sitemap + Hreflang + URL-Liste Snapshot-Diff 0), `URL_SLUG_MAP`-Helper liest aus Collection.

### 4.4 Sprint 4 — Soft-References + Locale-Neutralität (Woche 2-3)

**S4.1 `relatedPillars` 12-Werte-Enum → Soft-Slug-Reference** (1 Tag)

Tools-Schema in `content.config.ts:259-272`:

Vorher:
```ts
relatedPillars: z.array(z.enum([
  'was-ist-ki',
  'prompt-engineering',
  // ... 12 Werte
])).optional(),
```

Nachher:
```ts
relatedPillars: z.array(z.string()).optional()
  .superRefine(async (val, ctx) => {
    const pillars = await getCollection('ki-wissen', (e) => e.data.clusterRole === 'hub');
    const slugs = pillars.map((p) => p.id.split('/').pop()?.replace('.mdx', ''));
    for (const ref of val) {
      if (!slugs.includes(ref)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown pillar slug "${ref}"` });
      }
    }
  }),
```

Heutiger 12-Slug-Set bleibt valide (Werte unverändert). Bei Schema-Erweiterung (neuer Pillar in ki-wissen) → automatisch erlaubt.

Test: 108 Tool-Files validieren weiter ohne Code-Änderung in MDX.

**S4.2 `next[]` Strings → typed Slug-Refs** (4-6h)

ki-wissen-Schema:
```ts
next: z.array(z.string()).optional()
  .superRefine(async (val, ctx) => {
    const entries = await getCollection('ki-wissen');
    const slugs = entries.map((e) => /* extract slug */);
    // validate each ref
  }),
```

Codemod: deutsche/englische Sprachstrings → Slugs.

Beispiel-Mapping (manuell pro File, weil Sprachstring → Slug nicht trivial):
- `"Maschinelles Lernen"` → `"machine-learning"`
- `"Was ist ein neuronales Netz?"` → `"neural-networks"`

24 ki-wissen-Files migrieren.

Renderer aktualisieren: liest Slug, holt Label aus Sibling-Article per Locale.

**S4.3 `ki-wissen.category` zu locale-neutralen Slugs** (4h)

Bereits durch Sprint 3 erledigt (S3.3 Codemod transformierte deutsche Werte zu Slugs). Hier expliziter Check:

- EN-Files haben jetzt locale-neutralen Slug statt deutschen Wert (`'fundamentals'` statt `'Grundlagen'`)
- Renderer-Test: EN-Page zeigt englisches Label, DE-Page deutsches Label
- Übersetzung kommt aus Categories-Collection, nicht aus MDX-Frontmatter

**Sprint-4-Acceptance:** Cross-References sind Slug-basiert und superRefine-validiert. Build-Time-Check verhindert dangling Slug-Refs. SEO-Snapshot-Diff zeigt 0 URL-/Sitemap-Änderungen.

### 4.5 Sprint 5 — Schema-Package-Integration (Woche 3)

**Vorbedingung Sync-Punkt:** Branch A Sprint 2 (`@marketing-auto/content-schema` Workspace-Package) ist komplett durch.

**S5.1 `@marketing-auto/content-schema` importieren** (1 Tag)

`package.json` ergänzen:

```json
{
  "dependencies": {
    "@marketing-auto/content-schema": "workspace:*"
  }
}
```

(Falls Monorepo-Struktur nicht direkt verlinkbar: npm-link lokal oder git-submodule. Sync-Strategie mit Marcel klären.)

`src/content.config.ts` refactoren:

```ts
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import {
  baseFrontmatter,
  ToolwikiBlogExtras,
  ToolwikiComparisonExtras,
  ToolwikiToolExtras,
  ToolwikiUsecaseExtras,
  ToolwikiKiWissenExtras,
} from '@marketing-auto/content-schema/domains/toolwiki';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/blog' }),
  schema: baseFrontmatter(['de', 'en']).merge(ToolwikiBlogExtras),
});

const comparisons = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/comparisons' }),
  schema: baseFrontmatter(['de', 'en']).merge(ToolwikiComparisonExtras),
});

// ...

export const collections = { blog, comparisons, tools, usecases, 'ki-wissen': kiWissen, categories, authors, 'tool-categories': toolCategories, 'special-landings': specialLandings };
```

Eigene Zod-Composition entfernen.

Build-Test: alle 268 Files validieren weiterhin.

Snapshot-Test: Frontmatter-Output (gerenderte JSON-LD, Sitemap-Einträge, Hreflang) identisch zu vor Refactor.

**S5.2 Versionierungs-Strategie etablieren** (2-3h)

Falls Workspace-Package (Monorepo-Link): keine Versionierung nötig.

Falls separate Repos: Major-Version pinnen in `package.json` (`"@marketing-auto/content-schema": "^0.1.0"`).

README-Update: welche Version dieses Repo nutzt.

**S5.3 Dokumentation aktualisieren** (4h)

- `CLAUDE.md` Astro-Repo: neue Schema-Architecture-Section, Categories-Collection-Pattern, Soft-Slug-Reference-Pattern
- README: Hinweis auf Schema-Package
- Optional: ADR `docs/adr/0001-schema-consolidation.md`

**Sprint-5-Acceptance:** Repo nutzt `@marketing-auto/content-schema`, eigene Zod-Composition entfernt, Build identisch, SEO-Snapshot-Diff 0.

## 5. Tests

**Pro Sprint:**
- Astro-Build muss durchlaufen ohne Errors
- Sitemap-Generation muss funktionieren
- Hreflang-Bridge muss korrekt sein

**SEO-Snapshot-Tests (pflicht):**
- `scripts/snapshot-seo-diff.sh` läuft als Post-Sprint-Gate
- URL-Liste-Diff = 0
- Sitemap-Diff nur intentionale Änderungen
- JSON-LD-Diff semantisch identisch
- Hreflang-Diff = 0

**Codemod-Tests:**
- Jeder Codemod hat Dry-Run-Mode
- Dry-Run-Output zeigt Diff pro File
- Marcel reviewed vor Commit

**Spezial-Tests:**
- **S3.1:** Build-Time-Assert `urlSlugs` in Categories-Collection = heutige `URL_SLUG_MAP` (Test in `__tests__/`)
- **S3.5:** Roundtrip-Test `toUrlSlug(fromUrlSlug(x)) === x` für alle heutigen URLs
- **S2.2:** Per-File-JSON-LD-Byte-Diff vor/nach Lift, Marcel-Review-Sign-off

## 6. Acceptance (vollständig)

1. Astro-Build läuft durch, alle 268 MDX-Files validieren
2. SEO-Snapshot-Diff zeigt 0 URL-Änderungen über alle Sprints
3. Sitemap byte-identisch (außer intentionale `<lastmod>`-Diffs durch Datums-Harmonisierung)
4. JSON-LD-Output semantisch identisch zu vor Refactor (alle 5+ Collections, 15+ Sample-Pages)
5. Hreflang-Output byte-identisch
6. Categories-Collection mit 31 Files existiert, urlSlugs identisch zu heutiger `URL_SLUG_MAP`
7. `URL_SLUG_MAP`-Helper liest aus Collection, hardcoded Map entfernt
8. `relatedPillars`, `next[]`, `category` (alle 3 Modelle) sind Soft-Slug-References mit `superRefine`
9. HubCarousel-Boilerplate aus 50 Blog-Files entfernt, Layout-driven
10. Inline-JSON-LD aus 10 ki-wissen-Files in Layout-Renderer migriert
11. Schema-Leichen entfernt (8+ Felder)
12. Dead Imports aufgeräumt (`ToolCard` 2x, `ClusterBox` 6x)
13. `@marketing-auto/content-schema` ist Single-Source für Zod-Schemas
14. CLAUDE.md aktualisiert
15. Pre-Commit-Hook lintet Frontmatter-Quotes wie bisher (CLAUDE.md §10 unverändert)

## 7. Cross-Cutting-Regeln

- **Reversibilität:** Jeder Codemod hat Backup-Branch oder Dry-Run-Mode
- **Build-Test nach jedem Sub-Sprint:** Astro-Build pflicht
- **YAML-Quoting (CLAUDE.md §10):** Codemods müssen Quoting beibehalten
- **Keine Slug-Umbenennungen** (Phase-1-Risiko R8): Categories-Slugs identisch zur heutigen `URL_SLUG_MAP`
- **URL-Stabilität:** Keine URL ändert sich. 301-Redirects sind out-of-scope (= Fehler)
- **Commit-Granularität:** Pro Sub-Sprint ein Commit oder benannte Sequenz
- **Test-Strategie:** Snapshot-Tests für JSON-LD-Output, Sitemap-Output, Hreflang-Output, URL-Liste

## 8. Decisions (vorab geklärt mit Marcel)

| # | Decision | Empfehlung |
|---|---|---|
| D1 | Categories-Refactor jetzt? | Ja, vor BK-Aufschlag |
| D2 | Schema-Package importieren? | Ja, sobald Branch A Sprint 2 fertig |
| D3 | Comparison-Felder aus Blog raus? | Ja, Phase-1-Befund |
| D4 | `relatedPillars` Soft-Ref? | Ja, härtester Lock-In |
| D5 | `next[]` typed? | Ja, Robustness-Win |
| D6 | Bucket-D-Lifts? | D1, D3, D4 ja. D2 nein (Status quo). |
| D7 | URL-Stabilität? | Pflicht. Keine Slug-Umbenennungen. |
| D8 | SEO-Snapshot-Protokoll? | Pflicht-Gate pro Sprint. |

## 9. Sync-Punkte mit Branch A (Marketing-Tool)

| Branch-B-Sprint | Branch-A-Sprint | Sync-Bedingung |
|---|---|---|
| Sprint 5 (Schema-Package-Integration) | Sprint 2 (Workspace-Package) | A.2 muss komplett vor B.5 |
| Sprint 3 (Categories-Files) | Sprint 3 (Categories-Tabelle Tool) | A.3.2 (Seed) definiert Slugs für B.3.1 |
| Sprint 1+2+4 | keine | können parallel zu Branch A laufen |

**Empfohlene Bearbeitungs-Reihenfolge (1 Agent):**
1. A-Sprint 1+2
2. B-Sprint 1+2 parallel zu A-Sprint 3
3. A-Sprint 3 → B-Sprint 3
4. A-Sprint 4 + B-Sprint 4 parallel
5. B-Sprint 5 → A-Sprint 5

## 10. Risiken & Mitigation

| # | Risiko | Mitigation |
|---|---|---|
| R1 | URL-Slug-Wert-Drift in Categories vs. URL_SLUG_MAP | Build-Time-Assert S3.1, Marcel-Review S3.5 |
| R2 | JSON-LD-Lift bricht Schema-Markup | Per-File-Byte-Diff S2.2, Marcel-Sign-off |
| R3 | Datums-Harmonisierung bricht Sitemap-`<lastmod>` | Codemod 1:1 + Snapshot S1.2 |
| R4 | Comparison-Files versteckt im Blog-Folder | grep-Pre-Check S1.3 |
| R5 | Sync-Punkt mit Branch A verzögert sich | B-Sprint 1+2+4 können vorlaufen, B-Sprint 3+5 warten |
| R6 | Pre-Commit-Hook bricht durch Codemod-Output | Dry-Run-Mode + Marcel-Review verhindert das |
| R7 | Schema-Package-Setup bricht Astro-Build | TS-Path-Mapping + Build-Test in S5.1 |
| R8 | `superRefine` Performance bei Build (jeder Article ruft `getCollection`) | Cache-Pattern wie `_toolIndex`, einmaliger Build-Cache |

## 11. Offene Fragen für Marcel

1. **Sind die 10 ki-wissen-Files mit Inline-JSON-LD vor S2.2 manuell reviewed?** Default: ja, Marcel reviewed Output. LLM-Pass mit Validierung optional.
2. **Sind heute MDX-Files mit Category-Werten, die NICHT in den 6/5/7 erkannten Sets sind?** Vor S3.3 vollständiger Scan über alle 268 Files (nicht nur Phase-1-Sample). Bei Outlier: manuelle Klärung.
3. **`@marketing-auto/content-schema` Distribution: npm-link, workspace, oder git-submodule?** Hängt davon ab, ob Astro-Repo im selben Monorepo wie Marketing-Tool liegt. Marcel klären.
4. **Sollen die Knowledge-Hub-Spoke-Cluster im Astro-Repo bleiben oder Tool-getrieben werden?** Heute manuell gepflegt (Phase-1-Wissenslücke). Out of Scope für diesen Branch, aber relevant für BK-Onboarding.

## 12. Implemented

_(wird beim Spec-Abschluss gefüllt)_

## 13. Discovered & Deviations

_(wird beim Spec-Abschluss gefüllt)_
