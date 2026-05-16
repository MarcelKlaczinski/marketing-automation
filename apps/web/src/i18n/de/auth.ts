export default {
  login: {
    title: "Anmelden",
    subtitle: "Erhalte einen einmaligen Anmelde-Link per E-Mail",
    emailLabel: "E-Mail-Adresse",
    emailPlaceholder: "deine@email.de",
    emailRequired: "E-Mail-Adresse erforderlich",
    emailInvalid: "Ungültige E-Mail-Adresse",
    submitButton: "Magic Link senden",
    sendLink: "Magic Link senden",
    checkInbox: "Link wurde gesendet — bitte prüfe dein Postfach.",
    error: "Fehler beim Senden des Links. Bitte erneut versuchen.",
    successMessage: "E-Mail mit Anmelde-Link versendet. Bitte prüfe dein Postfach.",
    smtpNotConfigured:
      "E-Mail ist nicht konfiguriert. Der Anmelde-Link wird im Server-Log angezeigt (Dev-Modus).",
    checkServerLog: "Anmelde-Link im Server-Log",
    checkServerLogHint:
      'Schaue in der Konsole, in der `apps/api` läuft, nach einem Block mit "🔐 Magic link". Kopiere die URL und füge sie in deinen Browser ein.',
    useDifferentEmail: "Andere E-Mail verwenden",
  },
  verify: {
    loading: "Anmeldung wird überprüft...",
    verifying: "Link wird geprüft...",
    success: "Erfolgreich angemeldet. Weiterleitung...",
    failure: "Anmelde-Link ungültig oder abgelaufen.",
    invalid: "Anmelde-Link ungültig oder abgelaufen.",
    noToken: "Kein Anmelde-Token gefunden.",
    error: "Fehler bei der Anmeldung. Bitte erneut versuchen.",
    backToLogin: "Zurück zur Anmeldung",
    tryAgain: "Erneut versuchen",
  },
};
