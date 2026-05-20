export default {
  title: "Article Tools",
  description: "Tools for manual article control.",

  tabs: {
    generate: "Generate new article",
    manual: "Manual actions",
  },

  intents: {
    overview: "Overview",
    general: "General",
    review: "Test & Review",
    comparison: "Comparison",
    pricing: "Pricing",
    tutorial: "Tutorial",
    "use-cases": "Use Cases",
    features: "Features",
  },

  generate: {
    title: "Generate new article",
    description: "Start the article pipeline with a free topic.",
    submit: "Start pipeline",
    successMessage: "Article pipeline started",
    errorMessage: "Error starting pipeline",
    estimatedCost: "Estimated cost",
    estimatedTime: "Estimated time",
    fields: {
      topic: "Topic",
      topicHelper: "Title or core topic of the article (min. 5 characters)",
      primaryKeyword: "Primary keyword",
      collection: "Collection",
      locale: "Language",
      intentType: "Intent type",
      author: "Author",
      authorHelper: "Leave empty for automatic selection",
      cluster: "Cluster",
      clusterHelper: "Optional: assign article to an existing cluster",
      wordCount: "Target word count",
      approvalMode: "Approval mode",
      toolSlugs: "Tools to compare",
      toolSlugsHelper: "Select 2 to 4 tools from the tools collection",
      toolSlugsEmpty: "No tools available in this collection",
    },
    noCluster: "No cluster (standalone)",
    placeholders: {
      topic: "e.g. The best AI code editors 2025",
      primaryKeyword: "e.g. ai-code-editor",
      authorSlug: "Author slug (empty = automatic)",
    },
  },

  manual: {
    searchPlaceholder: "Search articles…",
    emptyTitle: "No article selected",
    emptyDescription: "Search for an article and select it.",
    noResults: "No articles found",
    noResultsDescription: "Try adjusting your search.",

    groups: {
      pipeline: "Pipeline steps",
      content: "Content operations",
      deploy: "Publishing",
    },

    actions: {
      outline: {
        title: "Generate outline",
        description: "Re-run the outline step",
      },
      draft: {
        title: "Generate draft",
        description: "Re-run the draft step",
      },
      heroImage: {
        title: "Generate hero image",
        description: "Re-generate image via Replicate",
      },
      schema: {
        title: "Extend schema",
        description: "Re-generate JSON-LD schema",
      },
      refresh: {
        title: "Refresh article",
        description: "Fully regenerate article (incurs cost)",
      },
      localize: {
        title: "Localize",
        description: "Generate or update EN counterpart",
      },
      continue: {
        title: "Continue",
        description: "Resume pipeline from last step",
      },
      sync: {
        title: "Synchronize",
        description: "Transfer article to Astro repo",
      },
      pagespeed: {
        title: "Check PageSpeed",
        description: "Start Lighthouse measurement",
      },
      preview: {
        title: "Preview",
        description: "Open local preview",
      },
    },

    confirmRefresh: {
      title: "Refresh article?",
      message: "Refresh fully regenerates the article (approx. €0.40 cost). Continue?",
    },

    triggerSuccess: "{action} started",
    triggerError: "Error starting action",
  },
};
