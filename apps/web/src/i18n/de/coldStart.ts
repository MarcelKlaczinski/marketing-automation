export default {
  intro:
    "Cold-Start initialisiert ein neues Projekt mit Brand-Voice, Wettbewerber-Analyse, Cluster-Plan und Cornerstone-Articles. Die 5 Phasen können einzeln oder nacheinander ausgeführt werden.",

  lockedHint: "Vorherige Phase abschließen, um diese zu starten",
  costSoFar: "Kosten bisher",

  statusLabels: {
    pending: "Ausstehend",
    running: "Läuft",
    awaiting_review: "Wartet auf Review",
    complete: "Abgeschlossen",
  },

  phase1: {
    title: "Brand Voice",
    description: "Generiere Fragen zur Marke und synthetisiere daraus den Marketing-Context.",
    idleDescription:
      'Klicke "Fragen generieren", um den Voice-Refinement-Prozess zu starten. Du erhältst dann ca. 10 Fragen zur Marke.',
    generateQuestions: "Fragen generieren",
    questionsRunning: "Fragen werden generiert...",
    questionsFailed: "Fragen-Generierung fehlgeschlagen",
    answerHint:
      "Beantworte die Fragen so detailliert wie möglich. Die Antworten werden zur Erstellung des Marketing-Contexts verwendet.",
    answerPlaceholder: "Antwort hier eingeben...",
    synthesizeButton: "Marketing-Context erstellen",
    synthesizeRunning: "Marketing-Context wird erstellt...",
    synthesizeFailed: "Synthese fehlgeschlagen",
    complete: 'Brand Voice ist gespeichert. Du findest den Marketing-Context im Tab "Übersicht".',
    regenerate: "Erneut generieren",
  },

  phase2: {
    title: "Wettbewerber-Analyse",
    description: "Analysiere die Top-Wettbewerber via DataForSEO + Anthropic.",
    idleDescription:
      'Klicke "Analyse starten" — die Pipeline ermittelt automatisch die Top 3–5 Wettbewerber und analysiert deren Keywords.',
    startButton: "Analyse starten",
    identifying: "Wettbewerber werden identifiziert...",
    running: "Wettbewerber werden analysiert...",
    failed: "Analyse fehlgeschlagen",
    noCompetitors: "Keine Wettbewerber identifiziert — bitte erneut versuchen.",
    complete: "Wettbewerber-Analyse abgeschlossen.",
    regenerate: "Erneut analysieren",
    confirmation: {
      title: "Bereit für Wettbewerbs-Analyse?",
      body: "{count} Wettbewerber identifiziert. Die Analyse kostet ca. €{cost} (DataForSEO).",
      tooManyCompetitors:
        "{count} Wettbewerber überschreiten das Maximum von {max}. Bitte kürze die Liste vor dem Start.",
      cancel: "Abbrechen",
      runAnalysis: "Analyse starten",
    },
  },

  phase3: {
    title: "Cluster-Plan",
    description: "Generiere einen Topic-Cluster-Plan basierend auf Brand-Voice und Wettbewerbern.",
    idleDescription:
      'Klicke "Cluster-Plan erstellen" — die Pipeline schlägt 3–7 Topic-Cluster vor mit jeweils einem Cornerstone-Keyword.',
    startButton: "Cluster-Plan erstellen",
    running: "Cluster-Plan wird erstellt...",
    failed: "Cluster-Plan fehlgeschlagen",
    complete: "Cluster-Plan erstellt.",
    regenerate: "Cluster-Plan neu erstellen",
    importedComplete: "{count} Cluster wurden automatisch aus dem Frontmatter importiert — kein manueller Cluster-Plan nötig.",
  },

  phase4: {
    title: "Cornerstones",
    description: "Generiere Cornerstone-Articles pro Cluster und reviewe sie.",
    idleDescription:
      'Klicke "Cornerstones generieren" — pro Cluster wird ein Cornerstone-Article-Vorschlag erstellt.',
    noClusters: "Kein Cluster-Plan vorhanden. Bitte zuerst Phase 3 abschließen.",
    generate: "Cornerstones generieren",
    running: "Cornerstones werden generiert...",
    failed: "Cornerstone-Generierung fehlgeschlagen",
    reviewIntro:
      "Reviewe jeden Cornerstone individuell. Du kannst ihn approven, editieren oder rejecten.",
    proceed: "{count} Cornerstone(s) approved — weiter zu Phase 5",
    statusLabels: {
      proposed: "Vorgeschlagen",
      approved: "Approved",
      rejected: "Rejected",
    },
    cardActions: {
      approve: "Approve",
      edit: "Editieren",
      reject: "Reject",
      save: "Speichern",
      cancel: "Abbrechen",
    },
    cardFields: {
      title: "Titel",
      keyword: "Cornerstone-Keyword",
      description: "Meta-Beschreibung",
    },
    idleDescriptionMultiLang:
      "Für jeden der {count} genehmigten Cluster wird pro Sprache ein Cornerstone-Spec generiert.",
    localesLabel: "Sprachen für Generierung",
    localeOptionDe: "Deutsch (DE)",
    localeOptionEn: "Englisch (EN)",
    reviewIntroMultiLang:
      "Überprüfe die DE+EN-Pärchen. Genehmige sie einzeln oder als Paar, dann generiere die Artikel.",
    generateArticles: "{count} Cluster: Artikel generieren",
    regenerate: "Erneut generieren",
    articlesEnqueued: "{total} Article-Generationen gestartet",
    openStandaloneView: "Standalone-Ansicht öffnen",
  },

  phase5: {
    title: "Go-Live Checklist",
    description: "Generiere eine Markdown-Checklist mit nächsten Schritten zum Go-Live.",
    idleDescription:
      'Klicke "Checklist generieren" — du erhältst eine personalisierte Liste mit nächsten Schritten.',
    startButton: "Checklist generieren",
    running: "Checklist wird erstellt...",
    failed: "Checklist-Erstellung fehlgeschlagen",
    complete: "Cold-Start abgeschlossen. Du kannst jetzt Articles generieren.",
  },
};
