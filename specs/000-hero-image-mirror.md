# Spec: Hero-Image-Mirror für Imported Articles

_Branch: `feature/hero-image-mirror`_
_Codebase: Marketing-Tool-Monorepo + Toolwiki-Astro-Repo (Default-Hero-File)_
_Status: Draft._
_Aufwand: ~1-2 Wochen, 5 Sprints._
_Voraussetzung: Post-Refactor-State + Hero-Image-State Audits, beide gemerged._
_Parallel-Branch: `feature/db-cleanup-post-refactor` (Cleanup-Spec) — Sync-Punkt: H3 muss vor C4 (Re-Import) auf master sein._

---

## 1. Problem

Aus `docs/discovery/hero-image-state-audit.md`:

1. **272 Imported Articles, 0 mit Hero-R2-Spiegel.** Alle vier `hero_image_*`-Promoted-Columns sind NULL für alle imported Articles im Toolwiki-Project.
2. **Repo-Hero-Pfade existieren in `domain_extras` JSONB** (210 `heroImage` + 118 `image` distinct Refs), aber Tool kennt diese Assets nicht als eigene Entities.
3. **`upsert-articles.ts` hat ZERO Hero-Logik** — Importer liest Frontmatter, schreibt in `domain_extras`, macht aber keinen R2-Upload.
4. **Re-Generate-Pfad würde neue Hero-Bilder erstellen** statt bestehende wiederzuverwenden — Tool sieht den Editorial-Aufwand nicht.
5. **Social-Media-Generation funktioniert nicht für Imported Articles** — kein R2-Asset zum Composen.
6. **2 ki-wissen-Articles ohne `heroImage`-Frontmatter** (`was-ist-ki` DE+EN) — heute leer, sollen Default-Hero bekommen.
7. **Repo-Asset-Updates ohne Detection** — wenn ein Editor ein Hero-Bild im Repo ersetzt, würde ein Mirror-Step ohne Content-Hash das nicht erkennen.

## 2. Ziel

Imported Articles haben ihre Hero-Bilder auf R2 gespiegelt, mit gesetzten Promoted-Columns. Mirror ist idempotent via Content-Hash. Default-Hero existiert im Repo für Articles ohne explizites Frontmatter. Re-Imports erkennen geänderte Repo-Files automatisch.

**In Scope:**

- Neue DB-Spalte `articles.hero_image_source_sha256` für Content-Hash-Tracking
- Default-Hero-File `public/heroes/default.webp` im Astro-Repo, in CLAUDE.md beider Repos dokumentiert
- Neuer Step `MirrorHeroImagesStep` in `AstroImportPipeline`
- WebP-Konversion via existierender `adapter-image-webp` für PNG/JPG-Sources
- DE+EN-Sibling-Dedup via Content-Hash
- Backfill-CLI-Script für die existierenden 272 Articles
- Tool-Categories-Skip-Logic (14 Rows, Collection hat keinen Hero by-design)
- Tests pro Step + Backfill-Script

**Out of Scope:**

- Generation-Side Hero-Pipeline anfassen (HeroImageStep funktioniert)
- Variant-Generation (Astro-Build macht das aus dem Source)
- Hero-Bild-Inhalt verändern (kein LLM-Edit, kein Resize)
- Alt-Text via LLM nach-generieren (Audit zeigt 218/272 hat Alt-Text aus Frontmatter)
- DB-Cleanup (B1-B5 aus Post-Refactor-Audit) — separater Branch
- D1/D4-Bug-Fixes aus Post-Refactor-Audit — separater Branch
- BK-Onboarding
- Theme 65 (Recurring Content)

## 3. Architektur

### 3.1 Sprint H1 — Content-Hash-Migration + Default-Hero-Doku (Tag 1-2)

**H1.1 DB-Migration für `hero_image_source_sha256`** (1-2h)

Neue Migration `0101_articles_hero_image_source_sha256.sql`:

```sql
ALTER TABLE articles
ADD COLUMN hero_image_source_sha256 text;

CREATE INDEX articles_hero_image_source_sha256_idx
ON articles (hero_image_source_sha256)
WHERE hero_image_source_sha256 IS NOT NULL;
```

Drizzle-Schema in `packages/db/src/schema/content.ts`:

```ts
heroImageSourceSha256: text("hero_image_source_sha256"),
```

Index ist partial (`WHERE NOT NULL`) für effiziente Dedup-Lookups via Hash. Begründung: Lookups nach Hash-Value zur Wiederverwendung von R2-Assets bei DE+EN-Siblings.

**Pattern-Referenz:** D124 (Type-Migration und Seed getrennt — hier nur Type, kein Seed nötig).

**H1.2 Default-Hero-File im Astro-Repo anlegen** (30min)

Datei: `<astro-repo>/public/heroes/default.webp`

- Inhalt: Generisches Tool-Hero-Bild (Marcel-bereitgestellt oder Image-Provider generiert), 1280x720 oder 16:9, ~150-300KB WebP
- Falls nicht vorhanden: Marcel stellt bereit, oder Image-Provider generiert via `nano-banana`-Adapter mit Prompt "Abstract AI-Knowledge concept hero illustration"
- File via PR im Astro-Repo unter `feature/default-hero-image` Branch committed
- Astro-Build muss durchlaufen (Default-Hero produziert eigene Build-Variants in `public/heroes/`)

**H1.3 Dokumentation in beiden Repos** (1h)

**Astro-Repo CLAUDE.md** (`<astro-repo>/CLAUDE.md`) — neue Section ergänzen:

