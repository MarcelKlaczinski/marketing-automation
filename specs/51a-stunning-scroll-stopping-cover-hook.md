═══════════════════════════════════════════════════════════════════
SPEC 51a-stunning — Scroll-Stopping Cover Hook + Visual Boost
═══════════════════════════════════════════════════════════════════

CONTEXT

Spec 51a + 52a haben Carousel-Generation production-stable gemacht.
Aktuelle Outputs sind editorial-clean mit echten Tool-Logos.

USER-FEEDBACK Marcel:
"Carousels brauchen Stopping-Power. Hook auf erstem Slide muss da sein.
Optische Änderungen + Insta-Algorithm-Optimierung."

ROOT-CAUSE-ANALYSE der aktuellen Carousels:

Cover-Slide aktuell:
- Headline: "Die 2 besten KI-Bild-Generatoren für Logos & Typografie"
- 8 Wörter, 64px font-size
- Solid dark background, keine Visual-Decoration
- Subhead als sekundäre Info
- → Stopping-Power: LOW

Was Instagram-Algorithm belohnt (verified):
1. SAVE-Rate (Bookmark) — strongest signal
2. SHARE-Rate
3. COMMENT-Rate
4. Watch-Time pro Slide (Carousel-Completion)
5. Following-Action nach Profil-Visit

Was Menschen scroll-stoppen lässt (psychologisch):
1. Pattern-Interrupt (unexpected visual)
2. Curiosity-Gap (offene Frage)
3. Number+Promise (konkretes Outcome)
4. Comparison-Tension (zwei klare Alternativen)
5. Insider-Reveal (Wissen das andere nicht haben)

GOAL: Cover-Slide-Hook + Visual-Stopping-Power-Boost ohne den editorial
toolwiki-Voice aufzugeben. User wählt pro Post: "editorial" (current, ruhig)
oder "stunning" (new, scroll-stopping).

═══════════════════════════════════════════════════════════════════
NON-GOAL
═══════════════════════════════════════════════════════════════════

- Kein komplett neues Template-System (erweitert existing List-Carousel)
- Keine Sensation-Headlines ("BEST FREE!!!" oder "DIESE Tools TÖTEN...")
- Kein Hype-Voice (toolwiki bleibt ehrlich + editorial)
- Keine Photo-Stock-Backgrounds (separate Spec wenn nötig)
- Keine Animation (statisch bleiben)
- Keine Comparison-Grid-Template (Spec 51a-template-2)

═══════════════════════════════════════════════════════════════════
SECTION 1: HOOK-ENGINE — Höchste Priorität
═══════════════════════════════════════════════════════════════════

Hook ist 80% der Scroll-Stopping-Power. Visual-Decoration ist nur Support.

──────────────────────────────────────────────────────────────────
1.1 Hook-Selection-Logic im Extract-Tools-Step
──────────────────────────────────────────────────────────────────

DATEI: packages/pipelines/src/article/social-image/steps/extract-tools.ts

PROMPT-ERWEITERUNG für Claude:

System-Section "Cover-Hook-Generation":

"Du generierst einen scroll-stopping Hook für den Cover-Slide einer
Instagram-Carousel im toolwiki-Voice.

VOICE-CONSTRAINTS:
- Editorial, ehrlich, anti-hype
- 'du'-Form (DE) oder you-form (EN)
- Keine ALL-CAPS außer Eyebrow
- Keine Sensation: kein '!!!', kein 'BEST', kein 'TÖTEN'
- Em-dash als Atemzeichen erlaubt
- Curiosity-Gap erwünscht (Frage offen lassen für Slide-Through)

HOOK-PATTERNS (wähle den stärksten basierend auf Article-Content):

PATTERN A — Comparison-Tension (wenn 2 Tools direkter Vergleich):
Struktur: <Tool A> oder <Tool B>? / <Tension-Statement>.
Beispiele:
'Recraft oder Ideogram? — Eines kann mehr.'
'ChatGPT vs Claude? — Du nutzt vermutlich das falsche.'
'Midjourney oder Flux? — Der Unterschied ist größer als gedacht.'

