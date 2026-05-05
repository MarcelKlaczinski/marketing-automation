---
slug: ki-wissensraum
language: de-DE
region: DE
pronounStyle: du
anglicismPolicy: pragmatic
humorLevel: pragmatic
schemaVersion: 1
---

# Marketing Context: KI-Wissensraum

## 1. Identity

KI-Wissensraum ist ein deutschsprachiges Wissensportal für Menschen, die KI praktisch
nutzen wollen, ohne in Hype-Marketing oder Forschungsjargon abzudriften. Wir erklären
Tools, Konzepte und Workflows so, dass Leser sie am nächsten Werktag anwenden können.

## 2. Audience

### Primary Persona

Berufstätige zwischen 25 und 50 in Wissensarbeit (Marketing, Vertrieb, Beratung,
Engineering, Selbstständigkeit). Sie hören "AI" jeden Tag, haben ChatGPT mal benutzt,
wollen aber jetzt **systematisch** verstehen, was geht und was nicht. Ihre Schmerzen:
zu viel Marketing-Geschwafel, zu wenig konkrete Beispiele, zu viele "Top 10 AI Tools"-
Listicles ohne eigene Erfahrung.

### Audience NOT-list

- Nicht für ML-Forscher, die paper-level depth wollen
- Nicht für Komplett-Anfänger, die nicht wissen, was ein LLM ist (separate Glossar-Seiten ja, Cluster-Inhalte nein)
- Nicht für reine Hype-Konsumenten, die nur "mind-blowing" Tool-Showcases wollen

## 3. Voice & Tone

### Voice

- Sachkundig, aber nie überheblich
- Pragmatisch — Fokus auf "kann ich morgen anwenden"
- Skeptisch gegenüber Hype, ohne zynisch zu werden
- Erste Person erlaubt, wenn aus eigener Erfahrung berichtet wird ("Bei meinen Tests…")
- Direkter Ton, kurze Sätze bevorzugt, aber nicht erzwungen

### Tone Range

- Tutorials: ruhiger, schrittweiser Ton, mehr "wir gehen das gemeinsam durch"
- Tool-Reviews: bewertend, mit klarer Empfehlung am Ende
- Konzept-Erklärungen: aufbauend, von einfach zu komplex
- Meinungsstücke (selten): scharf, mit Belegen

### Pronoun Style

Du-Form. Ausnahme: in formelleren Kontexten (z. B. Whitepaper-artige Inhalte) Sie-Form
explizit erlaubt, aber als Abweichung dokumentieren.

### Forbidden Phrases

- "In der heutigen schnelllebigen Welt"
- "Es ist wichtig zu beachten, dass"
- "revolutionär" / "Game-changer" — nur erlaubt mit Beleg, sonst raus
- "der heilige Gral" — nie
- "Synergie", "leverage", "deep dive" als deutsche Anglizismen
- "ChatGPT & Co." — zu lieblos, alternative Tools beim Namen nennen
- Reines Adjektiv-Stacking ohne Substanz ("intuitiv, einfach, leistungsstark")

### Signature Phrases

- "Das funktioniert in der Praxis so:" (Übergang zu konkretem Beispiel)
- "Was ich aus eigenen Tests gelernt habe:" (First-Hand-Marker)
- "Worauf du achten solltest:" (Caveat-Marker)

### Anglicism Policy

pragmatic — Fachbegriffe wie "Prompt", "Token", "Embedding", "Fine-Tuning" werden
unübersetzt verwendet, weil sie in der deutschen KI-Community Standard sind. Kein
gewaltsames Eindeutschen ("Spitzenwert" für Token). Aber: keine Anglizismen aus dem
Marketing-Sprech, wo deutsche Wörter natürlicher klingen.

## 4. Pillars

(initial draft — wird in Spec 14 verfeinert)

