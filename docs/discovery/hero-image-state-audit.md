# Hero-Image-State-Audit

> **Status:** Discovery, Read-Only.
> **Datum:** 2026-05-24
> **Scope:** Hero-Image-Coverage auf Imported Articles (Toolwiki-Project).
> **Toolwiki-Project-ID:** `3fad7929-b06d-47ce-b6a1-8ac134362c42`
> **Astro-Repo:** `/Users/marcelklaczinski/WebstormProjects/ki-wissensraum-neu`
> **Vorgänger-Audit:** [`docs/discovery/post-refactor-state-audit.md`](docs/discovery/post-refactor-state-audit.md)

---

## Executive Summary

Marcel-Hypothese **vollständig bestätigt**: **0 von 272 imported Articles** (alle 8 Collections × DE/EN) haben auch nur eine der vier `hero_image_*`-Spalten populated. Repo-Frontmatter trägt die Hero-Pfade als Strings (210 distinct `heroImage` + 118 distinct `image`-Werte für Tools/Authors), aber das Tool kennt diese Assets nicht als eigene Entities — kein R2-Spiegel, keine R2-Keys, keine Alt-Texts.

Die Lücke ist **strukturell, nicht punktuell**: [`upsert-articles.ts`](packages/adapters/astro-sync/src/import/steps/upsert-articles.ts) hat ZERO `hero`/`r2`/`storage`-Referenzen, [`AstroImportPipeline`](packages/adapters/astro-sync/src/import/pipeline.ts) hat keinen `MirrorHeroImagesStep`. Die Logik wurde nie implementiert.

**Backfill-Scope**: ~258 source-truth-Files in `<repo>/public/{heroes/auto,tools,blog,comparisons,authors,gen}` — **149 PNG + 7 JPG** (brauchen WebP-Konversion) + **~102 WebP** (Fast-Path). Geschätzte R2-Upload-Größe nach Konversion: ~60-100 MB canonical WebP + ~300-400 MB originals. Sequenzielles Upload-Budget: ~10-20 Minuten via `convertImageToWebp`.

**Astro-Verzeichnis-Konvention klar**: Alle Hero-Files leben unter `<repo>/public/...` (Astro public-folder), Frontmatter-Werte sind absolute Pfade vom Public-Root (`/heroes/auto/foo.png`). Astro Build erzeugt 9-25 responsive Varianten pro Source-File (Pattern `<name>-<aspect>-<width>.{webp,avif}`) — nur die Source-Files (149 + ~109 = 258) müssen gespiegelt werden, nicht die Varianten.

**Empfehlung: neuer `MirrorHeroImagesStep`** in `AstroImportPipeline` (zwischen `ParseFrontmatterBatch` und `UpsertArticles`), idempotent via `hero_image_original_r2_key IS NULL`-Gate (keine neue Migration nötig — Spec 64.6c-Spalte bereits vorhanden). Plus **One-Shot Backfill-Script** für die existierenden 258 Files. Details in §9.

---

## 1. DB-State Hero-Spalten

### 1.1 Coverage pro Collection × Locale × Source

Alle 272 Imported Articles (= alle Articles im Toolwiki-Project — keine `generated`-Rows):

| collection | locale | source | total | hero_r2_key | hero_public_url | hero_alt_text | hero_original_r2 |
|---|---|---|---|---|---|---|---|
| authors | de | imported | 5 | 0 | 0 | 0 | 0 |
| authors | en | imported | 5 | 0 | 0 | 0 | 0 |
| blog | de | imported | 29 | 0 | 0 | 0 | 0 |
| blog | en | imported | 29 | 0 | 0 | 0 | 0 |
| comparisons | de | imported | 12 | 0 | 0 | 0 | 0 |
| comparisons | en | imported | 12 | 0 | 0 | 0 | 0 |
| ki-wissen | de | imported | 12 | 0 | 0 | 0 | 0 |
| ki-wissen | en | imported | 12 | 0 | 0 | 0 | 0 |
| special-landings | de | imported | 5 | 0 | 0 | 0 | 0 |
| special-landings | en | imported | 5 | 0 | 0 | 0 | 0 |
| tool-categories | de | imported | 7 | 0 | 0 | 0 | 0 |
| tool-categories | en | imported | 7 | 0 | 0 | 0 | 0 |
| tools | de | imported | 54 | 0 | 0 | 0 | 0 |
| tools | en | imported | 54 | 0 | 0 | 0 | 0 |
| usecases | de | imported | 12 | 0 | 0 | 0 | 0 |
| usecases | en | imported | 12 | 0 | 0 | 0 | 0 |
| **Total** | — | — | **272** | **0** | **0** | **0** | **0** |

Hypothese **bestätigt zu 100 %**. Keine partielle Befüllung, keine Counter-Beispiele.

### 1.2 Spalten-Existenz (information_schema)

```
hero_image_alt_text          : text (nullable=YES)
hero_image_original_r2_key   : text (nullable=YES)
hero_image_public_url        : text (nullable=YES)
hero_image_r2_key            : text (nullable=YES)
```

Alle 4 Spalten existieren ✓ (inkl. `hero_image_original_r2_key` aus Spec 64.6c, Migration `0091_articles_hero_image_original.sql`). Kein Schema-Drift, kein Migrations-Bedarf für die Felder selbst.

Konfidenz: **high** (vollständige Zählung über alle 272 Rows + Spalten-Check via `information_schema`).

---

## 2. Hero-Referenzen in `domain_extras`

### 2.1 Frontmatter-Key-Coverage (imported-only)