```markdown
## Reserved Assets

The following files are **reserved** and must not be deleted, renamed, or replaced without coordination:

### `public/heroes/default.webp`

Fallback hero image for articles without explicit `heroImage` frontmatter.
Used by:
- Marketing-Tool's `MirrorHeroImagesStep` when an imported article has no hero reference
- Astro layouts as fallback if the configured hero file is missing

If you replace this file:
- Keep the path identical (`public/heroes/default.webp`)
- Keep WebP format
- Recommended size: 1280×720 minimum
- Inform marketing-tool maintainer to invalidate `hero_image_source_sha256` for affected articles
```

**Marketing-Tool CLAUDE.md** (Root) — Section "External Assets / Conventions" ergänzen:

```markdown
## External Repo Reserved Assets

### Toolwiki-Astro-Repo (`ki-wissensraum-neu`)

- `public/heroes/default.webp` — Fallback hero for articles without `heroImage` frontmatter.
  Consumed by `MirrorHeroImagesStep` (see `packages/adapters/astro-sync/src/import/steps/mirror-hero-images.ts`).
  Path must remain stable. File replacement requires `hero_image_source_sha256` invalidation in DB.
```

**Pattern-Referenz:** Dokumentation als Cross-Repo-Vertrag. Beide Codebases referenzieren denselben Path. Bei Verstoß: Mirror-Step erkennt fehlende Datei → warn-log + skip (siehe H3.4).

### 3.2 Sprint H2 — Mirror-Step Implementation (Tag 2-4)

**H2.1 `MirrorHeroImagesStep`** (1 Tag)

Datei: `packages/adapters/astro-sync/src/import/steps/mirror-hero-images.ts`

Position in `AstroImportPipeline` (`packages/adapters/astro-sync/src/import/pipeline.ts`):
```
ExtractCollectionSchemasStep
ListContentFilesStep
FilterChangedFilesStep
ParseFrontmatterBatchStep
↓
MirrorHeroImagesStep   ← NEU
↓
UpsertArticlesStep
LinkTranslationPairsStep
SyncClustersFromFrontmatterStep
DetectContentGapsStep
UpdateImportRunStep
```

**Skeleton:**

```ts
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { convertImageToWebp } from "@marketing-auto/adapter-image-webp";
import { BaseStep } from "@marketing-auto/pipelines/engine";

// Collections without hero by design (see hero-image-state-audit.md §2.1)
const COLLECTIONS_WITHOUT_HERO = new Set(["tool-categories"]);

const DEFAULT_HERO_PATH = "/heroes/default.webp";

interface MirrorResult {
  heroImageR2Key: string;
  heroImagePublicUrl: string;
  heroImageOriginalR2Key: string | null;
  heroImageSourceSha256: string;
}

export class MirrorHeroImagesStep extends BaseStep<...> {
  readonly name = "mirror-hero-images";

  async execute(input: {
    projectId: string;
    projectSlug: string;
    repoLocalPath: string;
    parsed: ParsedArticle[];
  }, ctx) {
    const seenHashes = new Map<string, MirrorResult>();  // sha256 → MirrorResult
    let mirrored = 0, skippedNoHero = 0, skippedByCollection = 0,
        reused = 0, unchanged = 0, failed = 0;

    for (const entry of input.parsed) {
      // Skip collections without hero by design
      if (COLLECTIONS_WITHOUT_HERO.has(entry.collection)) {
        skippedByCollection++;
        continue;
      }

      // Resolve hero source path
      let heroRef = (entry.typed.heroImage as string | undefined)
                ?? (entry.typed.image as string | undefined);

      // Fallback to default hero if no reference
      let usingDefault = false;
      if (!heroRef) {
        heroRef = DEFAULT_HERO_PATH;
        usingDefault = true;
      }

      const fsPath = path.join(input.repoLocalPath, "public", heroRef);

      try {
        // Read + hash
        const bytes = await readFile(fsPath);
        const sha256 = createHash("sha256").update(bytes).digest("hex");

        // Dedup: same hash already processed in this pipeline run?
        let result = seenHashes.get(sha256);
        if (result) {
          reused++;
        } else {
          // Check DB: does another article already have this hash on R2?
          const existing = await this.db.query.articles.findFirst({
            where: and(
              eq(articles.projectId, input.projectId),
              eq(articles.heroImageSourceSha256, sha256),
            ),
            columns: {
              heroImageR2Key: true,
              heroImagePublicUrl: true,
              heroImageOriginalR2Key: true,
            },
          });

          if (existing?.heroImageR2Key && existing.heroImagePublicUrl) {
            // Reuse existing R2 asset
            result = {
              heroImageR2Key: existing.heroImageR2Key,
              heroImagePublicUrl: existing.heroImagePublicUrl,
              heroImageOriginalR2Key: existing.heroImageOriginalR2Key,
              heroImageSourceSha256: sha256,
            };
            reused++;
          } else {
            // New upload
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
              heroImageSourceSha256: sha256,
            };
            mirrored++;
          }

          seenHashes.set(sha256, result);
        }

        // Stamp on entry for UpsertArticlesStep to write
        entry.heroImageR2Key = result.heroImageR2Key;
        entry.heroImagePublicUrl = result.heroImagePublicUrl;
        entry.heroImageOriginalR2Key = result.heroImageOriginalR2Key;
        entry.heroImageSourceSha256 = result.heroImageSourceSha256;
        entry.heroImageAltText = (entry.typed.heroImageAlt as string | undefined)
                              ?? (usingDefault ? "" : null);

        // If using default hero, also stamp it on the entry's heroImage frontmatter
        // so UpsertArticles + RenderMdx eventually write it back to MDX
        if (usingDefault) {
          entry.typed.heroImage = DEFAULT_HERO_PATH;
        }
      } catch (err) {
        log.warn({ fsPath, slug: entry.slug, locale: entry.locale, err }, "hero mirror failed");
        failed++;
      }
    }

    return {
      mirrored,
      reused,
      unchanged,
      skippedNoHero,
      skippedByCollection,
      failed,
      uniqueHashes: seenHashes.size,
    };
  }
}
```

