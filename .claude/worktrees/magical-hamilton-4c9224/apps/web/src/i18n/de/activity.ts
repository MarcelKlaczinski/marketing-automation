export default {
  title: "Aktivität",
  subtitle: "{count} aktiv",
  empty: "Keine Aktivität",
  emptyHint: "In diesem Zeitraum gab es keine Pipeline-Runs.",

  filters: {
    project: "Projekt",
    allProjects: "Alle Projekte",
    type: "Typ",
    status: "Status",
    since: "Zeitraum",
  },

  since: {
    "24h": "Letzte 24h",
    "7d": "Letzte 7 Tage",
    "30d": "Letzte 30 Tage",
  },

  types: {
    cold_start: "Cold-Start",
    article_outline: "Outline",
    article_draft: "Draft",
    astro_sync: "Sync",
    pagespeed: "PageSpeed",
    schema_extension: "Schema",
    link_rebuild: "Links",
    other: "Andere",
  },

  statuses: {
    queued: "Wartend",
    running: "Läuft",
    completed: "Fertig",
    failed: "Fehler",
    cancelled: "Abgebrochen",
  },

  relative: {
    justNow: "gerade eben",
    minutesAgo: "vor {n} Min",
    hoursAgo: "vor {n} Std",
    daysAgo: "vor {n} Tagen",
  },
};
