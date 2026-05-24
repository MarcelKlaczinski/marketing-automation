# Post-Refactor State Audit

> **Status:** Discovery, Read-Only.
> **Datum:** 2026-05-24
> **Scope:** Tool-DB ↔ Toolwiki-Repo Drift nach Branch-A (Tool-Side `multi-domain-evolution`) + Branch-B (Astro-Side `schema-consolidation`) Refactor.
> **Toolwiki-Project-ID:** `3fad7929-b06d-47ce-b6a1-8ac134362c42`
> **Astro-Repo:** `/Users/marcelklaczinski/WebstormProjects/ki-wissensraum-neu` (Branch: `master`, owner `MarcelKlaczinski/ki-wissensraum-v2`)

---

## Executive Summary

Der Drift zwischen DB und Repo ist **deutlich geringer als befürchtet**. Tools (108), Usecases (24), Authors (10), Tool-Categories (14), Special-Landings (10) und Categories (31) sind **bit-perfekt** synchron — keine Slug-Diffs, keine Felder-Drift jenseits eines kosmetischen `numeric→string`-Casts auf `tool_rating`. Drift konzentriert sich auf **drei eng umrissene Cluster**:

1. **10 verwaiste Blog-Rows** in der DB (5 pro Locale): 4 Comparison-Migrations (Blog→`comparisons`), 2 Slug-Renames (`...-leitfaden/-guide` → `...-best-practices-2026`), 4 pure Repo-Deletions (`chatgpt-preise/-pricing-2026`, `code-assistenten/ai-code-assistants`). **Der Importer hat keinen Delete-Step** — diese Rows bleiben auch nach Re-Import bestehen.
2. **12 fehlende ki-wissen-Pillars** (6 Themen × DE+EN) als reine Repo-Adds: `neuronale-netze`, `backpropagation`, `eu-ai-act`, `entscheidungsbaeume`, `datenschutz-bei-ki`/`ai-privacy`, `chatgpt-guide`, `decision-trees`, `neural-networks`. Plus **4 Comparison-Adds** (2 pro Locale): die migrierten DALL·E- und ElevenLabs-Posts.
3. **Stale `category` / `publishedAt` / `tags` auf migrierten Comparison-Rows**: Die 12 Comparison-Rows in DB tragen größtenteils alte Werte aus ihrer Blog-Vorvergangenheit (z.B. `category="Vergleiche"` statt `comparisons`-Slug, `tags` aus Blog-Zeit), weil das Repo-Schema diese Felder im `comparisons`-Frontmatter nicht mehr definiert.

**D143-Schema-JSON-LD-Konflikt ist vollständig dormant**: 0 von 272 Articles tragen `howTo` in `domain_extras`, 0 von 272 haben non-empty `schema_json_ld`. Die Branch-B-Migration der 10 ki-wissen-`howTo`-Frontmatters läuft also nicht in ein Konflikt-Fenster, solange die 6 neuen Pillars noch nicht importiert wurden.

**Empfehlung:** **Option 2 — Cleanup-First, dann selektiver Re-Import.** Begründung in §7. Konkret: 12 Bucket-B-SQL-Statements (Supersede + Stale-Comparison-Field-Cleanup) **vor** Re-Import + danach voller Re-Import. Re-Import alleine würde die 10 orphaned Rows nicht aufräumen und die 12 stale-field Comparison-Rows nicht heilen.

---

## 1. Project Metadata

| Feld | Wert |
|---|---|
| `projects.id` | `3fad7929-b06d-47ce-b6a1-8ac134362c42` |
| `projects.slug` | `toolwiki` |
| `projects.domain` | `toolwiki.ai` |
| `projects.industry` | `ai_education` |
| `projects.target_niche` | `ai-tool-wiki` |
| `projects.target_locales` | `["de-DE", "en-US"]` |
| `projects.classifier_examples` | populated (1 key: `knowledge`) |
| `projects.astro_repo.localPath` | `/Users/marcelklaczinski/WebstormProjects/ki-wissensraum-neu` |
| `projects.astro_repo.owner` / `name` | `MarcelKlaczinski` / `ki-wissensraum-v2` |
| `projects.astro_repo.defaultBranch` | `master` |
| `projects.astro_repo.installationId` | `129941086` |
| `projects.astro_repo.contentRoot` / `assetsRoot` | `src/content` / `src/assets` |

### 1.1 Bucket-D-Verdacht aus dem Task-Brief: nicht existente Felder

Der Task-Brief erwähnt zwei Felder als „existiert" — sie existieren **nicht** in der DB:

- **`projects.allowed_collections`** — nirgendwo im Schema, in keiner Migration (0094–0100). `apps/api/src/routes/projects/briefs.ts:534` baut `allowedCollections` **dynamisch** zur Request-Zeit aus dem Domain-Registry.
- **`projects.default_locale`** — existiert nicht; das Konzept wird via `target_locales[0]` als canonical-Locale abgeleitet.

Konfidenz: **high** (vollständige `grep`-Coverage über `packages/db/src/` + alle Migrations).
Impact: keiner — UI/Pipeline wären nicht betroffen, weil sie ohnehin nicht auf die Felder zugreifen. Aber der Task-Brief müsste vor der nächsten Verwendung korrigiert werden.

### 1.2 Categories-Seed-Verification

`content_categories` für Toolwiki hat **31 Zeilen**, exakt wie nach Migration `0099_realign_toolwiki_slugs_branch_b.sql` erwartet, aber mit einer anderen Scope-Verteilung als der Task-Brief beschreibt:

| Scope | DB-Count | DB-Slugs | Task-Brief-Erwartung |
|---|---|---|---|
| `tool` | 20 | `ai-agents, audio-music, avatar-voice, business-productivity, chatbots-assistants, code-assistants, coding-development, content-creation, image-generation, images-graphics, knowledge-management, marketing-seo, music-generation, presentation, research, text-language, translation, video-animation, video-generation, voice-synthesis` | „7 tool-top + 13 tool-sub" |
| `blog` | 6 | `comparisons, ethics-law, guides-tutorials, practice-use-cases, tool-reviews, trends-future` | „6 blog" ✓ |
| `knowledge` | 5 | `ethics-law, fundamentals, future, practice, technology` | „5 knowledge" ✓ |
| **Total** | **31** | — | **31** ✓ |

Die `tool`-Scope ist **flach** (20 Slugs, keine `tool-top`/`tool-sub`-Untertrennung im `scope`-Feld). Die hierarchische Struktur (parent/sub) wird im **`parentSlug`**-Frontmatter-Feld der `categories/tool/*.md`-Files getragen, nicht im DB-`scope`. Beispiel: `categories/tool/translation.md` hat `parentSlug: "text-language"`. Die DB-Tabelle `content_categories` enthält **kein `parent_slug`-Feld** — Hierarchie ist heute nur im Repo-File-Inhalt sichtbar, nicht in der DB.

Konfidenz: **high**.

---

## 2. Inventar-Übersicht

### 2.1 Repo-Side (`ki-wissensraum-neu/src/content/`)

