export default {
  title: "Pipeline Dashboard",
  liveStatus: "{running} laufend · {queued} wartend · €{cost} heute",

  stats: {
    activeRuns: "Aktive Runs",
    costMonth: "Kosten diesen Monat",
    articlesWeek: "Artikel diese Woche",
    successRate: "Erfolgsquote (24h)",
    running: "laufend",
    queued: "wartend",
    noTrend: "—",
    trendUp: "+{n}% ggü. Vorperiode",
    trendDown: "{n}% ggü. Vorperiode",
    trendNeutral: "Keine Veränderung",
  },

  filter: {
    last24h: "Letzte 24h",
    filter: "Filter",
  },

  lanes: {
    queued: "Wartend",
    running: "Laufend",
    failed: "Fehlerhaft",
    completed: "Abgeschlossen",
    empty: "Keine Runs",
    emptyDesc: "Im Moment nichts in dieser Lane.",
  },

  pipeline: {
    types: {
      blog: "Blog",
      translation: "Übersetzung",
      refresh: "Refresh",
      cluster: "Cluster",
      "cluster-creator": "Cluster",
      "cold-start": "Setup",
      default: "Pipeline",
    },
    stepOf: "Schritt {current}/{total}",
    elapsed: "Läuft seit {time}",
    ago: "vor {time}",
    costLabel: "€{cost}",
  },

  clusters: {
    title: "Aktive Cluster",
    empty: "Keine aktiven Cluster",
    emptyDesc: "Cluster mit laufender Generierung erscheinen hier.",
    progress: "{done}/{total} Artikel",
    pillsLabel: "Artikel-Statuspillen",
  },

  detail: {
    noSelection: "Keinen Run ausgewählt",
    noSelectionDesc: "Klicke eine Karte um Details, Schritte und Kosten zu sehen.",
    steps: "Schritte",
    noSteps: "Noch keine Schritte",
    cost: "Kosten",
    costSpent: "Ausgegeben",
    costEstimated: "Geschätzt",
    wordCount: "Wörter",
    author: "Autor",
    loadError: "Konnte Run nicht laden.",
    actions: {
      open: "Öffnen",
      retry: "Wiederholen",
      cancel: "Abbrechen",
      pause: "Pausieren",
    },
  },
};
