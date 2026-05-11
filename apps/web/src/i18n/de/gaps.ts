export default {
  pageTitle: "Content-Lücken",

  actions: {
    runDetection:   "Analyse starten",
    running:        "Analysiere…",
    dismiss:        "Verwerfen",
    reopen:         "Wieder öffnen",
    markInProgress: "In Bearbeitung",
    suggest:        "Titel vorschlagen",
    suggesting:     "Vorschlag wird geladen…",
    generate:       "Artikel generieren",
    generating:     "Wird gestartet…",
    translationDisabled: "Übersetzungs-Pipeline noch nicht verfügbar",
    viewArticle:    "Artikel ansehen",
    viewSpec:       "Cornerstone Spec ansehen",
    dismissAll:     "Alle verwerfen",
    suggestAll:     "Alle Titel vorschlagen",
  },

  status: {
    open:        "Offen",
    in_progress: "In Bearbeitung",
    resolved:    "Erledigt",
    dismissed:   "Verworfen",
  },

  gapType: {
    missing_hub:         "Fehlender Hub",
    missing_translation: "Übersetzung fehlt",
    missing_spoke_type:  "Spoke-Typ fehlt",
    cluster_too_small:   "Cluster zu klein",
  },

  priority: {
    "1": "Kritisch",
    "2": "Hoch",
    "3": "Mittel",
  },

  filters: {
    all:                 "Alle",
    missing_hub:         "Fehlende Hubs",
    missing_translation: "Übersetzungen",
    missing_spoke_type:  "Spoke-Typen",
    cluster_too_small:   "Kleine Cluster",
  },

  lastDetected:    "Zuletzt analysiert:",
  neverDetected:   "Noch nicht analysiert",
  totalOpen:       "{count} offene Lücken",
  emptyState:      "Keine offenen Content-Lücken gefunden.",
  emptyStateHint:  "Starte die Analyse, um Cluster und Übersetzungslücken zu erkennen.",
  emptyFiltered:   "Keine Lücken für diesen Filter.",

  suggestion: {
    title:              "Vorgeschlagener Titel:",
    slug:               "Slug:",
    keyword:            "Keyword",
    metaDesc:           "Meta-Beschreibung:",
    imagePrompt:        "Bild-Prompt:",
    discoveredKeywords: "Entdeckte Keywords (gespeichert):",
  },

  metadata: {
    cluster:         "Cluster",
    locale:          "Locale",
    missingLocale:   "Fehlende Sprache",
    intentType:      "Intent",
    spokesPresent:   "Vorhandene Spokes",
    existingArticle: "Vorhandener Artikel",
  },

  batch: {
    suggestAllConfirm:  "Für bis zu 20 Lücken einen Titel per KI vorschlagen (ca. 0,10 €)?",
    dismissedSuccess:   "{count} Lücken verworfen",
    suggestedSuccess:   "Titel für {count} Lücken vorgeschlagen",
  },

  articleCount: "{count} Artikel",
};