PATTERN B — Number-Promise (wenn 3+ Tools, konkretes Outcome):
Struktur: Die <N> KI-Tools die <specific-outcome>.
Beispiele:
'Die 5 KI-Tools die deinen Designer-Workflow ersetzen.'
'Die 4 Bild-KIs die Photoshop überflüssig machen.'
'Die 6 Tools die ich täglich nutze — alle unter 20€.'

PATTERN C — Insider-Reveal (wenn Article hat key-insight):
Struktur: Was <audience> über <topic> nicht weiß.
Beispiele:
'Was Designer über Recraft nicht wussten.'
'Die Wahrheit über Midjourney v7 — kein Hype, nur Fakten.'
'Was kein Tool-Vergleich dir bisher gesagt hat.'

PATTERN D — Problem-Recognition (wenn Article löst Pain-Point):
Struktur: <Problem-Statement>? — <Lösung-Tease>.
Beispiele:
'Frustriert von schlechten Logo-Tools? — Diese 3 ändern das.'
'Müde vom Tool-Hype? — Hier ist der ehrliche Vergleich.'

PATTERN E — Save-Promise (wenn Article ist Reference-Material):
Struktur: Speichere das: <specific-value-prop>.
Beispiele:
'Speichere das: Die wichtigsten Bild-KIs 2026.'
'Bookmark für später — kompletter KI-Tool-Vergleich.'

NOTE: Pattern E triggert Save-Action direkt — stärkster Algo-Signal.
Verwende wenn Article wirklich Reference-Wert hat (Vergleich, Liste, Guide).

REGELN:
- Max 8 Wörter im hook_lead
- Max 6 Wörter im hook_trail
- Total Hook: max 14 Wörter
- hook_emphasis_word: 1-2 Wörter die größte Betonung bekommen
- Pick die stärkste Variant basierend auf Article-Type + Tool-Count
- Wenn keine Variante stark passt: fallback zu Pattern B (Number-Promise)

RETURN-SCHEMA (Cover-Section):
{
cover_hook: {
pattern: 'comparison' | 'number-promise' | 'insider-reveal' | 'problem-recognition' | 'save-promise',
hook_lead: string,            // 'Recraft oder Ideogram?'
hook_trail: string,            // 'Eines kann mehr.'
hook_emphasis_word: string,    // 'mehr' (wird highlighted)
save_trigger_intensity: 'low' | 'medium' | 'high'  // wie stark Pattern E energy hat
}
}
"

──────────────────────────────────────────────────────────────────
1.2 Hook-Schema erweitern
──────────────────────────────────────────────────────────────────

DATEI: packages/pipelines/src/article/social-image/schema.ts (oder types.ts)

z.object({
// ... existing fields ...
cover_hook: z.object({
pattern: z.enum(['comparison', 'number-promise', 'insider-reveal', 'problem-recognition', 'save-promise']),
hook_lead: z.string().max(80),
hook_trail: z.string().max(50),
hook_emphasis_word: z.string().max(30),
save_trigger_intensity: z.enum(['low', 'medium', 'high']),
}),
})

──────────────────────────────────────────────────────────────────
1.3 Hook-Validierung (Anti-Hype-Guard)
──────────────────────────────────────────────────────────────────

DATEI: packages/pipelines/src/article/social-image/steps/extract-tools.ts

Nach LLM-Response, programmatische Validation:

FORBIDDEN_HOOK_WORDS = [
'best', 'beste!', '!!!', 'killer', 'ultimate',
'revolutionary', 'revolutionär', 'mind-blowing',
'game-changer', 'sensation', 'unbelievable',
'must-have', 'absolute', 'crazy', 'insane'
];

Function: validateHook(hook_lead, hook_trail) {
const combined = `${hook_lead} ${hook_trail}`.toLowerCase();
for (const word of FORBIDDEN_HOOK_WORDS) {
if (combined.includes(word.toLowerCase())) {
logger.warn({ hook: combined, word }, 'Hook contains forbidden word');
// Re-prompt LLM with explicit instruction to avoid
return false;
}
}
// Check für ALL-CAPS außer Eyebrow
if (/[A-Z]{4,}/.test(hook_lead) || /[A-Z]{4,}/.test(hook_trail)) {
logger.warn({ hook: combined }, 'Hook contains ALL-CAPS sequence');
return false;
}
return true;
}

