# Diagnose — Hero-Image Quality Probleme im Article-Pipeline

**Modus: DIAGNOSE ONLY. Keine Code-Changes. ~25-30 Min.**

## Symptom (Marcel-Beobachtung 2026-05-21)

Hero-Images die über `article:draft` Pipeline generiert werden sind qualitativ schlecht:
- **Random Pseudo-Schrift im Bild** (typisches DALL-E/Ideogram Problem)
- **Nichtssagende generische Stock-Art** statt content-spezifischer Visuals
- Marcel-Vermutung: **Image-Prompt wird auf Deutsch erzeugt** obwohl Image-Models primär auf englischen Captions trainiert sind

## Hypothesen

**H1: DE-Prompt für Image-Gen**
- Article ist auf Deutsch (Toolwiki primary locale)
- Image-Prompt wird aus DE topic_title/primary_keyword gebaut
- Image-Models (DALL-E 3, Ideogram, Stable Diffusion) sind primär auf EN Captions trainiert
- Konsequenz: schlechtere Composition, ungenaue Bilder, Pseudo-Schrift

**H2: Fehlende Negative-Constraints**
- Prompt sagt nicht "no text, no letters, no typography, no signage"
- DALL-E generiert dann oft random Pseudo-Schrift weil Model nicht weiß dass es sein lassen soll
- Standard-Best-Practice in Prompt-Engineering für Image-Models

**H3: Suboptimales Model/Settings**
- DALL-E 2 statt 3? Ältere Ideogram-Version?
- Quality-Setting auf "standard" statt "hd"?
- Style-Setting auf "natural" statt "vivid"?

**H4: Prompt zu kurz/abstrakt**
- Wenn nur "AI tools" oder "Productivity" als Prompt
- Model improvisiert generisch → Stock-Art-look
- Fehlt Composition-Hints ("professional photography", "clean composition")

**H5: Prompt-Template-Default**
- Generic Prompt ohne Article-spezifischen Context
- Oder bestimmter Article-Type (cluster vs blog vs spoke) hat schlechtes Template
- Vielleicht kein LLM-Step der einen guten Image-Prompt vom Article-Content ableitet

## Diagnose-Schritte

### Schritt 1 — Image-Pipeline-Code finden

```bash
# Wo lebt die Image-Generation?
grep -rn "image.*prompt\|imagePrompt\|hero.*image\|generateImage" \
  packages/pipelines/src/ apps/api/src/

# Welche Image-API wird genutzt?
grep -rn "dalle\|dall-e\|ideogram\|stability\|imagen\|openai.images" packages/

# Image-Adapter?
ls packages/adapters/ | grep -i "image\|dalle\|ideogram"
```

**Dokumentieren:**
- Pfad der Image-Pipeline (vermutlich `packages/pipelines/src/article/blog/` oder `packages/pipelines/src/article/image-step.ts`)
- Welcher Adapter wird genutzt (openai, ideogram, stability)?
- Welches Model konkret (dalle-3, dalle-2, ideogram-v2)?

### Schritt 2 — Aktuellen Prompt-Template lesen

```bash
# Finde den exakten Prompt-Build
grep -B 5 -A 30 "image.*prompt\|prompt.*image" packages/pipelines/src/article/

# Suche nach LLM-Step der Image-Prompt generiert
grep -rn "imagePromptStep\|HeroImagePrompt\|generateImagePrompt" packages/
```

**Dokumentieren:**
- Vollständiger Prompt-Template
- Welche Variables werden interpoliert? (article.title, article.description, primary_keyword)
- Sprache des Templates (DE vs EN)?
- Gibt's einen LLM-Translation-Step vor Image-Gen?
- Negative-Constraints enthalten? ("no text", "no typography")
- Composition-Hints? ("photorealistic", "professional")

### Schritt 3 — Sample-Prompts + Generated Images

```sql
-- Welche Articles haben Hero-Images? 
SELECT 
  id, title, hero_image_url, hero_image_prompt, status, created_at
FROM articles
WHERE hero_image_url IS NOT NULL
  AND project_id = (SELECT id FROM projects WHERE slug='toolwiki')
ORDER BY created_at DESC
LIMIT 10;
```

Falls `hero_image_prompt` Spalte nicht existiert:

```sql
-- Search im JSONB falls Prompt dort gespeichert ist
SELECT 
  id, title, hero_image_url, 
  metadata->>'imagePrompt' AS image_prompt,
  metadata->>'imageModel' AS model,
  created_at
FROM articles
WHERE hero_image_url IS NOT NULL
  AND project_id = (SELECT id FROM projects WHERE slug='toolwiki')
ORDER BY created_at DESC LIMIT 10;
```

**Dokumentieren:**
- 5-10 Sample-Prompts
- Sprache jedes Prompts (DE vs EN)
- Korrelation mit hero_image_url Qualität (Marcel review)

