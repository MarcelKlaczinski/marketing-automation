export default {
  // ── Wizard (Spec 56.4) ────────────────────────────────────────────────────
  title: "Neues Projekt einrichten",
  addProject: "+ Projekt hinzufügen",
  saveAndExit: "Speichern & später fortfahren",
  abandon: "Abbrechen",
  skip: "Überspringen",
  phaseLabel: "Phase {current} von {total}",

  abandonConfirm: {
    title: "Wizard abbrechen?",
    message:
      "Der Entwurf wird gelöscht. Du kannst jederzeit ein neues Projekt starten.",
  },

  new: {
    title: "Neues Projekt starten",
    description:
      "Richte in wenigen Schritten ein neues Marketing-Projekt ein — von den Basis-Infos bis zum ersten Content-Plan.",
    start: "Projekt starten",
    resumeDraft: "Angefangenen Entwurf fortsetzen",
  },

  phases: {
    basics: {
      label: "Basics",
      title: "Erzähl uns von deinem Projekt",
      description: "Gib die grundlegenden Informationen ein, damit wir dein Projekt einrichten können.",
      fields: {
        name: "Projektname",
        domain: "Domain",
        domainHelper: "Optional — wird für die automatische Markenanalyse verwendet.",
        industry: "Branche",
        targetLocales: "Zielsprachen",
        marketingContext: "Marketing-Context",
        marketingContextHelper:
          'Optional — beschreibe kurz Zielgruppe, Ton und Alleinstellungsmerkmale. Kann auch später in den Einstellungen ausgefüllt werden.',
      },
      placeholders: {
        name: "z. B. KI-Wissensraum",
        domain: "example.com",
        industry: "z. B. KI-Tools, Automotive, E-Commerce",
        marketingContext: "Unsere Zielgruppe sind ...",
      },
    },
    brand: {
      label: "Marke",
      title: "Marken-Identität",
      description:
        "Lass uns deine Markenfarben, Typografie und Markenstimme automatisch aus deiner Domain ermitteln — oder trage sie manuell ein.",
      discovery: {
        title: "Marke automatisch erkennen",
        description:
          "Wir analysieren deine Website und ermitteln Farben, Typografie und Ton automatisch. Das dauert ca. 15–30 Sekunden.",
        start: "Marke erkennen",
        enterManually: "Manuell eingeben",
      },
      discovering: {
        title: "Marke wird analysiert …",
        description: "Wir lesen deine Website aus und ermitteln Brand-Tokens.",
      },
      review: {
        title: "Brand-Tokens überprüfen",
        description: "Überprüfe und passe die erkannten Werte an.",
      },
      rediscover: "Erneut analysieren",
      fields: {
        domain: "Domain",
        primary: "Primärfarbe",
        secondary: "Sekundärfarbe",
        headingFont: "Überschriften-Schrift",
        voice: "Markenstimme",
      },
      placeholders: {
        voice: "Beschreibe den Ton deiner Marke: professionell, nahbar, direkt …",
      },
    },
    seed: {
      label: "Inhalt",
      title: "Content-Grundlage",
      description:
        "Generiere erste Themen-Säulen und Autoren-Personas, die als Basis für deine Content-Strategie dienen.",
      pillars: {
        title: "Themen-Säulen",
        description:
          "Themen-Säulen strukturieren deinen Content-Plan. Wir schlagen dir 3–5 Säulen vor.",
        generate: "Säulen generieren",
        regenerate: "Erneut generieren",
        add: "Säule hinzufügen",
      },
      authors: {
        title: "Autoren-Personas",
        description:
          "Autoren-Personas geben deinem Content eine menschliche Stimme. Wir schlagen dir 3 Personas vor.",
        generate: "Personas generieren",
        regenerate: "Erneut generieren",
      },
    },
    astro: {
      label: "Astro",
      title: "Astro-Integration",
      description:
        "Verbinde ein lokales Astro-Repository, damit generierter Content direkt synchronisiert werden kann.",
      info: {
        title: "Warum Astro?",
        description:
          "Die Plattform generiert Markdown-Dateien und synchronisiert sie direkt in dein Astro-Repository. Dort werden sie zu echten Blog-Posts.',",
        skipNote: "Du kannst diesen Schritt überspringen und die Integration später in den Einstellungen einrichten.",
      },
      fields: {
        repoPath: "Pfad zum Astro-Repository",
        repoPathHelper: "Absoluter Pfad auf deinem Rechner, z. B. /Users/me/my-blog",
        deployTarget: "Deploy-Ziel",
        contentPath: "Content-Verzeichnis",
      },
      deployTargets: {
        vercel: "Vercel",
        netlify: "Netlify",
        cloudflarePages: "Cloudflare Pages",
        selfHosted: "Selbst gehostet",
      },
    },
    confirm: {
      label: "Bestätigen",
      title: "Alles bereit?",
      description:
        "Überprüfe deine Eingaben und starte das Projekt. Du kannst alles später noch anpassen.",
      basics: "Basis-Informationen",
      brand: "Marke",
      pillars: "Themen-Säulen",
      authors: "Autoren-Personas",
      launch: "Projekt erstellen",
      cost: {
        title: "Geschätzte Kosten",
        description:
          "Ungefähre Kosten für die initiale Content-Generierung nach dem Start.",
        initialPillars: "Erstmalige Cluster-Generierung",
        firstMonth: "Geschätzte Kosten Monat 1",
      },
    },
  },

  locales: {
    de: "Deutsch",
    en: "Englisch",
  },

  pillarCard: {
    name: "Name der Säule",
    namePlaceholder: "z. B. KI-Tool-Reviews",
    description: "Beschreibung",
    descriptionPlaceholder: "Was umfasst diese Content-Säule?",
    keywords: "Keywords",
  },

  authorCard: {
    name: "Name",
    namePlaceholder: "z. B. Alex Müller",
    role: "Rolle",
    rolePlaceholder: "z. B. KI-Experte",
    bio: "Bio",
    bioPlaceholder: "Kurze Vorstellung der Persona …",
    expertise: "Thematische Expertise",
    addTopic: "Thema hinzufügen",
  },

  errors: {
    launchFailed: "Projekt konnte nicht erstellt werden. Bitte erneut versuchen.",
    initFailed: "Entwurf konnte nicht gestartet werden. Bitte erneut versuchen.",
  },

  // ── Pipeline execution (Spec 35, existing keys below) ────────────────────
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
    competitorsLabel: "Analysierte Wettbewerber",
    gapsLabel: "Content-Gaps",
    avoidLabel: "Zu vermeidende Topics",
    reportLabel: "Vollständiger Report",
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
    optInLabel: "Cluster-Vorschläge zusätzlich generieren",
    optInDescription:
      "Lasse die LLM-Pipeline zusätzliche Cluster-Vorschläge generieren, die in deinen importierten Clustern noch nicht abgedeckt sind. Du kannst die Vorschläge anschließend reviewen und auswählen.",
    generateAdditional: "Zusätzliche Cluster generieren",
    brownfieldMode: "Brownfield-Modus",
    brownfieldExplanation:
      "Der LLM schlägt neue Cluster vor, die deine vorhandenen {count} Cluster ergänzen. Duplikate musst du anschließend manuell herausfiltern.",
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