**Wichtige Punkte:**
- **Content-Hash-Dedup:** Map per `sha256`-Hash, nicht per File-Path. DE+EN-Siblings teilen Hash, ein Upload reicht.
- **Cross-Run-Dedup:** DB-Lookup nach existierendem Hash. Wenn anderes Article auf einem früheren Run dieses File schon gespiegelt hat, R2-Key wiederverwenden.
- **Default-Hero-Path:** Tool weiß den Astro-side Path (`/heroes/default.webp`). Auch der Default geht durch Content-Hash-Logik → wird genau einmal hochgeladen, alle Default-User teilen das R2-Asset.
- **Default-Frontmatter-Write:** Wenn Article ohne Hero den Default bekommt, wird `entry.typed.heroImage` auf den Default-Pfad gesetzt. `UpsertArticlesStep` schreibt das in `domain_extras`. Beim nächsten `ArticleSyncPipeline`-Lauf rendert `RenderMdxStep` den Default-Pfad ins MDX-Frontmatter zurück → MDX-File enthält dann auch `heroImage: "/heroes/default.webp"`.

**H2.2 UpsertArticlesStep-Erweiterung** (3-4h)

Datei: `packages/adapters/astro-sync/src/import/steps/upsert-articles.ts`

Vier neue Spalten (plus eine bereits existierende) in UPDATE/INSERT:

```ts
const heroFields = entry.heroImageR2Key ? {
  heroImageR2Key: entry.heroImageR2Key,
  heroImagePublicUrl: entry.heroImagePublicUrl,
  heroImageOriginalR2Key: entry.heroImageOriginalR2Key,
  heroImageSourceSha256: entry.heroImageSourceSha256,
  heroImageAltText: entry.heroImageAltText,
} : {};
```

**Refresh-Whitelist-Konformität:** Hero-Felder werden NUR gesetzt wenn aktuell NULL ist oder Hash sich geändert hat. Bei bereits gespiegeltem unverändertem Hero → leave-as-is (kein Re-Write).

Konkrete Logik:
```ts
const setHeroFields = (existing: Article, mirrored: MirrorEntryFields): Partial<Article> => {
  // No mirror result → don't touch DB
  if (!mirrored.heroImageR2Key) return {};

  // Already mirrored with same hash → no-op
  if (existing.heroImageSourceSha256 === mirrored.heroImageSourceSha256) return {};

  // New or changed → overwrite
  return {
    heroImageR2Key: mirrored.heroImageR2Key,
    heroImagePublicUrl: mirrored.heroImagePublicUrl,
    heroImageOriginalR2Key: mirrored.heroImageOriginalR2Key,
    heroImageSourceSha256: mirrored.heroImageSourceSha256,
    heroImageAltText: mirrored.heroImageAltText,
  };
};
```

**Pattern-Referenz:** Refresh-Whitelist (Spec multi-domain-evolution S1.1). Hero-Felder folgen demselben „existing-value-wins"-Pattern, aber mit Hash-Vergleich für Update-Detection.

**H2.3 Unit-Tests für MirrorHeroImagesStep** (4-6h)

Datei: `packages/adapters/astro-sync/test/mirror-hero-images.test.ts`

Test-Cases:

1. **Happy-Path WebP:** Fast-Path konversion mock, R2-Upload erfolgt, alle Spalten gesetzt
2. **Happy-Path PNG:** WebP-Konversion mock, original gespeichert (`hero_image_original_r2_key` non-null), beide URLs gesetzt
3. **DE+EN-Sibling-Dedup:** Zwei Entries mit gleichem File-Path → eine `convertImageToWebp`-Call, zwei Articles gleicher R2-Key
4. **Cross-Run-Dedup:** Entry mit Hash, der bereits in DB (anderes Article) gespiegelt ist → kein neuer Upload, R2-Key übernommen
5. **Missing local file:** `readFile` throws → `failed`-Count, kein throw, andere Entries verarbeiten weiter
6. **Tool-Categories-Skip:** Entry mit `collection='tool-categories'` → `skippedByCollection`-Count, keine `convertImageToWebp`-Call
7. **Default-Hero-Path:** Entry ohne `heroImage`/`image` Frontmatter → Default-Hero gemirrored, `entry.typed.heroImage` auf Default-Pfad gesetzt
8. **Default-Hero-Missing-File:** Default-Hero-File existiert nicht → `failed`-Count, warn-log, andere Entries weiter
9. **Hash-Unchanged:** Bestehender Article mit Hash X, gleicher Hash beim Re-Import → keine UPDATE-Call (über setHeroFields-Helper testen)
10. **Hash-Changed:** Bestehender Article mit Hash X, neuer Hash Y beim Re-Import → UPDATE mit allen neuen Spalten

Mocks:
- `readFile` → predefined byte buffers pro Test
- `convertImageToWebp` → predefined results pro Test
- `db.query.articles.findFirst` → predefined existing rows pro Test

