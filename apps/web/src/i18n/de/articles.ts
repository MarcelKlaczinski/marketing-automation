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
      resyncDisabledHint: 'Re-sync nur möglich wenn Status "Veröffentlichungsbereit", "Veröffentlicht" oder "PageSpeed blockiert".',
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
    noRunsYet: 'Noch keine Runs.',
    alreadyRunning: 'Pipeline läuft bereits — Aktion wurde nicht erneut ausgelöst',
  },

  runs: {
    type: {
      sync: 'Astro-Sync',
      pagespeed: 'PageSpeed',
      schema: 'Schema.org',
    },
    status: {
      pending: 'Läuft',
      succeeded: 'Erfolgreich',
      failed: 'Fehlgeschlagen',
      errored: 'Fehler',
      budgetExceeded: 'Budget überschritten',
      unknown: 'Unbekannt',
    },
  },

  header: {
    back: 'Zurück',
    cornerstone: 'Cornerstone-Artikel',
    lastUpdated: 'Zuletzt aktualisiert',
  },

  status: {
    proposed: 'Vorgeschlagen',
    approved: 'Freigegeben',
    generating: 'Wird generiert',
    outline_review: 'Outline-Review',
    drafting: 'Wird geschrieben',
    final_review: 'Final-Review',
    schema_extending: 'Schema wird erweitert',
    ready_to_publish: 'Veröffentlichungsbereit',
    validating: 'Wird validiert',
    published: 'Veröffentlicht',
    blocked_by_pagespeed: 'PageSpeed blockiert',
    failed: 'Fehlgeschlagen',
    rejected: 'Abgelehnt',
  },

  metadata: {
    title: 'Titel',
    slug: 'Slug (URL-Pfad)',
    cornerstoneKeyword: 'Cornerstone-Keyword',
    metaDescription: 'Meta-Beschreibung',
    status: 'Status',
    save: 'Speichern',
    saveSuccess: 'Metadaten gespeichert',
    slugHint: 'Nur Kleinbuchstaben, Ziffern und Bindestriche erlaubt',
    statusWarning: 'Status-Änderungen manuell vornehmen — nur für Notfallkorrekturen',
  },

  history: {
    noVersions: 'Noch keine Versionen vorhanden.',
    version: 'Version {n}',
    noReason: '(kein Änderungsgrund)',
    diffModal: {
      title: 'Version {n} vergleichen',
      selected: 'Version {n}',
      current: 'Aktuell',
      loading: 'Lädt Inhalt...',
      close: 'Schließen',
    },
  },

  validation: {
    pagespeed: {
      title: 'PageSpeed-Ergebnisse',
      notRun: 'Noch nicht validiert.',
      testedUrl: 'Getestete URL',
      failedCategories: 'Fehlgeschlagene Kategorien',
      outcome: {
        pass: 'Bestanden',
        fail: 'Nicht bestanden',
        error: 'Fehler',
      },
      categories: {
        performance: 'Performance',
        accessibility: 'Zugänglichkeit',
        'best-practices': 'Best Practices',
        seo: 'SEO',
      },
    },
    schema: {
      title: 'Schema.org-Erweiterung',
      notRun: 'Noch nicht ausgeführt.',
      faqCount: '{count} FAQ-Fragen',
      howtoCount: '{count} Schritte',
      types: {
        breadcrumb: 'Breadcrumb',
        faq: 'FAQ',
        howto: 'HowTo',
      },
      status: {
        pending: 'Ausstehend',
        succeeded: 'Erfolgreich',
        failed: 'Fehlgeschlagen',
      },
    },
  },
};