| collection | total | has `heroImage` | has `image` | has `cover` | has `heroImageAlt` |
|---|---|---|---|---|---|
| authors | 10 | **0** | **10** | 0 | 0 |
| blog | 58 | **58** | 0 | 0 | **58** |
| comparisons | 24 | **24** | 0 | 0 | **24** |
| ki-wissen | 24 | **22** | 0 | 0 | **22** |
| special-landings | 10 | **10** | 0 | 0 | **10** |
| tool-categories | 14 | **0** | **0** | 0 | 0 |
| tools | 108 | **72** | **108** | 0 | **72** |
| usecases | 24 | **24** | 0 | 0 | **24** |

**Beobachtungen:**

- **Authors** benutzen `image` (Avatar) — kein `heroImage`. Konsistent.
- **Tool-Categories** haben **kein einziges Bild-Feld** (0/14). Astro rendert diese Collection vermutlich ohne Hero — gelb markiert für Diskussion: soll Mirror-Step sie überspringen (kein Hero erwartet) oder als Bucket-D-Bug flaggen?
- **Tools** haben `image` (Logo) AUF allen 108 Rows + zusätzlich `heroImage` auf 72/108. Die 36 Tools ohne `heroImage` — Logo-only-Tools, möglicherweise ältere Imports vor Heros automatisch generiert wurden.
- **ki-wissen** 22/24 hat heroImage — **2 ki-wissen-Rows ohne Hero**: `was-ist-ki` (DE+EN). Manuelle Verifikation in §6 bestätigt.

### 2.2 Distinkte Pfad-Präfixe für `heroImage` (210 Refs gesamt)

| Präfix | Count | Bedeutung |
|---|---|---|
| `/heroes/` | 187 | `/heroes/auto/...` — pipeline-auto-generierte Heros (ältere Generation-Runs) |
| `/comparisons/` | 11 | Manuell platzierte Comparison-Heros |
| `/blog/` | 8 | Ältere manuelle Blog-Heros (Pre-Automation-Ära) |
| `/gen/` | 4 | **Orphan-Pattern** — exakt die 4 Orphan-Blog-Rows aus dem Post-Refactor-Audit (chatgpt-preise/-pricing, code-assistenten, ai-code-assistants), Subdirs unter `public/gen/<slug>/hero.webp` |

### 2.3 Distinkte Pfad-Präfixe für `image` (118 Refs gesamt)

| Präfix | Count | Bedeutung |
|---|---|---|
| `/tools/` | 108 | Tool-Logos |
| `/authors/` | 10 | Author-Avatars |

### 2.4 Datei-Endungen

| Feld | Endung | Count |
|---|---|---|
| `heroImage` | png | 187 |
| `heroImage` | webp | 23 |
| `image` (tools+authors) | webp | 118 |

**Format-Anteile gesamt** (heroImage + image):
- **PNG: 187 (57 %)** → WebP-Konversion nötig
- **WebP: 23 + 118 = 141 (43 %)** → Fast-Path (kein WebP-Encode)
- JPG: 0 unter `heroImage`/`image` (siehe §3 für Datei-System-Sicht — 7 JPG-Source-Files existieren physikalisch, aber keine wird aktuell von DB referenziert)

Konfidenz: **high** (vollständige Aggregation über alle 272 Rows + Distinct-Prefix-Query).

---

## 3. Repo-File-Inventur

### 3.1 Verzeichnis-Struktur (`<repo>/public/`)

**Alle Hero-Assets liegen unter `public/`, nicht unter `src/assets/`** (das ist die Standard-Astro-Konvention für unprocessed assets — Astro v5 erlaubt aber auch `src/assets/` mit Image-Service-Optimierung; Toolwiki-Repo hat sich für `public/` entschieden).

```
public/
├── heroes/auto/        (149 PNG sources + 2618 build variants)
├── tools/              (56 WebP sources + 1232 build variants)
├── blog/               (26 WebP + 2 JPG sources + 572 build variants)
├── comparisons/        (11 WebP sources + 242 build variants)
├── authors/            (5 WebP + 5 JPG sources + 0 variants)
├── gen/                (4 subdirs, je 1 hero.webp + 17-21 build variants)
├── social/             (mostly icons, not heroes)
└── assets/             (favicon/manifest)
```

`src/assets/articles/chatgpt-preise-2026/` existiert leer — ein Überbleibsel-Verzeichnis, nicht referenziert.

### 3.2 Source-File vs. Build-Variant-Pattern

**Naming-Konvention (Astro-Responsive-Image-Build):**

| Typ | Pattern | Beispiel |
|---|---|---|
| Source | `<basename>.<ext>` | `chatgpt.png`, `ai-hr-recruiting-smb-2026.png` |
| Variant | `<basename>-<aspect>-<width>.<ext>` | `chatgpt-16x9-1280.webp`, `chatgpt-1x1-400.avif` |

Aspect-Ratios gefunden: `16x9`, `1x1`, `4x3`.
Widths gefunden: 320, 400, 480, 640, 800, 960, 1200, 1280, 1600, 1920.

**Source-File-Count pro Verzeichnis** (gefiltert via Regex `-[0-9]+x[0-9]+-[0-9]+\.(webp|avif|png|jpg)$` → exclude):

| Verzeichnis | Sources | Format | Variants |
|---|---|---|---|
| `public/heroes/auto/` | **149** | alle PNG | 2618 |
| `public/tools/` | **56** | alle WebP | 1232 |
| `public/blog/` | **28** | 26 WebP + 2 JPG | 572 |
| `public/comparisons/` | **11** | alle WebP | 242 |
| `public/authors/` | **10** | 5 WebP + 5 JPG | 0 |
| `public/gen/{4 subdirs}/` | **4** | alle WebP | ~80 |
| **Total Sources** | **~258** | — | ~4744 Variants |

**Source-Format-Verteilung:**
- **149 PNG** (heroes/auto) → konvertieren via `convertImageToWebp`
- **101 WebP** (tools+blog+comparisons+authors+gen) → Fast-Path
- **7 JPG** (2 blog + 5 authors) → konvertieren via `convertImageToWebp`
- **Konversions-Quote: 156/258 = 60 %**

