export default {
  pageTitle: "Refresh-Warteschlange",
  pageDescription: "Veraltete Artikel, die eine Überarbeitung benötigen.",

  runDetection: "Erkennung starten",
  lastDetection: "Letzte Erkennung: {time}",
  neverDetected: "Noch nie erkannt",
  detectionStarted: "Erkennung gestartet",
  detectionFailed: "Fehler beim Starten der Erkennung",

  triggered: "Refresh gestartet",
  triggerFailed: "Fehler beim Starten des Refresh",
  dismissFailed: "Fehler beim Verwerfen",

  loadMore: "Weitere laden",

  empty: {
    title: "Keine Kandidaten",
    description: "Alle Artikel sind aktuell. Starte die Erkennung, um veraltete zu finden.",
    suggestions: "Keine offenen Qualitäts-Empfehlungen.",
  },

  lastUpdated: "Zuletzt aktualisiert",

  actions: {
    refresh: "Refresh",
    dismiss: "Verwerfen",
    markRefreshed: "Als aktualisiert markieren",
    viewFindings: "Details ansehen",
    analyzeOne: "Mit KI analysieren",
  },

  analyzeOneStarted: "KI-Analyse für diesen Artikel gestartet",
  analyzeOneFailed: "Fehler beim Starten der Einzel-Analyse",

  analyzeAll: "Alle analysieren",
  analyzeAllHint: "Startet KI-Qualitätsanalyse für alle veröffentlichten Artikel.",
  analyzing: "Wird analysiert…",
  analyzeStarted: "Analyse für {count} Artikel gestartet",
  analyzeFailed: "Fehler beim Starten der Analyse",

  markRefreshedSuccess: "Artikel als aktualisiert markiert",
  markRefreshedFailed: "Fehler beim Markieren",
  suggestionDismissed: "Empfehlung verworfen",

  suggestionsTitle: "Refresh-Empfehlungen",
  suggestionsDescription:
    "Artikel zur Überarbeitung – zeitbasiert (Threshold überschritten) oder durch KI-Qualitätsanalyse identifiziert.",

  source: {
    time: "Zeitbasiert",
    quality: "KI-Qualitätsanalyse",
  },

  recommendation: {
    "refresh-now": "Jetzt aktualisieren",
    "refresh-soon": "Bald aktualisieren",
    "no-action": "Kein Handlungsbedarf",
  },

  confidence: {
    high: "Hoch",
    medium: "Mittel",
    low: "Niedrig",
  },

  findings: {
    outdatedClaims: "Veraltete Aussagen",
    missingCoverage: "Fehlende Themen",
    staleReferences: "Veraltete Referenzen",
    confidenceLabel: "Konfidenz",
    noFindings: "Keine spezifischen Befunde.",
  },
};