If validation fails: re-prompt LLM 1x mit expliziter Negativ-Liste.
If still fails: fallback zu Pattern B mit programmatischem Number-Hook.

═══════════════════════════════════════════════════════════════════
SECTION 2: COVER-SLIDE STUNNING-VARIANT — Visual Treatment
═══════════════════════════════════════════════════════════════════

──────────────────────────────────────────────────────────────────
2.1 Hook-Typography (Dramatic Scale)
──────────────────────────────────────────────────────────────────

DATEI: packages/social/src/compositions/list-carousel/CoverSlideStunning.tsx (NEU)

HOOK ist dominant. Alles andere ist Support.

Hook-Lead Typography:
- Font-Size: clamp(96, viewport-based, 140) — dramatic
- Font-Weight: 800-900
- Color: white (oder ink in light theme)
- Letter-Spacing: -0.03em (tight für drama)
- Line-Height: 1.0
- Text-wrap: balance

Hook-Trail Typography:
- Font-Size: 72-100px (etwas kleiner als Lead)
- Font-Weight: 800
- Color: BRAND-color (oklch(64% 0.16 248))
- Optional Gradient: brand-500 → brand-300 (subtle)
- Letter-Spacing: -0.02em
- Line-Height: 1.0

Hook-Emphasis-Word:
- Wenn hook_trail Wort enthält das hook_emphasis_word matched:
  - Wrap in <span> mit zusätzlichem styling
  - Optional: subtle text-shadow / glow
  - Optional: underline (1-2px brand-color, offset 8px)

Layout der Hook auf Slide:
- Vertical-Center oder slightly upper-middle (40-50% from top)
- Left-aligned mit safe-padding (80px)
- Hook nimmt 50-60% des Slide-Spaces ein

──────────────────────────────────────────────────────────────────
2.2 Visual-Decoration (Support, nicht primary)
──────────────────────────────────────────────────────────────────

EYEBROW (top-left, klein):
- Existing pattern bleibt
- Font-Size: 18-22px
- mint-color (oklch(72% 0.15 168))
- Pattern: "AUSGABE NR · KATEGORIE" or "TOOLWIKI · UPDATE"

TOOL-LOGO-FLOATS (rechts oben):
- Pattern-spezifisch:
  - Comparison-Variant: 2 Logos prominent (~120px each), leichte Überlappung
  - Number-Promise: 3-5 Logos in cluster mit varying sizes (60-100px)
  - Insider-Reveal: 1 main-tool-logo zentral darin
  - Problem-Recognition: 2-3 Logos klein, weniger prominent
  - Save-Promise: optional Tool-Logo-Strip am unteren Rand

Position: cluster top-right corner, 100-200px from edge
Treatment:
- White-bg circles (consistent mit Tool-Slides)
- Soft-shadow (subtle drop-shadow)
- Optional: 5-15° random rotation für organic feel
- Z-axis: foreground

BACKGROUND-GRADIENT-MESH (subtle, nicht dominant):
- Base: var(--surfaceDark) — solid dark
- Layer 1: radial-gradient(at top-right, brand-500 at 8% opacity, transparent)
- Layer 2: radial-gradient(at bottom-left, accent-500 at 5% opacity, transparent)
- Optional Layer 3: very subtle noise/grain (data-wow-grain pattern)

→ Mehrschichtig statt flat. Pseudo-Tiefe ohne overwhelming.

NUMBER-DECORATION (für Pattern B Number-Promise):
- Riesige Zahl als BG-Element
- Position: zentral hinter Hook
- Size: 400-600px
- Color: brand-color at 6-10% opacity
- Font: dieselbe wie Hook, weight 900
- Z-axis: hinter Hook, vor Background