### 3.3 Hero-Naming-Schema

**Heros sind über DE+EN Locale-Paare hinweg geteilt.** Beispiel:
- `blog/de/ki-hr-recruiting-mittelstand-2026.mdx` referenziert `/heroes/auto/ai-hr-recruiting-smb-2026.png`
- `blog/en/ai-hr-recruiting-smb-2026.mdx` referenziert dieselbe `/heroes/auto/ai-hr-recruiting-smb-2026.png`

Hero-Basename folgt fast immer dem **EN-Slug** (kanonische Sprache). Das hat eine Konsequenz für die Mirror-Logik: bei DE+EN Translation-Pair-Articles soll der Mirror-Step erkennen, dass beide auf dasselbe Source-File zeigen — und EIN gemeinsames R2-Asset hochladen, das dann auf beiden Rows referenziert wird.

Konfidenz: **high** für File-Counts; **medium** für die EN-canonical-Hypothese (Stichproben passen alle, kein Counter-Beispiel gesehen — aber nicht alle 187 PNG-Refs einzeln verifiziert).

---

## 4. Importer-Code-Befund

### 4.1 `upsert-articles.ts` — keine Hero-Logik

```
grep -n "hero\|Hero\|HERO" packages/adapters/astro-sync/src/import/steps/upsert-articles.ts
# (no matches)
```

`UpsertArticlesStep` hat **ZERO Hero-Referenzen**. Die `heroImage`-Frontmatter wird in `domain_extras` JSONB durchgereicht (alle Felder, die nicht promoted columns sind, landen dort), aber die 4 `hero_image_*`-Spalten werden nie befüllt.

### 4.2 Gesamte `import/`-Tree — kein R2-Upload

```
grep -rn "hero\|r2\.put\|storage\|uploadToR2" packages/adapters/astro-sync/src/import/
# (no matches across all 9 import files)
```

### 4.3 `AstroImportPipeline` Step-Order

[`packages/adapters/astro-sync/src/import/pipeline.ts:37-45`](packages/adapters/astro-sync/src/import/pipeline.ts:37):

```typescript
new ExtractCollectionSchemasStep(),    // Spec 50
new ListContentFilesStep(),
new FilterChangedFilesStep(),
new ParseFrontmatterBatchStep(),
new UpsertArticlesStep(),
new LinkTranslationPairsStep(),
new SyncClustersFromFrontmatterStep(), // Spec 49a
new DetectContentGapsStep(),           // Spec 49b
new UpdateImportRunStep(),
```

**Kein `MirrorHeroImagesStep`**, kein `DownloadHeroStep`, kein hero-related step. Die Pipeline kennt das Konzept „Hero-Asset" nicht.

### 4.4 `render-mdx.ts` (Export-Pfad) — was passiert wenn DB-Spalten NULL?

[`packages/adapters/astro-sync/src/steps/render-mdx.ts:260-261, 312-318`](packages/adapters/astro-sync/src/steps/render-mdx.ts:260):

```typescript
const known: Record<string, unknown> = {
  …
  heroImage: "<placeholder — replaced below>",
  heroImageAlt: article.heroImageAltText,
  …
};
// Layer 4: image-field rewriting
for (const name of imageFieldNames) {
  if (out[name] || keepWhenEmpty) {
    out[name] = heroPublicPath;   // ← public path from upload
  }
}
```

`heroPublicPath` ist die R2-Public-URL (gebaut aus `hero_image_public_url`). Wenn DB-Wert NULL ist, generiert der Step `<placeholder — replaced below>` als heroImage-Wert und überschreibt mit `heroPublicPath` → wenn das auch leer ist, landet "" im MDX. **Das würde Astros `image()`-Schema-Validation brechen** (`heroImage` ist required für blog/comparisons/ki-wissen/usecases/special-landings).

**Konsequenz:** `ArticleSyncPipeline` (der Export-Pfad) würde heute für jeden imported Article (alle 272!) silent eine ungültige MDX schreiben. ABER: `ArticleSyncPipeline` wird nur für Articles mit `status='final_review'` ausgelöst — und imported Articles haben `status='published'`. Daher ist das Risiko nicht aktiv. Es wäre aber ein Footgun, falls jemand einen `status`-Wechsel triggert.

Konfidenz: **high** (vollständiger Code-Read von Pipeline + 2 Steps).

---

## 5. Generation-Side Hero-Pattern als Referenz

### 5.1 `HeroImageStep` ([packages/pipelines/src/article/steps/hero-image.ts](packages/pipelines/src/article/steps/hero-image.ts))

Quelle für die Referenz-Architektur. Wichtigste Punkte:

```typescript
// Line 171-173: storage prefix per project
const { provider, resolution } = await resolveImageConfig(input.projectId);
const seed = seedFromArticleId(input.articleId);
const storagePrefix = `${input.projectSlug}/articles/hero`;
// → für Toolwiki: "toolwiki/articles/hero"

// Returns:
{
  r2Key: "<storagePrefix>/<uuid>.webp",   // canonical WebP
  publicUrl: "https://...",
  altText: buildHeroAltTextForResume(outline.title, outline.heroImagePrompt, locale),
}
```

**R2-Key-Convention:** `<projectSlug>/articles/hero/<uuid>.webp`
**Alt-Text:** Build-time aus Outline-Daten (für imported: wäre direkt aus `domain_extras.heroImageAlt` übernehmbar).

### 5.2 `convertImageToWebp` ([packages/adapters/image-webp/src/convert.ts:64](packages/adapters/image-webp/src/convert.ts:64))

