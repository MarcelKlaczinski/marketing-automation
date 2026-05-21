export default {
  title: "Briefs",

  sections: {
    pending: "Ausstehend",
    pendingDescription: "Nach Trend-Score sortiert — höchste Priorität zuerst.",
    pendingEmpty: { title: "Keine ausstehenden Briefs", description: "Alle Briefs wurden bearbeitet." },
    inFlight: "In Bearbeitung",
    inFlightDescription: "Briefs die genehmigt wurden und deren Pipeline läuft.",
    inFlightEmpty: { title: "Keine aktiven Briefs", description: "Genehmige Briefs um Pipelines zu starten." },
    done: "Abgeschlossen",
    doneDescription: "Abgelehnte und abgeschlossene Briefs.",
    doneEmpty: { title: "Noch keine erledigten Briefs", description: "" },
  },

  bulk: {
    approveSelected: "Ausgewählte genehmigen",
    dismissSelected: "Ausgewählte ablehnen",
    confirmTitle: "Briefs genehmigen",
    confirmDescription: "{count} Brief(s) werden genehmigt.",
    estimatedCost: "Geschätzte Kosten",
    estimatedTime: "Geschätzte Zeit",
    modeAssist: "Assist (einzelne Artikel)",
    modeAuto: "Auto (Cluster-Erstellung)",
    confirm: "Genehmigen",
    success: "{approved} genehmigt, {skipped} übersprungen, {failed} fehlgeschlagen",
    approveSuccess: "{count} Brief(s) genehmigt",
    dismissSuccess: "Briefs abgelehnt",
    dismissConfirmTitle: "Briefs ablehnen",
    dismissConfirmDescription: "{count} Brief(s) werden abgelehnt.",
  },

  // Spec 63.6: dispatch picker for brief-approval (plan vs immediate).
  bulkApprove: {
    dispatchLabel: "Dispatch-Modus",
    plan: "In nächsten Plan einplanen",
    planHint:
      "Briefs landen im Plan-Pool. Generation startet erst, wenn du den nächsten Wochenplan freigibst — Budget-Gate aktiv.",
    planSuccess: "{count} Brief(s) für nächsten Plan vorgemerkt",
    immediate: "Jetzt sofort generieren",
    immediateHint:
      "Artikel werden sofort erzeugt. Das wöchentliche Budget-Gate wird umgangen — nur für Edge-Cases empfohlen.",
    immediateSuccess: "{count} Brief(s) — Generation läuft",
    immediateConfirmTitle: "Sofort generieren bestätigen",
  },

  actions: {
    approve: "Genehmigen",
    assignCluster: "Cluster zuweisen",
    dismiss: "Ablehnen",
    approveSuccess: "Brief genehmigt — Pipeline gestartet",
    dismissSuccess: "Brief abgelehnt",
  },

  fields: {
    title: "Vorgeschlagener Titel",
    slug: "Vorgeschlagener Slug",
    meta: "Meta-Beschreibung",
    primaryKeyword: "Primäres Keyword",
    clusterAction: "Cluster-Aktion",
  },

  detail: {
    suggestion: "KI-Vorschlag",
    trend: "Trend-Daten",
    refresh: "Refresh-Kontext",
    needsCluster: "Dieser Brief erfordert zuerst die Zuweisung eines Clusters.",
    empty: "Brief auswählen",
    emptyDescription: "Klicke links auf einen Brief um Details zu sehen.",
  },

  selectBrief: "Brief auswählen",

  approvalStatus: {
    pending: "Ausstehend",
    plan_pending: "Im Plan-Pool",
    approved: "Genehmigt",
    auto_approved: "Auto-Genehmigt",
    rejected: "Abgelehnt",
    routed: "Weitergeleitet",
    superseded: "Überholt",
  },

  source: {
    gap_analysis: "Gap-Analyse",
    trend_discovery: "Trend",
    refresh_detection: "Refresh",
    manual: "Manuell",
    comparison_discovery: "Vergleichs-Entdeckung",
  },

  clusterAction: {
    append_to_existing: "Zu Cluster hinzufügen",
    create_new: "Neuer Cluster",
    translation: "Übersetzung",
    refresh: "Refresh",
    standalone: "Standalone",
    comparison: "Vergleich",
  },

  filters: {
    label: "Quelle",
    all: "Alle",
    clear: "Filter zurücksetzen",
    readinessLabel: "Status",
    readinessAll: "Alle",
    readinessReady: "Approve-bereit",
    readinessUnready: "Nicht angereichert",
    readinessPlanReady: "Im Plan-Pool",
  },
};