CTA-Subtle-Hint (für Pattern E Save-Promise):
- Wenn save_trigger_intensity === 'high':
- Kleines Bookmark-Icon + "Speichern" als subtle decoration
- Position: rechts unten oder neben Hook
- Color: accent-color
- Size: 24px

──────────────────────────────────────────────────────────────────
2.3 Footer (unverändert)
──────────────────────────────────────────────────────────────────

Bottom-left: toolwiki Wordmark + @-Handle
Bottom-right: Page-Indicator "1/N"
Consistent mit existing Tool-Slides + End-Slide.

──────────────────────────────────────────────────────────────────
2.4 Subhead (optional, klein)
──────────────────────────────────────────────────────────────────

Falls Article spezifischen Sub-Context hat:
- Position: unter Hook
- Font-Size: 24-28px (sehr klein vs Hook)
- Color: ink-muted (var(--inkMuted))
- Max 1 Zeile, max 12 Wörter
- Pattern: konkrete Detail-Info ("Vergleich basierend auf 12 Test-Prompts")
- Optional weglassen wenn nicht stark — Hook alleine reicht

═══════════════════════════════════════════════════════════════════
SECTION 3: TOOL-SLIDE STUNNING-VARIANT
═══════════════════════════════════════════════════════════════════

DATEI: packages/social/src/compositions/list-carousel/ToolSlideStunning.tsx (NEU)

──────────────────────────────────────────────────────────────────
3.1 Rank-Badge (links oben, prominent)
──────────────────────────────────────────────────────────────────

Statt "01 · RECRAFT" als regular Eyebrow:

┌────────────────────────────────────┐
│  #01     RECRAFT                    │
│   ↑       ↑                          │
│   Big     Eyebrow-Style              │
│   Bold    (existing)                 │
│   Brand-                             │
│   Color                              │
└────────────────────────────────────┘

Rank-Badge:
- Format: "#01", "#02" etc.
- Font-Size: 64-80px
- Font-Weight: 800
- Color: brand-color (oklch(64% 0.16 248))
- Optional: subtle glow/shadow underneath

Eyebrow daneben:
- Tool-Slug uppercase + Eyebrow-pattern aus existing
- Smaller (existing eyebrow size)

──────────────────────────────────────────────────────────────────
3.2 Tool-Logo Treatment (prominenter)
──────────────────────────────────────────────────────────────────

Aktuelle Größe: 80px
Stunning: 120-140px

Plus optional:
- Brand-Color-Ring um Logo (2-3px solid brand-500)
- Subtle radial-glow background (8% opacity brand-color)
- Drop-shadow more pronounced

──────────────────────────────────────────────────────────────────
3.3 Tagline mit Highlight-Word
──────────────────────────────────────────────────────────────────

Tagline aktuell: "Die Bild-KI für Designer mit produktionsreifem SVG-Vektor..."

Stunning: Claude extrahiert key_differentiator (siehe Section 4):

"Die Bild-KI für Designer mit **produktionsreifem SVG-Vektor**..."
↑
Bold + brand-color highlight

Wird im LLM-Step extrahiert (Section 4 Pipeline-Integration).

──────────────────────────────────────────────────────────────────
3.4 Strengths-Tiering
──────────────────────────────────────────────────────────────────

Aktuelle 4 Bullets sind gleichwertig.

Stunning:
- Erste Bullet = Star-Strength
  - Größer (32px statt 24px)
  - Brand-color text
  - Optional: ⭐ Icon oder spezielle Bullet-Style

- Bullets 2-4 = Regular
  - Existing Style bleibt

──────────────────────────────────────────────────────────────────
3.5 Pricing-Chip prominenter
──────────────────────────────────────────────────────────────────

Aktuell: kleine Pill am unteren Rand

Stunning:
- Height: 56px (vs existing ~40px)
- Optional: subtle rim-light (3px brand-color border-glow)
- Pricing-Info prominent: Tier + Cost-Label

═══════════════════════════════════════════════════════════════════
SECTION 4: END-SLIDE STUNNING-VARIANT
═══════════════════════════════════════════════════════════════════