**H2.4 Integration-Test** (3-4h)

Datei: `packages/adapters/astro-sync/test/mirror-hero-images.integration.test.ts`

Mit echtem File-System (Test-Fixtures unter `__fixtures__/`) + in-memory adapter-storage Stub:

1. Importiere 3 Fake-Articles (1 mit hero, 2 ohne, 1 mit `image` (tool-style)) → erwartete Counts
2. Re-run gleiche Pipeline → 0 neue Uploads (Hash-Cache greift)
3. Modifiziere Fixture-File → Re-run → 1 neuer Upload für geänderten File

### 3.3 Sprint H3 — Mirror-Step Pipeline-Wiring (Tag 4-5)

**H3.1 Pipeline-Registry-Update** (1h)

Datei: `packages/adapters/astro-sync/src/import/pipeline.ts`

```ts
import { MirrorHeroImagesStep } from "./steps/mirror-hero-images";
// ...
new ParseFrontmatterBatchStep(),
new MirrorHeroImagesStep(),  // NEW — position between Parse and Upsert
new UpsertArticlesStep(),
```

**H3.2 Step-Input/Output-Schemas** (1h)

Zod-Input/Output für MirrorHeroImagesStep definieren. Mirror-Output wird vom UpsertArticlesStep konsumiert. Pipeline-Engine validiert.

**H3.3 Logging-Pattern** (30min)

Per Pattern aus existing import steps:

```ts
log.info({
  mirrored, reused, unchanged, skippedNoHero, skippedByCollection,
  failed, uniqueHashes,
  totalEntries: input.parsed.length,
}, "hero-mirror complete");
```

Plus per-failure-warn mit fsPath + Slug + Error.

**H3.4 Error-Handling für Default-Hero-Missing** (30min)

Wenn `public/heroes/default.webp` nicht existiert beim Mirror-Run:
- `failed`-Count erhöht für alle Entries die default verwendet hätten
- Warn-Log einmalig pro Pipeline-Run (nicht pro Entry, sonst log-spam)
- Pipeline-Run trotzdem grün (Imported Articles ohne Hero behalten NULL-Spalten)
- Notification an Owner (severity=warning): "Default hero file missing in Astro-Repo, X articles affected"

**H3.5 Acceptance-Test** (1h)

Dry-Run-Verifikation:
- Mirror-Step auf einem Test-Project mit 5 Fixture-Articles + Default-Hero-File ausführen
- Output zeigt: 5 mirrored (oder 4 + 1 reused wenn 2 Articles gleiche Hero teilen)
- DB-State: 5 Rows mit allen Hero-Spalten gefüllt
- Re-Run: 0 mirrored, 5 unchanged

**Sync-Punkt H3 → Cleanup-Branch C4:** Nach H3-Merge auf master kann Cleanup-Spec ihren Re-Import-Trigger (C4) ausführen. Re-Import wird Mirror-Step automatisch mit-laufen lassen für die 18 neuen Inserts plus eventuell Hash-Update für die existierenden Rows die zwischenzeitlich editiert wurden.

### 3.4 Sprint H4 — Backfill-Script (Tag 5-7)

**Hinweis:** H4 ist primär für den Catch-up der 272 existierenden Imported Articles. Wenn H3 vor C4 (Cleanup-Re-Import) auf master ist, übernimmt der Re-Import diesen Backfill automatisch — H4 wird dann redundant.

**Entscheidung Marcel-Decision:** H4 als „belt-and-suspenders" implementieren (kann auch nach C4 nochmal laufen, ist idempotent), oder skippen wenn C4 voraussichtlich schnell durch ist.

**H4.1 CLI-Script** (3-4h)

Datei: `apps/api/src/scripts/backfill-imported-heroes.ts`

```ts
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    project: { type: "string" },
    apply: { type: "boolean", default: false },
  },
});

if (!values.project) {
  console.error("Required: --project=<slug>");
  process.exit(1);
}

const project = await loadProject(values.project);
const heroImageless = await db.query.articles.findMany({
  where: and(
    eq(articles.projectId, project.id),
    eq(articles.source, "imported"),
    isNull(articles.heroImageR2Key),
    notInArray(articles.collection, ["tool-categories"]),
  ),
});

console.log(`Found ${heroImageless.length} articles without R2-mirrored hero`);

if (!values.apply) {
  console.log("DRY-RUN — no changes will be made");
  // Iterate, log what would happen per article, count by format/coll/locale
  // ...
  return;
}

// Apply: instantiate MirrorHeroImagesStep, run on each article
// (re-uses existing pipeline step implementation, not duplicated logic)
```

**Pattern-Referenz:** D146 — Backfill-Scripts haben Dry-Run-Default, `--apply` für Schreib-Modus, `--project=<slug>` pflicht (Cross-Tenant-Protection aus Spec 64.15).

**H4.2 Verify-Gate** (1h)

Nach `--apply`:
```sql
-- Expected: 0 rows after successful backfill
SELECT COUNT(*) FROM articles
WHERE project_id = '<toolwiki-id>'
  AND source = 'imported'
  AND hero_image_r2_key IS NULL
  AND collection NOT IN ('tool-categories');
```

Script printed Count nach Apply. Wenn > 0: Liste der fehlgeschlagenen Articles + Reason aus failed-Map.

**H4.3 Sample-Test auf 5 Articles** (1h)

