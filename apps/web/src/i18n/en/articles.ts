export default {
  tabs: {
    generated: "Generated",
    imported: "Imported",
  },

  imported: {
    syncFromRepo: "Import from Repo",
    syncStarted: "Import started",
    loading: "Loading...",
    noData: "No imported articles yet. Click 'Import from Repo' to start.",
    noPendant: "no pendant",
    noDeVersion: "No DE version",
    noEnVersion: "No EN version",
    collections: {
      blog: "Blog",
      "ki-wissen": "KI-Wissen",
      comparisons: "Comparisons",
      usecases: "Use Cases",
      tools: "Tools",
      "tool-categories": "Tool Categories",
      authors: "Authors",
      "special-landings": "Special Landings",
    },
  },

  empty: "No articles yet.",
  emptyHint: "Articles are created via Cold-Start (Phase 4) or via CLI.",

  toolbar: {
    byPillar: "By Pillar",
    byCluster: "By Cluster",
    totalCount: "{count} articles",
    countWithTotal: "{count} / {total} articles",
  },

  kanban: {
    loadMore: "Load more ({remaining} more)",
  },

  lane: {
    uncategorized: "Uncategorized",
    empty: "—",
  },

  statusGroup: {
    to_review: "Review",
    in_progress: "In Progress",
    ready: "Ready",
    issues: "Issues",
  },

  card: {
    cornerstone: "Cornerstone",
    words: "words",
  },

  locale: {
    noTranslation: "No {locale} version yet — create one via Pipeline Actions",
  },

  detail: {
    notFound: "Article not found",
    tabs: {
      body: "Body",
      metadata: "Metadata",
      history: "History",
      validation: "Validation",
      frontmatter: "Frontmatter",
    },
  },

  frontmatter: {
    title: "Generated Frontmatter",
    copy: "Copy",
    copied: "Frontmatter copied",
    empty: "No frontmatter available yet",
    previewBtn: "Open in Astro",
    previewHint: "Writes the .mdx file to your local Astro project. Set the path as astroRepo.localPath on the project in the DB. Run astro dev separately.",
    // Spec 50: schema-awareness + editor
    noSchema: "No schema stored. Run an Astro import first so collection fields are known.",
    runImport: "Run Astro Import",
    importStarted: "Import started — schema will load shortly",
    importError: "Could not start import",
    fieldsTitle: "Structured Fields",
    suggestAll: "AI Suggestions",
    suggestDone: "Suggestions applied and saved",
    suggestError: "Suggestions failed",
    saveSuccess: "Fields saved",
    addTag: "Add tag…",
    addItem: "Add item",
    faqQuestion: "Question",
    faqAnswer: "Answer",
    fields: {
      category: "Category",
      intentType: "Intent Type",
      tags: "Tags",
      faq: "FAQ",
      clusterRole: "Cluster Role",
    },
  },

  body: {
    outlineTitle: "Generated Outline",
    draftTitle: "Draft",
    save: "Save",
    discard: "Discard",
    saveSuccess: "Content saved",
    resyncTriggered: "Re-sync to Astro started",
    saveDialog: {
      title: "Save changes",
      changeReason: "Change reason (optional)",
      changeReasonPlaceholder: 'e.g. "Revised intro" or "Fixed factual error"',
      resyncAfterSave: "Automatically re-sync to Astro after saving",
      resyncDisabledHint:
        'Re-sync only available when status is "Ready to Publish", "Published", or "PageSpeed Blocked".',
      confirm: "Save",
    },
  },

  actions: {
    pipelineActions: "Pipeline Actions",
    lastRunStatus: "Recent Runs",
    generateOutline: "Generate Outline",
    generateDraft: "Generate Draft",
    syncToAstro: "Sync to Astro",
    validatePagespeed: "Validate PageSpeed",
    validatePagespeedLocal: "Validate locally (Lighthouse)",
    validatePagespeedApi: "Validate live (Google PSI)",
    validatePagespeedApiDisabled: "Production domain not set — add it in project settings",
    outlineNeedsTitle: "Please set a title first — it guides the outline AI",
    pagespeedNotSynced: "Article must be synced to Astro first",
    extendSchema: "Extend Schema.org",
    generateHero: "Generate Hero Image",
    heroNeedsOutline: "Generate outline first — the image prompt comes from it",
    heroDialogTitle: "Generate Hero Image",
    heroDialogHint: "Prompt from the outline — edit if needed before generating.",
    heroPromptLabel: "Image prompt (Flux 1.1 Pro)",
    heroStyle: "Style",
    heroGenerate: "Generate",
    heroTriggered: "Hero image generation started",
    triggered: "Action started: {action}",
    notAvailable: "Action not available in current status",
    noRunsYet: "No runs yet.",
    alreadyRunning: "Pipeline already running — action was not triggered again",
    runningStep: "Running: {step}",
    createLocaleVersion: "Create {locale} version",
    localizeDialogTitle: "Create {locale} version",
    localizeDialogHint: "Choose a method for the new language version.",
    localizeTranslateTitle: "Cultural translation (recommended)",
    localizeTranslateHint: "The existing article is linguistically and culturally adapted — not a word-for-word translation. Country-specific content, laws, and examples are rewritten for the target market.",
    localizeFreshTitle: "Fresh generation (keyword-optimised)",
    localizeFreshHint: "The title is translated and a new stub article is created. Then generate outline and draft separately for the target market.",
    localizeStart: "Start",
    localizeTriggered: "{locale} version is being created",
    localeLabel: { en: "English", de: "Deutsch" },
  },

  runs: {
    type: {
      sync: "Astro Sync",
      pagespeed: "PageSpeed",
      schema: "Schema.org",
      outline: "Generate Outline",
      draft: "Generate Draft",
      hero: "Hero Image",
      localize: "Language version",
    },
    status: {
      queued: "Queued",
      running: "Running",
      completed: "Completed",
      pending: "Running",
      succeeded: "Succeeded",
      failed: "Failed",
      errored: "Error",
      budgetExceeded: "Budget exceeded",
      unknown: "Unknown",
    },
  },

  header: {
    back: "Back",
    cornerstone: "Cornerstone Article",
    lastUpdated: "Last updated",
  },

  status: {
    proposed: "Proposed",
    approved: "Approved",
    generating: "Generating",
    outline_review: "Outline Review",
    drafting: "Drafting",
    final_review: "Final Review",
    schema_extending: "Extending Schema",
    ready_to_publish: "Ready to Publish",
    validating: "Validating",
    published: "Published",
    blocked_by_pagespeed: "PageSpeed Blocked",
    failed: "Failed",
    rejected: "Rejected",
  },

  metadata: {
    title: "Title",
    slug: "Slug (URL path)",
    cornerstoneKeyword: "Cornerstone Keyword",
    metaDescription: "Meta Description",
    status: "Status",
    save: "Save",
    saveSuccess: "Metadata saved",
    slugHint: "Lowercase letters, digits, and hyphens only",
    statusWarning: "Status changes are manual — for emergency recovery only",
  },

  history: {
    noVersions: "No versions yet.",
    version: "Version {n}",
    noReason: "(no change reason)",
    diffModal: {
      title: "Compare version {n}",
      selected: "Version {n}",
      current: "Current",
      loading: "Loading content...",
      close: "Close",
    },
  },

  validation: {
    pagespeed: {
      title: "PageSpeed Results",
      notRun: "Not validated yet.",
      testedUrl: "Tested URL",
      failedCategories: "Failed categories",
      outcome: {
        pass: "Passed",
        fail: "Failed",
        error: "Error",
      },
      categories: {
        performance: "Performance",
        accessibility: "Accessibility",
        "best-practices": "Best Practices",
        seo: "SEO",
      },
    },
    schema: {
      title: "Schema.org Extension",
      notRun: "Not yet executed.",
      faqCount: "{count} FAQ questions",
      howtoCount: "{count} steps",
      types: {
        breadcrumb: "Breadcrumb",
        faq: "FAQ",
        howto: "HowTo",
      },
      status: {
        pending: "Pending",
        succeeded: "Succeeded",
        failed: "Failed",
      },
    },
  },
};
