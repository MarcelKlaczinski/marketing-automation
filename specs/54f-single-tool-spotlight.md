# Spec 54f — single-tool-spotlight Template + Authoring-Doku

**Type:** New Template + Documentation
**Estimate:** 3-4h, 3-4 commits
**Depends on:** Spec 54a (TemplateRegistry), 54c (Discovery-Pipeline), 54d/54e (Preview-Gallery)
**Goal:** Drittes Carousel-Template — schaltet 108 Tool-Articles für Social-Content frei. Plus: Authoring-Doku in `CLAUDE.md` des Templates-Package, aus dem Bau-Prozess destilliert.

---

## Context

Die TemplateRegistry hat aktuell zwei Templates: `comparison-stunning` und `use-case-verdict-per-tool`. Beide bedienen die `comparisons`-Collection (22 Articles). Die größte ungenutzte Article-Gruppe sind die **108 Tool-Articles** (`collection: tools`) — kurzer Body (~212 Wörter), aber reichhaltiges Frontmatter (`pros`, `cons`, `rating`, `pricing`, `priceFrom`, `features`, `useCases`, `website`, `affiliateSlug`).

`single-tool-spotlight` ist das Template das diese Articles ausspielt. Es wird aus reinem Frontmatter gerendert — kein Body-Parsing nötig.

Zusätzlich: dies ist das **erste Template das nach den beiden Referenz-Templates gebaut wird**. Der Bau-Prozess soll eine wiederverwendbare Authoring-Doku produzieren (`packages/social/.../templates/CLAUDE.md`), damit jedes weitere Template (news-slide, concept-explainer-deck, ...) schneller und konsistenter entsteht.

---

## Teil A: single-tool-spotlight Template bauen

### A.1 — TemplateConstraints

Das Template muss einen machine-checkable Constraints-Block deklarieren — gleiche Disziplin wie die bestehenden Templates, die z.B. `useCaseVerdicts`-Bounds prüfen. Der Constraints-Block ist die formalisierte Antwort auf "wofür kann das Template verwendet werden" und verhindert Layout-Breaks durch schlechten Input.

```typescript
const SINGLE_TOOL_SPOTLIGHT_CONSTRAINTS = {
  minTools: 1,
  maxTools: 1,                        // genau ein Tool — das ist der Punkt
  minSlides: 4,
  maxSlides: 5,
  eligibleContainerForms: ['single-tool-deep-dive'],
  requiredFrontmatterFields: [
    'pros',          // mind. 2 Einträge — siehe fieldBounds
    'pricing',       // oder pricingTier
  ],
  fieldBounds: {
    pros:     { minItems: 2, maxItems: 5 },   // mehr als 5 sprengt die Stärken-Slide
    cons:     { minItems: 0, maxItems: 4 },
    features: { minItems: 0, maxItems: 6 },
    useCases: { minItems: 1, maxItems: 4 },   // treibt die "Für wen"-Slide
  },
  textConstraints: {
    coverHook:      { maxWords: 7 },
    strengthBullet: { maxChars: 60 },
    useCaseLabel:   { maxChars: 40 },
  },
};
```

Das Eligibility-Predicate prüft **jeden** dieser Werte. Tool-Article ohne `pros` oder mit nur 1 `pro` → `eligible: false` mit klarem `reason`. Das verhindert dass die Stärken-Slide leer rendert. Slide-Count-Math muss aufgehen: 4 fixe Slides + optional 1 → maxSlides 5, weit unter Instagrams 10-Limit, kein Konflikt.

### A.2 — Slide-Struktur

4 Slides Default, 5 wenn genug Content für eine separate Use-Case-Slide. Das **visuelle Layout-Design macht Claude Code CI-konform** (siehe A.3) — diese Spec gibt nur die strukturelle Gliederung und die wiederzuverwendenden Elemente vor.

