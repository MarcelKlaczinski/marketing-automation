export default {
  title: 'Kosten',
  detailLogs: 'Detail-Logs',

  summary: {
    thisMonth: 'Dieser Monat',
    lastMonth: 'Letzter Monat',
    thisYear: 'Dieses Jahr',
    dailyAvg: 'Tagesdurchschnitt',
    dailyAvgHint: 'Tagesschnitt aktueller Monat',
    vsLastMonth: 'vs. letzten Monat',
  },

  charts: {
    byService: 'Kosten nach Service',
    daily: 'Täglicher Verlauf (aktueller Monat)',
    byOperation: 'Kosten nach Operation',
    noData: 'Keine Daten für diesen Zeitraum',
  },

  services: {
    anthropic: 'Anthropic',
    replicate: 'Replicate',
    dataforseo: 'DataForSEO',
    smtp: 'SMTP',
  },

  thresholdTypes: {
    daily: 'Täglich',
    monthly: 'Monatlich',
  },

  filters: {
    project: 'Projekt',
    allProjects: 'Alle Projekte',
    service: 'Service',
    operation: 'Operation',
    operationPlaceholder: 'z.B. outline-generation',
  },

  table: {
    date: 'Datum',
    project: 'Projekt',
    service: 'Service',
    operation: 'Operation',
    callCount: 'Aufrufe',
    totalEur: 'Summe',
    of: 'von',
    noResults: 'Keine Treffer für diese Filter',
  },

  alerts: {
    title: '{count} aktive Kostenwarnungen',
  },

  errors: {
    limitExceeded: 'Kostenlimit erreicht. Pipeline pausiert.',
  },
};