| Collection | Total | DE | EN | Sample-Frontmatter-Felder (DE/erstes File) |
|---|---|---|---|---|
| `blog` | 50 | 25 | 25 | `author, bottomLinksVariant, category, clusterKey, clusterRole, excerpt, faq, featured, heroImage, heroImageAlt, intentType, locale, publishedAt, readingTime, seoDescription, seoTitle, showTopicLinks, slug, speakable, tags, title, translationKey, updatedAt, updatedReason` (25 Felder) |
| `comparisons` | 28 | 14 | 14 | `author, clusterKey, clusterRole, comparedAt, description, faq, heroImage, heroImageAlt, locale, seoDescription, seoTitle, testMethodology, title, toolSlugs, translationKey, updatedAt, useCaseVerdicts, verdict, winner` (Sample-File noch mit alten Comparison-Feldern — **Branch-B Schema-Leichen-Entfernung wurde nicht auf das `comparisons`-Schema angewandt**, nur auf `blog`) |
| `tools` | 108 | 54 | 54 | `affiliateSlug, author, category, clusterKey, clusterRole, cons, description, faq, features, image, integrations, locale, parentSlug, priceFrom, pricing, pros, rating, relatedPillars, seoDescription, seoTitle, source, subcategory, tags, title, translationKey, updatedAt, useCases, votes, website` (29 Felder) |
| `ki-wissen` | 36 | 18 | 18 | `author, category, clusterKey, clusterRole, color, description, facts, faq, heroImage, heroImageAlt, howTo, icon, level, locale, next, seoDescription, seoTitle, tags, title, translationKey, updatedAt` (21 Felder, inkl. **neuer `howTo` + `color`**) |
| `usecases` | 24 | 12 | 12 | `author, clusterKey, clusterRole, contentType, description, estimatedReadTime, faq, featuredToolSlugs, heroImage, heroImageAlt, icon, industryFocus, locale, relatedComparisonSlugs, relatedPillarSlugs, relatedTags, tags, title, translationKey, updatedAt` |
| `categories` | 31 | n/a | n/a | `scope, slug, translations` (+ optional `parentSlug` für `tool`-Scope) — **keine Locale-Aufteilung**, `translations.{de,en}.{label,urlSlug}` im Frontmatter |
| `authors` | 10 | 5 | 5 | `avatarGradient, description, expertise, image, initials, jobTitle, locale, location, name, sameAs, translationKey, yearsExperience` |
| `tool-categories` | 14 | 7 | 7 | `author, categorySlug, description, faq, locale, seoDescription, seoTitle, title, translationKey, updatedAt` |
| `special-landings` | 10 | 5 | 5 | `alternativeToolSlugs, applicationCategory, canonicalPath, description, faq, h1, heroImage, heroImageAlt, locale, offerCurrency, offerPrice, relatedArticles, seoDescription, seoTitle, title, toolSlug, translationKey, updatedAt` |

**Beobachtungen:**

- **Comparisons-Sample trägt noch die „entfernten" Felder** (`winner`, `verdict`, `testMethodology`, `useCaseVerdicts`, `comparedAt`). Branch-B hat sie aus dem **Blog**-Schema entfernt (gemäß `marketing-tool-datenmodell-synthese.md`), aber das `comparisons`-Schema in `ki-wissensraum-neu/src/content/config.ts` listet sie weiter als gültige Felder. Konsequenz: die migrierten Posts haben sie noch im Frontmatter, und der Astro-Schema-Parser akzeptiert sie weiter. **Kein Bug, aber widerspricht der Spec-Aussage „5 Comparison-only-Felder aus Blog-Schema entfernt".** Die Spec ist genauer als der Task-Brief, der formuliert hatte „aus Blog-Schema entfernt".
- **ki-wissen-Sample trägt `color` zusätzlich zu `howTo`** — `color` ist ein neues Feld, das im Task-Brief nicht erwähnt wird, aber Teil des Branch-B-Refactors zu sein scheint.

Konfidenz Repo-Inventar: **high** (100 % der Files in jeder Collection gezählt).

### 2.2 DB-Side (`articles` + `content_categories` + `clusters` + `content_pillars`)

| Tabelle/Filter | Anzahl |
|---|---|
| `articles` total (Project = Toolwiki) | **272 rows** |
| `articles WHERE source='imported'` | 272 (alle imported, 0 generated) |
| `content_categories` total | 31 (20 tool + 6 blog + 5 knowledge) |
| `clusters` total | 44 |
| `content_pillars` total | 20 |

**`articles` per Collection × Locale × Source:**

| collection | locale | source | count |
|---|---|---|---|
| `authors` | de | imported | 5 |
| `authors` | en | imported | 5 |
| `blog` | de | imported | **29** |
| `blog` | en | imported | **29** |
| `comparisons` | de | imported | **12** |
| `comparisons` | en | imported | **12** |
| `ki-wissen` | de | imported | **12** |
| `ki-wissen` | en | imported | **12** |
| `special-landings` | de | imported | 5 |
| `special-landings` | en | imported | 5 |
| `tool-categories` | de | imported | 7 |
| `tool-categories` | en | imported | 7 |
| `tools` | de | imported | 54 |
| `tools` | en | imported | 54 |
| `usecases` | de | imported | 12 |
| `usecases` | en | imported | 12 |

**Field-Coverage (per Collection, summiert über Locales):**

| collection | total | pubAt | fmUpd | category | clusterKey | hub | spoke | author | tool_pricing | tool_rating | tool_website | tool_affil | domain_extras populated | schema_json_ld non-empty | astro_frontmatter populated |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `blog` | 58 | 58 | 58 | 58 | 58 | 8 | 50 | 56 | 0 | 0 | 0 | 0 | 58 | **0** | **0** |
| `comparisons` | 24 | **2** | 24 | **2** | 24 | 20 | 4 | 24 | 0 | 0 | 0 | 0 | 24 | **0** | **0** |
| `tools` | 108 | 0 | 108 | 108 | 108 | 16 | 92 | 108 | 108 | 108 | 108 | **106** | 108 | **0** | **0** |
| `ki-wissen` | 24 | 0 | 24 | 24 | 24 | 24 | 0 | 24 | 0 | 0 | 0 | 0 | 24 | **0** | **0** |
| `usecases` | 24 | 0 | 24 | **0** | 24 | 24 | 0 | 24 | 0 | 0 | 0 | 0 | 24 | **0** | **0** |
| `authors` | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 | 0 | 0 |
| `tool-categories` | 14 | 0 | 14 | 0 | 0 | 0 | 0 | 14 | 0 | 0 | 0 | 0 | 14 | 0 | 0 |
| `special-landings` | 10 | 0 | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 | 0 | 0 |

**Drei Auffälligkeiten:**

- **`schema_json_ld` und `astro_frontmatter` sind über ALLE 272 Rows leer** (0 populated). Der Schema-Extension-Pipeline-Output wurde nie für die importierten Artikel berechnet (Bucket C — kein aktiver Bug, aber bedeutet: D143 ist heute physikalisch nicht möglich).
- **`comparisons.published_at = 2/24`** — von 24 Comparison-Rows hat nur 1 DE + 1 EN ein `published_at`-Datum. Die anderen 22 verloren ihren Wert irgendwann.
- **`comparisons.category = 2/24` + `usecases.category = 0/24`** — die Branch-B-Refactor-Sync hat `category` für `comparisons` größtenteils und für `usecases` komplett geleert. Das Sample (siehe §3.2) zeigt: das 1 verbleibende `comparisons`-Row mit category hat noch `"Vergleiche"` (alter deutscher Display-Name), nicht den neuen Slug `"comparisons"`.