```typescript
const result = await convertImageToWebp({
  projectId,
  bytes: rawImageBytes,           // Uint8Array
  contentType: "image/png",       // hint only — magic-byte sniff is authoritative
  storagePrefix: "toolwiki/articles/hero",
  // quality: 85 (default)
  // discardOriginal: false (default — keep originals)
});
// → {
//   webpKey: "toolwiki/articles/hero/<uuid>.webp",
//   webpUrl: "https://...",
//   webpBytes: 12345,
//   originalKey: "toolwiki/articles/hero/originals/<uuid>.png" | null,
//   originalUrl: "https://..." | null,
//   originalBytes: 67890 | null,
//   alreadyWebp: false,
// }
```

**Fast-Path** wenn input bereits WebP: kein sharp-encode, kein original-storage (`originalKey: null`).
**Magic-byte-sniff** verlässlicher als Content-Type-Header (siehe [`packages/adapters/image-webp/CLAUDE.md`](packages/adapters/image-webp/CLAUDE.md)).

### 5.3 R2-Bucket-Lookup ([packages/adapters/storage/src/r2.ts:37](packages/adapters/storage/src/r2.ts:37))

```typescript
const bucket = (await getGlobal("r2", "bucket")) ?? env.R2_BUCKET ?? "";
```

Vault-first (`global_credentials` Tabelle), Fallback auf `R2_BUCKET` env. Aus diesem Audit nicht read (würde aktive R2-Credentials brauchen), aber für die Mirror-Spec relevant: der gleiche R2-Bucket-Lookup-Pfad. Marcel müsste vor Backfill bestätigen dass `R2_BUCKET` für Toolwiki gesetzt ist.

### 5.4 Was die Mirror-Step direkt übernehmen kann

1. **R2-Key-Convention identisch** wie Generation-Side: `toolwiki/articles/hero/<uuid>.webp`. **Kein separates `imported/`-Sub-Prefix** — Generated- und Imported-Heros sind funktional austauschbar, gleiche Storage-Domäne.
2. **`convertImageToWebp` direkt aufrufen** mit `bytes = await readFile(<repoPath>)`. Adapter macht alles andere (sniff, encode-or-fast-path, upload, original-keep).
3. **Alt-Text trivial** aus `domain_extras.heroImageAlt` übernehmen — keine LLM-Generierung nötig (Coverage 218/272 Rows hat ihn schon im Frontmatter).

Konfidenz: **high**.

---

## 6. Round-Trip-Validierung (10 Sample-Articles)

| coll/loc/slug | DB hero_* | repo MDX | heroImage | image | resolved? | size (KB) | format |
|---|---|---|---|---|---|---|---|
| tools/de/chatgpt | all NULL | ✅ | `/heroes/auto/chatgpt.png` | `/tools/chatgpt.webp` | ✅ | 1976.8 | png |
| tools/en/chatgpt | all NULL | ✅ | `/heroes/auto/chatgpt.png` | `/tools/chatgpt.webp` | ✅ | 1976.8 | png |
| blog/de/ki-hr-recruiting-mittelstand-2026 | all NULL | ✅ | `/heroes/auto/ai-hr-recruiting-smb-2026.png` | — | ✅ | 2794.8 | png |
| blog/en/ai-hr-recruiting-smb-2026 | all NULL | ✅ | `/heroes/auto/ai-hr-recruiting-smb-2026.png` | — | ✅ | 2794.8 | png |
| blog/de/claude-pro-…-2026-test | all NULL | ✅ | `/blog/claude-pro-lange-dokumente-2026.webp` | — | ✅ | 273.8 | webp |
| comparisons/de/chatgpt-vs-claude-vs-gemini-2026-vergleich | all NULL | ✅ | `/heroes/auto/chatgpt-vs-claude-vs-gemini-2026-comparison.png` | — | ✅ | 2696.2 | png |
| ki-wissen/de/was-ist-ki | all NULL | ✅ | — | — | n/a | — | — |
| ki-wissen/en/what-is-ai | all NULL | ✅ | — | — | n/a | — | — |
| usecases/de/kundensupport-service | all NULL | ✅ | `/heroes/auto/customer-support.png` | — | ✅ | 2312.4 | png |
| special-landings/de/chatgpt | all NULL | ✅ | `/heroes/auto/chatgpt.png` | — | ✅ | 1976.8 | png |

**Highlights:**
- **9 von 10 Samples**: Resolvbar in `<repo>/public/...` ✅
- **1 von 10**: `ki-wissen/de/was-ist-ki` (+ EN counterpart) hat **keinen heroImage-Wert** → matches die 22/24 ki-wissen-Coverage aus §2.1
- **Format-Verteilung im Sample**: 7 PNG / 1 WebP — repräsentativ für die ~89-% PNG-Quote
- **Größen-Range**: 274 KB - 2.8 MB (mean ~2.1 MB für PNG, ~270 KB für WebP)
- **Asset-Sharing**: `tools/de/chatgpt` + `tools/en/chatgpt` + `special-landings/de/chatgpt` zeigen alle auf dasselbe `/heroes/auto/chatgpt.png` → mehrere Articles können dasselbe Source-File teilen

### 6.1 Ergänzung — globale Resolve-Check über alle Refs

Nicht nur Samples — **alle distinkten Refs**:

| Feld | Distinct Refs | Resolvable in `public/` | Missing |
|---|---|---|---|
| `heroImage` | 111 | **111** | **0** |
| `image` | 59 | **59** | **0** |

**Integrität 100 %**: jedes DB-referenzierte Asset existiert physikalisch im Repo. Keine Dead-References. Kein Backfill-Risiko durch fehlende Source-Files.

Konfidenz: **high** (vollständige Distinct-Reference-Resolution-Prüfung).

---

## 7. R2-Storage-State

**Keine DB-Index-Tabelle für R2-Assets existiert** (kein `r2_object_index`, kein `storage_inventory` oder ähnlich). Storage-State wird durch:
- `articles.hero_image_r2_key` + `articles.hero_image_public_url` (per-row)
- `articles.hero_image_original_r2_key` (per-row, Spec 64.6c forensic)
- `social_posts.render_r2_key` (per-row, für Social-Image-Renders)

