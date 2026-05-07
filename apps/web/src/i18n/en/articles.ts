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

  header: {
    back: 'Back',
    cornerstone: 'Cornerstone Article',
    lastUpdated: 'Last updated',
  },

  status: {
    proposed: 'Proposed',
    approved: 'Approved',
    generating: 'Generating',
    outline_review: 'Outline Review',
    drafting: 'Drafting',
    final_review: 'Final Review',
    schema_extending: 'Extending Schema',
    ready_to_publish: 'Ready to Publish',
    validating: 'Validating',
    published: 'Published',
    blocked_by_pagespeed: 'PageSpeed Blocked',
    failed: 'Failed',
    rejected: 'Rejected',
  },

  metadata: {
    title: 'Title',
    slug: 'Slug (URL path)',
    cornerstoneKeyword: 'Cornerstone Keyword',
    metaDescription: 'Meta Description',
    status: 'Status',
    save: 'Save',
    saveSuccess: 'Metadata saved',
    slugHint: 'Lowercase letters, digits, and hyphens only',
    statusWarning: 'Status changes are manual — for emergency recovery only',
  },

  history: {
    noVersions: 'No versions yet.',
    version: 'Version {n}',
    noReason: '(no change reason)',
    diffModal: {
      title: 'Compare version {n}',
      selected: 'Version {n}',
      current: 'Current',
      loading: 'Loading content...',
      close: 'Close',
    },
  },

  validation: {
    pagespeed: {
      title: 'PageSpeed Results',
      notRun: 'Not validated yet.',
      testedUrl: 'Tested URL',
      failedCategories: 'Failed categories',
      outcome: {
        pass: 'Passed',
        fail: 'Failed',
        error: 'Error',
      },
      categories: {
        performance: 'Performance',
        accessibility: 'Accessibility',
        'best-practices': 'Best Practices',
        seo: 'SEO',
      },
    },
    schema: {
      title: 'Schema.org Extension',
      notRun: 'Not yet executed.',
      faqCount: '{count} FAQ questions',
      howtoCount: '{count} steps',
      types: {
        breadcrumb: 'Breadcrumb',
        faq: 'FAQ',
        howto: 'HowTo',
      },
      status: {
        pending: 'Pending',
        succeeded: 'Succeeded',
        failed: 'Failed',
      },
    },
  },
};