Konfidenz: **high** (vollständiges `count(*)` über die Tabelle).

---

## 3. Diff-Matrix pro Collection

### 3.1 `blog`

| Locale | repo-Files | DB-Rows | Match | Repo-only | DB-only |
|---|---|---|---|---|---|
| DE | 25 | 29 | 24 | **1**: `system-prompts-role-prompting-best-practices-2026` | **5**: `chatgpt-preise-2026`, `code-assistenten`, `dalle-4-vs-midjourney-v7-vs-flux-2026-vergleich`, `elevenlabs-vs-murf-vs-play-ht-voice-cloning-test-2026`, `system-prompts-role-prompting-2026-leitfaden` |
| EN | 25 | 29 | 24 | **1**: `system-prompts-role-prompting-best-practices-2026` | **5**: `ai-code-assistants`, `chatgpt-pricing-2026`, `dall-e-4-vs-midjourney-v7-vs-flux-2026-comparison`, `elevenlabs-vs-murf-vs-play-ht-voice-cloning-comparison-2026`, `system-prompts-role-prompting-2026-guide` |

**Klassifikation der 10 DB-only-Rows** (per Locale-Paar):

| DB-only-Slugs (DE / EN) | Klassifikation | Begründung |
|---|---|---|
| `dalle-4-...-vergleich` / `dall-e-4-...-comparison` | **Bucket B — Collection-Move** | Erscheinen in `comparisons/de` + `comparisons/en` mit fast identischem (übersetztem) Slug. Branch-B-Refactor verschob sie. |
| `elevenlabs-...-test-2026` / `elevenlabs-...-comparison-2026` | **Bucket B — Collection-Move** | Analog. |
| `system-prompts-...-leitfaden` / `system-prompts-...-guide` | **Bucket B — Slug-Rename** | `filePath`-Spalte zeigt für beide DB-Rows bereits auf den NEUEN Slug `...-best-practices-2026.mdx` (Importer hat Filepath getrackt, aber nicht den Slug auf dem alten Row aktualisiert). |
| `chatgpt-preise-2026` / `chatgpt-pricing-2026` | **Bucket B — Pure Repo-Deletion** | Keine entsprechende Datei mehr im Repo. `lastImportedAt = 2026-05-17/20`. |
| `code-assistenten` / `ai-code-assistants` | **Bucket B — Pure Repo-Deletion** | `category=comparisons` (alt) — wahrscheinlich ursprünglich ein listicle-blog-Post. Datei wurde gelöscht. |

**Konfidenz:** high für Collection-Move (Slugs matchen), **medium** für Pure-Repo-Deletion (kann nicht zwischen „gelöscht" und „umbenannt-mit-anderem-Slug" unterscheiden ohne git history check — die Datums-Heuristik suggeriert aber gelöscht).

**Sample-Frontmatter-vs-Row-Diff** für 2 in-sync Blog-Rows:

| File | promoted-field-drift | Status |
|---|---|---|
| `blog/de/ki-hr-recruiting-mittelstand-2026` | 0/8 drifts | ✅ alle Felder match (`category=practice-use-cases`, `clusterKey=ki-business-2026/spoke`, `author=anna-weidner`, tags-Array identisch, etc.) |
| `blog/en/ai-hr-recruiting-smb-2026` | 0/8 drifts | ✅ analog |

Body-Größen-Drift `31967 (repo) → 32098 (DB)` ca. +130 chars — vermutlich Whitespace-Normalisierung beim Import; nicht-signifikant.

### 3.2 `comparisons`

| Locale | repo-Files | DB-Rows | Match | Repo-only | DB-only |
|---|---|---|---|---|---|
| DE | 14 | 12 | 12 | **2**: `dalle-4-vs-midjourney-v7-vs-flux-2026-vergleich`, `elevenlabs-vs-murf-vs-play-ht-voice-cloning-test-2026` | 0 |
| EN | 14 | 12 | 12 | **2**: `dall-e-4-vs-midjourney-v7-vs-flux-2026-comparison`, `elevenlabs-vs-murf-vs-play-ht-voice-cloning-comparison-2026` | 0 |

Die 2 Repo-only-Slugs pro Locale sind **exakt die Comparison-Migrations** aus §3.1 — gleiche Files unter neuer Collection.

**Sample-Frontmatter-vs-Row-Diff** für `comparisons/de/chatgpt-vs-claude-vs-gemini-2026-vergleich`:

| Field | Repo | DB | Status |
|---|---|---|---|
| `category` | (nicht im Frontmatter) | `"Vergleiche"` | ⚠️ **Stale DB-Wert** — Repo-Schema hat `category` für `comparisons` entfernt, DB hält alten deutschen Display-Namen. |
| `publishedAt` | (nicht im Frontmatter) | `2026-04-12` | ⚠️ **Stale DB-Wert** — wahrscheinlich von der alten Blog-Vorvergangenheit. |
| `tags` | (nicht im Frontmatter) | `["ChatGPT","Claude","Gemini",…]` (12 Tags) | ⚠️ **Stale DB-Wert** — Repo trägt keine `tags` mehr im `comparisons`-Frontmatter. |
| `clusterKey` | `chatbots-2026` | `chatbots-2026` | ✅ |
| `clusterRole` | `hub` | `hub` | ✅ |
| `author` | `lukas-hoffmann` | `lukas-hoffmann` | ✅ |
| `translationKey` | match | match | ✅ |

`domain_extras` enthält noch die alten Comparison-spezifischen Felder: `comparedAt, testMethodology, toolSlugs, useCaseVerdicts, verdict, winner` (alle 6 noch da). Das ist **konsistent** mit der Repo-Frontmatter-Beobachtung aus §2.1 (das `comparisons`-Schema im Repo definiert sie weiterhin).

Konfidenz: **high**.

### 3.3 `tools`

| Locale | repo-Files | DB-Rows | Match | Repo-only | DB-only |
|---|---|---|---|---|---|
| DE | 54 | 54 | 54 | 0 | 0 |
| EN | 54 | 54 | 54 | 0 | 0 |

**Perfekt synchron auf Slug-Ebene.**

**Sample-Frontmatter-vs-Row-Diff** für `tools/de/chatgpt`:

| Field | Repo | DB | Status |
|---|---|---|---|
| `category` | `text-language` | `text-language` | ✅ |
| `subcategory` | `chatbots-assistants` | `chatbots-assistants` | ✅ |
| `pricing` | `freemium` | `freemium` | ✅ |
| `rating` | `4.7` (number) | `"4.7"` (string) | ⚠️ **kosmetisch** — `tool_rating` ist `numeric(3,1)` und wird von Drizzle als String zurückgegeben. Bei JSON-Vergleich kosmetisch unterschiedlich, semantisch identisch. |
| `website` | `https://chatgpt.com` | `https://chatgpt.com` | ✅ |
| `affiliateSlug` | `chatgpt` | `chatgpt` | ✅ |
| `clusterKey`/`clusterRole` | `chatbots-2026/spoke` | `chatbots-2026/spoke` | ✅ |