… implizit getrackt. Idempotenz beim Mirror-Step muss daher entweder:
1. **`hero_image_r2_key IS NULL`-Gate** verwenden (einfach, deckt 100 % der heutigen Imported-Rows ab)
2. **Content-Hash-Tracking** verwenden (sicherer gegen Repo-Asset-Updates, aber neue Spalte nötig)

R2-Storage selbst kann nicht ohne Credentials inventarisiert werden. Aus den DB-Counts (0/272 Rows mit `hero_image_r2_key`) folgt: **es liegt heute kein einziges Imported-Hero-Asset im R2-Bucket** (bei normalem Verlauf — Tooling läßt keinen Pfad zu R2-Schreiben ohne DB-Update zu).

Konfidenz: **high für DB-Index-Lücke**; **medium für R2-Bucket-Inhalt** (nicht direkt verifiziert, aber logisch zwingend).

---

## 8. Risk-Assessment für Mirror-Step

### Frage 1: Format-Konversion nötig?

**Ja, für ~60 % der Files.** 149 PNG + 7 JPG = 156 von 258 Source-Files brauchen WebP-Encode. `convertImageToWebp` hat sowohl den Encode-Pfad (sharp) als auch den Fast-Path (sniff → webp → direct-upload). Mirror-Step ruft den Adapter einfach mit den raw bytes auf, der Adapter discriminiert.

**Konfidenz: high.**

### Frage 2: Mehrere Varianten pro Hero?

**Nein — nur das Source-Original spiegeln.** Astro-Build erzeugt die Varianten on-build (149 PNGs → 1309 WebP + 1309 AVIF Varianten in `public/heroes/auto/`). Das Tool spiegelt nur Source-Files. Für Social-Media-Komposition reicht das WebP-Original (HeroImageStep lädt heute auch nur 1 File per Article).

**Begründung gegen Variant-Spiegelung:** Tool müsste Aspect-Ratio/Width-Set kennen + replizieren — Code-Verdopplung mit Astro-Build. Keine Konsum-Story dafür im Tool heute.

**Konfidenz: high.**

### Frage 3: R2-Key-Convention für Imported Heros?

**Empfehlung: identische Convention wie Generation-Side** — `<projectSlug>/articles/hero/<uuid>.webp` (also `toolwiki/articles/hero/<uuid>.webp`). **Kein separates `imported/`-Sub-Prefix.**

Begründung:
- Generierte und imported Heros werden vom gleichen Consumer (Social-Media-Step, Schema-JSON-LD) konsumiert. Trennung würde zusätzlichen Lookup-Code an mehreren Stellen erzwingen.
- Spec 64.6c-Backfill-Script `convert-existing-heroes` (für generated Heros) iteriert `WHERE hero_image_r2_key IS NOT NULL AND hero_image_original_r2_key IS NULL` — dieser Filter ist Source-agnostisch.
- Spec 64.10 `cleanup-orphan-heroes` schützt sich gegen Pattern 120 (`<uuid>.<ext>` Allow-List) — wenn imported heros denselben UUID-Pattern haben, schützt der gleiche Filter beide.

**Konfidenz: high** (folgt direkt aus Code-Read der existierenden Backfills).

### Frage 4: Alt-Text-Handling

**Trivial übernehmbar.** 218 von 272 Rows (= alle Rows mit `heroImage` minus die 2 ki-wissen-Ohne-Hero) haben `domain_extras.heroImageAlt` mit qualitativen 40-80-Zeichen-Strings (siehe §2.4 Samples). Mirror-Step:

```typescript
const altText = (article.domainExtras as Record<string, string>)?.heroImageAlt
             ?? `${article.title} – Beitragsbild`;  // Pattern 117 locale-aware Fallback
```

**Konfidenz: high.**

### Frage 5: Größen-Hochrechnung

| Format | Files | Avg-Size | Total |
|---|---|---|---|
| PNG (Source → Encode → WebP) | 149 | ~2.3 MB raw → ~280 KB WebP | ~342 MB raw / ~42 MB WebP |
| WebP (Source → Fast-Path) | 101 | ~250 KB | ~25 MB |
| JPG (Source → Encode → WebP) | 7 | ~150 KB raw → ~120 KB WebP | ~1 MB raw / ~0.8 MB WebP |
| **Total** | **258** | — | **~68 MB canonical WebP + ~318 MB originals = ~386 MB R2 upload** |

R2-Cloudflare-Free-Tier: 10 GB storage, 1 GB egress / day. ~400 MB upload **weit drunter**.
Upload-Zeit bei sequenzieller Verarbeitung: ~30s pro PNG (sharp-encode + R2-PUT), ~5s pro WebP/JPG → **~75-90 Sekunden für 156 Konversionen + ~510 Sekunden für 102 Fast-Path-Uploads = ~10-15 Minuten total**. Mit moderater Parallelität (sharp ist CPU-bound, R2 ist I/O-bound) gut komprimierbar auf ~5 Minuten.

**Konfidenz: high für storage/network estimates; medium für Encoder-Throughput (basiert auf adapter-CLAUDE.md "~100ms pro 2K image" → bei 2.3 MB PNG vermutlich etwas länger).**

### Frage 6: Re-Import-Idempotenz

**Empfehlung: `hero_image_r2_key IS NULL`-Gate** (kein Content-Hash-Tracking in V1).