**Slide 1 — Cover**
- Eyebrow (z.B. "KI-TOOL IM CHECK · {YEAR}", oder aus `category` abgeleitet)
- Hook: superlative- oder identity-pattern mit single-word color-highlight — gleiche Hook-Mechanik und Highlight-Rendering wie bei `comparison-stunning` (color-only, kein Underline)
- Tool-Logo **prominent** — größer als auf dem Comparison-Cover, weil hier nur ein Tool da ist und es der zentrale visuelle Anker ist
- Subline: 1 Zeile, was das Tool im Kern macht
- Promise-Block mit Mint-Accent-Bar — dasselbe Element wie auf dem Comparison-Cover
- Footer + Page-Indicator

**Slide 2 — Stärken**
- Bis zu 3 Kern-Stärken aus `pros` / `features` — erste Stärke highlighted, Rest als Bullets (gleiches Pattern wie die Tool-Slide in `comparison-stunning`)
- Rating-Anzeige falls `rating` im Frontmatter vorhanden
- Tool-Name + kleines Logo als Kontext-Anker oben

**Slide 3 — Pricing & Für-wen**
- Pricing-Badge mit der disambiguierten Logik aus `comparison-stunning`: `freemium` → "Freemium · Pro ab X", `paid` → "Kostenpflichtig · ab X", `free` → "Kostenlos", `enterprise` → "Enterprise · auf Anfrage"
- "Perfekt für"-Block: die `useCases` als kurze Liste — wofür eignet sich das Tool konkret

**Slide 4 — End / CTA**
- Save-Action-Block ("Speichere diesen Post …") — dasselbe Pattern wie die End-Slide von `comparison-stunning`
- Link auf den vollständigen Article
- Optional: dezenter Hinweis auf `website` / Affiliate (falls `affiliateSlug` vorhanden — aber zurückhaltend, nicht werblich)

**Slide 5 (optional) — Use-Case-Detail**
- Nur wenn `useCases.length >= 3`: eine eigene Slide die 3-4 Use-Cases ausführlicher zeigt statt sie auf Slide 3 zu quetschen
- Wenn `useCases.length < 3`: diese Slide entfällt, Carousel hat 4 Slides

### A.3 — CI-konformes Layout-Design (Claude Code)

Das strukturelle Gerüst steht in A.2. Das **visuelle Design macht Claude Code** — aber strikt CI-konform. Das heißt konkret:

**Wiederverwenden, nicht neu erfinden:**
- Farben **ausschließlich** über den bestehenden Theme-Adapter (`getCoverColors` o.ä.) — kein einziger neuer Hex-Wert
- Spacing und Font-Größen aus den bestehenden Layout-Konstanten ableiten — wenn das Template eigene Konstanten braucht, von der bestehenden Skala ableiten, nicht frei erfinden
- Typografie wie etabliert: Inter, die bestehenden Weights (Hooks 800, Highlights 900, Body 400)
- Highlights color-only, kein Underline — das war ein bewusster Fix, nicht regredieren
- Standard-Footer-Pattern: `toolwiki.ai` / `@handle` / Page-Indicator
- Tool-Logo-Einbindung über denselben Mechanismus wie bei den bestehenden Templates (Asset-Library / Logo-Resolution mit DB-Cache) — inklusive Fallback-Verhalten wenn ein Tool kein Logo hat

**Theme-Parität ist Pflicht:** Jede Slide muss in `dark` UND `light` (= weiß, nicht cream) sauber rendern. Der Theme-Adapter macht den Color-Swap, die Komponente konsumiert nur dessen Output.

**Neue Slide-Typen aus bestehenden Primitives bauen:** Falls eine Slide ein Element braucht das die bestehenden Templates nicht haben (z.B. eine Rating-Anzeige), aus den vorhandenen Primitiven zusammensetzen — neue Komposition, gleiche Tokens.

Das Ziel: Ein Nutzer der ein `single-tool-spotlight`-Carousel neben ein `comparison-stunning`-Carousel legt, soll sie sofort als zur selben Marke gehörig erkennen. Andere Struktur, identische visuelle Sprache.