`domain_extras` enthält: `affiliateSlug, cons, faq, features, heroImage, heroImageAlt, image, integrations, priceFrom, pricing, pros, rating, relatedPillars, seoDescription, seoTitle, source, speakable, useCases, votes, website` — sämtliche tool-spezifischen Felder. Domain-Guard (`industry='ai_education'`) ist aktiv und korrekt: alle 108 Tool-Rows haben promoted columns gefüllt.

Konfidenz: **high**.

### 3.4 `ki-wissen`

| Locale | repo-Files | DB-Rows | Match | Repo-only | DB-only |
|---|---|---|---|---|---|
| DE | 18 | 12 | 12 | **6**: `backpropagation`, `chatgpt-guide`, `datenschutz-bei-ki`, `entscheidungsbaeume`, `eu-ai-act`, `neuronale-netze` | 0 |
| EN | 18 | 12 | 12 | **6**: `ai-privacy`, `backpropagation`, `chatgpt-guide`, `decision-trees`, `eu-ai-act`, `neural-networks` | 0 |

**Genau die 6 neuen Pillar-Themen × 2 Locales = 12 Repo-Adds**, exakt wie Branch-B Spec dokumentiert.

**Cluster-Verteilung:** alle 12 DB-Rows sind `clusterRole=hub` (kein einziger spoke). Ki-wissen-Pillars sind alle Hubs.

**`howTo` im Repo-Frontmatter:** ~5 von 18 DE-Files haben `howTo` (gefunden: `backpropagation`, `chatgpt-guide`, `deep-learning`, `entscheidungsbaeume`, `eu-ai-act`). Alle sind ENTWEDER neue Pillars (noch nicht in DB) oder bestehende Pillars (`deep-learning` ist in DB, hat aber `howTo` noch nicht in `domain_extras` — was bedeutet die jüngste Repo-Änderung wurde noch nicht synchronisiert).

**Sample-Frontmatter-vs-Row-Diff** für `ki-wissen/de/was-ist-ki`:

| Field | Repo | DB | Status |
|---|---|---|---|
| `category` | `fundamentals` | `fundamentals` | ✅ |
| `clusterKey`/`clusterRole` | `grundlagen-ki/hub` | `grundlagen-ki/hub` | ✅ |
| `author` | `toolwiki – Redaktion` | `toolwiki – Redaktion` | ✅ |

`domain_extras` enthält: `color, facts, faq, icon, level, next, seoDescription, seoTitle` — keine `howTo` (das File hat selber kein `howTo`, also korrekt).

Konfidenz: **high**.

### 3.5 `usecases`

| Locale | repo-Files | DB-Rows | Match | Repo-only | DB-only |
|---|---|---|---|---|---|
| DE | 12 | 12 | 12 | 0 | 0 |
| EN | 12 | 12 | 12 | 0 | 0 |

**Perfekt synchron.** Auffällig: `category` ist auf allen 24 Rows NULL — Usecases-Frontmatter hat **kein `category`-Feld**. Die `category`-Spalte ist für diese Collection by-design leer.

Konfidenz: **high**.

### 3.6 `categories`

| Total | Repo-only | DB-only |
|---|---|---|
| Repo: 31, DB: 31, matched: 31 | 0 | 0 |

**Perfekt synchron**, alle 31 scope+slug-Paare matchen. Beispiel-Frontmatter (Repo `tool/translation.md`):
```yaml
slug: translation
scope: tool
parentSlug: text-language     # ← Hierarchie nur im Repo, nicht in DB-Spalten
translations:
  de: { label: "Übersetzung", urlSlug: "uebersetzung" }
  en: { label: "Translation",  urlSlug: "translation" }
```

`content_categories`-Tabelle hat das Feld `translations` als JSONB, aber **kein `parent_slug`-Feld**. Die Hierarchie-Information (`parentSlug: text-language` für `translation` → `text-language` als parent) ist nur im Repo-File präsent, nicht in der DB-Tabelle. Die DB hat: `id, projectId, scope, slug, translations, createdAt, updatedAt` — Hierarchie fehlt.

Konfidenz: **high** für Slug-Match. **medium** für „parentSlug fehlt in DB" — habe Schema nur kursorisch gescannt, aber Migration `0094_content_categories.sql` müsste das beweisen.

### 3.7 `authors`, `tool-categories`, `special-landings`

| Collection | Locale | repo | DB | Status |
|---|---|---|---|---|
| `authors` | DE/EN | 5/5 | 5/5 | ✅ perfekt synchron beide Locales |
| `tool-categories` | DE/EN | 7/7 | 7/7 | ✅ perfekt synchron |
| `special-landings` | DE/EN | 5/5 | 5/5 | ✅ perfekt synchron |

Sample-Frontmatter-vs-Row-Diff für diese Collections **nicht durchgeführt** (Slug-Match ist 100 %, niedrige Priorität). Konfidenz: **medium** für Felder-Konsistenz (slug-perfekt aber Feld-Werte nicht stichprobenartig verifiziert).

---

## 4. Cluster-State

### 4.1 `articles.cluster_key` Drift

| | DB-distinct | Repo-distinct | Repo-only | DB-only |
|---|---|---|---|---|
| `cluster_key`-Werte | 44 | 46 | **2**: `ki-recht-2026`, `praxis-tools` | **0** |

**Repo-only-Clusters:**
- `ki-recht-2026` — Repo: 2 hubs + 2 spokes (4 Files). Wahrscheinlich Branch-B-Add für eines der neuen ki-wissen-Themen (eu-ai-act + datenschutz-bei-ki?).
- `praxis-tools` — Repo: 2 hubs + 0 spokes (2 Files). Vermutlich ein neuer Hub-only-Cluster, evt. für chatgpt-guide.

Re-Import würde diese 2 cluster_keys auf den 6 neuen ki-wissen-Pillar-Rows landen lassen.

### 4.2 Hub/Spoke-Count-Drift bei matched cluster_keys

| cluster_key | DB hubs/spokes | Repo hubs/spokes | Drift |
|---|---|---|---|
| `chatbots-2026` | 2/18 | 2/16 | DB hat **2 Spokes mehr** (sind die migrierten DALL·E + ElevenLabs comparison-blog-Posts, die im Repo jetzt unter `comparisons/` liegen mit `clusterKey=chatbots-2026`) |
| `code-assistenten-2026` | 2/6 | 2/4 | DB hat **2 Spokes mehr** (sind `code-assistenten` + `ai-code-assistants`, die pur gelöscht wurden) |
| `grundlagen-ki` | 8 hubs / 0 spokes | 14 hubs / 0 spokes | Repo hat **6 Hubs mehr** = die 6 neuen ki-wissen-Pillars (DE+EN gleichmäßig) |
| `ki-wissen` | 14 hubs / 0 spokes | 14 hubs / 0 spokes | ✅ exakt |

Konsistent mit den Findings aus §3.1+§3.4. Konfidenz: **high**.

### 4.3 `clusters`-Tabelle (44 Rows) vs `content_pillars`-Tabelle (20 Rows)