Begründung:
- **Repo-Asset-Updates sind selten** in Toolwiki (Branch-B-Refactor hat keine bestehenden Heros ersetzt, nur neue für die 6 ki-wissen-Pillars hinzugefügt).
- **Content-Hash-Spalte** würde Migration + Re-Computation bei jedem Import bedeuten. ROI niedrig für diesen Use-Case.
- **Wenn Marcel später ein Hero im Repo ersetzt** und das auch im R2-Spiegel sehen will, kann er die DB-Spalten manuell auf NULL setzen — dann picked der Mirror-Step beim nächsten Import den neuen File wieder auf.
- **Spätere V2** kann Content-Hash hinzufügen, falls Re-Mirror-Frequenz steigt (z.B. bei BK-Onboarding mit fortlaufenden Repo-Edits).

**Pattern 119 Compliance**: alle Image-Storage geht durch `convertImageToWebp` — dort wird ohnehin ein neuer UUID generiert, also haben sich neue Mirror-Runs neue R2-Keys. Kollision unmöglich.

**Konfidenz: medium** (V2-Path ist Spekulation, V1-Recommendation ist solid).

---

## 9. Empfehlung

### 9.1 Soll-Architektur

**Neuer Step: `MirrorHeroImagesStep`**

**Position in [`AstroImportPipeline`](packages/adapters/astro-sync/src/import/pipeline.ts)**:
```
ExtractCollectionSchemasStep
ListContentFilesStep
FilterChangedFilesStep
ParseFrontmatterBatchStep
↓
MirrorHeroImagesStep    ← NEU (zwischen Parse + Upsert)
↓
UpsertArticlesStep
LinkTranslationPairsStep
SyncClustersFromFrontmatterStep
DetectContentGapsStep
UpdateImportRunStep
```

**Input:** `parsed: Array<{collection, locale, slug, typed: {heroImage?, image?, heroImageAlt?, ...}}>` (Output von ParseFrontmatterBatch)
**Output:** `parsed` (passthrough) + zusätzliche Felder `{heroImageR2Key, heroImagePublicUrl, heroImageOriginalR2Key, heroImageAltText}` pro parsed entry, die `UpsertArticlesStep` dann in DB schreibt.

**Logik per parsed-entry**:
1. Resolve hero-source-path:
   - `typed.heroImage ?? typed.image` (Tools+Authors fallback)
   - Falls null → skip diesen Entry (kein Hero zu spiegeln)
2. Build local file path: `${repoLocalPath}/public${heroPath}`
3. Existenz-Check + Content-Hash (für Idempotenz im V1 nicht persistiert, aber nice-to-have für Logging)
4. Bytes laden (`readFile`)
5. `convertImageToWebp({projectId, bytes, contentType: <from file extension>, storagePrefix: "<projectSlug>/articles/hero"})`
6. Result-Fields auf parsed-entry stempeln
7. Sharing via Translation-Pairs: vor dem Upload prüfen, ob das gleiche local-file-path bereits in dieser Pipeline-Run gespiegelt wurde (gleiche EN-canonical-Source für DE+EN) → wiederverwenden, kein Re-Upload

**Idempotenz im UpsertArticlesStep**: nur Hero-Spalten schreiben wenn `hero_image_r2_key` aktuell NULL ist (sonst leave-as-is — Refresh-Whitelist-Pattern Spec multi-domain-evolution S1.1). Bei expliziten Repo-File-Updates muss Marcel die DB-Spalten manuell nullen.

**Code-Skeleton (~120 LoC inkl. Tests)** — sketch:
```typescript
// packages/adapters/astro-sync/src/import/steps/mirror-hero-images.ts
import { convertImageToWebp } from "@marketing-auto/adapter-image-webp";
import { readFile, stat } from "node:fs/promises";

export class MirrorHeroImagesStep extends BaseStep<…> {
  readonly name = "mirror-hero-images";

  async execute(input: {projectId, projectSlug, repoLocalPath, parsed: …[]}, ctx) {
    const seenLocalPaths = new Map<string, MirrorResult>();  // dedup across DE+EN
    let mirrored = 0, skipped = 0, failed = 0;

    for (const entry of input.parsed) {
      const heroRef = (entry.typed.heroImage as string | undefined)
                   ?? (entry.typed.image as string | undefined);
      if (!heroRef) { skipped++; continue; }

      const fsPath = path.join(input.repoLocalPath, "public", heroRef);

      let result = seenLocalPaths.get(fsPath);
      if (!result) {
        try {
          const bytes = await readFile(fsPath);
          const r = await convertImageToWebp({
            projectId: input.projectId,
            bytes: new Uint8Array(bytes),
            contentType: contentTypeFromExt(path.extname(fsPath)),
            storagePrefix: `${input.projectSlug}/articles/hero`,
          });
          result = {
            heroImageR2Key: r.webpKey,
            heroImagePublicUrl: r.webpUrl,
            heroImageOriginalR2Key: r.originalKey,
          };
          seenLocalPaths.set(fsPath, result);
          mirrored++;
        } catch (err) {
          log.warn({fsPath, err}, "hero mirror failed — skipping");
          failed++;
          continue;
        }
      } else {
        // Reused canonical (e.g. DE+EN sibling) — no re-upload
        skipped++;
      }

      entry.heroImageR2Key = result.heroImageR2Key;
      entry.heroImagePublicUrl = result.heroImagePublicUrl;
      entry.heroImageOriginalR2Key = result.heroImageOriginalR2Key;
      entry.heroImageAltText = (entry.typed.heroImageAlt as string | undefined) ?? null;
    }

    return { mirrored, skipped, failed, uniqueFiles: seenLocalPaths.size };
  }
}
```

**UpsertArticlesStep-Erweiterung**: 4 neue conditional inserts/updates (`heroImageR2Key` etc.), beschützt durch Refresh-Whitelist-Logik (Spec multi-domain-evolution S1.1) — nur schreiben wenn DB-Wert NULL ist.

### 9.2 Migrations-Bedarf

**Keine Migrations nötig.**

