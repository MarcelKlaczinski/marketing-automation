export default {
  tabs: {
    generated: "Generiert",
    imported: "Importiert",
  },

  imported: {
    syncFromRepo: "Vom Repo importieren",
    syncStarted: "Import wurde gestartet",
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
    localeLabel: { en: "English", de: "Deutsch" },
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