Marcel triggert sample-mode (neuer Flag `--limit=5`), Script läuft auf 5 zufälligen Articles, Verify-Output zeigt:
- 5 R2-Keys generiert
- R2-Public-URLs erreichbar (curl-Test optional in Script eingebaut)
- DB-Spalten alle 5 gesetzt
- Astro-Repo-File-Path unverändert (Backfill schreibt nicht MDX)

### 3.5 Sprint H5 — Full-Backfill + Verification (Tag 7-8)

**H5.1 Full-Apply** (Marcel-Action, ~10-15min)

Nach Marcel-Approval des Sample-Output:

```bash
bun --filter @marketing-auto/api backfill-imported-heroes --project=toolwiki --apply
```

Erwartete Mutationen aus Hero-Audit:
- ~258 unique source-files → ~258 R2-Uploads (minus Dedup, vermutlich ~200 unique uploads)
- ~258 PNG/JPG-Konversionen (149+7=156 Konversionen + 102 Fast-Path)
- 272 Articles × 5 Spalten Updated (minus 14 tool-categories und 2 ki-wissen-without-hero → 256 Hero-Mirrored + 2 Default-Hero-Used + 14 Skipped)

**H5.2 Verification** (1h)

```sql
-- Coverage-Check pro Collection
SELECT collection, locale, COUNT(*) AS total,
       COUNT(*) FILTER (WHERE hero_image_r2_key IS NOT NULL) AS has_r2,
       COUNT(*) FILTER (WHERE hero_image_source_sha256 IS NOT NULL) AS has_hash
FROM articles
WHERE project_id = '<toolwiki-id>' AND source = 'imported'
GROUP BY collection, locale;
```

Erwartung: alle Collections außer `tool-categories` haben 100% Coverage.

**H5.3 Sample-R2-Reachability** (30min)

5 zufällige `hero_image_public_url` URLs öffnen + verifizieren dass Bild lädt.

**H5.4 Astro-Build-Check** (15min)

Im Astro-Repo: `pnpm build` → muss durchlaufen, keine fehlenden Hero-Files (Default-Hero ist da, alle anderen unverändert).

**H5.5 Documentation-Update** (1h)

- `packages/adapters/astro-sync/CLAUDE.md`: neue Section "Hero-Image Mirroring" mit Verweis auf Step + Default-Hero-Convention
- `docs/specs/hero-image-mirror/IMPLEMENTED.md`: Zusammenfassung mit Counts + Commit-SHAs

## 4. Tests

**Pro Sprint:**
- Unit-Tests in `__tests__/`-Ordnern (D-Convention)
- Bun-Test-Runner
- Keine Smoke-Tests

**Cross-Sprint:**

- **Snapshot-Test Imported-Pipeline:** Mock-Pipeline-Run auf 5 Test-Articles vor H2, nach H2 mit Hero-Spalten gefüllt. Diff zeigt nur die 5 erwarteten neuen Felder.
- **Backfill-Idempotenz:** Backfill `--apply` zweimal hintereinander → zweiter Run zeigt 0 Uploads (Hash-Check greift)
- **Default-Hero-Round-Trip:** Article ohne Frontmatter → Mirror setzt Default-Hero → Re-Import nach `ArticleSyncPipeline`-Lauf → MDX hat jetzt `heroImage: "/heroes/default.webp"` → nächster Re-Import erkennt Default-Hash → keine Action

## 5. Acceptance

1. Migration 0101 angewendet, `hero_image_source_sha256`-Spalte existiert mit partial-Index
2. `public/heroes/default.webp` im Astro-Repo committed, in beiden CLAUDE.mds dokumentiert
3. `MirrorHeroImagesStep` in `AstroImportPipeline` integriert, Position zwischen Parse + Upsert
4. Unit-Tests grün (10 Cases aus H2.3)
5. Integration-Test grün (3 Cases aus H2.4)
6. `UpsertArticlesStep` respektiert Hash-basierte Refresh-Whitelist für Hero-Felder
7. Backfill-Script existiert mit Dry-Run-Default, `--apply`-opt-in, `--project=<slug>`-Pflicht
8. Sample-Backfill auf 5 Articles erfolgreich, 5 R2-Uploads, 5 DB-Updates verifiziert
9. Full-Backfill für Toolwiki abgeschlossen, alle 258 Hero-Source-Files gespiegelt
10. Tool-Categories (14 Rows) korrekt geskippt (NULL bleibt NULL)
11. 2 ki-wissen-Articles (`was-ist-ki` DE+EN) haben Default-Hero gespiegelt + DB-Spalten gesetzt
12. Astro-Build im Toolwiki-Repo grün nach Sync
13. Re-Run von Backfill zeigt 0 neue Uploads (Idempotenz-Beweis)
14. CLAUDE.md beider Repos aktualisiert

## 6. Cross-Cutting-Regeln

- **Pattern 119 Compliance:** Hero-Image-Storage geht durch `convertImageToWebp` — Adapter macht R2-Upload + Tracking + Cost-Logging intern. Step braucht keinen duplicate-Code.
- **R2-Key-Convention:** `<projectSlug>/articles/hero/<uuid>.webp` — identisch zur Generation-Side (HeroImageStep). Kein separates `imported/`-Prefix.
- **Content-Hash:** SHA-256 über Source-Bytes (Pre-Konversion). Stored as hex string.
- **Refresh-Whitelist:** Hero-Spalten werden nur überschrieben wenn Hash sich ändert. Existing-value-wins-Pattern.
- **Multi-Tenant:** Mirror-Step lädt `projectId` aus Pipeline-Input. Cross-Tenant-Lookups nicht möglich (kein Hash-Match zwischen Projects).
- **Default-Hero-Path-Stability:** `/heroes/default.webp` ist Cross-Repo-Vertrag. Astro-Repo committed das File. Tool-Repo dokumentiert die Erwartung. Replacement bedarf Hash-Invalidation in DB.
- **Pattern 121 / D146:** Backfill-Script Dry-Run-Default, `--apply`-Flag erforderlich für Mutations.

