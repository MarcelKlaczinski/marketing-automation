export default {
  title: "Einstellungen",

  sections: {
    project: "Projekt",
    "brand-tokens": "Brand-Tokens",
    "brand-assets": "Brand-Assets",
    credentials: "Zugangsdaten",
  },

  project: {
    title: "Projekteinstellungen",
    basics: {
      title: "Grundlagen",
      description: "Name, Domain und Branche des Projekts.",
    },
    marketing: {
      title: "Marketing-Kontext",
      description: "Beschreibung der Zielgruppe, Tonalität und Kernbotschaften für die KI-Pipeline.",
    },
    costLimits: {
      title: "Kostenlimits",
      description: "Monatliches Budget und Alarmgrenzen für API-Kosten.",
    },
    astro: {
      title: "Astro-Repository",
      description: "Verbindung zum Astro-Repo für Artikelveröffentlichung und lokale Vorschau.",
      notConfigured: "Kein Astro-Repository konfiguriert.",
      triggerImport: "Import starten",
      importStarted: "Import gestartet",
      importError: "Import konnte nicht gestartet werden",
    },
    pagespeed: {
      title: "PageSpeed-Schwellenwerte",
      description: "Mindestanforderungen für Lighthouse-Scores bei der Validierung.",
    },
    translation: {
      title: "Übersetzungs-Automatisierung",
      description: "Automatisch EN-Version generieren wenn ein DE-Artikel fertiggestellt wird.",
    },
    social: {
      title: "Social Media",
      description: "Einstellungen für die automatisierte Carousel-Generierung.",
    },
    fields: {
      name: "Projektname",
      domain: "Domain",
      domainHelper: "Öffentliche Domain ohne Protokoll, z.B. ki-wissensraum.de",
      industry: "Branche",
      marketingContextMd: "Marketing-Kontext (Markdown)",
      marketingContextMdHelper: "Beschreibung der Zielgruppe, Tonalität und Kernbotschaften. Wird in jede Pipeline geladen.",
      monthlyBudget: "Monatliches Anthropic-Budget (€)",
      monthlyBudgetHelper: "Maximale monatliche Ausgaben für Anthropic API-Aufrufe.",
      alertThreshold: "Alarm-Schwellenwert (%)",
      alertThresholdHelper: "Bei welchem Prozent des Budgets eine Warnung ausgelöst wird (z.B. 80).",
      astroDefaultBranch: "Standard-Branch",
      astroLocalPath: "Lokaler Pfad",
      astroLocalPathHelper: "Absoluter Pfad zum lokal ausgecheckten Astro-Repo für die Vorschau.",
      minPerformance: "Mindest-Performance-Score (0–100)",
      minSeo: "Mindest-SEO-Score (0–100)",
      translationAutoTrigger: "EN-Version automatisch generieren",
      translationAutoTriggerHelper: "Startet die Übersetzungs-Pipeline automatisch nach Abschluss eines DE-Artikels.",
    },
  },

  discovery: {
    title: "Content-Discovery",
    description: "Automatisierung für Trends, Content-Gaps und veraltete Artikel.",
    active: "Aktiv",
    inactive: "Inaktiv",
    lastRun: "Letzter Lauf",
    nextRun: "Nächster Lauf",
    runNow: "Jetzt ausführen",
    running: "Läuft…",
    inMinutes: "in {n} Min.",
    inHours: "in {n} Std.",
    trends: {
      title: "Trend-Erkennung",
      description: "Tägliche Synthese externer Signale zu Themenbriefs (01:30 UTC).",
    },
    refresh: {
      title: "Refresh-Erkennung",
      description: "Erkennt veraltete Artikel anhand des Staleness-Schwellenwerts (02:00 UTC).",
      thresholdLabel: "Staleness-Schwellenwert (Tage)",
      thresholdHelper: "Artikel, die länger als N Tage nicht aktualisiert wurden, erscheinen in der Refresh-Queue.",
    },
    qualityAnalysis: {
      title: "Qualitätsanalyse (KI)",
      description: "Tägliche LLM-Analyse aller Artikel auf Aktualität und inhaltliche Lücken (03:00 UTC).",
    },
    autoApproveGaps: {
      title: "Content-Gaps automatisch genehmigen",
      description: "Startet die Artikel-Generierung direkt nach dem Suggest-Schritt, ohne manuelle Freigabe.",
      warning: "Achtung: Es werden Artikel ohne Bestätigung generiert. Kosten entstehen automatisch.",
    },
  },

  brandTokens: {
    title: "Brand-Tokens",
    formMode: "Formular-Ansicht",
    advancedMode: "JSON-Editor",
    advancedDescription: "Bearbeite alle Brand-Tokens als JSON.",
    resetSection: "Abschnitt zurücksetzen",
    jsonInvalid: "Ungültiges JSON – bitte korrigieren.",
    jsonSaveError: "Fehler beim Speichern: {msg}",
    resetAll: "Alle zurücksetzen",
    colors: {
      title: "Farben",
      primary: "Primärfarbe",
      accent: "Akzentfarbe",
      surface: "Hintergrundfarbe",
    },
    typography: {
      title: "Typografie",
      headingFont: "Schrift Überschriften",
      headingFontCustom: "Eigene Schrift",
      customFont: "Eigene Schrift (Name)",
    },
    voice: {
      title: "Markenstimme",
      addressForm: "Anrede",
      addressDu: "Du (informell)",
      addressSie: "Sie (formell)",
      forbiddenWords: "Verbotene Wörter",
      forbiddenWordsHelper: "Kommagetrennte Liste von Wörtern, die nicht verwendet werden sollen.",
      signaturePhrases: "Signature-Phrasen",
      signaturePhrasesHelper: "Eine Phrase pro Zeile – charakteristische Formulierungen der Marke.",
    },
    social: {
      title: "Social Media",
      instagramHandle: "Instagram-Handle",
      websiteUrl: "Website-URL",
    },
    socialColors: {
      title: "Social-Farben",
      description: "Farben für generierte Instagram-Karussells. Änderungen wirken sich auf neue Renders aus.",
      eyebrowColor: "Eyebrow-Farbe",
      eyebrowColorHelper: "Akzentfarbe für Kategorie-Labels über Überschriften (dark theme)",
      surfaceSecondary: "Sekundäre Fläche",
      surfaceSecondaryHelper: "Hintergrund für Inhalts-Karten innerhalb der dark-theme Slides",
      pricingColors: "Pricing-Tier-Farben",
      pricingFree: "Kostenlos",
      pricingFreemium: "Freemium",
      pricingPaid: "Kostenpflichtig",
    },
  },

  brandAssets: {
    title: "Brand-Assets",
    uploadLabel: "Datei hochladen",
    uploadDrag: "Datei hierher ziehen oder klicken",
    deleteLabel: "Löschen",
    noAsset: "Kein Asset hochgeladen",
    uploadError: "Upload fehlgeschlagen",
    slots: {
      logo: {
        title: "Logo",
        description: "Primäres Brand-Logo (SVG oder PNG empfohlen, min. 200×60 px)",
      },
      tool_icon: {
        title: "Tool-Icon",
        description: "Standardicon für Tools ohne eigenes Logo (quadratisch, min. 128×128 px)",
      },
    },
  },

  credentials: {
    title: "Zugangsdaten",
    description: "Verwalte API-Schlüssel für externe Dienste.",
    set: "Speichern",
    update: "Aktualisieren",
    verify: "Verbindung testen",
    remove: "Entfernen",
    setBefore: "(bereits konfiguriert)",
    savedSuccess: "Zugangsdaten gespeichert",
    verifySuccess: "Verbindung erfolgreich",
    verifyFailed: "Verbindung fehlgeschlagen",
    keys: {
      apiKey: "API-Schlüssel",
      apiToken: "API-Token",
      login: "Benutzername",
      password: "Passwort",
    },
  },

  tabs: {
    adapters: "Adapter",
    system: "System",
    profile: "Profil",
    notifications: "Benachrichtigungen",
  },

  adapters: {
    intro:
      "Verwalte die Verbindungen zu externen Diensten. Klicke auf einen Adapter um die Konfiguration zu ändern.",
    disconnect: "Verbindung trennen",
    status: {
      verified: "Verifiziert",
      configured: "Konfiguriert",
      notConfigured: "Nicht konfiguriert",
    },
    disconnectDialog: {
      title: "Verbindung wirklich trennen?",
      description:
        "Alle gespeicherten Anmeldedaten für {adapter} werden gelöscht. Du kannst sie jederzeit erneut konfigurieren.",
      confirm: "Trennen",
      success: "Verbindung getrennt",
    },
  },

  system: {
    intro: "Status der Kern-Infrastruktur und Systemmetadaten.",
    deploymentMode: "Modus",
    apiVersion: "API-Version",
    connected: "Verbunden",
    disconnected: "Getrennt",
    lastChecked: "Zuletzt geprüft",
    lokalCaption: "Lokaler Entwicklungsmodus",
    selfHostedCaption: "Self-hosted-Modus (Container)",
    refreshButton: "Status aktualisieren",
    coreUnreachable:
      "Kern-Infrastruktur (PostgreSQL/Redis) ist nicht erreichbar. Prüfe DATABASE_URL und REDIS_URL in deiner .env-Datei.",
  },

  profile: {
    intro: "Dein Account.",
    email: "E-Mail-Adresse",
    userId: "Benutzer-ID",
  },

  notifications: {
    title: "Browser-Benachrichtigungen",
    intro: "Erhalte Push-Benachrichtigungen für kritische Events (Pipeline-Fehler, Kostenlimits) auch wenn der Tab geschlossen ist.",
    enabled: "Aktiviert auf diesem Gerät",
    disabled: "Nicht aktiviert auf diesem Gerät",
    enable: "Aktivieren",
    disable: "Deaktivieren",
    unsupported: "Push-Notifications werden in diesem Browser nicht unterstützt.",
    permissionDenied: "Berechtigung abgelehnt. Aktiviere sie in den Browser-Einstellungen.",
    permissionDeniedToast: "Berechtigung verweigert. Aktiviere sie in den Browser-Einstellungen.",
    enabledSuccess: "Push-Notifications aktiviert",
    disabledSuccess: "Push-Notifications deaktiviert",
    sendTest: "Test-Notification senden",
    testSent: "Test-Notification gesendet",
    activeDevices: "Aktive Geräte",
    noDevices: "Keine Geräte registriert",
    unknownDevice: "Unbekanntes Gerät",
    subscribedAt: "Registriert {time}",
    lastUsed: "Zuletzt {time}",
    revoke: "Widerrufen",
    deviceRevoked: "Gerät widerrufen",
  },
};