### Schritt 4 — Image-Library Cost + Settings

```bash
# OpenAI Image-API Setup
grep -rn "model:.*dalle\|quality:\|size:.*\|style:" packages/

# Oder ähnlich für andere Provider
grep -rn "imagen-3\|ideogram-v2\|stable-diffusion-xl" packages/
```

**Dokumentieren:**
- Aktuelles Model (dalle-3, dalle-2, gpt-image-1, etc.)
- Quality-Setting (standard, hd)
- Size (1024×1024, 1792×1024 für hero)
- Style (vivid, natural)
- Cost pro Image (~$0.04 für DALL-E 3 HD 1024×1792)

### Schritt 5 — Cost-Tracking + Failure-Rate

```sql
-- Wieviele Hero-Image generation Calls gab es?
SELECT 
  COUNT(*) AS total_runs,
  SUM(cost_eur) AS total_cost,
  AVG(cost_eur) AS avg_cost_per_image,
  MIN(created_at) AS first_run,
  MAX(created_at) AS last_run
FROM cost_logs
WHERE operation LIKE '%image%' OR operation LIKE '%hero%' OR operation LIKE '%dalle%'
  AND project_id = (SELECT id FROM projects WHERE slug='toolwiki');
```

**Dokumentieren:**
- Total Images generiert
- Cost-Verteilung
- Pro Article (z.B. 1× Hero + N× inline) oder nur Hero?

### Schritt 6 — Existing Step-Konfiguration

```bash
# Image-Step Implementation
cat packages/pipelines/src/article/blog/steps/image-*.ts 2>/dev/null || \
cat packages/pipelines/src/article/blog/steps/hero-image*.ts 2>/dev/null
```

Plus:
```bash
# Wann läuft der Image-Step? Vor oder nach Article-Body-Generation?
grep -B 2 -A 5 "imageStep\|HeroImage" packages/pipelines/src/article/blog/pipeline.ts
```

**Dokumentieren:**
- Reihenfolge in Article-Pipeline
- Input zum Image-Step (nur title? oder body?)
- Output (URL + Prompt + metadata)

### Schritt 7 — Visual Sample Check

Pick 3-5 hero_image_urls aus Schritt 3 Output und prüfe:
- Liegen die im Astro-Repo (`/public/hero-images/` o.ä.)?
- Sind sie aus DB-Storage (S3, R2, Supabase)?

**Marcel Action für visuelle Verifikation:** wenn URLs zugänglich, schickt Marcel 2-3 Screenshots der schlechten Images.

Aber: Diagnose darf auch ohne visuelle Bestätigung weitergehen — die Hypothesen sind durch Prompt-Analyse + Code-Pfad bereits diagnostizierbar.

## Format der Rückmeldung

```markdown
## Image-Pipeline-Code

- Pfad: [packages/pipelines/src/...]
- Adapter: [openai/ideogram/...]
- Aktuelles Model: [dalle-3/...]
- Settings: quality=X, size=Y, style=Z

## Prompt-Template

[vollständiger Template-Text]

- Sprache: DE / EN / mixed
- LLM-Translation-Step vorhanden: ja/nein
- Negative-Constraints: [list oder "fehlt"]
- Composition-Hints: [list oder "fehlt"]
- Variable-Interpolation: [list]

## Sample-Prompts (5-10)

| Article | Prompt | Sprache | Model | Generated URL |
|---|---|---|---|---|
| ... | ... | DE/EN | dalle-3 | ... |

## Image-Step Reihenfolge

- Vor/Nach Article-Body
- Input zum Step: [list]
- Cost-Profile: ~€X pro Image

## Cost-Aggregat

- Total Images: N
- Total Cost: €X
- Avg per Image: €Y

## Diagnose

[Welche Hypothesen treffen zu? Konkrete Ursache?]

## Fix-Optionen (Skizze, KEINE Implementation)

[2-4 mögliche Fix-Pfade abhängig vom Befund]
```

## Anti-Patterns

- Image-Pipeline-Code anfassen
- Prompt-Template ändern
- Migration vorschlagen
- Existing Images regenerieren
- Bilder herunterladen oder löschen

## Hintergrund

- Phase-E Item #5: Hero-Image Quality (Mid-Priority)
- Marcel-Vermutung: DE-Prompt
- Trigger: vor Plan-Approve morgen, damit zukünftige Article-Generation gute Hero-Images bekommt
- Cost-Implikation: jedes Article hat 1 Hero-Image → bei 10 Articles/Woche × €0.04 = ~€2/Monat (überschaubar aber wasted wenn Quality schlecht)
- Article-Pipeline: cluster:full-plan triggert N Spokes → jeder Spoke hat Hero-Image
- Plus: cluster_spoke Items (64.1) auch Hero-Images

Spec-Referenzen:
- Phase-E Backlog Item #5
- Memory D140 (Pipeline-Router) — Image-Step ist nachgelagert in article:blog