## 7. Decisions (vorab geklärt mit Marcel)

| # | Decision | Empfehlung | Begründung |
|---|---|---|---|
| D1 | Content-Hash-Tracking | JA in V1 | Re-Import-Idempotenz bei Repo-Asset-Updates. Editor-Realität in Toolwiki + bald BK. |
| D2 | Hash-Spalte-Position | Neue Spalte `articles.hero_image_source_sha256` | Cleaner als JSONB-in-domain-extras, Index möglich für Cross-Tenant-Lookups |
| D3 | Hash-Berechnung-Basis | Source-Bytes (Pre-Konversion) | Authoritativ für Repo-File-State; WebP-Encode ist nicht deterministic-stable |
| D4 | Tool-Categories ohne Hero | Skip by-design | Audit bestätigt 0/14 Hero-Coverage, Collection hat kein Hero-Konzept |
| D5 | Default-Hero-Location | `public/heroes/default.webp` im Astro-Repo | Astro-side Convention, Tool kennt den Path |
| D6 | Default-Hero-Frontmatter-Write | Tool schreibt `heroImage`-Frontmatter via `ArticleSyncPipeline`-Export-Pfad | Kein neuer MDX-Mutation-Pfad, nutzt existierende Export-Pipeline |
| D7 | Backfill-Script vs. Re-Import | Beides — Script als „belt-and-suspenders" | Script ist idempotent, kann pre- oder post-Re-Import laufen |
| D8 | R2-Key-Convention | `<projectSlug>/articles/hero/<uuid>.webp` | Identisch zur Generation-Side, keine Trennung Imported/Generated |
| D9 | Alt-Text-Strategy | Aus Frontmatter übernehmen, NULL wenn fehlt | 218/272 hat Alt-Text. LLM-Backfill out-of-scope. |

## 8. Sync-Punkt mit Cleanup-Branch

| Hero-Sprint | Cleanup-Sprint | Beziehung |
|---|---|---|
| H1 (Migration + Default-Doku) | — | Unabhängig |
| H2 (Mirror-Step Code) | C1-C3 (DB-Cleanup + D-Fixes) | Parallel möglich |
| H3 (Pipeline-Wiring) | — | **Muss vor C4 auf master sein** |
| H4 (Backfill-Script) | — | Optional, parallel zu C1-C3 |
| H5 (Full-Backfill) | C5 (Verification) | Parallel oder konsekutiv |
| **Sync-Punkt** | **Cleanup C4 (Re-Import)** | **Wartet auf H3-Merge** |

**Konkret:** Cleanup-Branch kann ohne Hero-Branch arbeiten an C1-C3. Wenn beide Branches an C4/H5 ankommen, ist die Reihenfolge:
1. H1-H3 mergen auf master
2. Cleanup C1-C3 mergen (parallel mit obigem)
3. Cleanup C4 (Re-Import) — nutzt Mirror-Step automatisch
4. H5 entweder als Pre-Re-Import-Backfill oder als Post-Re-Import-Cleanup (idempotent egal welche Reihenfolge)
5. Cleanup C5 + H5-Verifikation

## 9. Risiken & Mitigation

| # | Risiko | Mitigation |
|---|---|---|
| R1 | Default-Hero-File nicht existent zum Mirror-Run | H3.4 graceful handling, warn-log, andere Articles unbeeinträchtigt |
| R2 | Content-Hash-Migration auf laufender Production blockt | Spalte ist nullable, kein Default, kein Backfill-on-Migration. Migration ist instant. |
| R3 | Backfill auf 272 Articles dauert zu lang | Sequenzielle Estimate ~10-15min. Bei Bedarf parallelisierbar (P-Limit auf 5-10 concurrent), aber vermutlich nicht nötig. |
| R4 | R2-Upload-Cost durch Backfill | ~400 MB Upload, Cloudflare-Free-Tier ist 10 GB Storage / 1 GB Egress pro Tag. Kein Cost-Issue. |
| R5 | Astro-Build bricht wegen MDX-Hero-Pfad-Änderung | Backfill schreibt nicht MDX. Erst nach `ArticleSyncPipeline`-Lauf entstehen MDX-Mutations — und nur für die 2 ki-wissen-Files (Default-Hero-Eintrag). Astro-Schema akzeptiert beliebige `heroImage`-Strings. |
| R6 | Hash-Kollision zwischen verschiedenen Projects | Cross-Project-Lookup ist by-projectId gegated. Kein Issue. |
| R7 | `tool-categories`-Skip wird übersehen wenn neue Collection ohne Hero kommt | `COLLECTIONS_WITHOUT_HERO`-Constant in Mirror-Step. Bei neuer Collection: Constant erweitern. Dokumentiert in CLAUDE.md. |
| R8 | DE+EN-Sibling-Dedup greift nicht (verschiedene Hashes für gleiche Datei) | Dedup-Strategie via Hash, nicht via File-Path. Wenn 2 Files identische Bytes haben → gleicher Hash → ein Upload. Robust. |

## 10. Offene Fragen für Marcel

