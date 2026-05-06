export default {
  title: 'Einstellungen',

  tabs: {
    adapters: 'Adapter',
    system: 'System',
    profile: 'Profil',
  },

  adapters: {
    intro: 'Verwalte die Verbindungen zu externen Diensten. Klicke auf einen Adapter um die Konfiguration zu ändern.',
    disconnect: 'Verbindung trennen',
    status: {
      verified: 'Verifiziert',
      configured: 'Konfiguriert',
      notConfigured: 'Nicht konfiguriert',
    },
    disconnectDialog: {
      title: 'Verbindung wirklich trennen?',
      description: 'Alle gespeicherten Anmeldedaten für {adapter} werden gelöscht. Du kannst sie jederzeit erneut konfigurieren.',
      confirm: 'Trennen',
      success: 'Verbindung getrennt',
    },
  },

  system: {
    intro: 'Status der Kern-Infrastruktur und Systemmetadaten.',
    deploymentMode: 'Modus',
    apiVersion: 'API-Version',
    connected: 'Verbunden',
    disconnected: 'Getrennt',
    lastChecked: 'Zuletzt geprüft',
    lokalCaption: 'Lokaler Entwicklungsmodus',
    selfHostedCaption: 'Self-hosted-Modus (Container)',
    refreshButton: 'Status aktualisieren',
    coreUnreachable: 'Kern-Infrastruktur (PostgreSQL/Redis) ist nicht erreichbar. Prüfe DATABASE_URL und REDIS_URL in deiner .env-Datei.',
  },

  profile: {
    intro: 'Dein Account.',
    email: 'E-Mail-Adresse',
    userId: 'Benutzer-ID',
  },
};