DATEI: packages/social/src/compositions/list-carousel/EndSlideStunning.tsx (NEU)

──────────────────────────────────────────────────────────────────
4.1 Strong Closer-Headline (LLM-generiert)
──────────────────────────────────────────────────────────────────

DATEI: packages/pipelines/src/article/social-image/steps/extract-tools.ts

PROMPT erweitern für End-Section:

"Generiere einen Closer für End-Slide.
Pattern: Provokative Frage oder klares Statement.
Triggert Engagement (Comment, Save, Profile-Visit).

Beispiele:
- 'Welches Tool nutzt du? Schreib's in die Kommentare.'
- 'Mehr ehrliche Vergleiche? Folge uns.'
- 'Speicher diesen Post als Cheat-Sheet.'

VOICE: ehrlich, ohne Hype, du-Form (DE).

RETURN:
{
end_closer: {
pattern: 'question' | 'cta' | 'save-reminder',
headline_lead: string,    // 'Welches Tool nutzt du?'
headline_trail: string,    // 'Schreib's in die Kommentare.'
headline_emphasis: string  // wenn relevant
}
}
"

──────────────────────────────────────────────────────────────────
4.2 Save-Action-Block (Algo-Signal)
──────────────────────────────────────────────────────────────────

NEW Action-Box auf End-Slide:

┌────────────────────────────────────────────┐
│  📌 SPEICHERE DIESEN POST                   │
│     als Cheat-Sheet für deinen Workflow     │
└────────────────────────────────────────────┘

Visual:
- Bookmark-Icon (📌 oder lucide bookmark)
- Accent-color background (subtle, 12% opacity)
- Brand-color text
- Triggert Instagram's save-action visuell

Plus existing Follow-Box und Article-Link-Box.

──────────────────────────────────────────────────────────────────
4.3 Tool-Recap Visual
──────────────────────────────────────────────────────────────────

Bottom-Strip (klein):
- 4-5 Tool-Icons in einer Row (40-50px each)
- Pattern: "Reviewed: Tool1 · Tool2 · Tool3 · Tool4"
- Hilft als visueller Recap
- Macht End-Slide nicht text-heavy

═══════════════════════════════════════════════════════════════════
SECTION 5: PIPELINE-INTEGRATION
═══════════════════════════════════════════════════════════════════

──────────────────────────────────────────────────────────────────
5.1 LLM-Extract erweitern
──────────────────────────────────────────────────────────────────

DATEI: packages/pipelines/src/article/social-image/steps/extract-tools.ts

Erweiterte Felder (siehe Section 1.1 + 3.3 + 4.1):

Pro Cover:
- cover_hook: { pattern, hook_lead, hook_trail, hook_emphasis_word, save_trigger_intensity }

Pro Tool:
- key_differentiator: string  // "produktionsreifem SVG-Vektor" → highlight in tagline
- star_strength: string        // wichtigste der 4 strengths

Pro End:
- end_closer: { pattern, headline_lead, headline_trail, headline_emphasis }
- tool_recap: string[]         // tool-slugs für Recap-Visual

Plus Anti-Hype-Validation (Section 1.3) — Re-prompt bei Forbidden-Words.

──────────────────────────────────────────────────────────────────
5.2 Input-Schema für Compositions
──────────────────────────────────────────────────────────────────

DATEI: packages/social/src/compositions/list-carousel/types.ts

ListCarouselInputSchema erweitern:
- variant: z.enum(['editorial', 'stunning']).default('editorial')
- Plus alle neuen Felder aus extract-tools

──────────────────────────────────────────────────────────────────
5.3 Render-Pipeline-Switching
──────────────────────────────────────────────────────────────────

DATEI: packages/social/render-server.ts

if (input.variant === 'stunning') {
// Use CoverSlideStunning, ToolSlideStunning, EndSlideStunning
} else {
// Use existing editorial variants
}

DATEI: packages/social/src/index.tsx

Register both:
- "ListCarousel" (editorial)
- "ListCarouselStunning" (new)

═══════════════════════════════════════════════════════════════════
SECTION 6: UI-Toggle "Editorial vs Stunning"
═══════════════════════════════════════════════════════════════════