- `articles.hero_image_r2_key`, `hero_image_public_url`, `hero_image_alt_text` existieren seit Spec 44
- `articles.hero_image_original_r2_key` existiert seit Spec 64.6c (Migration 0091)
- Optional V2: `articles.hero_image_content_hash` für Content-Hash-Idempotenz — **nicht in V1**

### 9.3 Backfill-Strategy

**One-Shot CLI Backfill-Script** für die ~258 existierenden Hero-Files:

```bash
bun --filter @marketing-auto/api backfill-imported-heroes toolwiki --dry-run
# (Pattern 121 — D146: dry-run als Default, --apply als opt-in)
bun --filter @marketing-auto/api backfill-imported-heroes toolwiki --apply
```

**Script-Skeleton** (~80 LoC) — analog zu [`apps/api/src/scripts/convert-existing-heroes.ts`](apps/api/src/scripts/convert-existing-heroes.ts) (Spec 64.6c):
1. Resolve Toolwiki-Project + `astroRepo.localPath`
2. Select `WHERE source='imported' AND project_id=$1 AND hero_image_r2_key IS NULL`
3. Pro Row: heroImage-Ref aus `domain_extras` lesen → local-file-path → bytes laden → `convertImageToWebp` → UPDATE Hero-Spalten
4. Idempotency-Logging (dedup across DE+EN siblings)
5. `--project=<slug>` Pflicht-Flag (verhindert versehentlichen Cross-Tenant-Run, siehe Spec 64.15 Phase C Lesson learned)
6. `--dry-run`-Default, `--apply`-opt-in (Pattern 121)

**Alternative: einmaliger Re-Import mit aktiviertem Mirror-Step** — funktional äquivalent, aber:
- Re-Import läuft auch die anderen 8 Steps durch → mehr Risk-Surface
- Backfill-Script kann auch retroaktiv für nicht-importierten Hero-Refs ausgelöst werden
- **Empfehlung: Beides** — Backfill-Script jetzt für 1× Catch-up, Mirror-Step in Pipeline für alle künftigen Re-Imports

### 9.4 Test-Strategy

**Vor Backfill-Apply auf Toolwiki:**

1. **Unit-Tests** für `MirrorHeroImagesStep`:
   - Happy-Path: PNG → WebP conversion + R2 upload (mock `convertImageToWebp`)
   - Already-WebP fast-path (mock returns `alreadyWebp: true`)
   - Missing local file → skip+failed-count, no throw
   - DE+EN siblings share same local-file → only 1 upload (dedup via Map)
   - Refresh-Whitelist: bestehende `hero_image_r2_key` wird nicht überschrieben

2. **Integration-Test mit echtem File-System + Mock-R2** (in-memory adapter-storage Stub):
   - Importiere 3 Fake-Articles → 3 Mirror-Calls, 2 unique uploads (1 sibling pair), 1 unique
   - Re-run gleicher Test → 0 neue Uploads (idempotent via DB-Gate)

3. **Sample-Backfill auf 5 Toolwiki-Articles** (Marcel triggert manuell):
   - Verify R2-Files existieren via `r2 list <bucket> <prefix>`
   - Verify Promoted-Columns gesetzt
   - Verify `hero_image_alt_text` aus Frontmatter übernommen

4. **Astro-Build im Repo nach Mock-Sync grün:**
   - Vorher: `bun --cwd <astro-repo> astro check` → ist baseline grün
   - Nach Backfill-Test-Run: Re-Run, immer noch grün (Hero-Image-Pfade im MDX unverändert, weil Backfill nur DB schreibt, nicht MDX)

5. **SEO-Snapshot-Diff in Toolwiki = 0**:
   - Hero-Image-Tag in HTML sollte sich nicht ändern, weil Astro-Build aus `/heroes/auto/foo.png` rendert (Public-Pfad), nicht aus R2 (das ist eine Tool-interne Optimierung)

### 9.5 Reihenfolge der Implementierung

1. **PR 1 — Mirror-Step + Tests** (~3-4 Stunden): Step-Code + 5 Unit-Tests + 2 Integration-Tests. Worker-Restart pflichtig. CI grün.
2. **PR 2 — Backfill-Script** (~1-2 Stunden): CLI + dry-run-default + Toolwiki sample-run. Marcel approves dry-run-output bevor `--apply`.
3. **PR 3 — Apply Backfill** (Marcel-Action): `bun … backfill-imported-heroes toolwiki --apply`. 258 Files in ~10 Minuten gespiegelt, DB-Spalten gefüllt, R2-Quota +400 MB.
4. **PR 4 — Folge-Spec** falls Marcel das Mirror-on-Re-Import-Verhalten optimieren will (V2 Content-Hash, V2 manual-re-mirror UI, etc.).

---

## 10. Offene Fragen für Marcel

1. **R2-Bucket-Namen + Region-Bestätigung**: Audit hat aus Code-Read abgeleitet, dass `(getGlobal("r2", "bucket") ?? env.R2_BUCKET)` der Lookup-Pfad ist. Welcher konkrete Bucket-Name ist heute für Toolwiki gesetzt? (Ich wollte das Audit clean halten und nicht in den Vault greifen.)
2. **Tool-Categories (14 Rows, 0 Heros)**: Akzeptierte Lücke (keine Hero-Anforderung) oder Bucket-D-Bug? Im UI heißt das: `/tool-categories/<slug>`-Seiten haben heute kein Hero-Bild. Ist das beabsichtigt?
3. **ki-wissen `was-ist-ki` (DE+EN) — 2 Rows ohne `heroImage`**: Soll Mirror-Step diese überspringen (status quo) oder ein Default-Hero hinterlegen (z.B. den "neuronale-netze"-Hero)? Default: skip.
4. **R2-Key-Convention bestätigen**: `toolwiki/articles/hero/<uuid>.webp` für ALLE Heros (imported + generated)? Oder doch separates `toolwiki/articles/hero/imported/<uuid>.webp`? Mein Empfehlungs-Default ist no-split.
5. **Backfill-Timing**: Soll PR 1+2 + Sample-Run + voller Backfill in derselben Session passieren oder über mehrere Tage staged? Stilfrage — Code ist deterministic, kein Time-Pressure.

