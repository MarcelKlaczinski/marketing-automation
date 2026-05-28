/**
 * Spec 65.11 — Recurring-Content / Hook-Library / End-Slide Settings i18n (DE).
 *
 * Three sibling pages live under /settings/{recurring-content,hooks,end-slides}.
 * Keys nested under `definitions.*`, `hooks.*`, `endSlides.*` so /search.ts
 * Cmd+K entries can reference them via a single path.
 */
export default {
  definitions: {
    title: "Recurring Content",
    description:
      "Wiederkehrende Carousel-Definitionen — Marcel-Definitionen, Frequenz, Format-Konfiguration und Template-Strategie.",
    empty:
      "Noch keine Definitionen — leg eine neue an, um eine wiederkehrende Carousel-Rhythmus zu starten.",
    loadError: "Definitionen konnten nicht geladen werden.",
    newDefinition: "Neue Definition",
    columns: {
      name: "Name",
      formatType: "Format",
      frequency: "Frequenz",
      nextRun: "Nächster Lauf",
      active: "Aktiv",
    },
    filters: {
      formatType: "Format-Typ filtern",
      formatTypeAll: "Alle Formate",
      includeInactive: "Inaktive einschließen",
    },
    inactiveChip: "Inaktiv",
    rowOpen: "Öffnen",

    detail: {
      title: "Definition-Detail",
      tabs: {
        config: "Konfiguration",
        history: "Verlauf",
        upcoming: "Kommende Runs",
      },
      actions: {
        toggleActivate: "Aktivieren",
        toggleDeactivate: "Deaktivieren",
        runNow: "Jetzt ausführen",
        runNowConfirm:
          "Eine zusätzliche, manuell ausgelöste Brief-Generierung. Der reguläre Zeitplan läuft weiter.",
        runNowSuccess: "Jetzt-Lauf in die Warteschlange eingereiht.",
        dryRun: "Vorschau (Dry-Run)",
        dryRunHint:
          "Dry-Run kostet so viel wie ein echter Lauf — alle LLM-Calls werden ausgeführt, aber nichts gespeichert.",
        dryRunSuccess: "Vorschau erstellt.",
        dryRunFailed: "Vorschau fehlgeschlagen.",
        sampleImage: "Sample-Bild rendern",
      },
      sampleImage: {
        title: "Preset-Vorschau (Sample-Bild)",
        description:
          "Rendert EIN NB2-Bild mit dem gewählten Preset und einer festen Editorial-Szene. Verwendet das gleiche €5/Monat-Budget wie Dry-Run.",
        presetLabel: "Preset für diesen Test",
        presetInherit: "Cascade (Definition → Projekt-Standard)",
        render: "Rendern",
        costHint: "~€0.062 pro Klick (1k nano-banana-2). Cost-tracked im dry_run Budget.",
        success: "Sample-Bild gerendert.",
        failed: "Sample-Bild fehlgeschlagen.",
        metaPreset: "Preset verwendet",
        metaCost: "Kosten (geschätzt)",
      },
      runNowDialog: {
        title: "Jetzt-Lauf bestätigen",
        message:
          "Ein zusätzlicher Brief wird sofort erstellt. Der reguläre Wochen-Zeitplan bleibt unverändert.",
      },
      dryRunResult: {
        title: "Dry-Run-Ergebnis",
        statusPersisted: "Persistiert",
        statusSkipped: "Übersprungen",
        statusPreview: "Vorschau (nicht gespeichert)",
        templateLabel: "Template",
        templateVia: "Strategie",
        endSlideLabel: "End-Slide",
        endSlideVia: "Auswahl",
        toolsLabel: "Tools",
        hookLabel: "Hook (rendered)",
        topicTitleLabel: "Topic-Titel",
        briefTextLabel: "Brief-Text",
      },
      historyEmpty: "Noch keine Runs für diese Definition.",
      historyTable: {
        runNumber: "Run #",
        createdAt: "Erstellt",
        topicTitle: "Topic",
        status: "Status",
      },
      upcomingEmpty: "Keine kommenden Runs (Definition inaktiv?).",
    },

    create: {
      title: "Neue Definition",
      titleEdit: "Definition bearbeiten",
      cancel: "Abbrechen",
      save: "Speichern",
      saving: "Speichert…",
      saveSuccess: "Definition gespeichert.",
      saveFailed: "Speichern fehlgeschlagen.",
      fields: {
        name: "Name",
        nameHint: 'z. B. "Top 5 LLMs Wochen-Vergleich"',
        formatType: "Format-Typ",
        formatTypeHint: "Bestimmt das Layout der Carousel-Slides.",
        frequency: "Frequenz",
        frequencyHint:
          'weekly, biweekly, monthly ODER ein Cron-Ausdruck (z. B. "0 9 * * 1" für jeden Montag 09:00 UTC).',
        outputTargetsArticle: "Artikel erzeugen",
        outputTargetsSocial: "Social-Carousel erzeugen",
        templateStrategy: "Template-Auswahl",
        templateStrategyHint:
          "fixed = ein konkretes Template • lru = least-recently-used • llm-picks = LLM rankt • latest = neuestes",
        fixedTemplateKey: "Festes Template (key)",
        endSlideStrategy: "End-Slide-Strategie",
        endSlideStrategyHint:
          "Aktuell nur Rotation (LRU). Wird automatisch auf den Pool angewendet, oder fällt auf die Format-Defaults zurück wenn der Pool leer ist.",
        endSlidePool: "End-Slide-Pool",
        endSlidePoolHint:
          "Mehrere End-Slide-Definitionen auswählen. Leer = Format-Defaults aus der Format-Type-Registry werden verwendet.",
        endSlidePoolPlaceholder: "End-Slides auswählen …",
        endSlidesLoadFailed: "End-Slide-Definitionen konnten nicht geladen werden",
        nextRunAt: "Erster Lauf (UTC)",
        formatConfig: "Format-Konfiguration (JSON)",
        formatConfigHint:
          "Zod-validiert per Format-Typ. Schema-Hinweise unten — copy/paste als Startpunkt.",
        isActive: "Aktiv",
      },
      formatConfigSchemaHeading: "Erwartetes Schema für dieses Format",
      formatConfigJsonInvalid: "Ungültiges JSON.",
    },

    formatType: {
      top_n_comparison: "Top-N Vergleich",
      head_to_head: "Head-to-Head",
      story_arc_clickbait: "Story-Arc (clickbait)",
      lifestyle_listicle: "Lifestyle-Listicle",
      opinion_recommendation: "Meinung & Empfehlung",
    },

    family: {
      A: "Familie A — datengetrieben",
      B: "Familie B — Hook-getrieben",
    },

    templateStrategy: {
      fixed: "Fest (fixed)",
      lru: "Least-recently-used (LRU)",
      "llm-picks": "LLM-Ranking",
      latest: "Neuestes",
    },

    endSlideStrategy: {
      rotation: "Rotation (LRU)",
    },

    endSlideOption: {
      inactive: "inaktiv",
    },
  },

  hooks: {
    title: "Hook-Bibliothek",
    description:
      "Wiederverwendbare Familie-B-Hook-Muster mit {variablen}-Platzhaltern. Die 65.5 Brief-Generatoren rotieren per LRU.",
    empty: "Noch keine Hooks für dieses Format / diese Sprache.",
    addHook: "Neuer Hook",
    languageLabel: "Sprache",
    languageDe: "Deutsch",
    languageEn: "Englisch",
    formatTypeLabel: "Format-Typ",
    columns: {
      pattern: "Muster",
      variables: "Variablen",
      usage: "Verwendungen",
      lastUsed: "Zuletzt verwendet",
      active: "Aktiv",
    },
    inactiveChip: "Inaktiv",
    edit: {
      titleCreate: "Neuer Hook",
      titleEdit: "Hook bearbeiten",
      fields: {
        formatType: "Format-Typ",
        language: "Sprache",
        pattern: "Hook-Muster",
        patternHint:
          'Verwende {variable}-Platzhalter, z. B. „Ich habe meinen {profession}-Job verloren wegen {tool}".',
        variables: "Variablen (komma-getrennt)",
        variablesHint:
          "Liste aller Platzhalter im Muster, ohne geschweifte Klammern.",
        isActive: "Aktiv",
      },
      previewHeading: "Vorschau",
      previewHint: "Mit Beispielwerten gerendert.",
      saveSuccess: "Hook gespeichert.",
      saveFailed: "Speichern fehlgeschlagen.",
      cancel: "Abbrechen",
      save: "Speichern",
    },
    samples: {
      profession: "Texter",
      tool: "Claude",
      lifeArea: "Alltag",
      persona: "Solopreneur",
      role: "Designer",
      stance: "begeistert",
      context: "im Team",
    },
  },

  endSlides: {
    title: "End-Slide-Definitionen",
    description:
      "Letzter Frame jedes Theme-65-Carousels. Pluggable Types: follow-cta, comment-to-get, link-in-bio, tag-friend, save-share-cta, swipe-up, quote-action.",
    empty: "Noch keine End-Slide-Definitionen.",
    addEndSlide: "Neuer End-Slide",
    columns: {
      name: "Name",
      type: "Typ",
      active: "Aktiv",
    },
    inactiveChip: "Inaktiv",
    typeLabel: {
      "follow-cta": "Follow-CTA",
      "comment-to-get": "Kommentar-für-Ressource",
      "link-in-bio": "Link in Bio",
      "tag-friend": "Freund taggen",
      "save-share-cta": "Speichern / Teilen",
      "swipe-up": "Swipe-up",
      "quote-action": "Zitat-Action",
    },
    edit: {
      titleCreate: "Neuer End-Slide",
      titleEdit: "End-Slide bearbeiten",
      fields: {
        name: "Name (DE / EN)",
        nameHint:
          "Admin-Label für beide UI-Sprachen. Wird je nach Login-Sprache angezeigt.",
        type: "Typ",
        typeImmutable: "(nach Erstellung nicht änderbar)",
        config: "Konfiguration (JSON)",
        configHint:
          "Zod-validiert per Typ. Texte für die gerenderten Slides als {\"de\": \"…\", \"en\": \"…\"} eintragen. Schema-Hinweise unten.",
        isActive: "Aktiv",
      },
      schemaHeading: "Erwartetes Schema für diesen Typ",
      saveSuccess: "End-Slide gespeichert.",
      saveFailed: "Speichern fehlgeschlagen.",
      nameRequiredBoth: "Bitte beide Sprachen (DE + EN) ausfüllen.",
      cancel: "Abbrechen",
      save: "Speichern",
    },
    // Spec 65.V1.5c — live React preview of the end-slide.
    preview: {
      label: "Live-Vorschau",
      themeLight: "Light",
      themeDark: "Dark",
      loading: "Vorschau wird geladen …",
      parseError: "JSON-Fehler",
      mountError: "Vorschau konnte nicht geladen werden",
      hint: "Real React-Render via lazy React import. 1080×1080 skaliert auf 360px.",
    },
  },
  // Spec 65.V1.5b — multi-page wizard for creating recurring-content definitions.
  wizard: {
    title: "Neue Recurring-Definition",
    progressLabel: "Wizard-Fortschritt",
    stepEyebrow: "Schritt {current} von {total}",
    cancelTitle: "Wizard abbrechen?",
    cancelMessage:
      "Dein Entwurf wird verworfen. Bereits eingegebene Werte gehen verloren.",
    restorePrompt:
      "Du hast einen unvollständigen Entwurf. Soll ich da weitermachen, wo du aufgehört hast?",
    restoreContinue: "Entwurf fortsetzen",
    restoreDiscard: "Entwurf verwerfen",
    steps: {
      formatType: "Format-Typ",
      config: "Konfiguration",
      schedule: "Zeitplan & Output",
      review: "Überprüfen",
    },
    formatType: {
      title: "Welcher Carousel-Typ?",
      description:
        "Wähle den Rhythmus dieser Definition. Family A liefert Daten-Vergleiche, Family B narrative Hook-Stories.",
      loadError: "Format-Typen konnten nicht geladen werden.",
      descriptions: {
        top_n_comparison: "Top N AI-Tools nebeneinander — datengetriebener Vergleich.",
        head_to_head: "Tool A vs. Tool B — Side-by-Side Showdown.",
        story_arc_clickbait: "Narrative-Arc: Setup → Konflikt → Auflösung. Klickstark.",
        lifestyle_listicle: "Lifestyle-orientiertes Ranking für einen Lebensbereich.",
        opinion_recommendation: "Pointiertes Statement + Tool-Empfehlung.",
      },
    },
    config: {
      title: "Konfiguration",
      noFormatType: "Wähle zuerst einen Format-Typ im vorherigen Schritt.",
      descriptionFallback:
        "Setze die format-spezifischen Parameter dieser Definition.",
      descriptions: {
        top_n_comparison: "Top-N + optional Kategorie / manuelle Tool-Liste.",
        head_to_head: "Die zwei zu vergleichenden Tool-Slugs.",
        story_arc_clickbait: "Profession-Pool für die Hook-Variablen-Substitution.",
        lifestyle_listicle: "Lebensbereich + Top-N für die Listicle-Ausgabe.",
        opinion_recommendation: "Standpunkt (favorisierend / kritisch / ausgewogen).",
      },
      nameLabel: "Admin-Name für diese Definition",
      namePlaceholder: "z.B. \"Top 5 AI Coding Tools (wöchentlich)\"",
      nameRequired: "Bitte einen Namen vergeben.",
      editorHint:
        "JSON-Editor (Fallback für unbekannte Format-Typen). Validierung passiert Server-side via validateFormatConfig.",
      notAnObject: "Die Konfiguration muss ein JSON-Objekt sein.",
      invalidJson: "Ungültiges JSON.",
      toolPicker: {
        noOptions: "Keine Tools gefunden. Stelle sicher, dass tools importiert sind.",
        loadError: "Tool-Liste konnte nicht geladen werden.",
      },
      topN: {
        categoryLabel: "Tool-Kategorie (Slug)",
        categoryPlaceholder: "z.B. ai-image-generation",
        categoryHint: "Kebab-case Slug aus articles.subcategory. Eingabe wird Server-side validiert.",
        topNLabel: "Anzahl Tools",
        rankingLabel: "Ranking-Quelle",
        rankingLlm: "LLM-kuratiert (Default)",
        rankingStars: "GitHub-Sterne (auto)",
        rankingManual: "Manuelle Liste",
        manualToolsLabel: "Manuelle Tool-Liste",
        manualToolsHint: "Genau {n} Tools auswählen. Reihenfolge wird beibehalten.",
        excludeRecentlyUsed: "Tools aus den letzten 4 Runs ausschließen (LRU-Diversität)",
        tierModeLabel: "Tier-Ranking-Modus (Solide · Stark · Spitze)",
        tierModeHint:
          "Datengetriebene Tier-Buckets aus tool_persona_scores. Routet zu tool-tier-ranking-Template. Pool wird auf scored + logo-having Tools gefiltert; topN wird auf 3-5 begrenzt.",
      },
      headToHead: {
        toolALabel: "Tool A",
        toolBLabel: "Tool B",
        angleLabel: "Vergleichs-Angle (optional)",
        anglePlaceholder: "z.B. Free-Tier Limits, Code-Qualität",
        angleHint: "Optional. Leer lassen → LLM wählt den besten Angle.",
        sameToolWarning: "Tool A und Tool B dürfen nicht identisch sein.",
      },
      storyArc: {
        professionPoolLabel: "Professions-Pool",
        professionPoolHint: "Berufe als Tags eingeben + Enter. LRU-Rotation über alle Runs.",
        toolLabel: "Featured Tool",
        toolHint: "Das Tool, das die narrative Disruption ausgelöst hat.",
        angleLabel: "Narrative Angle",
        angleCareerDisruption: "Karriere-Disruption (AI ersetzt mich)",
        angleProductivity: "Produktivitäts-Transformation (Tool macht mich besser)",
        angleLifestyle: "Lifestyle-Shift (Arbeitsweise / Ortsunabhängigkeit)",
        toneLabel: "Ton-Intensität",
        toneDramatic: "Dramatic (stärkere Clickbait-Sprache)",
        toneSubtle: "Subtle (zurückhaltend, SEO-sicherer)",
      },
      lifestyle: {
        lifeAreaLabel: "Lebensbereich",
        lifeAreaPlaceholder: "z.B. Studium, Familie, Solopreneur-Alltag",
        lifeAreaHint: "Freitext. Wird in den Hook-Pattern als {lifeArea} substituiert.",
        itemCountLabel: "Anzahl Items im Listicle",
        filterHeading: "Tool-Filter (optional)",
        categoryFilterLabel: "Kategorie-Slugs (Komma-separiert)",
        categoryFilterPlaceholder: "z.B. ai-image-generation, content-creation",
        categoryFilterHint: "Mehrere Kategorien Komma-getrennt. Leer lassen für alle Kategorien.",
        personaFilterLabel: "Persona-Filter",
        personaFilterPlaceholder: "z.B. solopreneur",
      },
      opinion: {
        toolLabel: "Empfohlenes Tool",
        toolHint: "Das Tool, für das der Opinion-Post wirbt.",
        stanceLabel: "Standpunkt",
        stanceEnthusiastic: "Enthusiastisch (klare Empfehlung)",
        stanceCritical: "Kritisch-aber-positiv (Flaws + lohnt sich trotzdem)",
        stanceContrarian: "Contrarian (alle sagen X, aber eigentlich Y)",
        affiliateAngleLabel: "Affiliate-Angle aktivieren (Pricing erwähnen)",
        affiliateAngleHint:
          "Wenn aktiviert, fokussiert der Brief auf Preis/Value-Prop. Sonst nur Feature-Argumentation.",
      },
    },
    schedule: {
      title: "Zeitplan & Output",
      description:
        "Wie oft soll die Definition feuern und welche Output-Targets sollen erzeugt werden?",
      frequency: "Frequenz",
      frequencyWeekly: "Wöchentlich",
      frequencyBiweekly: "Alle 2 Wochen",
      frequencyMonthly: "Monatlich",
      frequencyCustom: "Eigener Cron",
      cronLabel: "Cron-Ausdruck",
      cronPlaceholder: "0 9 * * 1   (Montags 09:00 UTC)",
      cronHint: "Standard 5-Feld oder 6-Feld Cron. Wird beim Speichern validiert.",
      outputTargets: "Output-Targets",
      outputArticle: "Artikel (Blog/Knowledge)",
      outputSocial: "Social-Carousel",
      outputRequired: "Mindestens ein Target wählen.",
      locales: "Zielsprachen",
      localeDe: "Deutsch",
      localeEn: "Englisch",
      localesRequired: "Mindestens eine Sprache wählen.",
      autoApproveLabel: "Auto-Approve",
      autoApproveInherit: "Projekt-Standard verwenden",
      autoApproveOn: "Für diese Definition aktivieren",
      autoApproveOff: "Für diese Definition deaktivieren",
      autoApproveHint:
        "Auto-approvierte Briefs überspringen plan_pending und landen direkt in der Pipeline.",
      imageStylePresetLabel: "Bild-Stil Preset (Override)",
      imageStylePresetInherit: "Projekt-Standard verwenden",
      imageStylePresetOptions: {
        "dark-neon-grid": "Dark Neon Grid",
        "light-editorial": "Light Editorial",
        "blue-tech-gradient": "Blue Tech Gradient",
      },
      imageStylePresetHint:
        "Überschreibt den Projekt-Default für die NB2-Bilder dieser Definition. Lifestyle nutzt photographic statt NB2.",
    },
    review: {
      title: "Definition überprüfen",
      description:
        "Letzter Check, bevor die Definition aktiv wird. Du kannst sie jederzeit später deaktivieren.",
      name: "Name",
      formatType: "Format-Typ",
      frequency: "Frequenz",
      outputTargets: "Output",
      locales: "Sprachen",
      autoApprove: "Auto-Approve",
      imageStylePreset: "Bild-Stil",
      config: "Konfiguration",
      create: "Definition erstellen",
      createSuccess: "Definition erstellt.",
      createError: "Definition konnte nicht erstellt werden.",
    },
  },
};
