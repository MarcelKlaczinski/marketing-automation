export default {
  title: "Artikel-Tools",
  description: "Werkzeuge für die manuelle Artikelsteuerung.",

  tabs: {
    generate: "Neuen Artikel generieren",
    manual: "Manuelle Aktionen",
  },

  intents: {
    overview: "Übersicht",
    general: "Allgemein",
    review: "Test & Review",
    comparison: "Vergleich",
    pricing: "Preise",
    tutorial: "Tutorial",
    "use-cases": "Anwendungsfälle",
    features: "Funktionen",
  },

  generate: {
    title: "Neuen Artikel generieren",
    description: "Starte die Artikel-Pipeline mit einem freien Thema.",
    submit: "Pipeline starten",
    successMessage: "Artikel-Pipeline gestartet",
    errorMessage: "Fehler beim Starten der Pipeline",
    estimatedCost: "Geschätzte Kosten",
    estimatedTime: "Geschätzte Dauer",
    fields: {
      topic: "Thema",
      topicHelper: "Titel oder Kernthema des Artikels (min. 5 Zeichen)",
      primaryKeyword: "Hauptkeyword",
      collection: "Collection",
      locale: "Sprache",
      intentType: "Intent-Typ",
      author: "Autor",
      authorHelper: "Leer lassen für automatische Auswahl",
      cluster: "Cluster",
      clusterHelper: "Optional: Artikel einem bestehenden Cluster zuordnen",
      wordCount: "Zielwortanzahl",
      approvalMode: "Freigabe-Modus",
    },
    placeholders: {
      topic: "z.B. Die besten KI-Code-Editoren 2025",
      primaryKeyword: "z.B. ki-code-editor",
    },
  },

  manual: {
    searchPlaceholder: "Artikel suchen…",
    emptyTitle: "Kein Artikel ausgewählt",
    emptyDescription: "Suche nach einem Artikel und wähle ihn aus.",

    groups: {
      pipeline: "Pipeline-Schritte",
      content: "Content-Operationen",
      deploy: "Veröffentlichung",
    },

    actions: {
      outline: {
        title: "Gliederung generieren",
        description: "Outline-Schritt neu ausführen",
      },
      draft: {
        title: "Entwurf generieren",
        description: "Draft-Schritt neu ausführen",
      },
      heroImage: {
        title: "Hero-Bild generieren",
        description: "Bild über Replicate neu generieren",
      },
      schema: {
        title: "Schema erweitern",
        description: "JSON-LD Schema neu generieren",
      },
      refresh: {
        title: "Artikel auffrischen",
        description: "Artikel vollständig neu generieren (kostenpflichtig)",
      },
      localize: {
        title: "Lokalisieren",
        description: "EN-Pendant generieren oder aktualisieren",
      },
      continue: {
        title: "Fortführen",
        description: "Pipeline ab letztem Schritt weiterführen",
      },
      sync: {
        title: "Synchronisieren",
        description: "Artikel ins Astro-Repo übertragen",
      },
      pagespeed: {
        title: "PageSpeed prüfen",
        description: "Lighthouse-Messung starten",
      },
      preview: {
        title: "Vorschau",
        description: "Lokale Vorschau öffnen",
      },
    },

    confirmRefresh: {
      title: "Artikel auffrischen?",
      message: "Refresh generiert den Artikel vollständig neu (ca. €0.40 Kosten). Fortfahren?",
    },

    triggerSuccess: "{action} gestartet",
    triggerError: "Fehler beim Starten der Aktion",
  },
};