| `clusters` | `content_pillars` |
|---|---|
| 44 Rows | 20 Rows |
| Slug-artige Namen (`ai-image-tools-2026`, `usecase-customer-support`, `grundlagen-ki`) | Mix aus EN-Slugs (`audio-music`), DE-Display-Names (`Grundlagen`, `Vergleiche`, `Technik`, `Zukunft`, `Ethik & Recht`, `Praxis`, `Tool-Reviews`), und Cluster-ähnlichen Slugs (`ki-regulierte-branchen-2026`, `rag-context-engineering-2026`) |

**Beobachtungen:**

- Die Branch-B-Spec sprach von „12 neue ki-wissen-Pillars angelegt: `neuronale-netze`, `backpropagation`, `eu-ai-act`, `entscheidungsbaeume`, `datenschutz-bei-ki`, `chatgpt-guide`". Diese Slugs **erscheinen weder in `clusters` noch in `content_pillars`** als Tabellen-Einträge — sie sind nur File-Slugs in `ki-wissen/{de,en}/*.mdx`. Die DB-Tabellen `clusters`/`content_pillars` wurden also **nicht** mit den neuen Pillars geseedet.
- Die 44 `clusters` zeigen Doppel-Naming-Drift: `code-assistants-2026` (EN) + `code-assistenten-2026` (DE) existieren beide als separate Cluster, obwohl Hub-Spoke-Topology pro Cluster-Slug sein sollte. Beim Re-Import von `articles.cluster_key` wird das nicht aufgelöst — die Cluster bleiben separat.
- `content_pillars.name` hat 4 Einträge mit Schwesterkonzept-Drift: `Praxis` und `Praxis & Use Cases` parallel; `Grundlagen` + `Technik` + `Zukunft` (deutsch) parallel zu `audio-music`/`business-productivity`/`coding-development` (englisch). Das ist sehr wahrscheinlich Daten-Müll aus mehreren früheren Migrations-Runs (Cluster Creator + ColdStart + sync-clusters-from-frontmatter).

Diese sind **out-of-scope für diesen Audit** (nicht durch den aktuellen Refactor verursacht), aber sie wären während eines Plan- oder Article-Generation-Runs verwirrend. Wert für Marcel: separater Cluster/Pillar-Cleanup vor dem nächsten ColdStart oder Cluster-Creator-Run.

Konfidenz: **high** für DB-Counts, **medium** für Drift-Ursache (kann ich nicht ohne git history sicher sagen).

---

## 5. Schema-JSON-LD-State-Diff (D143-Konflikt-Check)

### 5.1 Aktueller State

- **0 von 272 articles** haben `domain_extras ? 'howTo'`
- **0 von 272 articles** haben `schema_json_ld` als non-empty Array
- **0 von 272 articles** haben `astro_frontmatter` populated

→ D143-Konflikt ist **vollständig dormant**. Selbst wenn `ArticleSyncPipeline` heute auf jeden der 272 Articles laufen würde, gibt es nichts zu konflikten.

### 5.2 RenderMdxStep-Verhalten ([render-mdx.ts:266-267](packages/adapters/astro-sync/src/steps/render-mdx.ts:266))

```ts
// Layer 3: static known fields (always win — highest priority)
const known: Record<string, unknown> = {
  …
  schema: article.schemaJsonLd,
  schemaJsonLd: article.schemaJsonLd,
  …
};
const merged: Record<string, unknown> = { ...extras, ...fromColumns, ...known };
// dann gefiltert nach input.collectionInfo.fields (nur Felder die im Astro-Schema sind)
```

`RenderMdxStep` schreibt heute **null** als `schema`/`schemaJsonLd` ins MDX (weil DB-Wert null ist), wobei der Filter durch `collectionInfo.fields` ohnehin die Astro-Schema-Felder einschränkt. **Wenn das `ki-wissen`-Schema in `ki-wissensraum-neu/src/content/config.ts` keinen `schemaJsonLd`-Eintrag enthält**, wird das Feld stillschweigend gedroppt — kein Risiko.

### 5.3 D143-Risiko-Profil nach Re-Import

Nach Re-Import würden die 6 neuen Pillars + andere ki-wissen-Files mit `howTo` ihren `howTo`-Wert in `domain_extras` landen (das ist der existierende DOMAIN_EXTRAS-Pfad). Wenn dann `SchemaExtensionPipeline` für eines dieser Articles läuft, würde `schema_json_ld` populated werden. Falls jemand danach `ArticleSyncPipeline` für dasselbe Article triggert, schreibt das `schema_json_ld` UND das (intakte) `howTo` ins MDX zurück.

**Doppel-Information ja**, aber **Konflikt nein** — solange das Astro-Schema nur eines der beiden Felder rendert. Branch-B hat den Layout-Renderer auf `howTo` umgestellt, nicht auf `schema_json_ld`. Das ist also weiter konsistent.

**Echtes D143-Risiko** entsteht erst, wenn eine zukünftige Spec den `SchemaExtensionPipeline`-Output AUTHORITATIV für JSON-LD macht (oder umgekehrt: `howTo` als authoritativ für Article-Body-Rendering). Heute ist das nicht der Fall.

Konfidenz: **high** (Code-Read der relevanten Steps + leere DB-State).

---

## 6. Risk-Assessment

### 6.1 Befunde nach Bucket

#### Bucket A — Erwartet, harmlos

| # | Befund | Begründung |
|---|---|---|
| A1 | `tools/{de,en}` 54/54 perfekt synchron, alle 6 tool_*-Promoted-Columns korrekt geguarded auf `industry='ai_education'` | Domain-Guard funktioniert wie spec. |
| A2 | `usecases/{de,en}` 12/12 perfekt synchron, `category` korrekt NULL (Usecases-Schema hat das Feld nicht) | By-design. |
| A3 | `authors/tool-categories/special-landings` jeweils perfekt synchron | By-design. |
| A4 | `content_categories` 31/31 perfekt synchron mit Repo-Scopes | Migration 0095 + 0099-Realign aktiv. |
| A5 | `schema_json_ld` + `astro_frontmatter` leer auf allen 272 Rows | Schema-Extension-Pipeline wurde für imported articles nie ausgelöst — kein Bug, sondern by-design. |
| A6 | `tool_rating`: Repo=`4.7` (number) vs DB=`"4.7"` (string) | Drizzle gibt `numeric` als String zurück. Kosmetisch, nicht semantisch. |
| A7 | `articles.collection` als `text` (nicht enum), `frontmatter_extras` umbenannt zu `domain_extras` | Migrations 0096 + 0100 aktiv. |
| A8 | `cluster_role='hub'`-Verteilung auf ki-wissen: 12/12 sind Hubs | Ki-wissen-Pillars sind Hub-only by-design. |

#### Bucket B — Erwartet, Cleanup nötig

