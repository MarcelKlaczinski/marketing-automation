export default {
  tabs: {
    generated: "Generiert",
    imported: "Importiert",
  },

  templateSuggestions: {
    empty: "Keine Template-Vorschläge. Artikel importieren oder Gap fixen.",
    generateAll: "Alle generieren",
    generateSelected: "Auswahl generieren",
    queued: "{n} Render-Job(s) gestartet",
    status: {
      pending: "Ausstehend",
      rendering: "Wird gerendert",
      ready: "Fertig",
      failed: "Fehlgeschlagen",
    },
  },

  discoveryGate: {
    title: "Discovery für importierte Artikel",
    subtitle: "Import abgeschlossen. {count} Artikel benötigen Discovery-Update.",
    new: "Neu importiert",
    updated: "Aktualisiert",
    unchanged: "Unverändert (übersprungen)",
    costEstimate: "Geschätzter Cost: ~${cost} (Haiku LLM-Klassifikation)",
    skipBtn: "Später",
    deterministicBtn: "Nur deterministisch",
    fullBtn: "Discovery starten",
    triggered: "Discovery-Jobs wurden gestartet",
  },

  imported: {
    syncFromRepo: "Vom Repo importieren",
    syncStarted: "Import wurde gestartet",
    syncCompleted: "Import abgeschlossen",
    loading: "Lädt...",
    noData: "Noch keine importierten Artikel. Klicke 'Vom Repo importieren' um zu starten.",
    noPendant: "kein Gegenstück",
    noDeVersion: "Keine DE-Version",
    noEnVersion: "Keine EN-Version",
    collections: {
      blog: "Blog",
      "ki-wissen": "KI-Wissen",
      comparisons: "Vergleiche",
      usecases: "Use-Cases",
      tools: "Tools",
      "tool-categories": "Tool-Kategorien",
      authors: "Autoren",
      "special-landings": "Special Landings",
    },
  },

  empty: "Noch keine Artikel.",
  emptyHint: "Artikel werden über den Cold-Start (Phase 4) oder per CLI erstellt.",

  // 56.2: Articles view (list + detail)
  list: {
    title: "Artikel",
    empty: "Keine Artikel gefunden",
    emptyDescription: "Passe die Filter an oder starte den Cold-Start.",
    detailEmpty: "Artikel auswählen",
    detailEmptyDescription: "Klicke links auf einen Artikel um Details zu sehen.",
  },

  filters: {
    status: "Status",
    collection: "Collection",
    locale: "Sprache",
    collections: {
      blog: "Blog",
      tools: "Tools",
      comparisons: "Vergleiche",
      "ki-wissen": "KI-Wissen",
      usecases: "Use-Cases",
      "tool-categories": "Tool-Kategorien",
    },
    locales: {
      de: "DE",
      en: "EN",
    },
    // Spec 64.19 / Phase B — opt-in audit-trail toggle for superseded articles.
    showSuperseded: "Ersetzte anzeigen",
  },

  detailTabs: {
    body: "Inhalt",
    frontmatter: "Frontmatter",
    versions: "Versionen",
    runs: "Runs",
    cost: "Kosten",
    social: "Social",
  },

  detailActions: {
    preview: "Vorschau",
    refresh: "Refresh",
    sync: "Sync",
  },

  reRender: {
    button: "Re-Render",
    dialogTitle: "Karussell erneut rendern?",
    dialogMessage:
      "Re-Render kostet ca. €0,10 (Cover- und Narrative-LLM). Die bestehenden Slide-Bilder werden überschrieben.",
    optionCached: "Nur Text neu (Bilder aus Cache wiederverwenden) — ~€0,10",
    optionRefresh: "Text + Bilder komplett neu (Pexels/NB2 neu laden) — ~€0,30",
    dialogConfirm: "Re-Render starten",
    success: "Re-Render gestartet — neue Slides erscheinen in ca. 30-60s.",
    successRefresh: "Re-Render mit frischen Bildern gestartet — neue Slides in ca. 60-90s.",
    error: "Re-Render konnte nicht gestartet werden.",
  },

  bodyEditor: {
    words: "Wörter",
    chars: "Zeichen",
    save: "Speichern",
    cancel: "Abbrechen",
    saveSuccess: "Inhalt gespeichert",
  },

  versionsTab: {
    noVersions: "Noch keine Versionen",
    version: "Version {n}",
    noReason: "(kein Änderungsgrund)",
  },

  runsTab: {
    noRuns: "Noch keine Runs für diesen Artikel",
  },

  costTab: {
    noData: "Noch keine Kostendaten",
    totalCost: "Gesamtkosten",
  },

  toolbar: {
    byPillar: "Nach Pillar",
    byCluster: "Nach Cluster",
    totalCount: "{count} Artikel",
    countWithTotal: "{count} / {total} Artikel",
  },

  kanban: {
    loadMore: "Mehr laden ({remaining} weitere)",
  },

  lane: {
    uncategorized: "Ohne Cluster",
    empty: "—",
  },

  statusGroup: {
    to_review: "Review",
    in_progress: "In Arbeit",
    ready: "Fertig",
    issues: "Probleme",
  },

  card: {
    cornerstone: "Cornerstone",
    words: "Wörter",
  },

  locale: {
    noTranslation: "Noch keine {locale}-Version vorhanden — über Pipeline-Aktionen erstellen",
  },

  detail: {
    notFound: "Artikel nicht gefunden",
    tabs: {
      body: "Inhalt",
      metadata: "Metadaten",
      history: "Versionen",
      validation: "Validierung",
      frontmatter: "Frontmatter",
      social: "Social",
    },
  },

  frontmatter: {
    title: "Generiertes Frontmatter",
    copy: "Kopieren",
    copied: "Frontmatter kopiert",
    empty: "Noch kein Frontmatter verfügbar",
    previewBtn: "In Astro öffnen",
    previewHint: "Schreibt die .mdx-Datei in dein lokales Astro-Projekt. Pfad als astroRepo.localPath in der DB setzen. Starte astro dev separat.",
    // Spec 50: schema-awareness + editor
    noSchema: "Kein Schema gespeichert. Führe zuerst einen Astro-Import aus damit die Collection-Felder bekannt sind.",
    runImport: "Astro-Import starten",
    importStarted: "Import gestartet — Schema wird in Kürze geladen",
    importError: "Import konnte nicht gestartet werden",
    fieldsTitle: "Strukturierte Felder",
    suggestAll: "KI-Vorschläge",
    suggestDone: "Vorschläge eingetragen und gespeichert",
    suggestError: "Vorschläge fehlgeschlagen",
    saveSuccess: "Felder gespeichert",
    addTag: "Tag hinzufügen…",
    addItem: "Eintrag hinzufügen",
    faqQuestion: "Frage",
    faqAnswer: "Antwort",
    fields: {
      category: "Kategorie",
      intentType: "Intent-Typ",
      tags: "Tags",
      faq: "FAQ",
      clusterRole: "Cluster-Rolle",
    },
    heroImage: "Hero-Bild",
    heroImageAlt: "Hero-Bild Vorschau",
    heroVariants: "Bildvarianten",
  },

  body: {
    outlineTitle: "Generiertes Outline",
    draftTitle: "Draft",
    save: "Speichern",
    discard: "Verwerfen",
    saveSuccess: "Inhalt gespeichert",
    resyncTriggered: "Re-Sync zu Astro gestartet",
    saveDialog: {
      title: "Änderungen speichern",
      changeReason: "Änderungsgrund (optional)",
      changeReasonPlaceholder: 'z.B. "Intro überarbeitet" oder "Faktencheck korrigiert"',
      resyncAfterSave: "Nach dem Speichern automatisch zu Astro re-syncen",
      resyncDisabledHint:
        'Re-sync nur möglich wenn Status "Veröffentlichungsbereit", "Veröffentlicht" oder "PageSpeed blockiert".',
      confirm: "Speichern",
    },
  },

  actions: {
    pipelineActions: "Pipeline-Aktionen",
    lastRunStatus: "Letzte Runs",
    generateOutline: "Outline generieren",
    generateDraft: "Draft generieren",
    syncToAstro: "Zu Astro syncen",
    validatePagespeed: "PageSpeed validieren",
    validatePagespeedLocal: "Lokal validieren (Lighthouse)",
    validatePagespeedApi: "Live validieren (Google PSI)",
    validatePagespeedApiDisabled: "Production-Domain nicht gesetzt — in Projekteinstellungen eintragen",
    outlineNeedsTitle: "Bitte zuerst einen Titel vergeben — er dient als Vorgabe für die Outline-KI",
    pagespeedNotSynced: "Artikel muss erst nach Astro gesynct werden",
    extendSchema: "Schema.org erweitern",
    generateHero: "Hero-Bild generieren",
    heroNeedsOutline: "Zuerst Outline generieren — der Bild-Prompt stammt daraus",
    heroDialogTitle: "Hero-Bild generieren",
    heroDialogHint: "Prompt aus dem Outline vorab geprüft — bei Bedarf anpassen.",
    heroPromptLabel: "Bild-Prompt (Flux 1.1 Pro)",
    heroStyle: "Stil",
    heroGenerate: "Generieren",
    heroTriggered: "Hero-Bild wird generiert",
    triggered: "Aktion gestartet: {action}",
    notAvailable: "Aktion nicht verfügbar im aktuellen Status",
    noRunsYet: "Noch keine Runs.",
    alreadyRunning: "Pipeline läuft bereits — Aktion wurde nicht erneut ausgelöst",
    runningStep: "Läuft: {step}",
    createLocaleVersion: "{locale}-Version erstellen",
    localizeDialogTitle: "{locale}-Version erstellen",
    localizeDialogHint: "Wähle eine Methode für die neue Sprachversion.",
    localizeTranslateTitle: "Kulturell übersetzen (empfohlen)",
    localizeTranslateHint: "Der vorhandene Artikel wird sprachlich und kulturell angepasst — kein 1:1-Wörtlichübersetzen. Länderspezifische Inhalte, Gesetze und Beispiele werden für den Zielmarkt adaptiert.",
    localizeFreshTitle: "Neu generieren (keyword-optimiert)",
    localizeFreshHint: "Der Titel wird übersetzt und ein neuer Stub-Artikel angelegt. Danach Outline und Draft separat für den Zielmarkt generieren.",
    localizeStart: "Starten",
    localizeTriggered: "{locale}-Version wird erstellt",
    siblingGenerating: "{locale}-Version wird gerade generiert…",
    localeLabel: { en: "English", de: "Deutsch" },
    viewSiblingLocale: "{locale}-Version ansehen",
  },

  divergence: {
    this_newer: {
      headline: "{locale}-Version ist veraltet",
      description: "Dieser Artikel wurde bearbeitet seit die Übersetzung zuletzt synchronisiert wurde. Die {locale}-Version kann jetzt aktualisiert werden.",
    },
    sibling_newer: {
      headline: "{locale}-Version ist neuer",
      description: "Die {locale}-Version wurde bearbeitet. Öffne sie und starte die Rück-Synchronisation von dort.",
    },
    both_diverged: {
      headline: "Beide Versionen wurden bearbeitet",
      description: "Dieser Artikel und die {locale}-Version wurden unabhängig voneinander bearbeitet. Wähle, welche Version als Quelle dienen soll.",
    },
    resyncSibling: "{locale}-Version jetzt synchronisieren",
    openSibling: "{locale}-Version öffnen",
    resyncStarted: "Synchronisation gestartet — die Übersetzung wird im Hintergrund aktualisiert.",
  },

  runs: {
    type: {
      sync: "Astro-Sync",
      pagespeed: "PageSpeed",
      schema: "Schema.org",
      outline: "Outline generieren",
      draft: "Draft generieren",
      hero: "Hero-Bild",
      localize: "Sprachversion",
    },
    status: {
      queued: "Warteschlange",
      running: "Läuft",
      completed: "Abgeschlossen",
      pending: "Läuft",
      succeeded: "Erfolgreich",
      failed: "Fehlgeschlagen",
      errored: "Fehler",
      budgetExceeded: "Budget überschritten",
      unknown: "Unbekannt",
    },
  },

  header: {
    back: "Zurück",
    cornerstone: "Cornerstone-Artikel",
    lastUpdated: "Zuletzt aktualisiert",
  },

  statusGuide: {
    proposed:         "Artikel freigeben, dann Outline generieren",
    approved:         "Outline generieren → KI analysiert Keyword & SERP",
    outline_review:   "Outline prüfen, dann Draft generieren",
    final_review:     "Draft prüfen → Schema.org erweitern oder direkt nach Astro syncen",
    ready_to_publish: "Zu Astro syncen → Artikel wird veröffentlicht",
    published:        "PageSpeed validieren für vollständige Qualitätsprüfung",
    running:          "Pipeline läuft — bitte warten…",
    blocked:          "PageSpeed-Fehler beheben, dann erneut validieren",
    failed:           "Pipeline fehlgeschlagen — Details in den letzten Runs prüfen",
  },

  status: {
    proposed: "Vorgeschlagen",
    approved: "Freigegeben",
    generating: "Wird generiert",
    outline_review: "Outline-Review",
    drafting: "Wird geschrieben",
    final_review: "Final-Review",
    schema_extending: "Schema wird erweitert",
    ready_to_publish: "Veröffentlichungsbereit",
    validating: "Wird validiert",
    published: "Veröffentlicht",
    blocked_by_pagespeed: "PageSpeed blockiert",
    failed: "Fehlgeschlagen",
    rejected: "Abgelehnt",
    superseded: "Ersetzt",
  },
  // Spec 64.19 / Phase B
  supersededTooltip: "Dieser Artikel wurde ersetzt (letzte Änderung: {at}).",

  automation: {
    title: "Vollautomatik-Status",
    triggerButton: "Vollautomatik",
    steps: {
      outline:       "Outline",
      draft:         "Draft + Hero",
      "schema-de":   "Schema (DE)",
      localize:      "Lokalisierung → EN",
      "schema-en":   "Schema (EN)",
      "astro-transfer": "Astro-Transfer",
    },
    states: {
      done:    "Fertig",
      running: "Läuft…",
      pending: "Wartend",
      failed:  "Fehlgeschlagen",
    },
    totalCost: "Gesamt",
    resume: "Fortsetzen",
    cancel: "Abbrechen",
    cancelled: "Abgebrochen",
    resumeSuccess: "Chain wird fortgesetzt",
    cancelSuccess: "Chain abgebrochen",
    error: "Fehler: {msg}",
    disabled_translation: "Übersetzungs-Lücken nicht unterstützt",
    disabled_hub: "Hub-Lücken verwenden den Cornerstone-Workflow",
  },

  metadata: {
    title: "Titel",
    slug: "Slug (URL-Pfad)",
    cornerstoneKeyword: "Cornerstone-Keyword",
    metaDescription: "Meta-Beschreibung",
    status: "Status",
    save: "Speichern",
    saveSuccess: "Metadaten gespeichert",
    slugHint: "Nur Kleinbuchstaben, Ziffern und Bindestriche erlaubt",
    statusWarning: "Status-Änderungen manuell vornehmen — nur für Notfallkorrekturen",
  },

  history: {
    noVersions: "Noch keine Versionen vorhanden.",
    version: "Version {n}",
    noReason: "(kein Änderungsgrund)",
    diffModal: {
      title: "Version {n} vergleichen",
      selected: "Version {n}",
      current: "Aktuell",
      loading: "Lädt Inhalt...",
      close: "Schließen",
    },
  },

  validation: {
    pagespeed: {
      title: "PageSpeed-Ergebnisse",
      notRun: "Noch nicht validiert.",
      testedUrl: "Getestete URL",
      failedCategories: "Fehlgeschlagene Kategorien",
      outcome: {
        pass: "Bestanden",
        fail: "Nicht bestanden",
        error: "Fehler",
      },
      categories: {
        performance: "Performance",
        accessibility: "Zugänglichkeit",
        "best-practices": "Best Practices",
        seo: "SEO",
      },
    },
    schema: {
      title: "Schema.org-Erweiterung",
      notRun: "Noch nicht ausgeführt.",
      faqCount: "{count} FAQ-Fragen",
      howtoCount: "{count} Schritte",
      types: {
        breadcrumb: "Breadcrumb",
        faq: "FAQ",
        howto: "HowTo",
      },
      status: {
        pending: "Ausstehend",
        succeeded: "Erfolgreich",
        failed: "Fehlgeschlagen",
      },
    },
  },
};
