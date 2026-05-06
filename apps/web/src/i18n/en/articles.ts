export default {
  empty: 'No articles yet.',
  emptyHint: 'Articles are created via Cold-Start (Phase 4) or via CLI.',

  toolbar: {
    byPillar: 'By Pillar',
    byCluster: 'By Cluster',
    totalCount: '{count} articles',
  },

  lane: {
    uncategorized: 'Uncategorized',
    empty: '—',
  },

  statusGroup: {
    to_review: 'Review',
    in_progress: 'In Progress',
    ready: 'Ready',
    issues: 'Issues',
  },

  card: {
    cornerstone: 'Cornerstone',
    words: 'words',
  },

  detail: {
    notFound: 'Article not found',
    tabs: {
      body: 'Body',
      metadata: 'Metadata',
      history: 'History',
      validation: 'Validation',
    },
  },

  body: {
    save: 'Save',
    discard: 'Discard',
    saveSuccess: 'Content saved',
    resyncTriggered: 'Re-sync to Astro started',
    saveDialog: {
      title: 'Save changes',
      changeReason: 'Change reason (optional)',
      changeReasonPlaceholder: 'e.g. "Revised intro" or "Fixed factual error"',
      resyncAfterSave: 'Automatically re-sync to Astro after saving',
      confirm: 'Save',
    },
  },

  actions: {
    pipelineActions: 'Pipeline Actions',
    lastRunStatus: 'Recent Runs',
    generateOutline: 'Generate Outline',
    generateDraft: 'Generate Draft',
    syncToAstro: 'Sync to Astro',
    validatePagespeed: 'Validate PageSpeed',
    extendSchema: 'Extend Schema.org',
    triggered: 'Action started: {action}',
    notAvailable: 'Action not available in current status',
  },
};