### A.4 — Template-Definition & Integration

Folge der exakten Shape der bestehenden Template-Definitionen:

- `key: 'single-tool-spotlight'` — zur `TemplateKey`-Union in `types.ts` hinzufügen
- `eligibility`: pure, deterministisch, prüft alle Constraints aus A.1
- `buildInput`: **async** (Frontmatter-Adapter macht DB-Lookups) — nutzt den `tools`-Collection-Adapter (`getToolContext` o.ä., analog zu `getComparisonContext`)
- `render`: konsumiert `context.brandTokens ?? DEFAULT_BRAND_TOKENS`, baut die Slides via Remotion
- `mockFixtures`: siehe A.5
- In `bootstrap.ts` registrieren

### A.5 — Mock-Fixtures

3 hardcodierte Fixtures für die Preview-Gallery — deterministisch, damit Layout-Iteration ohne Input-Rauschen möglich ist:

- **`characteristic`** — ein bekanntes Tool mit vollem Frontmatter (z.B. ChatGPT oder Midjourney): alle Felder befüllt, 4-5 `pros`, `useCases`, Pricing
- **`edge-min`** — Minimum-Input: genau 2 `pros`, 1 `useCase`, minimale Pricing-Info — beweist dass das 4-Slide-Layout auch mit wenig Content intentional aussieht
- **`edge-max`** — Maximum-Input: 5 `pros`, 6 `features`, 4 `useCases`, längste Texte die die `textConstraints` noch erlauben — beweist dass das Ceiling hält und nichts überläuft

---

## Teil B: Authoring-Doku in CLAUDE.md schreiben

Während Teil A gebaut wird, entstehen Erkenntnisse darüber wie ein Template technisch aufgebaut sein muss um CI-konform und bruchsicher zu sein. Diese Erkenntnisse werden **am Ende** in `packages/social/.../templates/CLAUDE.md` destilliert — als Anleitung für jedes weitere Template.

Die Datei soll knapp und praktisch sein (kein Roman), und mindestens diese Punkte abdecken:

### B.1 — Was beim Bau eines neuen Templates zu beachten ist

**Brand-Anker (wiederverwenden, nicht neu erfinden):**
- Welche Dateien sind die Single-Source-of-Truth fürs Visuelle (Theme-Adapter, Layout-Konstanten) — mit konkreten Pfaden
- Welche Elemente sind bereits als Primitives da und sollen wiederverwendet werden (Promise-Block, Pricing-Badge, Save-Action-Block, Hook-Renderer, Footer, Tool-Logo-Component)
- Verbotene Drift: keine neuen Hex-Werte, keine frei erfundenen Font-Größen/Spacings

**Logo- & Asset-Handling:**
- Wie Tool-Logos technisch eingebunden werden (Asset-Library, DB-Cache, Resolution-Pfad)
- Wie der Fallback aussieht wenn ein Tool kein Logo hat
- Welche Bildformate/Größen erwartet werden

**Der Template-Contract:**
- `TemplateDefinition`-Shape: welche Felder Pflicht sind
- `TemplateConstraints` ist Pflicht — warum (Layout-Break-Schutz), und dass die Slide-Count-Math gegen Instagrams 10-Limit aufgehen muss
- `eligibility` ist ein Hard Gate, kein Präferenz-Score — prüft jede Constraint
- `buildInput` ist **async** — Grund nennen (DB-Lookups in Adaptern)
- `key` muss in die `TemplateKey`-Union — sonst Registry-unsichtbar / wird von der Discovery-Pipeline als Halluzination gefiltert
- In `bootstrap.ts` registrieren

**Theme-Parität:**
- Jede Slide muss dark + light können, light ist weiß (nicht cream)
- Der Theme-Adapter macht den Swap, die Komponente konsumiert nur

**Mock-Fixtures:**
- Min-Case + Max-Case sind Pflicht — sie beweisen dass die Constraints halten

