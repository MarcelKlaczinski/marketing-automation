export default {
  title: "Erste Einrichtung",
  intro:
    "Dieser Assistent führt dich durch die Einrichtung aller externen Dienste. Du kannst einzelne Schritte überspringen und später nachholen.",
  alreadyInitialized:
    "Das System wurde bereits eingerichtet. Du kannst hier einzelne Adapter neu konfigurieren oder verifizieren.",

  step: "Schritt {current} von {total}",
  back: "Zurück",
  next: "Weiter",
  skip: "Überspringen",
  finish: "Fertig",

  status: {
    pending: "Ausstehend",
    configured: "Konfiguriert",
    verified: "Verifiziert",
    failed: "Verifizierung fehlgeschlagen",
    skipped: "Übersprungen",
  },

  save: {
    save: "Speichern",
    update: "Aktualisieren",
    saved: "Gespeichert",
  },

  verify: {
    button: "Jetzt verifizieren",
    inProgress: "Wird verifiziert...",
    success: "Verbindung erfolgreich",
    failure: "Verbindung fehlgeschlagen: {message}",
  },

  skipDialog: {
    title: "Schritt überspringen?",
    intro: "Wenn du diesen Schritt überspringst, sind die folgenden Funktionen nicht verfügbar:",
    confirm: "Verstanden, überspringen",
    cancel: "Abbrechen",
  },

  adapters: {
    verified: "Konfiguriert und verifiziert",
    configuredNotVerified: "Konfiguriert, nicht verifiziert",
    notConfigured: "Nicht konfiguriert",
  },

  validation: {
    required: "Pflichtfeld",
  },

  steps: {
    intro: {
      title: "Willkommen",
      description:
        "Diese Plattform automatisiert SEO- und Content-Workflows. Bevor du loslegen kannst, müssen einige externe Dienste eingerichtet werden.",
      timeEstimate: "Geschätzte Dauer: 30-60 Minuten",
    },
    core: {
      title: "Kern-Infrastruktur",
      description:
        "Datenbank und Redis. Diese sind über Umgebungsvariablen konfiguriert und können nicht im Browser geändert werden.",
      postgresLabel: "PostgreSQL",
      redisLabel: "Redis",
      configHint: "Setze DATABASE_URL und REDIS_URL in der `.env` und starte den API-Server neu.",
    },
    smtp: {
      title: "E-Mail (SMTP)",
      description: "Wird für Magic-Link-Anmeldung benötigt. Empfohlen: Gmail mit App-Password.",
      consequenceIfSkipped:
        "Magic-Link-Login wird in der Konsole protokolliert (Dev-Modus). Cost-Alerts und Benachrichtigungen werden nicht versendet.",
      fields: {
        host: "SMTP-Host",
        port: "Port",
        user: "Benutzername",
        password: "Passwort",
        fromAddress: "Absender-Adresse",
      },
      hint: "Gmail-Setup: Aktiviere 2-Faktor-Auth, dann erstelle ein App-Passwort unter https://myaccount.google.com/apppasswords",
    },
    anthropic: {
      title: "Anthropic API",
      description:
        "Wird für Cold-Start-Synthese, Article-Generierung und Schema-Erweiterungen benötigt.",
      consequenceIfSkipped:
        "Folgende Funktionen sind nicht verfügbar: Cold-Start, Article-Generierung, Schema-Extraktion, Internal Linking. Tatsächlich: fast alles.",
      fields: {
        apiKey: "API-Key",
      },
      hint: "Erhalte den Key unter https://console.anthropic.com/settings/keys",
    },
    replicate: {
      title: "Replicate",
      description: "Wird für die Generierung von Hero-Bildern (Flux 1.1 Pro) verwendet.",
      consequenceIfSkipped:
        "Hero-Image-Generierung im Article-Pipeline ist nicht verfügbar. Articles werden ohne Hero-Image erstellt.",
      fields: {
        apiToken: "API-Token",
      },
      hint: "Token erhältlich unter https://replicate.com/account/api-tokens",
    },
    r2: {
      title: "Cloudflare R2",
      description: "Speicher für generierte Hero-Bilder. Wird in Astro Sync direkt referenziert.",
      consequenceIfSkipped:
        "Replicate funktioniert nicht ohne R2 (Bilder können nicht gespeichert werden). Indirekte Konsequenz: keine Article-Generierung.",
      fields: {
        accountId: "Account ID",
        accessKeyId: "Access Key ID",
        secretAccessKey: "Secret Access Key",
        bucket: "Bucket Name",
        publicBaseUrl: "Public Base URL",
      },
      hint: "Erstelle Bucket + R2-Token unter https://dash.cloudflare.com/?to=/:account/r2",
    },
    dataforseo: {
      title: "DataForSEO",
      description: "Liefert SERP-Daten und Keyword-Volumen für Cold-Start und Article-Research.",
      consequenceIfSkipped:
        "Cold-Start Wettbewerber-Analyse, Cluster-Plan, und Article-Research funktionieren nicht. Cold-Start ist faktisch blockiert.",
      fields: {
        login: "Login",
        password: "Passwort",
      },
      hint: "Account mit $50 Deposit unter https://app.dataforseo.com/register",
    },
    githubApp: {
      title: "GitHub App",
      description: "Push von Articles in das Astro-Repository.",
      consequenceIfSkipped:
        "Astro-Sync-Funktion ist nicht verfügbar. Articles bleiben in der DB, müssen manuell ins Astro-Repo kopiert werden.",
      fields: {
        appId: "App ID",
        privateKeyPath: "Pfad zum Private Key (.pem)",
        privateKeyContent: "Private Key Inhalt (PEM)",
      },
      hint: "Setup-Anleitung: packages/adapters/astro-sync/SETUP-GITHUB-APP.md",
      hintPathPlaceholder: "/Users/you/.ssh/my-github-app.pem",
      hintPemPlaceholder: "-----BEGIN RSA PRIVATE KEY-----",
      modeNoteLokal: "Lokaler Modus: Pfad zur PEM-Datei auf deinem Mac.",
      modeNoteSelfHosted:
        "Self-Hosted-Modus: Inhalt der PEM-Datei einfügen (wird verschlüsselt gespeichert).",
    },
    producthunt: {
      title: "Product Hunt API",
      description: "Wird vom Signal-Collector (Spec 54.4) verwendet, um täglich neue AI-Tool-Launches von Product Hunt abzurufen.",
      consequenceIfSkipped:
        "Product-Hunt-Signale werden nicht gesammelt. HN- und RSS-Quellen laufen weiterhin.",
      fields: {
        apiKey: "API-Key (Client ID)",
        apiSecret: "API-Secret (Client Secret)",
      },
      hint: "OAuth-App unter https://www.producthunt.com/v2/oauth/applications anlegen → Client ID und Client Secret kopieren.",
    },
    summary: {
      title: "Zusammenfassung",
      readyTitle: "Du kannst loslegen",
      readyDescription:
        "Alle Pflicht-Adapter sind konfiguriert. Klicke auf Fertig um zur App zu wechseln.",
      partialTitle: "Setup teilweise abgeschlossen",
      partialDescription:
        "Einige Adapter sind übersprungen. Du kannst sie unter Einstellungen jederzeit nachholen.",
      finishButton: "Fertig — zur App",
    },
  },
};