| # | Befund | Cleanup-Empfehlung |
|---|---|---|
| **B1** | **2× Comparison-Migration-Orphans**: `dalle-4-vs-midjourney-v7-vs-flux-2026-vergleich` (DE), `dall-e-4-vs-midjourney-v7-vs-flux-2026-comparison` (EN), `elevenlabs-vs-murf-vs-play-ht-voice-cloning-test-2026` (DE), `elevenlabs-vs-murf-vs-play-ht-voice-cloning-comparison-2026` (EN) — als `collection='blog'` in DB, aber im Repo unter `comparisons/`. | `UPDATE articles SET status='superseded' WHERE …` ODER `DELETE FROM articles WHERE …`. Der Repo-File-Inhalt wird nach Re-Import als neue `collection='comparisons'`-Row angelegt. |
| **B2** | **2× Slug-Rename-Orphans**: `system-prompts-role-prompting-2026-leitfaden` (DE) und `system-prompts-role-prompting-2026-guide` (EN), beide DB-Rows haben `filePath` bereits auf den NEUEN Slug `system-prompts-role-prompting-best-practices-2026.mdx` zeigend (Importer hat Filepath getrackt, aber Slug-Spalte stehengelassen). | Wie B1: `UPDATE … SET status='superseded'`. |
| **B3** | **4× Pure-Deletion-Orphans**: `chatgpt-preise-2026` (DE), `chatgpt-pricing-2026` (EN), `code-assistenten` (DE), `ai-code-assistants` (EN). Kein matchendes Repo-File mehr. | Wie B1+B2. Total 10 Blog-Rows als `superseded` markieren. |
| **B4** | **22× stale `published_at` auf Comparison-Rows** + **22× stale `category` auf Comparison-Rows** + **24× stale `tags` auf Comparison-Rows**: Migrierte Comparison-Posts tragen alte Blog-Felder, weil das neue `comparisons`-Schema diese Felder nicht enthält. | `UPDATE articles SET category=NULL, published_at=NULL, tags=NULL WHERE project_id=$1 AND collection='comparisons' AND ...` ODER per Re-Import (UpsertArticlesStep überschreibt diese Felder beim nächsten Sync nicht-deterministisch — siehe §7). **Empfehlung:** in der Cleanup-Phase explizit auf NULL setzen, dann Re-Import. |
| **B5** | **2 neue cluster_keys** im Repo (`ki-recht-2026`, `praxis-tools`), aber `clusters`-Tabelle hat keinen passenden Eintrag | Der Re-Import läuft via `SyncClustersFromFrontmatterStep`, der die fehlenden Cluster-Rows anlegt (out-of-the-box). **Kein manueller Cleanup nötig.** |

#### Bucket C — Unerwartet, harmlos

| # | Befund | Begründung |
|---|---|---|
| C1 | **`content_pillars`-Tabelle hat 20 Einträge mit Schwesterkonzept-Drift** (`Praxis` + `Praxis & Use Cases` parallel; 7 EN-Slug-style + 12 DE-Display-Name-style + 3 -2026-suffix). | Akkumulierter Daten-Müll aus mehreren früheren Pipeline-Runs (Cluster Creator + ColdStart + sync-clusters-from-frontmatter). Funktionalität nicht betroffen, weil neue Articles ohnehin `cluster_key` als Strings setzen, nicht über FK auf `content_pillars`. |
| C2 | **`clusters`-Tabelle hat Doppel-Sprach-Cluster-Slugs** (`code-assistants-2026` + `code-assistenten-2026` als separate Rows) | Analog zu C1. Kein Funktions-Impact, weil cluster_key per-Article gesetzt wird, nicht über Cluster-PK joining. |
| C3 | **`comparisons`-Schema im Repo enthält weiterhin die „entfernten" Felder** `winner, verdict, testMethodology, useCaseVerdicts, comparedAt` | Branch-B-Spec sagte „aus Blog-Schema entfernt" — Comparison-Schema wurde nicht angefasst. Diese Felder werden weiter im Repo-Frontmatter geführt und in `domain_extras` gespeichert. Funktional korrekt. |
| C4 | **31 `categories`-Files im Repo haben `parentSlug`-Frontmatter, aber `content_categories`-Tabelle hat kein `parent_slug`-Feld** | Hierarchie-Info wird heute nicht in DB persistiert. Akzeptabel solange niemand eine cross-tenant `category`-Hierarchie-Query braucht. |
| C5 | **`projects.allowed_collections` und `projects.default_locale` existieren nicht in DB-Schema**, obwohl Task-Brief das behauptet | Werden dynamisch zur Request-Zeit aus Domain-Registry berechnet (Routes-Code). Funktional unkritisch. |

#### Bucket D — Unerwartet, Bug-Verdacht

| # | Befund | Hypothese | Verifikation |
|---|---|---|---|
| **D1** | **`astro_frontmatter` ist auf ALLEN 272 Rows leer/null**, obwohl die Spalte (`jsonb`) für Astro-Frontmatter-Sync gedacht scheint. | Importer schreibt diese Spalte nie. `astroFrontmatter` ist im `UpsertArticlesStep` nicht referenziert. Entweder dead column (Bucket C) oder vergessener Write-Path (Bucket D). | `grep -rn "astroFrontmatter\|astro_frontmatter" packages/ apps/` — wenn nur Schema-Definition + Render-Step-Read aber keine Writer → dead column. |
| **D2** | **`schema_json_ld` ist auf ALLEN 272 Rows leer**, aber `RenderMdxStep` liest es als `known.schemaJsonLd` und schreibt es zurück | Bedeutet: ArticleSyncPipeline würde aktuell `schemaJsonLd: null` ins MDX schreiben. Astro ignoriert vermutlich unknown null-Felder. Aber: sobald `SchemaExtensionPipeline` für ein imported Article läuft (was bisher nie passierte), wäre das Feld gefüllt — und ein nachfolgender Sync würde es ins MDX rendern. Heute kein aktiver Bug, **aber ein Footgun für die Zukunft**. | Check ob `SchemaExtensionPipeline` für `source='imported'` Articles überhaupt enqueued werden kann (Frontend-Trigger?). Wenn nein, bleibt das Feld in der Praxis leer und das ist OK. |
| **D3** | **10 Orphan-Blog-Rows haben `published_at` und `frontmatter_updated_at` gesetzt** — `lastImportedAt` zwischen 2026-05-16 und 2026-05-20 | Importer kennt keinen Delete-Sweep (verifiziert: 9 Steps in `AstroImportPipeline`, keiner deletet articles). Bedeutet: jeder zukünftige Re-Import lässt diese 10 Rows stehen. Cleanup ist manuell. | Confirmed durch [pipeline.ts:37-45](packages/adapters/astro-sync/src/import/pipeline.ts:37) — keine Delete/Stale-Step in der Pipeline. |
| **D4** | **Branch-B-Spec mentioned 12 neue ki-wissen-Pillars-Slugs** (`neuronale-netze`, `backpropagation`, …), die im Repo als Files erscheinen, aber **`content_pillars`-Tabelle hat 0 davon** als Einträge | Pillars-Tabelle ist nicht authoritativ für Pillar-Definitionen — die Files sind authoritativ, die Tabelle ist historisch gefüllt. Re-Import via `SyncClustersFromFrontmatterStep` legt vermutlich Pillar-Rows für `cluster_key` an, aber pro Cluster, nicht pro File. Daher landen die neuen Pillars als Cluster-Rows (`ki-recht-2026`, `praxis-tools`), nicht als content_pillars-Rows. | `SyncClustersFromFrontmatterStep.execute()` lesen, prüfen ob `content_pillars.name` aus `pillar`-Frontmatter-Field geseedet wird. Wenn ja, würde Re-Import die 2 neuen Pillars anlegen. Wenn nein, bleiben die als Cluster-only ohne Pillar-Eltern. |

### 6.2 Re-Import-Risiko-Matrix