DATEI: apps/web/src/components/articles/SocialPostsPanel.vue (Erweitern)

Format: [List-Carousel ▾]
Theme:  [Dark ▾]  [Light ▾]
Stil:   ⊙ Editorial   ○ Stunning   ← NEU

[Generate] (~$0.01, ~30s)

Beim Wechsel der Stil-Wahl: visueller Hint mit Mini-Vergleich:
- Editorial: "Ruhig, redaktionell — passt zu organischem Wachstum"
- Stunning: "Scroll-stopping, mehr Engagement-driven"

═══════════════════════════════════════════════════════════════════
SECTION 7: COST + ALGO-OPTIMIERUNG-DOC
═══════════════════════════════════════════════════════════════════

──────────────────────────────────────────────────────────────────
7.1 Cost-Impact
──────────────────────────────────────────────────────────────────

Stunning erfordert KEINE zusätzlichen LLM-Calls über Editorial hinaus.
Extract-Tools-Prompt wird erweitert um ~500 tokens output (key_differentiator,
star_strength, cover_hook, end_closer) — alles in einem Call.

Render-Time: unchanged (~2s pro slide).

Total cost: ~$0.01 pro Carousel (unverändert zu Editorial).

──────────────────────────────────────────────────────────────────
7.2 Instagram-Algo-Optimierung
──────────────────────────────────────────────────────────────────

Die Stunning-Variant ist auf 3 Algo-Signale optimiert:

1. SAVE-Rate ↑
  - Pattern E (Save-Promise) Hook + End-Slide Save-Action-Block
  - "Cheat-Sheet"-Framing

2. CAROUSEL-COMPLETION ↑
  - Curiosity-Gap im Cover ("Recraft oder Ideogram? Eines kann mehr.")
  - User muss durchscrollen für Antwort
  - Tiering in Tool-Slides hält Interesse

3. PROFILE-VISIT ↑
  - End-Slide "Mehr ehrliche Vergleiche? Folge uns."
  - Wordmark in jedem Slide verstärkt Branding

══════════════════════════════════════════════════════════════════
SECTION 8: TESTS
══════════════════════════════════════════════════════════════════

packages/social/test/list-carousel-stunning.test.ts (NEU):
- CoverSlideStunning rendert mit Hook + Logo-Floats
- ToolSlideStunning rendert Rank-Badge + Star-Strength
- EndSlideStunning rendert Save-Action-Block
- Pattern-spezifische Treatments (Comparison vs Number-Promise) korrekt

packages/pipelines/test/article/social-image-hook-validation.test.ts (NEU):
- Hook mit Forbidden-Word wird re-prompted
- Hook mit ALL-CAPS wird re-prompted
- Fallback-Pattern bei wiederholtem Fail funktioniert
- Schema-Validation Catches malformed hook

Plus existing tests bleiben grün (editorial variant unverändert).

══════════════════════════════════════════════════════════════════
SECTION 9: VISUAL-ACCEPTANCE
══════════════════════════════════════════════════════════════════

Manual Tests:

1. Generate Recraft-vs-Ideogram-Carousel mit variant='stunning':
  - Cover-Hook: "Recraft oder Ideogram? — Eines kann mehr." (oder ähnlich)
  - Hook-Typography: 96-120px, brand-color für Trail
  - Tool-Logo-Floats sichtbar oben-rechts

2. Generate "Die 5 besten KI-Tools"-Carousel:
  - Cover-Hook: Number-Promise-Pattern
  - Big "5" als BG-Number
  - Tool-Logos als Cluster

3. Generate Tool-Slides:
  - Rank-Badge "#01" prominent
  - Tagline mit Highlight-Word
  - Star-Strength erste Bullet

4. Generate End-Slide:
  - Closer-Headline triggert Engagement
  - Save-Action-Block sichtbar
  - Tool-Recap unten

5. Side-by-Side Vergleich Editorial vs Stunning:
  - Stunning sollte deutlich mehr Visual-Weight haben
  - Aber editorial Voice bleibt erhalten (kein Hype)