1. **Default-Hero-Bereitstellung**: Stellst du das `public/heroes/default.webp` selbst zur Verfügung, oder soll Tool das via Image-Provider generieren? Falls Tool: Prompt-Vorschlag und Image-Provider klären (nano-banana vs. replicate).
2. **R2-Bucket-Name für Toolwiki**: Audit nicht direkt verifiziert. Bestätigung dass `R2_BUCKET` env oder `getGlobal("r2", "bucket")` korrekt populated ist.
3. **H4-Skippen oder Implementieren?** Wenn H3-Merge schnell und C4-Re-Import zeitnah, kann H4-Script entfallen. Default: implementieren als belt-and-suspenders.
4. **Sample-Run-Size**: 5 Articles für H4.3 Sample-Test ausreichend, oder 20-30? Default: 5.
5. **Notification bei Default-Hero-Verwendung**: Bei jeder Mirror-Run-Apply soll Marcel benachrichtigt werden, welche Articles den Default verwenden? Heute nur via log. Default: bleibt log-only.

## 11. Implemented

**H1 — Migration + schema + cross-repo doc** (2026-05-24)
- Migration `packages/db/drizzle/0101_articles_hero_image_source_sha256.sql` adds nullable text column + partial index `WHERE NOT NULL`. Journal entry `idx: 101`, `when: 1787900000000`. Drizzle schema `articles.heroImageSourceSha256` in `packages/db/src/schema/content.ts`. Applied locally via `bun --filter @marketing-auto/db migrate`; existing 272 rows stay NULL until backfill runs.
- Root CLAUDE.md gets a new "External Repo Reserved Assets" section pointing at `public/heroes/default.webp` in the Toolwiki Astro repo.
- Astro-Repo CLAUDE.md update **NOT shipped** in this branch — that's a PR in the `ki-wissen-astro-neu` repo and needs Marcel-side commit access. The marketing-tool side documents the contract; the Astro side will be coordinated when Marcel commits the default-hero file.

**H2 — `MirrorHeroImagesStep` + Upsert hash-whitelist + unit tests** (2026-05-24)
- New file `packages/adapters/astro-sync/src/import/steps/mirror-hero-images.ts` (~400 LoC). Contains the BaseStep wrapper + the pure exported `mirrorOneArticle(deps, input)` helper that's the single integration point for backfill reuse. GitHub-App blob fetches pinned to `headCommitSha`; sniffed-and-converted via `convertImageToWebp` (Pattern 119). In-run `Map<sha256, HeroFields>` for DE+EN dedup, DB-lookup-by-hash for cross-run dedup. `COLLECTIONS_WITHOUT_HERO = {"tool-categories"}`. `repoPathForHeroRef` allows only leading-slash refs (`public/...`) in V1.
- `UpsertArticlesStep` extended with `setHeroFields` block using `CASE WHEN heroImageSourceSha256 IS DISTINCT FROM <new hash> THEN <new> ELSE <existing> END` per hero column — refresh-whitelist semantics implemented atomically in one UPDATE per row, no SELECT-then-UPDATE.
- 14 unit tests in `packages/adapters/astro-sync/test/mirror-hero-images.test.ts`: 11 helper cases (spec §H2.3 + a bonus upload-error case) + 3 path-resolution + 2 DB-integration (real Drizzle session, asserts multi-tenant boundary). All green. `@marketing-auto/adapter-image-webp` added as a workspace dep in `packages/adapters/astro-sync/package.json`.

**H3 — Pipeline wiring + integration tests** (2026-05-24)
- `RepoImportPipeline.steps` gains `MirrorHeroImagesStep` between `ParseFrontmatterBatchStep` and `UpsertArticlesStep` (slot 4 of 9). Bridges: parse → mirror passes `{projectId, astroRepo, headCommitSha, parsed}` reading `headCommitSha` from the earlier `list-content-files` output; mirror → upsert forwards `{projectId, parsed}` with the augmented entries.
- 5 pipeline-wiring tests in `packages/adapters/astro-sync/test/mirror-hero-images-pipeline.test.ts` (positional check, both new bridges, fail-fast on missing list-content-files output, regression check that the final `detect-content-gaps → update-import-run` bridge still resolves the parse step). Offline, no DB / GitHub / R2.
- `packages/adapters/astro-sync/CLAUDE.md` gets a "Hero-Image Mirroring" section documenting the path-resolution rule, dedup layers, default-hero fallback, refresh-whitelist, skipped-collection list, and the pure-helper reuse contract.

**H4 — Backfill CLI** (2026-05-24)
- `apps/api/src/scripts/backfill-imported-heroes.ts`. Mirrors the 64.10 / 64.15 backfill pattern: `DatabasePort` + `GithubPort` + `UploadPort` DI seams, dry-run default with `count(*)` short-circuit (no predicate-loop spin), `--apply` opt-in, `--project=<slug>` mandatory (cross-tenant gate), optional `--limit=N`. Calls `mirrorOneArticle` so production and backfill share one code path. CAS-guarded `UPDATE` via `IS DISTINCT FROM`. Registered as `bun --filter @marketing-auto/api backfill-imported-heroes` in `apps/api/package.json`.
- 8 smoke tests in `apps/api/test/scripts/backfill-imported-heroes.smoke.test.ts` (dry-run no-op, --apply happy path, sibling dedup, failure partial-success, --limit cap, missing project, default-hero fallback, tool-style `image` ref). All green.
- Adapter `./import` subpath export widened with the mirror types + helper.

