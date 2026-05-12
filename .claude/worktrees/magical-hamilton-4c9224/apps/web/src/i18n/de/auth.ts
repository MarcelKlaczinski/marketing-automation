export default {
  login: {
    title: "Anmelden",
    subtitle: "Erhalte einen einmaligen Anmelde-Link per E-Mail",
    emailLabel: "E-Mail-Adresse",
    emailRequired: "E-Mail-Adresse erforderlich",
    emailInvalid: "Ungültige E-Mail-Adresse",
    submitButton: "Magic Link senden",
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
    success: "Erfolgreich angemeldet. Weiterleitung...",
    failure: "Anmelde-Link ungültig oder abgelaufen.",
    tryAgain: "Erneut versuchen",
  },
};