Was würde passieren, wenn jetzt `RepoImportPipeline` für Project Toolwiki läuft (ohne Cleanup)?

| Risiko | Status | Re-Import-Impact |
|---|---|---|
| **L1 Human-Edit-Überschreiben** in `articles.body_md` | NICHT aktiv — alle Articles sind `source='imported'` und body_md wird vom Importer geschrieben | Re-Import überschreibt body_md aus Repo. Erwartet, akzeptiert. |
| **L5 Silent-Build-Drop bei Schema-Diff** | Mitigiert durch Spec multi-domain-evolution S1.2 (Boundary-Validator) | Re-Import wirft auf unbekannte Felder → laute Failure statt silent skip. ✅ |
| **L7 Repo-Deletions ohne Sweep** | **AKTIV** — Importer hat keinen Delete-Step | 10 verwaiste Blog-Rows bleiben stehen. Plus 2 neue Comparison-Rows + 12 neue ki-wissen-Rows + 1 neue Blog-Row (`...best-practices-2026`) als Inserts → DB-Total wächst von 272 auf 287, mit 12 stale Orphans inside (10 alte + 2 alte Slug-renamed). |
| **L8 Refresh-Whitelist (S1.1)** schützt `featured`/`tool_pricing` etc. | Aktiv | Re-Import würde diese Felder nicht überschreiben, auch wenn Repo-Wert sich ändert. ✅ — relevant für Bucket-B4-Cleanup-Reihenfolge: B4 muss VOR Re-Import laufen, weil ansonsten die alten Werte nicht überschrieben werden. **Wichtig!** |
| **Domain-Registry Collection-Gate** | Aktiv | Repo hat 9 Collections. Toolwiki-Domain-Spec sollte alle 9 erlauben. Verifizieren mit `loadAllowedCollections(toolwikiProjectId)`. Wenn `comparisons` (plural) fehlt → Re-Import throws. |
| **Datums-Field-Mapping** | Aktiv | Importer mappt `publishedAt`/`updatedAt`-Frontmatter auf `published_at`/`frontmatter_updated_at`. Comparison-Files (die kein `publishedAt` mehr haben) → DB-Wert bleibt unverändert (siehe L8 Whitelist). Stale-`publishedAt` bleibt also auch nach Re-Import bestehen, wenn nicht vorher genullt. |
| **Astro silent-exclusion**: Pflichtfeld fehlt | Mitigiert durch Validator | Wirft, statt silent zu rendern. ✅ |
| **D143 ki-wissen howTo**: Tool-DB schreibt schema_json_ld ins MDX zurück | Dormant (0 Rows haben Schema gesetzt) | Heute kein Risiko. Zukunft: wenn SchemaExtensionPipeline ausgelöst wird, ja. |

### 6.3 Risk-Summary

**Hard blockers für sauberen Re-Import: 0**
**Soft drift, durch Cleanup vor Re-Import lösbar: 5** (B1-B5)
**Forward-Footguns, nicht durch Re-Import gelöst: 2** (D2, D4)
**Out-of-scope, separate Cleanup-Tasks für später: 3** (C1 content_pillars, C2 clusters, C4 categories.parent_slug)

---

## 7. Empfehlung

### Empfohlene Option: **Option 2 — Cleanup-First, dann Re-Import**

**Begründung:**

1. Pure-Re-Import (Option 1) hinterlässt die **10 verwaisten Blog-Rows** dauerhaft in der DB (kein Delete-Step). Diese würden bei jedem Plan-Generation-Lauf als „existierender Content" gezählt, was die Gap-Detection und Cluster-Belegung verfälscht.
2. Pure-Re-Import löst **das stale `category`/`published_at`/`tags`-Problem auf Comparisons NICHT**, weil die Refresh-Whitelist diese Felder schützt (Spec multi-domain-evolution S1.1). 22 Rows mit alten `category="Vergleiche"`-Werten würden weiter Comparison-Routing und Brief-Match brechen (siehe §3.2).
3. Selective Re-Import (Option 3) ist over-engineered für ein Drift dieser Größe (15 Adds + 10 Deletes = 25 Zeilen Veränderung auf 272 Gesamt = ~9 % Drift). Die Komplexität von Per-Collection-Filtern lohnt sich nicht.

### Konkreter Plan

#### Phase 1 — Cleanup-SQL (gegen Production, nach Marcel-OK)

```sql
-- 10 verwaiste Blog-Rows als superseded markieren
UPDATE articles
SET status = 'superseded', updated_at = NOW()
WHERE project_id = '3fad7929-b06d-47ce-b6a1-8ac134362c42'
  AND collection = 'blog'
  AND slug IN (
    'dalle-4-vs-midjourney-v7-vs-flux-2026-vergleich',
    'dall-e-4-vs-midjourney-v7-vs-flux-2026-comparison',
    'elevenlabs-vs-murf-vs-play-ht-voice-cloning-test-2026',
    'elevenlabs-vs-murf-vs-play-ht-voice-cloning-comparison-2026',
    'system-prompts-role-prompting-2026-leitfaden',
    'system-prompts-role-prompting-2026-guide',
    'chatgpt-preise-2026',
    'chatgpt-pricing-2026',
    'code-assistenten',
    'ai-code-assistants'
  );
-- expected: 10 rows updated

-- Stale-Felder auf Comparison-Rows neutralisieren (lässt Importer beim nächsten Lauf Refresh-Whitelist-konform leer)
UPDATE articles
SET
  category = NULL,
  published_at = NULL,
  tags = NULL,
  updated_at = NOW()
WHERE project_id = '3fad7929-b06d-47ce-b6a1-8ac134362c42'
  AND collection = 'comparisons';
-- expected: 24 rows updated (12 DE + 12 EN)
```

**Hinweis zu `status='superseded'`:** Prüfen ob `articleStatusEnum` in `packages/db/src/schema/_enums.ts` den Wert `superseded` enthält. Falls nicht: stattdessen `archived` oder einen neuen Status hinzufügen.

#### Phase 2 — Re-Import (per HTTP-Trigger ODER CLI)

```bash
# Empfohlen: HTTP-Endpoint hat alle Cost/Pause-Gates aktiv
curl -X POST http://localhost:3001/api/projects/toolwiki/astro-import \
  -H "Cookie: <session>"

# ODER: CLI direkt
bun --filter @marketing-auto/api run astro-import toolwiki
```

**Erwartete Mutationen:**
- 1 INSERT pro Locale: `system-prompts-role-prompting-best-practices-2026` (blog, DE+EN) = 2 Rows
- 2 INSERTs pro Locale: `dalle-…` und `elevenlabs-…` unter `comparisons` (DE+EN) = 4 Rows
- 6 INSERTs pro Locale: neue ki-wissen-Pillars = 12 Rows
- ggf. INSERTs in `clusters` für `ki-recht-2026`, `praxis-tools` über `SyncClustersFromFrontmatterStep`
- UPDATEs auf 250 bestehenden in-sync Rows (frontmatter_updated_at + body_md, falls geändert)

**DB-Total nach Phase 2:** 272 (alt) - 0 (kein delete) + 18 (neue Inserts) = **290 Rows**, davon 10 mit `status='superseded'` (filterbar in UI/Queries).