1. **Tools praktisch**
   - Why: Konkrete Tool-Reviews mit eigener Erfahrung, nicht Marketing-Copy
   - In scope: Reviews einzelner Tools, Vergleiche, Workflow-Integration
   - Out of scope: reine Newsmeldungen, Affiliate-Listicles ohne Substanz

2. **Konzepte verstehen**
   - Why: Mentale Modelle, mit denen man neue Tools schnell einordnen kann
   - In scope: Was ist ein Transformer / Embedding / Agent? Wie funktioniert RAG?
   - Out of scope: Mathematische Tiefe, Paper-Reviews

3. **Workflows automatisieren**
   - Why: Konkrete Anleitungen, wie KI in echte Arbeitsprozesse integriert wird
   - In scope: Step-by-Step-Anleitungen mit Beispielen, Templates
   - Out of scope: Generische "Productivity Hacks"

4. **Branchen-Anwendungen**
   - Why: Wie KI in spezifischen Berufen aussieht
   - In scope: Marketing, Vertrieb, Beratung, kreative Berufe
   - Out of scope: Branchenfremde Spekulationen

5. **Ethik & Grenzen**
   - Why: Realistische Einordnung, wo KI versagt und welche Risiken bestehen
   - In scope: Halluzinationen, Bias, Datenschutz, urheberrechtliche Fragen
   - Out of scope: Doomerism, Existenz-Risiko-Diskussionen

## 5. Cluster Strategy

Cluster sind tightly scoped: ein Konzept oder eine Tool-Kategorie pro Cluster. Jeder
Cluster hat genau einen Cornerstone-Artikel (umfassend, ~3000 Wörter) und 5-10 Satellite-
Artikel (fokussiert, ~1500 Wörter). Satellites verlinken auf den Cornerstone und mindestens
einen Querverweis-Cluster. Cornerstone-Artikel werden alle 6 Monate aktualisiert.

## 6. Differentiation

Konkurrenz im DACH-Raum:
- **horstmar.de**: stark in News, schwach in Tutorials
- **ki.expert**: gute Konzept-Erklärungen, aber zu akademisch, wenig Praxis
- **allaboutai.de**: viel Affiliate-Content, wenig Eigentests

Unsere Unterscheidung: **Praxisnähe mit erkennbarer eigener Stimme**. Jeder Artikel
hat mindestens eine Beobachtung "wir haben das selbst getestet, hier ist was rausgekommen".

## 7. Monetization Posture

- AdSense: aktiviert, aber dezente Platzierung — keine Auto-Ads im Lesefluss
- Affiliate: ja, aber **nur Tools, die wir selbst benutzt haben**, mit klarer Kennzeichnung
- Eigene Produkte (langfristig): denkbar, nicht Phase 1
- Newsletter: ja, mit ehrlicher CTA, nicht "Geheimtipps die niemand kennt!!"

Disclosure: jeder Affiliate-Link wird im Fließtext als solcher markiert (deutsches
Recht: ausreichend gekennzeichnet ist Pflicht). Keine versteckten Promotions.

## 8. Quality Floors

Jeder Artikel muss erfüllen:

- [ ] Mindestens **eine** First-Hand-Beobachtung ("Bei meinem Test…", "In der Praxis zeigte sich…")
- [ ] Mindestens **ein** Original-Datenpunkt (selbsterstellte Vergleichstabelle, Screenshot mit Annotation, eigene Recherche-Zahl)
- [ ] Mindestens **ein** custom Visual (Diagramm, beschrifteter Screenshot, Hero-Bild reicht NICHT)
- [ ] Author ist namentlich auf der Seite
- [ ] Schema.org Article-Markup vollständig
- [ ] Mindestens **ein** interner Link zu einem inhaltlich nahen Artikel
- [ ] Keine reine Synthese aus Wikipedia + ChatGPT — wenn der Text in 5 Minuten von einem LLM aus öffentlichen Quellen rekonstruiert werden könnte, fehlt etwas
