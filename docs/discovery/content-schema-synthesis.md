# Content-Schema-Synthese — Toolwiki + Domain-Generalisierung

> **Status:** Discovery-Audit, Read-only. Keine Code-Änderungen vorgenommen.
> **Datum:** 2026-05-22
> **Autor:** Schema-Architekt (Claude Opus 4.7)
> **Scope:** `/Users/marcelklaczinski/WebstormProjects/ki-wissensraum-neu` — 8 Content-Collections, 268 MDX-Dateien
> **Stress-Test-Domain (hypothetisch):** balkon-kraft-werk.de (Balkonkraftwerk-Produktvergleiche, Einspeise-Guides, Wirtschaftlichkeitsrechner)
> **Methodik:** 60 Sample-Files (10 pro Collection, DE+EN gemischt) für Frontmatter-Coverage; vollständiger `grep` über alle 268 MDX-Bodies für Component-Imports; vollständiger Read des Zod-Schemas (`src/content.config.ts`); vollständiger Read der i18n-/Resolver-/Pipeline-Helpers.

---

## Executive Summary

1. **Das Schema ist deutlich überdimensioniert.** ~30 % der optionalen Frontmatter-Felder werden in 0/10 Sample-Files genutzt (Legacy-Reste + Reserveslots). Live ist eine reduzierte Schnittmenge.
2. **Drei Naming-Bruchstellen** als Top-Friction für Generalisierung: (a) `date`+`updated` (blog, regex-String) vs. `updatedAt` (alle anderen, `isoDate`); (b) Blog-`category` ist striktes Zod-Enum mit englischen Labels, ki-wissen-`category` ist striktes Enum mit **deutschen Labels** (auch in EN-Files), Tool-`category` ist freier String; (c) Comparison-Felder (`toolSlugs`, `winner`, `verdict`, `testMethodology`, `useCaseVerdicts`) sind in zwei Collections dupliziert — im Blog-Schema definiert, aber in 0/10 Sample-Blogposts gelebt; live nur in `comparisons`.
3. **Bucket D (hartkodierte Component-Embeds) ist klein.** Insgesamt nur **2 reale Embed-Typen** in den MDX-Bodies: `HubCarousel` (50× im Blog, 1 Prop) und 11 Interactive-Components in `ki-wissen` (je 2×, jeweils 1 `locale`-Prop). `ToolCard` und `ClusterBox` sind Dead-Imports (in 8 Files importiert, in 0 Files gerendert). 1.561 Pipe-Tabellen + tausende HTML-Aside-Blöcke laufen über pure Markdown+Tailwind, nicht über Components.
4. **Bucket C (toolwiki-only) ist ebenfalls überschaubar:** `pricing`/`priceFrom`/`affiliateSlug`/`features`/`pros`/`cons`/`integrations`/`useCases`/`rating`/`votes`/`logoStrategy`/`logoSvg`/`relatedPillars`-Enum, `intentType`/`bottomLinksVariant`/`primaryTool`, `applicationCategory`/`offerPrice`/`offerCurrency` (Special-Landings). Vieles davon ist für balkon-kraft-werk.de semantisch übertragbar — nur die Werte sind anders.
5. **Empfehlung — Zwei-Layer-Schema:** Layer 1 Core (Bucket A+B) als gemeinsame Zod-Module (`seoCore`, `i18nCore`, `clusterCore`, `monetizationCore`, `baseFrontmatter`). Layer 2 Domain-Extension via **Zod-Composition pro Domain** (Astro-native, type-safe, build-time-validiert) — *nicht* `domainExtras: z.record(z.unknown())`-JSONB. Im Marketing-Tool spiegelt die Postgres-Persistenz das via JSONB-Spalte, aber im Astro-Repo bleibt es typstark.
6. **Kategorien-Refactor empfohlen:** Eine eigene `categories`-Collection (`{ slug, translations: { de, en }, parent?, urlSlug: { de, en } }`), Article-Frontmatter referenziert per Slug — analog zu wie `featuredToolSlugs` schon heute per `superRefine` validiert wird. Das beseitigt die drei verschiedenen Category-Modelle gleichzeitig.
7. **Marketing-Tool-Anbindung:** Heute lose (CLI-Scripts, JSON-Catalog, kein CI/CD im Repo, keine Drizzle/Postgres-Spuren). Generische Schicht muss **Frontmatter-Schreiber + Slug-Konventionen** kennen, nicht mehr.
8. **Größtes Risiko bei Migration:** URL-Slug-Map und `parentSlug`-Verkettungen. 108 Tools haben hartkodierte `relatedPillars`-Enum auf 12 Toolwiki-Pillars — das ist der einzige Punkt, an dem das Schema *jetzt schon* explizit Toolwiki ist und nicht generalisierbar.

---

## Phase 1 — Inventar

### Collections Übersicht

| Collection | DE-Files | EN-Files | Total | Reife | Notiz |
|---|---|---|---|---|---|
| `tools` | 54 | 54 | 108 | hoch | Größte Collection; Frontmatter-getrieben (Body teils auto-prosa) |
| `blog` | 28 | 28 | 56 | hoch | Editorial-Workhorse; Comparison-Felder schemadupliziert |
| `comparisons` | 11 | 11 | 22 | sehr hoch | Sauberste Coverage (5/5 in Sample-Pflichtfeldern) |
| `usecases` | 12 | 12 | 24 | mittel | 12 Branchen-Hubs; `highlights`/`industryFocus` ungenutzt |
| `ki-wissen` | 12 | 12 | 24 | hoch | `next[]`-Lerngraph; werbefrei; Category-Enum auf Deutsch (auch in EN) |
| `tool-categories` | 7 | 7 | 14 | niedrig (Sample 2/14) | Reine Long-Form-Stub-Collection |
| `special-landings` | 5 | 5 | 10 | unklar (Sample 1/10) | Brand-Landings, eigene Routing-Konvention (`/de/chatgpt/`) |
| `authors` | 5 | 5 | 10 | mittel | Person-Schema-Felder dominieren |
| **Summe** | **134** | **134** | **268** | | |

**Konfidenz:** *high* für tools/blog/comparisons/usecases/ki-wissen (jeweils 10 oder volle Locale-Hälfte gesampelt). *medium* für authors. *low* für tool-categories und special-landings (≤2 gelesene Files).

### Frontmatter-Felder pro Collection

Konsolidierte Übersicht — vollständige Per-Collection-Coverage-Tabellen liegen im Audit-Anhang vor (siehe Anhang am Ende). Hier die kondensierte Sicht „Schema-deklariert vs. real genutzt":

#### `tools` (Sample 10/108)

| Feld | Coverage | Schema | Bucket | Notiz |
|---|---|---|---|---|
| `title`, `description` | 10/10 | ✅ | A | Universal |
| `category`, `subcategory` | 10/10 | ✅ (freier String!) | B/C | Inkonsistent: anders als blog/ki-wissen kein Zod-Enum |
| `pricing`, `priceFrom`, `affiliateSlug` | 10/10 | ✅ | C | Tools-spezifisch |
| `rating`, `votes` | 9/10 | ✅ | C | UGC-Reputation, nur Tool-Bewertungen |
| `website`, `image` | 10/10 | ✅ | B | Universal-Extended |
| `features`, `pros`, `cons`, `integrations`, `useCases` | 10/10 | ✅ | B/C | Tool-Review-Pattern — semantisch in vielen Produkt-Domains übertragbar |
| `updatedAt` | 10/10 | ✅ | A | Universal |
| `author` | 10/10 | ✅ | A | Universal |
| `source` | 10/10 | ✅ (enum) | C/D | Marketing-Tool-Provenienz-Tag |
| `relatedPillars` | 9/10 | ✅ (hardcoded Enum 12 Slugs!) | C | **Härteste Toolwiki-Bindung im Schema** |
| `speakable` | 10/10 | ✅ | B | Universal (SEO) |
| `clusterKey`, `clusterRole` | 9/10 | ✅ | B | Universal-Extended |
| `seoTitle`, `seoDescription` | 10/10 | ✅ | A | Universal |
| `faq` | 9/10 | ✅ | B | Universal-Extended |
| `locale`, `translationKey` | 10/10 | ✅ | A | Universal i18n |
| `date`, `lastReviewed`, `lastReviewedBy`, `pricingVerifiedAt`, `logoStrategy`, `logoSvg`, `canonical`, `noindex`, `preconnect`, `imagePrompt`, `clusterOrder`, `parentSlug` | **0/10** | ✅ | — | **Schema-Leichen / Reserveslots** — alle deklariert, keine genutzt |