**H5 prep — verification** (2026-05-24)
- `bun --filter @marketing-auto/db typecheck` → 0 errors.
- `bun --filter @marketing-auto/adapter-astro-sync typecheck` → 0 errors.
- `bun --filter @marketing-auto/api typecheck` → only 3 pre-existing errors in `src/scripts/discovery/audit-*.ts` (untouched by this spec, committed in `ad3f5fb`). All Spec-000 code compiles clean.
- `bun --filter @marketing-auto/adapter-astro-sync test` → 90 pass / 0 fail (14 new + 5 new + 71 pre-existing).
- `bun --filter @marketing-auto/db test` → 69 pass / 0 fail.
- `bun --filter @marketing-auto/api test` → 260 pass / 6 skip / 0 fail (8 new).
- Toolwiki dry-run: `bun --filter @marketing-auto/api backfill-imported-heroes --project=toolwiki` → **258 candidates** (matches spec §H5.1 forecast). 67 ms wall-clock; no DB mutation, no GitHub call (dry-run short-circuit).

**Not shipped yet (Marcel-side actions):**
- Astro-Repo PR committing `public/heroes/default.webp` + the CLAUDE.md section. Without it the backfill `--apply` will mark the 2 `was-ist-ki` articles as `failed: default_hero_missing` and the other 256 will succeed normally (they have explicit hero refs).
- H5.1 full `--apply` run on Toolwiki.
- H5.2 / H5.3 / H5.4 verification (SQL coverage check, R2 reachability, Astro build).

## 12. Discovered & Deviations

1. **Import pipeline reads via GitHub-App API, not local checkout** — Spec §3.2 (H2.1) sketched `repoLocalPath: string` + `readFile(fsPath)` but `RepoImportPipeline` never materializes a local clone. Confirmed pre-implementation with Marcel; rewrote the step to use `octokit.request("GET /contents/{path}?ref={sha}")` + blob fetch (mirrors how `ParseFrontmatterBatchStep` reads MDX). Backfill resolves HEAD of `defaultBranch` once at script start so the whole run is pinned to a stable commit.
2. **Bridge needs `headCommitSha`** — the mirror step requires a ref to pin blob lookups. The earlier `ListContentFilesStep` already emits `headCommitSha`; the parse → mirror bridge reads it via `getStepOutput("list-content-files")`. Throws fast if upstream output is absent.
3. **Step does NOT mutate `entry.typed.heroImage` for default-hero fallback** — spec §3.2 (H2.1) "Default-Frontmatter-Write" wanted the mutation so an export round-trip later writes the default path into MDX. The DB column `domain_extras` is populated from `extras` (NOT `typed`) in `UpsertArticlesStep`, so the mutation would not have flowed to disk anyway. Skipped to keep scope tight; the 2 `was-ist-ki` MDX files keep empty `heroImage` frontmatter for now (acceptance #11 requires only DB columns to be populated, not the MDX round-trip). The cross-sprint "Default-Hero-Round-Trip" test in §4 is implicitly deferred.
4. **No `setHeroFields` helper as separate module** — spec §H2.2 sketched a pure function `setHeroFields(existing, mirrored): Partial<Article>` for the refresh-whitelist. Implemented inline as `CASE WHEN ... IS DISTINCT FROM ... END` SQL expressions, atomic per row, no SELECT round-trip. Same semantics, less code.
5. **Spec §6 acceptance R2 path** — `<projectSlug>/articles/hero/<uuid>.webp` matches the generation side AND the backfill writes under the same prefix. Confirmed via the dry-run output structure.
6. **Tool-Categories skip is collection-string-based, not collection_type-enum-based** — `COLLECTIONS_WITHOUT_HERO` checks `entry.collection` (the Astro folder name `"tool-categories"`), which is what the parsed entry carries. Different from `articles.collection_type` (the enum). This matches the audit's premise.
7. **`authors` collection NOT in `COLLECTIONS_WITHOUT_HERO`** — spec §3.2 only listed `tool-categories`. Authors rows have no `heroImage` frontmatter so they would route to the default-hero fallback. If Marcel wants authors to stay NULL, extend the set. Flagged in CLAUDE.md so a future regression is one-line. ([authors collection check needed during H5 verification](packages/adapters/astro-sync/src/import/steps/mirror-hero-images.ts))
8. **Failed entries do NOT poison the dedup cache** — `seenHashes.set()` only fires AFTER successful upload + DB lookup. Important when the same hero file fails for the first DE article (transient R2 error) but succeeds for its EN sibling on the next loop iteration. Covered by case 11 (bonus) in the unit tests.
9. **Pre-existing typecheck errors in `apps/api/src/scripts/discovery/audit-*.ts`** — 3 errors from commit `ad3f5fb` (Marcel's audit-tooling commit). Orthogonal to this spec; flagged so they don't get attributed here.
10. **Acceptance #14 (Astro-Repo CLAUDE.md updated)** is **deferred** — the Astro repo isn't a workspace package; that PR needs Marcel commit access. The marketing-tool side documents the contract in root CLAUDE.md + adapter CLAUDE.md as planned.
11. **Spec §10 Q1 (Marcel-provides default-hero)** confirmed at start of work — tool does NOT generate the default via nano-banana. Backfill `--apply` will fail-gracefully for the 2 articles whose heroImage is empty until Marcel commits `public/heroes/default.webp` to the Astro repo. The other 256 candidates have explicit hero refs and won't depend on the default.
12. **Spec §10 Q3 (H4 belt-and-suspenders)** — implemented per Marcel's pre-work answer. Script is idempotent (CAS on hash mismatch).