**Acceptance:**
- Visual Render in der Preview-Gallery, beide Themes, alle Fixtures — nicht "Unit-Tests grün"
- Eligibility gegen einen echten eligiblen + einen nicht-eligiblen Article testen

### B.2 — Stolperfallen aus diesem und vorherigen Templates

Sammle die konkreten Gotchas die beim Bau auftauchen — z.B. (Beispiele, tatsächliche Liste ergibt sich aus dem Bau):
- `exactOptionalPropertyTypes`-Verhalten bei optionalen Frontmatter-Feldern
- Workspace-/Import-Eigenheiten zwischen den Packages
- Remotion-Composition-Quirks (Dimensionen, Font-Loading)
- Frontmatter-Inkonsistenzen zwischen Articles derselben Collection und wie das Eligibility-Predicate damit umgeht

CLAUDE.md soll am Ende so sein, dass das nächste Template (`news-slide`) gebaut werden kann ohne dass jemand die zwei alten Templates erst komplett reverse-engineeren muss.

---

## Commit-Reihenfolge

```
1. Constraints + Definition + Eligibility + buildInput      ~1h    commit 1
2. Slide-Components + CI-Layout-Design (beide Themes)        ~1.5h  commit 2
3. Mock-Fixtures + Registry-Registrierung + Render-Verify    ~45min commit 3
4. CLAUDE.md Authoring-Doku                                  ~30min commit 4
```

---

## Acceptance

- [ ] `single-tool-spotlight` ist in der TemplateRegistry registriert
- [ ] Eligibility akzeptiert einen echten Tool-Article mit vollem Frontmatter, lehnt einen mit < 2 `pros` ab
- [ ] Alle 3 Mock-Fixtures rendern in dark UND light ohne Layout-Break
- [ ] `edge-min`-Fixture sieht intentional aus, nicht leer
- [ ] `edge-max`-Fixture hat keinen Text-Overflow, kein Clipping
- [ ] Ein `single-tool-spotlight`-Carousel neben einem `comparison-stunning`-Carousel ist visuell klar als dieselbe Marke erkennbar
- [ ] Tool-Logo wird korrekt eingebunden, Fallback funktioniert bei einem Tool ohne Logo
- [ ] PNG-Screenshots beider Themes im PR
- [ ] `packages/social/.../templates/CLAUDE.md` existiert und deckt B.1 + B.2 ab

---

## Deviations from Spec

**1. `enterprise` pricing tier mapped to `"paid"`, not `"Enterprise · auf Anfrage"`**
The spec (A.3) described `enterprise` → `"Enterprise · auf Anfrage"`. In practice, `PricingChip` only accepts `"free" | "freemium" | "paid"`. Enterprise tools in our DB typically have a `priceFrom` price, so mapping enterprise → paid and showing the price-from value is more accurate than a static "auf Anfrage" label. The `PricingForWhomSlide` recomputes the label locally from `pricingTier + priceFrom` rather than accepting a pre-built string.

**2. `useCases.minItems` set to 0, not 1**
The spec declared `useCases: { minItems: 1, maxItems: 4 }`. The implementation uses `minItems: 0` — a tool article with zero use cases is eligible; the "Perfekt für" block is simply hidden. Enforcing minItems: 1 would reject valid tool articles that describe use cases in prose rather than a structured list. The layout handles the empty case correctly.

**3. `buildPricingLabel()` helper removed**
The spec implied a shared pricing-label builder. During implementation, each slide (`PricingForWhomSlide`) computed the label locally. A shared `buildPricingLabel()` was added to the template definition but found to be dead code during code review (Zod stripped it silently). It was removed; the local computation in each slide is the canonical approach.

---

## Out of Scope

- ⏸️ news-slide, concept-explainer-deck — Folge-Specs, profitieren von der CLAUDE.md aus dieser Spec
- ⏸️ Affiliate-Link-Prominenz / werbliche Elemente — bewusst zurückhaltend in dieser Spec
- ⏸️ Multi-Locale-Rendering-Optimierung — bestehender Mechanismus reicht