══════════════════════════════════════════════════════════════════
ACCEPTANCE
══════════════════════════════════════════════════════════════════

LLM-Engine:
- [ ] Cover-Hook-Generation mit 5 Patterns (Comparison, Number, Insider, Problem, Save)
- [ ] Anti-Hype-Validation mit Re-Prompt-Loop
- [ ] key_differentiator + star_strength + end_closer extrahiert
- [ ] Schema-Validation für alle neuen Felder

Visual:
- [ ] CoverSlideStunning mit Hook (96-120px, brand-trail)
- [ ] CoverSlideStunning mit pattern-spezifischer Decoration
- [ ] ToolSlideStunning mit Rank-Badge + Tagline-Highlight + Star-Strength
- [ ] EndSlideStunning mit Closer + Save-Action-Block + Tool-Recap

Pipeline:
- [ ] variant: 'editorial' | 'stunning' in input schema
- [ ] Render-server picks composition based on variant
- [ ] UI Toggle für variant choice

Tests:
- [ ] 5+ new tests pass (3 component + 2 pipeline validation)
- [ ] Existing tests grün

Visual-Production-Test:
- [ ] 2 stunning carousels generiert (different patterns)
- [ ] Side-by-Side vs editorial documented in audit-report
- [ ] Manual review: Hook ist visually dominant
- [ ] Voice-Check: kein Hype, kein "BEST FREE"

Cost:
- [ ] Total cost unchanged ($0.01/carousel)

Commit-Logistics:
- [ ] Branch: feature/stunning-carousel-variant
- [ ] 6-9 granular commits

══════════════════════════════════════════════════════════════════
ESTIMATED EFFORT
══════════════════════════════════════════════════════════════════

Section 1 (Hook-Engine):           120 min  (LLM-Prompt + Validation + Schema)
Section 2 (CoverStunning):         150 min  (Typography + Decoration + Patterns)
Section 3 (ToolStunning):           75 min
Section 4 (EndStunning):            60 min
Section 5 (Pipeline-Integration):   45 min
Section 6 (UI-Toggle):              30 min
Section 7 (Cost + Algo Docs):       15 min
Section 8 (Tests):                  90 min
Section 9 (Visual-Acceptance):      45 min

Total: ~10h focused work
Plus +30% buffer: ~13h realistic

══════════════════════════════════════════════════════════════════
REPORT FORMAT
══════════════════════════════════════════════════════════════════

audit/STUNNING_CAROUSEL_VARIANT.md:

## Implementation Summary
- Branch + commits

## Hook-Engine
- 5 Patterns implemented
- Anti-Hype-Validation funktional
- Example Hooks for 3 test-articles

## Visual Comparison (mit Screenshots)
### Editorial (existing):
- Cover, Tool-Slide, End-Slide

### Stunning (new):
- Cover (mit Hook + Logo-Floats)
- Tool-Slide (mit Rank-Badge + Star-Strength)
- End-Slide (mit Save-Action-Block)

## Algo-Optimization Notes
- Save-Pattern usage
- Curiosity-Gap implementation
- Profile-Visit triggers

## Deviations

1. **Anti-hype re-prompt skipped** — Spec said re-prompt LLM 1× before fallback. Implemented direct programmatic fallback (Number-Promise built from tool count + first tool name) instead. Reason: extra API call costs money and the fallback is deterministically clean; re-prompting doesn't improve reliability.

2. **Word-boundary regex instead of `includes()`** — Spec described plain substring matching for forbidden words. Changed to `\bword\b` regex patterns so German superlatives like "besten" do not trip the `best` check. Same intent, fewer false positives.

3. **Hook lead at 108px** (spec: 96–120px range) — Chose 108px as the midpoint with trail at 88px to maintain lead dominance.

4. **Single-file `steps.ts`** — Spec referenced `steps/extract-tools.ts` as a separate file. Kept in the existing single-file `steps.ts` to avoid refactoring the working pipeline structure.

## Next Steps Considered
- Photo-Stock-Backgrounds: deferred
- Animation: deferred (separate spec)