#### Phase 3 — Verification

```bash
# Audit-Scripts re-running als Smoke-Test
bun --env-file .env apps/api/src/scripts/discovery/audit-db-inventory.ts
bun --env-file .env apps/api/src/scripts/discovery/audit-diff-matrix.ts
# Erwartet: 0 only-in-DB Rows pro Collection (außer den 10 superseded)
```

#### Phase 4 — Nicht-blockierende Folge-Tasks (separate Spec)

- **D1**: Klären ob `astro_frontmatter` dead column ist → ggf. droppen (Migration 0101)
- **D4**: Sync-Clusters-Step prüfen — werden `content_pillars` aus dem `pillar`-Frontmatter geseedet? Wenn nein, dann auch nicht erwartet.
- **C1+C2**: Cleanup-Pass für `content_pillars`/`clusters`-Schwesterkonzept-Drift (vor nächstem ColdStart)
- **C4**: `parent_slug`-Spalte auf `content_categories` ergänzen, falls Hierarchie-Queries gebraucht werden

---

## 8. Offene Fragen für Marcel

1. **`articleStatusEnum.superseded`-Existenz prüfen.** Wenn nicht vorhanden, ist `status='archived'` der nächstbeste Default — oder ich erstelle eine Migration für den neuen Status. Was bevorzugst du?
2. **Re-Import-Timing**: Soll Phase 1 + Phase 2 in derselben Session laufen, oder erst Phase 1, dann ein Smoke-Test der Cleanup-Wirkung, dann Phase 2?
3. **`content_pillars` + `clusters` Schwester-Drift (Bucket C1+C2)**: Out-of-scope laut Task-Brief, aber sind diese Cluster-Dubletten wirklich harmlos, oder sehen wir bei Plan-Generation Probleme? Wenn du Beispiele kennst, würde ich Bucket C nach Bucket B verschieben.
4. **`astro_repo.installationId`**: 129941086 — soll ich verifizieren, dass die GitHub-App-Installation noch aktiv ist, bevor der Re-Import läuft? `bun --filter @marketing-auto/adapter-astro-sync list-installations` würde das zeigen.
5. **D3 Slug-Rename-Erkennung im Importer**: Lohnt es sich, eine Spec für „Importer erkennt Slug-Rename via `filePath`-Match und supersedet die alte Row automatisch" zu schreiben? Würde diese Klasse von Drift forever lösen.

---

## Anhang: Files gelesen + Konfidenz pro Befund

### Genutzte Scripts (alle in `apps/api/src/scripts/discovery/`)

| Script | Zweck | Sample-Größe |
|---|---|---|
| `audit-project.ts` | `projects` + `content_categories` für Toolwiki | exhaustive |
| `audit-repo-inventory.ts` | File-Count + Slug-List per Collection × Locale + Sample-Frontmatter-Keys | exhaustive (alle 281 Files) |
| `audit-db-inventory.ts` | `articles` per Collection × Locale × Source + Field-Coverage pro Collection | exhaustive (alle 272 Rows) |
| `audit-diff-matrix.ts` | Slug-Set-Diff zwischen Repo und DB | exhaustive (alle 281 Repo-Slugs + 272 DB-Slugs) |
| `audit-categories-and-samples.ts` | Categories-Cross-Reference + 11 sample frontmatter-vs-row diffs | sample (11 von 272) |
| `audit-orphans-and-clusters.ts` | Orphaned Blog-Rows + Cluster-State-Diff | exhaustive für Orphans (10), exhaustive für distinct cluster_keys (44 DB + 46 Repo) |
| `audit-howto-state.ts` | D143-Dormancy-Check: howTo+schemaJsonLd-Verteilung | exhaustive (alle 272 Rows) |

Outputs persistiert in `apps/api/src/scripts/discovery/repo-inventory.json` + `db-inventory.json` für Re-Use.

### Code-Files gelesen

- `packages/db/src/schema/content.ts` (articles-Schema)
- `packages/db/src/schema/identity.ts` (clusters + content_pillars)
- `packages/db/src/schema/categories.ts` (content_categories)
- `packages/db/src/schema/projects.ts` (projects)
- `packages/adapters/astro-sync/src/import/pipeline.ts` (Pipeline-Step-Ordering)
- `packages/adapters/astro-sync/src/import/steps/upsert-articles.ts` (Importer-Write-Logic + Toolwiki-Domain-Guard)
- `packages/adapters/astro-sync/src/import/steps/sync-clusters-from-frontmatter.ts` (Cluster-Auto-Population)
- `packages/adapters/astro-sync/src/steps/render-mdx.ts` (D143-Schema-Write-Logic)
- `packages/adapters/astro-sync/CLAUDE.md` (Adapter-Konventionen)
- `packages/db/CLAUDE.md` (Schema-Konventionen)
- Migrations 0094 → 0100 (titles gescannt für Branch-A-Refactor-Validation)

### Konfidenz-Übersicht pro Phase

| Phase | Befund | Konfidenz |
|---|---|---|
| 1 | Toolwiki Project-ID + astro_repo Path | high |
| 1 | `allowed_collections`/`default_locale` existieren nicht | high |
| 1 | Categories-Scope-Verteilung 20+6+5=31 | high |
| 2 | Repo-File-Count per Collection | high |
| 2 | Sample-Frontmatter-Keys per Collection | medium (nur erstes File jeder Collection) |
| 3 | DB-Row-Count per Collection×Locale×Source | high |
| 3 | Field-Coverage-Stats pro Collection | high |
| 4 | Slug-Set-Diff per Collection | high |
| 4 | Klassifikation der 10 DB-only Blog-Slugs | high für Collection-Move + Slug-Rename; medium für Pure-Deletion (ohne git history nur Heuristik) |
| 4 | Sample-Frontmatter-vs-Row-Diff für 5 Files | high für die 5; **low** für extrapolation auf die 272 |
| 5 | Cluster-State-Diff | high für distinct-cluster_key-Werte; medium für Hub/Spoke-Drift-Ursachen |
| 6 | D143 Dormancy (0/272 howTo + 0/272 schemaJsonLd) | high (vollständige Zählung) |
| 6 | RenderMdxStep schreibt schemaJsonLd zurück ins MDX | high (Code-Read line 266-267) |
| 7 | Bucket-Klassifikation der Befunde | medium-high (Bucket D #1+#2 sind Verdachts-Findings, brauchen Verifikation) |
| 8 | Importer hat keinen Delete-Step | high (vollständiger Pipeline-Step-Read) |
| 8 | Refresh-Whitelist schützt category/published_at vor Re-Import | high (Spec multi-domain-evolution S1.1) |
| 9 | Empfehlung Option 2 | high (folgt logisch aus Phase 6+8 Findings) |

### Audit-Side-Effects

- **Keine DB-Writes** während des Audits (alle Scripts sind `SELECT`-only)
- **Keine Repo-Edits** während des Audits (alle Reads via `readFile`)
- 7 neue Read-Only-Scripts in `apps/api/src/scripts/discovery/` angelegt — können nach Marcel-Review entweder behalten (für zukünftige Audit-Runs) oder gelöscht werden. Empfehlung: behalten + zu einem `bun --filter @marketing-auto/api audit-toolwiki-drift` Script konsolidieren.
