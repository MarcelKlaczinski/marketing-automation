export default {
  title: "Einstellungen",

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