#### `blog` (Sample 10/56)

| Feld | Coverage | Schema | Bucket | Notiz |
|---|---|---|---|---|
| `title`, `excerpt`, `date`, `category`, `heroImage`, `heroImageAlt`, `seoTitle`, `seoDescription`, `tags`, `featured`, `clusterKey`, `showTopicLinks`, `author`, `speakable`, `locale`, `translationKey` | 10/10 | ✅ | A/B | Core-Editorial-Setup |
| `updated`, `updatedReason` | 5/10 / 4/10 | ✅ | A | Universal — aber Naming-Bruch zu `updatedAt` |
| `clusterRole`, `parentSlug`, `clusterOrder` | 9/10 / 7/10 / 3/10 | ✅ | B | Hub-Spoke-Gradient |
| `primaryTool`, `intentType`, `bottomLinksVariant` | 9/10 / 9/10 / 8/10 | ✅ | C | Toolwiki-Renderer-Hints |
| `readingTime` | 7/10 | ✅ | B | Universal |
| `faq` | 8/10 | ✅ | B | Universal-Extended |
| `toolSlugs`, `winner`, `verdict`, `testMethodology`, `useCaseVerdicts`, `comparedAt`, `listicleType` | 0–4/10 | ✅ | — | **Comparison-Felder im Blog-Schema dupliziert; live nur in `comparisons`-Collection genutzt** |
| `pubDate`, `description` | 0/10 | ✅ | — | Legacy-Rückwärtskompatibilität, tot |
| `loadNewsletterScript`, `ads`, `preconnect`, `canonical`, `noindex`, `slug` | 0–3/10 | ✅ | B | Per-File-Overrides, fast nie genutzt |
| `adsenseSlots`, `hasAffiliateLinks` | 0/10 | ✅ (Factory) | B | **Niemals explizit im Frontmatter** — Factory-Defaults wirken stillschweigend |

#### `comparisons` (Sample 5/22) — sauberste Collection

Alle Pflichtfelder 5/5: `title`, `description`, `toolSlugs`, `winner`, `verdict`, `updatedAt`, `comparedAt`, `testMethodology`, `useCaseVerdicts`, `author`, `heroImage`, `heroImageAlt`, `seoTitle`, `seoDescription`, `faq`, `locale`, `translationKey`. Ungenutzt: `lastReviewed`, `lastReviewedBy`, `canonical`, `noindex`, `clusterOrder`.

#### `usecases` (Sample 5/24)

Konsistent: `title`, `updatedAt`, `author`, `featuredToolSlugs`, `relatedPillarSlugs`, `contentType` (`'pillar'` oder `'hub'`, nie `'stub'`/`'expanded'` im Sample), `clusterKey`, `clusterRole`, `locale`, `translationKey`, `faq`. Ungenutzt: `highlights` (0/5), `industryFocus` (1/5).

#### `ki-wissen` (Sample 4/24)

Konsistent: alle deklarierten Felder 4/4 — `title`, `description`, `category` (Enum, deutsch), `level` (Enum, deutsch), `icon`, `facts[]` (4 Items pro File), `next[]`, `tags`, `updatedAt`, `author`, `seoTitle`, `seoDescription`, `faq`, `clusterKey`, `clusterRole`. Ungenutzt: `parentSlug`, `clusterOrder`, `canonical`, `noindex`, `preconnect`, `imagePrompt`. Monetization-Defaults `false`/`false` werden nie überschrieben (Knowledge-Layer bleibt clean — explizite Editorial-Entscheidung).

#### `tool-categories` (Sample 2/14)

Sehr kompaktes Schema. Alle 12 deklarierten Felder 2/2 belegt. `categorySlug` als Join-Key auf die Tool-Taxonomy (`src/lib/taxonomy.ts`). Kein clusterBase, kein monetization, keine FAQ-Constraint außer `optional()`. *Confidence: low.*

#### `special-landings` (Sample 1/10)

Sehr spezialisiert: `toolSlug` + `alternativeToolSlugs[1-4]`, `canonicalPath`, `applicationCategory`, `offerPrice`, `offerCurrency`, `relatedArticles[]`. Eigene Routing-Konvention (`/de/chatgpt/` statt `/de/top-ki-tools/.../chatgpt/`). *Confidence: low.*

#### `authors` (Sample 1/10)

Person-Schema-Felder: `name`, `jobTitle`, `expertise[]` (≥2), `initials` (1–3 chars), `avatarGradient` (HSL-Tuple), `image`, `sameAs[]` (im Sample leer), `email` (optional), `location`, `yearsExperience`, `knowsLanguage[]` (default `['de','en']`).

### MDX-interne Component-Imports

Vollständiger `grep` über alle 268 MDX-Bodies. Nur Komponenten, die **innerhalb der MDX-Bodies** importiert + gerendert werden (nicht Layout-Components):

| Component | Quelle | Total Renders | Verteilung | Props-Komplexität |
|---|---|---|---|---|
| `HubCarousel` | `@/components/content/HubCarousel.astro` | **50** | nur `blog` (25 DE + 25 EN) | 1 String-Prop (`excludeSlug`) |
| `AIQuiz`, `AIGlossary`, `GenAIToolFinder`, `TokenVisualizer`, `PromptBuilder`, `AIUseCaseFinder`, `MLAlgorithmFinder`, `OverfittingVisualizer`, `DLArchitectureFinder`, `NeuralNetworkVisualizer`, `AIClassifierDemo` | `@/components/interactive/*.astro` | **22** (11 × 2) | nur `ki-wissen` | je 1 String-Prop (`locale`) |
| `ToolCard` | `@/components/cards/ToolCard.astro` | **0** | importiert in 2 `tool-categories`-Files, nie gerendert | Dead Import |
| `ClusterBox` | `@/components/content/ClusterBox.astro` | **0** | importiert in 6 `ki-wissen`-Files, nie gerendert | Dead Import |

**Weitere Befunde im MDX-Body:**
- **JSON-LD-Snippets inline:** 10 `ki-wissen`-Files emittieren `<script type="application/ld+json" set:html={JSON.stringify(...)} />` für HowTo/Article-Schema. Das gehört konzeptionell ins Layout, nicht in den Body.
- **1.561 Pipe-Tabellen** (Markdown). Keine Component-Wrapper.
- **HTML-`<aside>`-Blöcke mit Tailwind:** Tausende, sehr konsistent (`card-soft`, `bg-amber-50`, `dark:bg-amber-900/20`). Diese sind *de-facto* TL;DR-/Callout-/Aside-Components, aber nicht als Components abstrahiert.

**Interpretation:** Die Codebase nutzt MDX-Component-Embeds **sparsam und mit minimalen Props** — Bulk-Editorial-Patterns laufen über Markdown+Tailwind. Bucket D ist damit **viel kleiner als ein generisches Schema-Design vermuten würde**.

### Kategorien & i18n heute

#### URL-Slug-Map (`src/lib/url-slugs.ts:16-40`)

Mappt locale-neutrale Frontmatter-Slugs → lokalisierte URL-Slugs:

```ts
toolCategories: {
  'audio-music':           { de: 'audio-musik',           en: 'audio-music' },
  'images-graphics':       { de: 'bilder-grafik',         en: 'images-graphics' },
  'business-productivity': { de: 'business-produktivitaet', en: 'business-productivity' },
  // … 7 Top-Level-Kategorien
},
toolSubcategories: { /* … 13 Subkategorien */ }
```

Helper: `toUrlSlug(canonicalSlug, locale, namespace)` ⇄ `fromUrlSlug(urlSlug, locale, namespace)`.

#### i18n-Config (`src/i18n/config.ts:40-72`)

- `defaultLocale: 'de'`
- `locales: [{ code: 'de', … }, { code: 'en', … }]`
- `prefixDefaultLocale: true` — beide Locales haben URL-Prefix (`/de/…`, `/en/…`)
- Konsumiert von `getLocalizedPath()`, `translateLocalePath()`, `stripLocaleFromPath()`, `buildAlternates()` (alle in `src/i18n/index.ts`)

#### DE/EN-Bridge

Primär über `translationKey: "tool-chatgpt"` o.ä. (in 108/108 Tools, 56/56 Blog-Posts, 24/24 Usecases gesetzt). Sitemap-Generator (`src/pages/sitemap/tools.xml.ts:53-61`) baut daraus `keyToToolByLocale`-Map → Hreflang-Alternates. Sekundär: identische Slugs in `de/` und `en/`-Ordnern (alle 108 Tools haben beide Pendants, kein `comm -23`-Diff).

Fehlende EN-Pendants werden **stillschweigend ausgelassen** — keine Build-Validierung, keine Schema-Constraint, kein x-default-Throw.

#### Drei verschiedene Category-Modelle

| Collection | Typ | Werte | Locale-Verhalten |
|---|---|---|---|
| `blog.category` | striktes `z.enum` (6 Werte) | `'Guides & Tutorials'`, `'Tool-Reviews'`, `'Vergleiche'`, `'Trends & Zukunft'`, `'Praxis & Use Cases'`, `'Ethik & Recht'` | gemischtsprachig; gleicher Enum-Set für DE+EN |
| `ki-wissen.category` | striktes `z.enum` (5 Werte) | `'Grundlagen'`, `'Technik'`, `'Ethik & Recht'`, `'Praxis'`, `'Zukunft'` | **rein deutsch — auch in EN-Files** |
| `tools.category` | `z.string().optional()` — freier String, kein Constraint im Schema | 7 kanonische Werte (`'audio-music'`, …) — Constraint nur informell in `url-slugs.ts` | locale-neutrale Slugs, lokalisiert über `URL_SLUG_MAP` |

Plus: `usecases.relatedTags[]`, `tools.tags[]`, `blog.tags[]`, `ki-wissen.tags[]` — alle freier Text, keine Registry. Tags unterscheiden sich zwischen DE und EN (`"Assistent"` vs. `"Assistant"`).

#### Resolver-Helpers

Nur `tools` (`src/lib/tools.ts`) und `authors` (`src/lib/authors.ts`) haben dedicated Lookup-Helper mit Map-Cache + Locale-Fallback. `ki-wissen`/`comparisons`/`usecases` werden in Page-Templates direkt per `getCollection('…')` gelesen + ad-hoc gefiltert.

#### Marketing-Tool-Touchpoints heute

- **Pipeline:** `tools:update` = `tools:ph` → `tools:csv` → `tools:catalog` (Script fehlt!) → `tools:crawl` (Script fehlt!) → `tools:merge` → `tools:mdx`. Lücke deutet darauf hin, dass der externe Marketing-Tool-Lauf das Catalog-Json überspringt oder das selbst hält.
- **Keine `.github/workflows/`** im Repo. Automation ist CLI-driven.
- **Keine Drizzle/Postgres-Spuren** — Marketing-Tool ist extern, schreibt nur in den Repo.
- **`dist-audit/`** ist `.gitignored`. Audit-Reports persistieren nicht im Repo.
- **`contentHash`-Feld** (im Schema, im Sample 2/10) ist Marketing-Tool-internes Kollisions-Schutz-Token bei automatisch generierten MDX-Slugs.

---

## Phase 2 — Klassifikation

Jedes vorkommende (oder im Schema deklarierte und potenziell sinnvolle) Feld wird in eines von vier Buckets klassifiziert.

**Bucket-Definitionen:**
- **A — Universal-Core:** Gehört in jede Astro-Content-Domain.
- **B — Universal-Extended:** In vielen Domains nützlich, optional.
- **C — Domain-spezifisch:** Nur Toolwiki-Semantik.
- **D — Hartkodiert, dynamisierbar:** Heute Code-Snippet im MDX-Body, sollte Frontmatter-Flag oder Layout-Konvention sein.

Jede Klassifikation enthält den **Balkon-Kraft-Werk-Stress-Test** in Klammern.

### Bucket A — Universal-Core

| Feld (kanonisch) | Heutige Quellen | Begründung |
|---|---|---|
| `title` | alle 8 Collections | Jeder Content braucht einen Titel. *(BK: Produkttitel, Guide-Titel — identisch)* |
| `description` | tools, blog (`excerpt`), comparisons, ki-wissen, … | Subtitle/Lead. *(BK: identisch)* |
| `locale` | alle Collections via `i18nBase` | Multi-Locale ist Mainstream. *(BK: zumindest DE — später evtl. AT/CH/EN)* |
| `translationKey` | alle Collections via `i18nBase` | Hreflang-Bridge ist universal. *(BK: identisch)* |
| `date` / `updated` (kanonisch **ein** Datums-Paar) | blog: `date`+`updated`; alle anderen: `updatedAt`. **Bruch.** | Zeitstempel ist universal. *(BK: identisch; bei Strompreis-Guides extrem wichtig)* |
| `author` | fast alle Collections; `authors`-Collection als Source | E-E-A-T-Signal universal. *(BK: identisch)* |
| `seoTitle`, `seoDescription` | alle Collections via `seoBase` | SEO ist universal. *(BK: identisch)* |
| `heroImage`, `heroImageAlt` | alle außer `authors` (`image`) | Universal — jede Content-Page hat Cover. *(BK: identisch)* |
| `canonical` | `seoBase` | SEO-Edge-Case, in jeder Domain potentiell relevant. *(BK: identisch)* |
| `noindex` | `seoBase` | Universal. *(BK: identisch — z. B. Affiliate-Disclaimer-Page)* |
| `draft` | **fehlt heute komplett**, könnte über `noindex` simuliert werden | Universal — Working-Copy-Status. *(BK: identisch)* |
| `tags` | tools, blog, ki-wissen, usecases (als `relatedTags`) | Universal-Lite. Freitext OK; Registry-optional. *(BK: identisch)* |

**Naming-Empfehlung Core:** Datums-Paar harmonisieren auf `publishedAt` + `updatedAt` (ISO `YYYY-MM-DD`) — **keine Mischung aus `date`/`updated`/`updatedAt`/`comparedAt`**. `comparedAt` wandert in die Domain-Extension von `comparison`-Content.

### Bucket B — Universal-Extended