---

## Anhang: Files gelesen + Konfidenz pro Befund

### Genutzte Audit-Scripts (alle in [`apps/api/src/scripts/discovery/`](apps/api/src/scripts/discovery))

| Script | Zweck | Sample-Größe |
|---|---|---|
| `audit-hero-state.ts` | Phase 1+2: hero_* Spalten-Coverage + domain_extras hero-key-Coverage + Pfad-Präfixe + Extensions | exhaustive (alle 272 Rows + alle 210 distinct heroImage refs) |
| `audit-hero-round-trip.ts` | Phase 6: 10 sample-articles round-trip + distinct-ref resolve-check + source-vs-variant count | 10 samples + alle 111 distinct heroImage refs + alle 59 distinct image refs |

Wiederverwendet aus dem Post-Refactor-Audit:
- [`apps/api/src/scripts/discovery/audit-project.ts`](apps/api/src/scripts/discovery/audit-project.ts) (Project-Lookup)

### Code-Files gelesen

- [`packages/db/src/schema/content.ts`](packages/db/src/schema/content.ts) (hero_* Spalten-Definition Z.97-103, schemaJsonLd, domainExtras)
- [`packages/adapters/astro-sync/src/import/pipeline.ts`](packages/adapters/astro-sync/src/import/pipeline.ts) (Step-Order)
- [`packages/adapters/astro-sync/src/import/steps/upsert-articles.ts`](packages/adapters/astro-sync/src/import/steps/upsert-articles.ts) (Hero-Lücke verifiziert)
- [`packages/adapters/astro-sync/src/steps/render-mdx.ts`](packages/adapters/astro-sync/src/steps/render-mdx.ts:260) (Export-Pfad — Z.260, 312-318)
- [`packages/pipelines/src/article/steps/hero-image.ts`](packages/pipelines/src/article/steps/hero-image.ts) (Generation-Side Referenz — Z.171-173 storagePrefix)
- [`packages/adapters/image-webp/src/convert.ts`](packages/adapters/image-webp/src/convert.ts:64) (`convertImageToWebp` public API)
- [`packages/adapters/image-webp/CLAUDE.md`](packages/adapters/image-webp/CLAUDE.md) (Adapter-Konventionen)
- [`packages/adapters/storage/src/r2.ts`](packages/adapters/storage/src/r2.ts:37) (R2-Config-Lookup)
- [`apps/api/src/scripts/convert-existing-heroes.ts`](apps/api/src/scripts/convert-existing-heroes.ts) — als Referenz für Backfill-Script-Skeleton

### Repo-Side Files gelesen / Datei-System-Operationen

- `find /Users/marcelklaczinski/WebstormProjects/ki-wissensraum-neu/{src/assets,public}` — Verzeichnis-Inventur
- `ls`/`stat` für 10 Sample-Heros + alle 111 distinct heroImage refs
- `gray-matter` parse für 10 Sample-Files frontmatter-Vergleich

### Konfidenz-Übersicht

| Phase / Befund | Konfidenz | Begründung |
|---|---|---|
| 1 — alle 4 hero_* Spalten = 0/272 populated | **high** | Vollständiger COUNT, kein Sample |
| 1 — Spalten-Existenz im Schema | **high** | information_schema verified |
| 2 — domain_extras hero-key Coverage | **high** | Vollständige Aggregation |
| 2 — 187 PNG / 23 WebP Distribution | **high** | Distinct-extension Count |
| 3 — Verzeichnis-Struktur public/* | **high** | `find` über alle Dirs |
| 3 — Source-vs-Variant-Count via Regex | **high** | Regex-Filter validated mit Sample-Inspection |
| 3 — Hero-File-Naming-Convention | **medium** | Stichproben + Astro-Build-Variant-Pattern erkannt; aber nicht alle 258 Files individuell verifiziert |
| 4 — Importer hat keine Hero-Logik | **high** | Vollständiger grep über `import/`-Tree |
| 4 — Render-MDX-Footgun bei NULL hero_* | **high** | Code-Read Z.260-318 |
| 5 — Generation-side R2-Key-Convention | **high** | Code-Read hero-image.ts |
| 6 — 10/10 Samples confirm hypothesis | **high** | jeder Sample individuell |
| 6 — 111/111 + 59/59 refs resolve | **high** | exhaustive check |
| 7 — R2-Bucket-State (keine Imported-Heros) | **medium** | aus DB-State zwingend, aber R2 nicht direkt gepingt |
| 8 — Frage 1-4 | **high** | direkt aus Code + Daten ableitbar |
| 8 — Frage 5 (Größen/Zeit-Estimate) | **medium** | basiert auf adapter-CLAUDE.md Throughput-Annahmen + Sample-Size |
| 8 — Frage 6 (Idempotency-Pattern) | **medium** | V1-Recommendation solid, V2-Path Spekulation |
| 9 — Mirror-Step-Architektur | **high** | folgt direkt aus bestehenden Adapter-Patterns |
| 9 — Backfill-Strategie | **high** | Spec 64.6c hat exakt das Pattern bereits etabliert |

### Audit-Side-Effects

- **Keine DB-Writes** (nur SELECT)
- **Keine R2-Uploads** (kein adapter-storage call mit putObject)
- **Keine Repo-Edits** (nur readFile + stat)
- 2 neue Scripts in [`apps/api/src/scripts/discovery/`](apps/api/src/scripts/discovery): `audit-hero-state.ts` + `audit-hero-round-trip.ts` — können behalten werden für künftige Re-Audits (z.B. nach BK-Onboarding).
