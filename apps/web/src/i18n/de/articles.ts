export default {
  empty: 'Noch keine Artikel.',
  emptyHint: 'Artikel werden über den Cold-Start (Phase 4) oder per CLI erstellt.',

  toolbar: {
    byPillar: 'Nach Pillar',
    byCluster: 'Nach Cluster',
    totalCount: '{count} Artikel',
  },

  lane: {
    uncategorized: 'Ohne Cluster',
    empty: '—',
  },

  statusGroup: {
    to_review: 'Review',
    in_progress: 'In Arbeit',
    ready: 'Fertig',
    issues: 'Probleme',
  },

  card: {
    cornerstone: 'Cornerstone',
    words: 'Wörter',
  },

  detail: {
    notFound: 'Artikel nicht gefunden',
    tabs: {
      body: 'Inhalt',
      metadata: 'Metadaten',
      history: 'Versionen',
      validation: 'Validierung',
    },
  },

  body: {
    save: 'Speichern',
    discard: 'Verwerfen',
    saveSuccess: 'Inhalt gespeichert',
    resyncTriggered: 'Re-Sync zu Astro gestartet',
    saveDialog: {
      title: 'Änderungen speichern',
      changeReason: 'Änderungsgrund (optional)',
      changeReasonPlaceholder: 'z.B. "Intro überarbeitet" oder "Faktencheck korrigiert"',
      resyncAfterSave: 'Nach dem Speichern automatisch zu Astro re-syncen',
      confirm: 'Speichern',
    },
  },

  actions: {
    pipelineActions: 'Pipeline-Aktionen',
    lastRunStatus: 'Letzte Runs',
    generateOutline: 'Outline generieren',
    generateDraft: 'Draft generieren',
    syncToAstro: 'Zu Astro syncen',
    validatePagespeed: 'PageSpeed validieren',
    extendSchema: 'Schema.org erweitern',
    triggered: 'Aktion gestartet: {action}',
    notAvailable: 'Aktion nicht verfügbar im aktuellen Status',
  },
};