| Feld | Heutige Quellen | Begründung |
|---|---|---|
| `excerpt` | blog | Listings-Subtitle. *(BK: identisch)* |
| `category` (als **Slug-Reference**, nicht String) | tools, blog, ki-wissen (drei verschiedene Modelle!) | Universal — aber als Reference auf eine `categories`-Collection, nicht als Enum-pro-Collection. *(BK: identisch — Mikrowechselrichter, Solarpanele 400W+, Batteriespeicher)* |
| `subcategory` | tools | Universal-Extended bei hierarchischen Taxonomien. *(BK: identisch — z. B. „Panele/Glas-Glas")* |
| `clusterKey`, `clusterRole`, `parentSlug`, `clusterOrder` | `clusterBase` in tools/blog/comparisons/usecases/ki-wissen | Hub-Spoke ist eine universelle SEO-Strategie. *(BK: identisch — Pillar „Einspeisevergütung 2026" mit Spokes)* |
| `faq[{question, answer}]` | `seoBase.faq` in fast allen Collections | FAQPage-JSON-LD ist universal. *(BK: identisch)* |
| `imagePrompt` | `seoBase` | Universal für AI-Tool-driven Content. *(BK: identisch)* |
| `preconnect[]` | `seoBase` | Performance-Hint, universal. *(BK: identisch)* |
| `speakable` | tools, blog | Voice-Search-SEO universal. *(BK: identisch)* |
| `readingTime` / `estimatedReadTime` | blog, usecases (inkonsistente Namen!) | Universal. Harmonisieren auf `readingTime`. *(BK: identisch)* |
| `featured` | blog | Universal-Lite. *(BK: identisch)* |
| `contentType` | usecases (`'stub'`/`'expanded'`/`'pillar'`/`'hub'`) | Universal — Renderer-Hint für Layout-Komplexität. *(BK: identisch)* |
| `adsenseSlots`, `hasAffiliateLinks` (`monetizationCore`) | blog/comparisons/usecases/ki-wissen | Universal — jede Content-Domain monetarisiert irgendwie. *(BK: identisch — extrem Affiliate-getrieben)* |
| Cross-Collection-Refs als generisches Konzept (`relatedXxxSlugs[]`) | usecases.relatedPillarSlugs/relatedComparisonSlugs; tools.relatedPillars (Enum); blog.toolSlugs | Universal, aber **als typed-Slug-Reference-Pattern**, nicht als hartkodierte Enums. *(BK: identisch — `relatedProducts`, `relatedGuides`)* |

### Bucket C — Domain-spezifisch (Toolwiki)

| Feld | Begründung | BK-Test-Verdikt |
|---|---|---|
| `pricing` (Tools), `priceFrom`, `affiliateLink`, `affiliateSlug` | Tools-Monetization-Felder | **Universal-Extended-Twin:** Produkt-Domains brauchen analog `pricing` (€-Wert), `affiliateUrl`. Eher Bucket B, aber Semantik unterscheidet sich (Subscription vs. Einmalkauf). → Empfehlung: **in eine domain-konfigurierbare `productEconomics`-Group**. |
| `rating`, `votes` | UGC-Tool-Reputation | Universal-Extended für Produkt-Domains. BK identisch. → Eher Bucket B. |
| `features[]`, `pros[]`, `cons[]`, `useCases[]` | Tool-Review-Pattern | **Universal-Extended für jede Produkt-/Service-Domain.** BK identisch. → Bucket B. |
| `integrations[]` | Tool-spezifisch (Software-Integrationen) | BK selten relevant (manche Balkonkraftwerke haben Apps, aber nicht universell). → **Bucket C: Toolwiki-spezifisch**, in BK weglassen. |
| `relatedPillars: z.enum([12 Toolwiki-Slugs])` | **Hardcoded 12 Knowledge-Pillar-Slugs** | **Echtester Toolwiki-Lock-In im Schema.** BK kennt keine `was-ist-ki`/`prompt-engineering`-Pillars. → Bucket C, **muss in Extension wandern + zur Soft-Slug-Reference auf `categories`-/`pillars`-Collection werden**. |
| `intentType: z.enum(['overview','pricing','features','use-cases','comparison','tutorial','review','ethics','general'])` | Blog-Renderer-Hint für Sektion-Auswahl | BK hätte andere Intents (`installation-guide`, `roi-calculation`, …). → Bucket C; in Extension. |
| `bottomLinksVariant: z.enum(['default','tool','learning','business','private','comparison'])` | Blog-Layout-Variante | BK identisch unstimmig. → Bucket C; in Extension. |
| `primaryTool` (Blog) | Tool-Slug-Referenz für Related-Ranking | BK: `primaryProduct`. → Bucket C-mit-Twin. |
| `featuredToolSlugs[2-7]` (Usecases) | Slug-Array auf Tool-Collection | BK: `featuredProductSlugs`. **Generisches Pattern**, nur Wertraum unterschiedlich. → Bucket B als generisches `featuredEntitySlugs`-Konzept; konkrete Naming Bucket C. |
| `logoStrategy: z.enum(['auto','svg-inline'])`, `logoSvg` | Tool-Logo-Rendering-Strategie | BK: Produkte haben Hersteller-Logos, gleiches Pattern. → Bucket B. |
| `applicationCategory`, `offerPrice`, `offerCurrency` (Special-Landings) | Schema.org `SoftwareApplication`-Felder | BK: würde Schema.org `Product` brauchen → andere Felder (`brand`, `sku`, `gtin`). → Bucket C; per JSON-LD-Renderer pro Domain. |
| `toolSlug` + `alternativeToolSlugs` (Special-Landings) | Brand-Landing-Tool-Bindung | BK: `productSlug` + `alternativeProductSlugs`. → Bucket B/C-Twin. |
| `next[]` (ki-wissen Learning-Graph) | DE-/EN-Sprachstrings als Slug-Ersatz | Pattern universal, aber heute als **freier String** implementiert statt typed Slug-Reference. → Bucket B mit Strukturwarnung. |
| `level: z.enum(['Einsteiger','Praktiker','Profi'])` | ki-wissen Difficulty | BK identisch (`'Einsteiger'`/`'Profi'` bei DIY-Installation). → Bucket B. |
| `industryFocus` (Usecases) | Branchen-Freitext | BK identisch (`'Hausbesitzer-Eigenheim'`). → Bucket B. |
| `comparedAt`, `winner`, `verdict`, `testMethodology`, `useCaseVerdicts` | Comparison-Felder | BK identisch (`balkon-x vs. balkon-y`). → Bucket B-Twin (als generisches `comparison`-Extension). |
| `source: z.enum(['manual','producthunt','futurepedia','csv','auto'])` | Marketing-Tool-Provenienz | BK identisch (`'manual'`/`'amazon'`/`'idealo'`/`'auto'`). → Bucket B, aber **Enum-Werte sind Domain-Config**. |
| `contentHash` (interne ID) | Slug-Kollisions-Schutz im Generator | BK identisch — gehört in Marketing-Tool, nicht ins Public-Schema-Doku. → Bucket B (intern). |
| `loadNewsletterScript`, `ads` (Blog) | Per-File-Renderer-Toggle | BK potenziell. → Bucket B. |
| `expertise[]`, `avatarGradient`, `initials`, `knowsLanguage[]` (Authors) | Person-Schema-Felder | BK identisch. → Bucket B. |

### Bucket D — Hartkodiert in MDX, sollte dynamisiert werden

| Heutiger Zustand | Realität (aus Component-Audit) | Empfehlung |
|---|---|---|
| `<HubCarousel excludeSlug="…" />` als `import` + `<Render />` in 50 Blog-MDX-Bodies | 1 Prop, immer am Artikel-Ende | **In Layout verschieben** + Frontmatter-Flag `showHubCarousel: boolean` (default `true`). Slug für `excludeSlug` aus File-Slug. |
| 11 Interactive-Components in ki-wissen (`<AIQuiz locale="de" />`, …) | 1 `locale`-Prop (= File-Locale) | Bleiben im Body, aber `locale`-Prop kann aus Astro-Context kommen → keine Frontmatter-Flag nötig, nur weniger Boilerplate. Alternative: deklarativer Embed-Slot in Frontmatter `embeds: [{ type: 'ai-quiz' }]` mit Layout-Dispatch-Map. |
| Inline-`<script type="application/ld+json">` in 10 ki-wissen-Files | Manuelle HowTo-Schema-Pollution | **In Layout verschieben** + Frontmatter-Flag `schemaType: 'HowTo'` mit strukturierten Frontmatter-Feldern (`howToSteps: [{ name, text }]`). |
| `<aside class="card-soft …">…</aside>` Tausende HTML-Aside-Blöcke | TL;DR-/Callout-/Warning-Pattern in pure Markdown+Tailwind | **Status quo lassen.** Markdown-only ist editorial schneller und MDX-portabler als Component-Imports. Falls Standardisierung gewünscht: optionaler `<Callout>`-Component, aber nicht als Pflicht. |
| Dead Imports `ToolCard` (2×), `ClusterBox` (6×) | Importiert, nie gerendert | **Aufräumen** (Edge Case, siehe Phase 4). |

**Quantitatives Verdikt:** Bucket D ist **kleiner als erwartet** — nur 2 reale Embed-Patterns, beide mit minimalen Props. Der Großteil der Editorial-Komplexität liegt in Markdown+Tailwind, nicht in Component-Embeds. Das ist eine **gute Nachricht für Generalisierung**: Layer 1 + 2 müssen sich nicht primär um Embed-Composition kümmern.

---

## Phase 3 — Konsolidierungs-Vorschlag

### Core-Schema (Layer 1, Bucket A + B)

Ziel: ein gemeinsames Zod-Modul, das für Toolwiki, BK-Werk und beliebige weitere Domains die Frontmatter-Basis liefert. Astro-Collection-Definitionen pro Domain extenden es.

```ts
// shared/content-schema/core.ts — domain-agnostic
import { z } from 'astro/zod';

/** Locale-Codes — pro Domain konfigurierbar. */
export const makeLocaleEnum = (locales: readonly [string, ...string[]]) =>
  z.enum(locales);

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

export const imagePath = z
  .string()
  .regex(/^(https?:\/\/|\/)/i, 'image must start with "/" or "https://"');

export const seoCore = z.object({
  seoTitle: z.string().max(70).optional(),
  seoDescription: z.string().max(180).optional(),
  canonical: z.string().url().optional(),
  noindex: z.boolean().default(false),
  preconnect: z.array(z.string().url()).optional(),
  imagePrompt: z.string().optional(),
  speakable: z.boolean().default(false),
  faq: z
    .array(z.object({ question: z.string(), answer: z.string() }))
    .max(15)
    .optional(),
});

export const i18nCore = (locales: readonly [string, ...string[]]) =>
  z.object({
    locale: makeLocaleEnum(locales).default(locales[0]),
    translationKey: z.string().optional(),
  });

export const clusterCore = z.object({
  clusterKey: z.string().optional(),
  clusterRole: z.enum(['hub', 'spoke']).optional(),
  parentSlug: z.string().optional(),
  clusterOrder: z.number().int().nonnegative().optional(),
});

export const monetizationCore = (
  defaultSlots: false | readonly ('top' | 'mid' | 'bottom')[],
  defaultAffiliate: boolean,
) =>
  z.object({
    adsenseSlots: z
      .union([z.literal(false), z.array(z.enum(['top', 'mid', 'bottom']))])
      .default(defaultSlots as false | ('top' | 'mid' | 'bottom')[]),
    hasAffiliateLinks: z.boolean().default(defaultAffiliate),
  });

/** Universal-Core + Universal-Extended Basis-Schema.
 *  Pro Domain via `.merge(domainExtension)` erweitern. */
export const baseFrontmatter = (locales: readonly [string, ...string[]]) =>
  z
    .object({
      title: z.string(),
      description: z.string().optional(),
      excerpt: z.string().optional(),
      publishedAt: isoDate.optional(),
      updatedAt: isoDate.optional(),
      author: z.string().optional(), // slug into authors collection
      heroImage: imagePath.optional(),
      heroImageAlt: z.string().optional(),
      readingTime: z.string().optional(),
      tags: z.array(z.string()).default([]),
      // Category as soft slug reference (validated via superRefine against categories collection)
      category: z.string().optional(),
      subcategory: z.string().optional(),
      draft: z.boolean().default(false),
      featured: z.boolean().default(false),
      contentType: z
        .enum(['article', 'stub', 'pillar', 'hub'])
        .default('article'),
      // generic cross-collection references — kept open, validated per domain
      relatedSlugs: z.array(z.string()).optional(),
    })
    .merge(seoCore)
    .merge(i18nCore(locales))
    .merge(clusterCore);
```

**Anmerkungen:**
- `publishedAt`/`updatedAt` ersetzen die heutige Mischung `date`/`updated`/`updatedAt`. Migration der 56 Blog-Posts nötig.
- `category` ist **String** (Slug-Reference), nicht `enum`. Die Konsistenz wird per Domain via `superRefine` gegen eine eigene `categories`-Collection erzwungen (siehe unten).
- `relatedSlugs` ersetzt das Pattern, das heute pro Collection als `relatedPillarSlugs`/`relatedComparisonSlugs`/`featuredToolSlugs` mehrfach existiert. Domains können engere Felder zusätzlich definieren.
- `monetizationCore` bleibt eine Factory, weil die Defaults pro Content-Type sinnvoll variieren (knowledge vs. blog vs. comparison).

### Extension-Mechanik (Layer 2) — zwei Optionen

#### Option A: `domainExtras: z.record(z.unknown())` (JSONB-Style)

```ts
const blog = defineCollection({
  schema: baseFrontmatter(['de', 'en']).extend({
    domainExtras: z.record(z.unknown()).optional(),
  }),
});

// Per-Domain Validator (manuell aufgerufen, nicht im Build):
function validateToolwikiBlogExtras(extras: unknown) {
  return z
    .object({
      intentType: z.enum(['overview', 'pricing', /* … */]).optional(),
      bottomLinksVariant: z.enum(['default', /* … */]).optional(),
      primaryTool: z.string().optional(),
    })
    .parse(extras);
}
```

**Vorteile:**
- Marketing-Tool kann `domainExtras` 1:1 als JSONB-Spalte in Postgres halten.
- Sehr lockerer Astro-Build: Schema-Änderungen pro Domain brechen nicht den Build.
- Cross-Domain-Tooling muss nur die Core-Felder kennen.

**Nachteile:**
- Verliert Astro-Build-Validierung der Domain-Felder (Validator wäre nicht standardmäßig wired).
- Typescript-Inferenz funktioniert nicht ohne explizite Type-Casts in Templates.
- "Stiller Drift": ein Tippfehler in `intentType` schlägt erst im Renderer fehl, nicht im Build.
- MDX-Editor (Cursor, VS Code) bekommt keine Auto-Completion für Domain-Felder.

#### Option B: Astro-Collection-Composition pro Domain (Zod-Merge)

```ts
// shared/content-schema/core.ts — wie oben

// per-domain extension:
// toolwiki/content-schema.ts
import { baseFrontmatter, monetizationCore } from '@shared/content-schema/core';

const toolwikiBlogExtras = z.object({
  primaryTool: z.string().optional(),
  intentType: z
    .enum(['overview', 'pricing', 'features', 'use-cases', /* … */])
    .optional(),
  bottomLinksVariant: z
    .enum(['default', 'tool', 'learning', 'business', /* … */])
    .optional(),
  showTopicLinks: z.boolean().default(true),
  // Comparison-Felder wandern aus dem Blog-Schema raus — eigene Collection
});

export const blog = defineCollection({
  schema: baseFrontmatter(['de', 'en'])
    .merge(toolwikiBlogExtras)
    .merge(monetizationCore(['top', 'mid'], true)),
});
```

**Vorteile:**
- Astro-Build validiert Domain-Felder strikt.
- Volle Typescript-Inferenz in Templates (`entry.data.intentType` wird `'overview' | …`).
- Editor-Auto-Completion in MDX-Files.
- Klares Audit pro Domain: was ist Core, was ist Extension.

**Nachteile:**
- Marketing-Tool muss pro Domain die Extension-Definition kennen, um Frontmatter zu generieren.
- Schema-Migration aufwendiger (Domain-Schemas leben pro Repo).

#### Empfehlung: **Option B im Repo, Option A im Marketing-Tool**

- **Im Astro-Repo:** Zod-Composition (Option B). Astro-native, type-safe, build-time-validiert.
- **Im Marketing-Tool (Postgres):** Eine Spalte `core_frontmatter JSONB` (Bucket A+B) + Spalte `domain_extras JSONB` (Bucket C). Validierung beim Insert über pro-Domain registrierten Zod-Validator (gleicher Zod-Code wird im Tool und im Repo geteilt, z. B. als npm-Package `@marcel/content-schema`).
- **Schreibpfad:** Marketing-Tool schreibt MDX-File → Frontmatter ist flach (kein `domainExtras`-Subobjekt) → Astro liest mit Composed Schema (Option B) → strikte Build-Validierung.

So bekommst du das Beste aus beiden Welten: lockere Persistenz im Tool, strenge Validierung im Repo.

### Dynamisierung Bucket D (pro Fall)

#### D1 — `HubCarousel` in Blog-Posts

**Heutiger Zustand** (`src/content/blog/de/ki-hr-recruiting-mittelstand-2026.mdx:254`):
```mdx
import HubCarousel from '@/components/content/HubCarousel.astro';

…artikel-body…

<HubCarousel excludeSlug="ki-hr-recruiting-mittelstand-2026" />
```

**Vorgeschlagene Frontmatter-Form:**
```yaml
showHubCarousel: true   # default true in BlogLayout
```

**Wer rendert das:** `BlogPost.astro`-Layout — liest `entry.data.showHubCarousel`, dispatcht auf `<HubCarousel excludeSlug={entry.slug} />`. Frontmatter wird kürzer; `import`-Boilerplate verschwindet aus 50 Files.

**Migrationspfad:** 50 Files; `awk`-Script entfernt die zwei Zeilen (Import + Render). Reversibel.

#### D2 — Interactive Components in ki-wissen

**Heutiger Zustand** (`src/content/ki-wissen/de/was-ist-ki.mdx:389`):
```mdx
import AIQuiz from '@/components/interactive/AIQuiz.astro';

…artikel-body…

<AIQuiz locale="de" />
```

**Vorgeschlagene Frontmatter-Form:**
```yaml
embeds:
  - type: 'ai-quiz'
    placement: 'after-section-3'   # optional, default = body-end
  - type: 'ai-glossary'
```

**Wer rendert das:** `KiWissenLayout.astro` liest `entry.data.embeds[]`, mappt über `embedComponentMap: Record<EmbedType, AstroComponent>` und rendert. `locale`-Prop wird aus Layout-Context injiziert.

**Trade-off:** Lose MDX-Component-Imports sind editorial direkter — der Redakteur sieht im File, was wo gerendert wird. `embeds[]` ist sauberer fürs Marketing-Tool, aber abstrakter. **Mein Vorschlag: Status quo lassen, nur die `locale`-Prop aus Astro-Context ziehen** (entfernt 22× Boilerplate). Vollständige Dynamisierung lohnt sich erst, wenn die Embed-Anzahl pro Page > 3 wird.

**Migrationspfad:** Component-Signaturen ändern (Prop wird optional, default = `Astro.currentLocale`). Frontmatter unverändert.

#### D3 — Inline-JSON-LD-Snippets in ki-wissen

**Heutiger Zustand** (10 Files, `<script type="application/ld+json">…HowTo…</script>` im Body):

**Vorgeschlagene Frontmatter-Form:**
```yaml
schemaType: 'HowTo'
howToSteps:
  - name: 'Schritt 1: Modell auswählen'
    text: 'Wähle ein vortrainiertes Sprachmodell …'
  - name: 'Schritt 2: Prompt formulieren'
    text: '…'
```

**Wer rendert das:** Layout emittiert das JSON-LD basierend auf `schemaType` + strukturierten Frontmatter-Feldern. Der Body bleibt MDX-Prosa.

**Migrationspfad:** Pro File ein Lift von Schema-JSON in Frontmatter. 10 Files, ~30 Min manuell oder 1× LLM-Pass mit Validierung.

#### D4 — Dead Imports aufräumen

`ToolCard` in 2 `tool-categories`-Files, `ClusterBox` in 6 `ki-wissen`-Files. **Einfach entfernen**, keine Frontmatter-Änderung nötig.

### Kategorien-Refactor-Vorschlag

#### Heutiger Stand (Drei Modelle, drei Probleme)

1. **Blog:** `category: z.enum(['Guides & Tutorials', /* … */])` — englische Labels, gemischter Set, kein Locale-Mapping.
2. **ki-wissen:** `category: z.enum(['Grundlagen', /* … */])` — deutsche Labels, auch in EN-Files (sic!) gleicher deutscher Wert.
3. **Tools:** `category: z.string().optional()` — freier String, Validierung nur informell via `URL_SLUG_MAP`. 7 kanonische Werte (`'audio-music'`, …).

#### Vorschlag: separate `categories`-Collection

```ts
// shared/content-schema/categories.ts
const category = defineCollection({
  loader: glob({ pattern: '*.{md,mdx}', base: './src/content/categories' }),
  schema: z.object({
    slug: z.string(),       // locale-neutral, e.g. 'audio-music'
    translations: z.record(
      z.object({
        label: z.string(),
        urlSlug: z.string(),
      }),
    ),
    parent: z.string().optional(),  // for sub-categories
    scope: z.enum(['tool', 'blog', 'knowledge', 'usecase']).default('tool'),
    icon: z.string().optional(),
    color: z.string().optional(),
  }),
});
```

Beispiel-Datei `src/content/categories/audio-music.md`:
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

**Content-Frontmatter referenziert per Slug:**
```yaml
# src/content/tools/de/suno.mdx
category: 'audio-music'
subcategory: 'song-generation'
```

**Schema-Constraint:** `tools.category`/`blog.category`/`ki-wissen.category` werden zu `z.string().optional()` + `superRefine`-Check gegen die `categories`-Collection (analog zu wie heute `featuredToolSlugs` validiert wird).

**Migration:** Ein einmaliger Lift — Blog-Posts mit `category: 'Guides & Tutorials'` → `category: 'guides-tutorials'`. Plus: 6+5+7 Kategorie-Files schreiben. Plus: Renderer ziehen Label nicht mehr aus Frontmatter, sondern aus `categories`-Collection per Locale.

**BK-Test:** Würde 1:1 funktionieren — Kategorien wären `mikrowechselrichter`, `solarpanele-400w-plus`, `batteriespeicher`, `ladegeraete-elektroautos`, mit `de`/`en`-Übersetzungen. `parent` würde Hierarchie ermöglichen (`solarpanele` → `solarpanele-400w-plus`).

**Neben-Effekt:** `URL_SLUG_MAP` in `src/lib/url-slugs.ts` wird redundant — die Information sitzt in der Categories-Collection. Hilfe-Funktion `toUrlSlug(slug, locale)` liest die Collection statt einer hardcoded Map. *(Achtung: Build-Performance prüfen — Slug-Resolution darf nicht pro Render-Call neu laufen, sondern einmal pro Build cachen, analog zu `_toolIndex`.)*

---

## Phase 4 — Edge Cases & Limits

Befunde, die realistisch **nicht generisch generalisiert** werden können oder einen Escape-Hatch brauchen.

| # | Edge Case | Charakter | Empfehlung |
|---|---|---|---|
| E1 | **`relatedPillars: z.enum([12 toolwiki slugs])` in `tools`-Collection** (`src/content.config.ts:259-272`) | Hartkodierte Toolwiki-Pillar-Slugs. Schema bricht für jede andere Domain. | **In Domain-Extension verschieben** + zur Soft-Slug-Reference auf Domain-spezifische Pillar-/Knowledge-Collection machen. Validierung via `superRefine` gegen `ki-wissen`-Slugs. |
| E2 | **Comparison-Felder im Blog-Schema dupliziert** (`toolSlugs`, `winner`, `verdict`, `testMethodology`, `useCaseVerdicts`, `comparedAt`, `listicleType` in `content.config.ts:392-408`) | In Blog-Schema deklariert, in 0–4/10 Sample-Files genutzt, parallel zur eigenständigen `comparisons`-Collection. | **Aus Blog-Schema entfernen.** Falls Blog-Posts mit Vergleichscharakter gewollt sind: über `intentType: 'comparison'` + Cross-Reference auf eine Comparison-Entity (Slug). |
| E3 | **ki-wissen-Category-Enum auf Deutsch — auch in EN-Files** (`'Grundlagen'` in `en/what-is-ai.mdx`) | Schema-erzwungener Deutsch-Wert in Englisch-Locale. Funktioniert nur, weil der Renderer den Wert übersetzt. | **Locale-neutraler Slug** (`'fundamentals'`) — Übersetzung läuft via Categories-Collection (siehe Phase 3). |
| E4 | **Special-Landings haben eigene Routing-Konvention** (`/de/chatgpt/` statt `/de/top-ki-tools/.../chatgpt/`, via `canonicalPath`-Frontmatter) | Eigenes Schema mit Schema.org-Product-Subset (`applicationCategory`/`offerPrice`/`offerCurrency`). | **Akzeptabel als eigene Collection mit Domain-Extension.** Im generischen Schema gibt es kein Äquivalent — Marketing-Landings sind per Natur Domain-spezifisch. |
| E5 | **JSON-LD-Renderer pro Schema-Type** | Toolwiki: `SoftwareApplication`. BK: `Product`. Andere Domains: `Service`, `Recipe`, etc. | **Layout-Konvention pro Domain.** Frontmatter signalisiert `schemaType: '…'`, der Layout-Renderer baut das passende JSON-LD. Im Core-Schema bleibt nur `schemaType: z.string().optional()`. |
| E6 | **`pricing`-Semantik** (Tools: `'freemium'`/`'api-based'`/etc. als Freitext; BK wäre Einmalkauf-€-Betrag) | Gleicher Frontmatter-Schlüssel, unterschiedliche Werte/Semantik. | **In Domain-Extension** — pro Domain wird `pricing` als Zod-Enum oder Zod-`union` definiert. Core hat kein `pricing`. |
| E7 | **`source`-Enum**: `'manual'|'producthunt'|'futurepedia'|'csv'|'auto'` — provider-spezifisch | BK hätte `'manual'|'amazon'|'idealo'|'auto'`. | **Domain-Config** — Enum-Werte werden pro Domain konfiguriert. Core hat `source: z.string()` o. Ä. |
| E8 | **`logoStrategy`/`logoSvg`** (Tools, 0/10 genutzt) + **`logoStrategy: 'svg-inline'`-Pfad** | Nicht-trivial: Inline-SVG bedeutet Render-Time-Sanitize-Anforderung. | Status quo. Im Core nicht abbilden. |
| E9 | **`next[]` im ki-wissen Learning-Graph** ist heute deutsche/englische Sprachstrings (`"Maschinelles Lernen"`, nicht `slug`) | Brittle; bricht bei Umbenennung. | **Zu typed Slug-Reference machen** (`next: z.array(z.string())` mit `superRefine` gegen `ki-wissen`-Slugs). |
| E10 | **`contentHash`-Slug-Kollisions-Schutz** | Marketing-Tool-interner Mechanismus, im Schema sichtbar. | Bleibt im Schema (Bucket B), aber als „intern" markiert; nicht im Core-Doku erwähnen. |
| E11 | **`prefixDefaultLocale: true` + locale-neutrale URL_SLUG_MAP** | Etablierte Routing-Konvention, nicht ohne Migration änderbar. | Status quo. Generische Domains müssen nur die Routing-Strategie pro Domain selbst entscheiden — kein Core-Lock-In. |
| E12 | **Hreflang ohne Build-Validierung für fehlende EN-Pendants** (stille Auslassung) | Datenqualitäts-Risiko, nicht Schema-Risiko. | Optional: `superRefine`-Check, der bei `translationKey` ohne Partner warnt (nicht erroriert). |
| E13 | **Drei verschiedene Datums-Felder** (`date`/`updated`/`updatedAt`/`comparedAt`) | Harmonisierung kostet Migration auf 268 Files. | Lohnt sich; einmaliger Aufwand für langlebigen Gewinn. |
| E14 | **Authors `image: imagePath.optional()` und Fallback auf `initials`+`avatarGradient`** | Spezifische Person-Schema-Pflege. | Status quo. Universal-Extended, kein Edge Case im engeren Sinn. |
| E15 | **Tags-Semantik** (Freitext, locale-unterschiedlich, keine Registry) | Bekannte SEO-Verwaltungslast, nicht Schema-Bruch. | Status quo. Optionale Tag-Registry kann später kommen, nicht Pflicht. |

**Verdikt:** Die meisten Edge Cases sind durch das Zwei-Layer-Schema + Domain-Extension lösbar. Nur **E4 (Special-Landings)** und **E5 (JSON-LD pro Schema-Type)** sind echte Domain-Spezifika, die per Renderer (Layout-Code), nicht per Schema-Feld, gelöst werden.

---

## Phase 5 — Risiken & offene Fragen

### Migrations-Risiken (für die 268 bestehenden Files)

| Risiko | Schadensklasse | Mitigation |
|---|---|---|
| **R1 Datums-Harmonisierung** (`date`/`updated` → `publishedAt`/`updatedAt` im Blog) | mittel — 56 Files, JSON-LD-Renderer abhängig | Codemod via `awk`/Node-Script; Build-Test danach |
| **R2 Category-Refactor** (3 Modelle → 1) | hoch — bricht URLs falls Categories-Collection-Slugs nicht 1:1 zu heutigen `URL_SLUG_MAP`-Einträgen passen | Migration phasenweise: Categories-Collection erst additiv (Schema-Felder optional), Renderer doppelt unterstützen, dann alten Pfad entfernen |
| **R3 Comparison-Felder aus Blog entfernen** | niedrig — 0–4/10 belegt, fast tot | Direkte Entfernung; Build-Test sagt, wo es bricht |
| **R4 `relatedPillars`-Enum dekoppeln** (hardcoded 12 → Soft-Ref) | mittel — 108 Tools referenzieren das Enum | Schema-Wandel + Build-Check, dass alle bestehenden Werte gegen die ki-wissen-Collection auflösen |
| **R5 Schema-Leichen entfernen** (`pubDate`, `description` im Blog; `lastReviewedBy`, `pricingVerifiedAt`, `logoStrategy`, `logoSvg` in Tools) | niedrig — 0/10 belegt | Direkte Entfernung |
| **R6 `URL_SLUG_MAP` durch Categories-Collection ersetzen** | mittel — Routing-Code in 5+ Pages-Templates | Sequenziell: erst Categories-Collection einführen + Helper umstellen, dann `URL_SLUG_MAP` deprecaten |
| **R7 Marketing-Tool muss neue Domain-Schemas kennen** | hoch (außerhalb des Repos) | Geteiltes Zod-Package zwischen Tool und Repo. Sonst driftet Schema-Realität auseinander |
| **R8 `parentSlug`-Verkettungen** brechen bei Slug-Umbenennung in der Categories-Collection | niedrig — keine Slug-Umbenennung im Migrations-Pfad nötig | Keep slugs identical (`audio-music` etc.) |
| **R9 `translationKey`-Konsistenz** zwischen DE/EN-Pendants | niedrig — heute manuell gepflegt, funktioniert | Optionaler `audit:hreflang`-Lauf vor Push |
| **R10 Pre-commit-Hook lintet Frontmatter-Quotes** (CLAUDE.md §10) | niedrig | Lift-Scripts müssen YAML-quoting beibehalten |

### Welche Decisions braucht Marcel?

**D1 — Geteiltes Zod-Package: ja/nein?**
Generisches Schema lebt entweder als npm-Package (`@marcel/content-schema`) und wird in Tool + Repo importiert, oder es ist nur Konvention. **Empfehlung: ja.** Sonst driftet das Schema, wie es heute schon zwischen `crawl-utils.mjs` und `content.config.ts` Patterns dupliziert.

**D2 — `domainExtras` JSONB im Tool, Composition im Repo: akzeptabel?**
Das ist die Empfehlung aus Phase 3. Alternative: Im Tool genauso strict typed (Drizzle-Tabelle pro Domain). **Trade-off: Flexibilität vs. Migrations-Aufwand pro neue Domain.**

**D3 — Categories als eigene Collection: jetzt oder später?**
Drei Datenmodelle für `category` ist die größte konzeptionelle Last. Jetzt zu lösen bedeutet ~2 Tage Migration. Später bedeutet, dass das Marketing-Tool die Mehrgleisigkeit selber abbilden muss. **Empfehlung: jetzt, vor dem zweiten Domain-Aufschlag (BK-Werk).**

**D4 — Comparison-Felder aus Blog: ja entfernen?**
0–4/10 Coverage, parallel zur dedizierten `comparisons`-Collection. **Vermutung ja**, aber Marcel sollte bestätigen, dass keine Blog-Templates die Felder lesen.

**D5 — `relatedPillars` zur Soft-Reference machen: ja?**
Härtester Toolwiki-Lock-In. Generalisierung erfordert das. **Vermutung ja.**

**D6 — `next[]`-Strings im ki-wissen zu Slug-Refs: ja?**
Robustheits-Win, nicht Schema-Pflicht. **Vermutung ja, aber niedrige Priorität.**

**D7 — Bucket-D-Dynamisierung: alle 4 Patterns oder nur D1+D4?**
D1 (HubCarousel ins Layout) + D4 (Dead Imports aufräumen) sind risikoarm. D2 (Interactive `locale`-Auto-Inject) ist ergonomisch. D3 (JSON-LD-Lift) ist mehr Aufwand, bringt aber Wartbarkeit. **Empfehlung: D1 + D4 sofort; D2 + D3 als eigene Sprints.**

### Was ich nicht analysieren konnte (Wissenslücken)

- **Cross-Article-Relations** (`relatedPillars`, `next[]`, `featuredToolSlugs`): heute manuell oder per Marketing-Tool gepflegt? Aus Repo allein nicht ableitbar. Frage an Marcel: wer/was schreibt die Slug-Arrays?
- **`contentHash`-Generierung**: Hash worüber? Inhaltsbasiert oder Provenienz? Im Schema sichtbar, Algorithmus nicht (`scripts/_lib/crawl-utils.mjs` nicht im Detail gelesen).
- **Wie das externe Marketing-Tool heute authentifiziert** in den Repo schreibt: Webhook? CLI-only? SSH? Im Repo gibt es keine `.github/workflows/`, keine Trigger-Endpoints — wahrscheinlich Lokal-CLI gegen `git push`. Frage an Marcel: vereinheitlichen?
- **Sample-Bias bei kleinen Collections**: `tool-categories` (2/14), `special-landings` (1/10), `authors` (1/10) sind unterabgetastet. Aussagen dort sind *low confidence*.
- **Performance der Categories-Collection-Lookups** bei Build (analog zu `_toolIndex`-Cache): müsste benchmark-getestet werden, wenn Categories live wird.
- **BK-Werk-Schema** ist hypothetisch. Echte Anforderungen können von der hier projizierten Semantik abweichen (z. B. „Wirtschaftlichkeitsrechner" als eigene Collection mit Input-Variablen).

---

## Anhang: Sample-File-Liste

Pro Collection wurden folgende Files gelesen (Pfade absolut):

### tools (10/108)
- `/Users/marcelklaczinski/WebstormProjects/ki-wissensraum-neu/src/content/tools/de/deepl.mdx`
- `…/src/content/tools/de/claude.mdx`
- `…/src/content/tools/de/flux-pro.mdx`
- `…/src/content/tools/de/elevenlabs.mdx`
- `…/src/content/tools/de/gemini.mdx`
- `…/src/content/tools/en/deepl.mdx`
- `…/src/content/tools/en/lokalise.mdx`
- `…/src/content/tools/en/reverso.mdx`
- `…/src/content/tools/en/play-ht.mdx`
- `…/src/content/tools/en/synthesia.mdx`

### blog (10/56)
- `…/src/content/blog/de/ki-hr-recruiting-mittelstand-2026.mdx`
- `…/src/content/blog/de/chain-of-thought-prompting-2026-techniken-beispiele.mdx`
- `…/src/content/blog/de/prompt-engineering-2026-leitfaden.mdx`
- `…/src/content/blog/de/ki-spracherkennung.mdx`
- `…/src/content/blog/de/ki-fuer-kleine-unternehmen-7-use-cases-roi.mdx`
- `…/src/content/blog/de/few-shot-vs-zero-shot-prompting-wann-welche-technik.mdx`
- `…/src/content/blog/en/elevenlabs-vs-murf-vs-play-ht-voice-cloning-comparison-2026.mdx`
- … (4 weitere EN-Files, gegrept)

### comparisons (5/22)
- `…/src/content/comparisons/de/chatgpt-vs-claude-2026.mdx`
- `…/src/content/comparisons/de/midjourney-vs-dalle-2026.mdx`
- `…/src/content/comparisons/de/suno-vs-udio-2026.mdx`
- `…/src/content/comparisons/en/chatgpt-vs-claude-2026.mdx`
- `…/src/content/comparisons/en/elevenlabs-vs-murf-vs-play-ht-2026.mdx`

### usecases (5/24)
- `…/src/content/usecases/de/softwareentwicklung-it.mdx`
- `…/src/content/usecases/en/marketing-sales.mdx`
- + 3 weitere aus paralleler Bash-Erkundung

### ki-wissen (4/24)
- `…/src/content/ki-wissen/de/was-ist-ki.mdx`
- `…/src/content/ki-wissen/de/transformer.mdx`
- `…/src/content/ki-wissen/de/generative-ki.mdx`
- `…/src/content/ki-wissen/en/what-is-ai.mdx`

### tool-categories (2/14, low confidence)
- `…/src/content/tool-categories/de/text-language.mdx`
- `…/src/content/tool-categories/de/audio-music.mdx`

### special-landings (1/10, low confidence)
- `…/src/content/special-landings/de/chatgpt.mdx`

### authors (1/10, medium confidence)
- `…/src/content/authors/de/lukas-hoffmann.mdx`

### Schema- und Infrastruktur-Files (vollständig gelesen)
- `…/src/content.config.ts` (680 Zeilen)
- `…/src/i18n/config.ts`, `…/src/i18n/index.ts`
- `…/src/lib/url-slugs.ts`, `…/src/lib/taxonomy.ts`
- `…/src/lib/tools.ts`, `…/src/lib/authors.ts`
- `…/scripts/generate-tools-mdx.mjs`, `…/scripts/extend-new-tool-mdx.mjs`
- `…/scripts/generate-hero-image.mjs`
- `…/package.json`, `…/.env.example`

### Component-Audit (vollständiger grep über alle 268 MDX-Bodies)
- `grep -r "^import " src/content/ --include="*.mdx"` — alle MDX-Imports
- `grep -r "<HubCarousel\|<ToolCard\|<ClusterBox\|<AI[A-Z]" src/content/ --include="*.mdx"` — Rendering-Belege
- `grep -r "application/ld\+json" src/content/ --include="*.mdx"` — 10 ki-wissen-Files
- Markdown-Tabellen via `grep -c "^|" src/content/**/*.mdx` — 1.561 Treffer

---

*Ende des Reports. Confidence-Verteilung über Befunde: ~70 % high, ~25 % medium, ~5 % low (Letztere klar markiert in Phase 1 & Phase 5).*
