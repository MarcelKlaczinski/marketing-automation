export default {
  title: "Planner",
  description: "Wochenplan ansehen und freigeben",

  // Spec 62.7: tab navigation
  tabs: {
    calendar: "Kalender",
    quarantine: "Quarantäne",
  },

  // Spec 62.7: cron-indicator top-right
  cronIndicator: {
    on: "Cron: AN",
    off: "Cron: AUS",
    onTooltip:
      "Automatischer Wochentrigger ist aktiv. Klicken, um in den Einstellungen anzupassen.",
    offTooltip:
      "Automatischer Wochentrigger ist deaktiviert. Klicken, um zu konfigurieren.",
  },

  // Spec 62.7: Quarantine tab
  quarantine: {
    title: "Fehlgeschlagene Plan-Generationen",
    description:
      "Plan-Runs, die fehlgeschlagen sind. Details anzeigen oder einen neuen Lauf für die gleiche Woche starten.",
    empty: "Keine fehlgeschlagenen Plan-Runs — alles läuft sauber.",
    failedBadge: "Fehlgeschlagen",
    planLabel: "Plan KW {n} / {year}",
    triggeredByCron: "cron",
    triggeredByManual: "manuell",
    triggeredByRetry: "retry",
    viewDetails: "Details ansehen",
    retry: "Erneut versuchen",
    retryStarted: "Neuer Plan-Run gestartet",
    retryUnsupported:
      "Dieser Run hat keine Zielwoche im Input — bitte manuell über Kalender starten.",
    retryConfirm: {
      title: "Plan-Generation wiederholen?",
      body: "Neuer Plan-Run für KW {n} / {year} wird gestartet. Vorheriger fehlgeschlagener Run bleibt in der Historie.",
      confirm: "Starten",
      cancel: "Abbrechen",
    },
  },

  // Week navigator
  week: "KW {n} / {year}",
  weekRange: "{start} – {end}",
  prevWeek: "Vorherige Woche",
  nextWeek: "Nächste Woche",
  thisWeek: "Aktuelle Woche",
  pickWeek: "Woche wählen",

  // View toggle
  viewGrid: "Grid",
  viewList: "Liste",
  viewToggleAria: "Ansicht wechseln",

  // Status badges
  planStatus: {
    draft: "Entwurf",
    approved: "Freigegeben",
    running: "Läuft",
    completed: "Abgeschlossen",
    partially_failed: "Teilweise fehlgeschlagen",
    cancelled: "Abgebrochen",
    superseded: "Ersetzt",
  },
  itemStatus: {
    pending: "Ausstehend",
    enqueued: "In Warteschlange",
    in_progress: "Läuft",
    completed: "Abgeschlossen",
    failed: "Fehlgeschlagen",
    skipped: "Übersprungen",
    cancelled: "Abgebrochen",
  },

  // Source-kind badges. Spec 62.4-followup Issue 3: user-friendly labels
  // replace raw enum names. selection_reason (audit detail) surfaces only as
  // a hover tooltip on the badge.
  sourceKind: {
    floor: "Geplant",
    overage_signal: "Trend",
    sibling_locale: "EN-Version",
  },

  // Content-type badges
  contentType: {
    cluster: "Cluster",
    comparison: "Comparison",
    ki_wissen: "KI-Wissen",
    social_post: "Social",
    article: "Artikel",
    refresh: "Refresh",
    translation: "Übersetzung",
  },

  // Budget bar
  budget: {
    label: "Budget",
    used: "€{used} / €{total}",
    percent: "{percent}%",
    tooltip: "Floor: €{floor}  ·  Overage: €{overage}  ·  Sibling: €{sibling}",
    breakdownFloor: "Floor",
    breakdownOverage: "Overage",
    breakdownSibling: "Sibling",
  },

  // Empty / no-plan state
  empty: {
    title: "Kein Plan für diese KW",
    description: "Generiere einen Plan für KW {n} / {year}, um Items hier zu sehen.",
    cta: "Plan für KW {n} generieren",
  },
  emptyDay: "Keine Items",

  // Action bar
  actions: {
    approveAll: "Alle freigeben",
    approveSelected: "Auswahl freigeben ({n})",
    cancelPlan: "Plan abbrechen",
    regenerate: "Neu generieren",
    viewRuns: "Pipeline Runs anzeigen",
    viewRunsComingSoon: "Wird in Spec 62.6 verfügbar",
    generatePlan: "Plan generieren",
    generating: "Generiere Plan …",
  },

  // Generate confirm dialog
  generateConfirm: {
    title: "Plan für KW {n} / {year} generieren?",
    body: "Die Kosten ergeben sich nach Generierung aus dem Budget-Balken. Pipeline läuft typischerweise 1–3 Sekunden.",
    confirm: "Generieren",
    confirmDebug: "Debug-Run starten",
    cancel: "Abbrechen",
    debugToggle: "Debug-Mode (Schritt für Schritt)",
    debugHint:
      "Pausiert nach jedem Step. Du kannst Input/Output prüfen, Prompts anpassen oder einzelne Steps neu ausführen. Springt direkt in die Run-Detail-Ansicht.",
  },
  regenerateConfirm: {
    title: "Aktuellen Plan ersetzen?",
    body: "Der bestehende Plan wird als 'ersetzt' markiert und ein neuer Plan generiert. Das kann nicht rückgängig gemacht werden.",
    confirm: "Ersetzen",
    cancel: "Abbrechen",
  },
  cancelPlanConfirm: {
    title: "Plan abbrechen?",
    body: "Alle ausstehenden Items werden abgebrochen. Das kann nicht rückgängig gemacht werden.",
    confirm: "Abbrechen",
    cancel: "Schließen",
  },
  approveSelectedConfirm: {
    title: "Nicht-ausgewählte Items abbrechen und Plan freigeben?",
    body: "{toCancel} Item(s) werden abgebrochen, danach werden die verbleibenden {toKeep} Item(s) freigegeben. Das kann nicht rückgängig gemacht werden.",
    confirm: "Abbrechen + Freigeben",
    cancel: "Abbrechen",
  },

  // Toasts / errors
  toast: {
    planGenerated: "Plan erstellt",
    planGeneratedDebug: "Debug-Run gestartet — pausiert nach Step 1",
    planApproved: "Plan freigegeben",
    planCancelled: "Plan abgebrochen",
    itemCancelled: "Item abgebrochen",
    itemRescheduled: "Slot-Datum aktualisiert",
    planAlreadyExists: "Plan existiert bereits für diese KW",
    rescheduleOutOfRange: "Datum liegt außerhalb der Plan-Woche",
    actionFailed: "Aktion fehlgeschlagen",
  },

  // Detail page
  detail: {
    back: "Zurück zum Planner",
    title: "Item-Details",
    scheduleSection: "Termin",
    contentSection: "Inhalt",
    costSection: "Kosten",
    pipelineInputSection: "Pipeline-Input",
    siblingSection: "Sibling-Lokal",
    sourceBriefSection: "Quelle",
    fields: {
      date: "Datum",
      planWeek: "Plan-Woche",
      type: "Typ",
      pipeline: "Pipeline",
      source: "Quelle",
      reason: "Begründung",
      estimated: "Geschätzt",
      actual: "Tatsächlich",
      notExecuted: "(noch nicht ausgeführt)",
    },
    editSlotDate: "Termin ändern",
    saveSlotDate: "Speichern",
    cancelEdit: "Abbrechen",
    cancelItem: "Item abbrechen",
    siblingParent: "Übergeordnetes Item",
    siblingChild: "Sibling-Item",
    viewSibling: "Sibling-Item öffnen",
    viewSourceBrief: "Quelle-Brief öffnen",
    noSibling: "Kein Sibling",
    noSourceBrief: "Keine Quelle",
  },

  // Card meta
  card: {
    cost: "€{cost}",
    selectAria: "Item auswählen",
    openAria: "Item-Details öffnen",
    dragHandleAria: "Item ziehen, um Termin zu ändern",
  },

  // Days of week (short labels)
  days: {
    mo: "Mo",
    tu: "Di",
    we: "Mi",
    th: "Do",
    fr: "Fr",
    sa: "Sa",
    su: "So",
  },
};
