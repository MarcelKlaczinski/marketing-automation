/**
 * Spec 65.11 — Recurring-Content / Hook-Library / End-Slide Settings i18n (EN).
 */
export default {
  definitions: {
    title: "Recurring Content",
    description:
      "Recurring carousel definitions — Marcel-defined name, frequency, format config, template strategy.",
    empty:
      "No definitions yet — create one to start a recurring carousel rhythm.",
    loadError: "Failed to load definitions.",
    newDefinition: "New definition",
    columns: {
      name: "Name",
      formatType: "Format",
      frequency: "Frequency",
      nextRun: "Next run",
      active: "Active",
    },
    filters: {
      formatType: "Filter format-type",
      formatTypeAll: "All formats",
      includeInactive: "Include inactive",
    },
    inactiveChip: "Inactive",
    rowOpen: "Open",

    detail: {
      title: "Definition detail",
      tabs: {
        config: "Config",
        history: "History",
        upcoming: "Upcoming runs",
      },
      actions: {
        toggleActivate: "Activate",
        toggleDeactivate: "Deactivate",
        runNow: "Run now",
        runNowConfirm:
          "Schedule an additional manual brief generation. The regular schedule is unaffected.",
        runNowSuccess: "Run-now job enqueued.",
        dryRun: "Preview (dry-run)",
        dryRunHint:
          "Dry-run costs the same as a real run — every LLM call is real, but nothing is persisted.",
        dryRunSuccess: "Preview produced.",
        dryRunFailed: "Preview failed.",
      },
      runNowDialog: {
        title: "Confirm Run-Now",
        message:
          "An additional brief is generated immediately. The regular weekly schedule is unchanged.",
      },
      dryRunResult: {
        title: "Dry-run result",
        statusPersisted: "Persisted",
        statusSkipped: "Skipped",
        statusPreview: "Preview (not saved)",
        templateLabel: "Template",
        templateVia: "Strategy",
        endSlideLabel: "End-slide",
        endSlideVia: "Selection",
        toolsLabel: "Tools",
        hookLabel: "Hook (rendered)",
        topicTitleLabel: "Topic title",
        briefTextLabel: "Brief text",
      },
      historyEmpty: "No runs for this definition yet.",
      historyTable: {
        runNumber: "Run #",
        createdAt: "Created",
        topicTitle: "Topic",
        status: "Status",
      },
      upcomingEmpty: "No upcoming runs (is the definition inactive?).",
    },

    create: {
      title: "New definition",
      titleEdit: "Edit definition",
      cancel: "Cancel",
      save: "Save",
      saving: "Saving…",
      saveSuccess: "Definition saved.",
      saveFailed: "Save failed.",
      fields: {
        name: "Name",
        nameHint: 'e.g. "Top 5 LLMs weekly comparison"',
        formatType: "Format type",
        formatTypeHint: "Determines the carousel slide layout.",
        frequency: "Frequency",
        frequencyHint:
          'weekly, biweekly, monthly OR a cron expression (e.g. "0 9 * * 1" for every Monday 09:00 UTC).',
        outputTargetsArticle: "Generate article",
        outputTargetsSocial: "Generate social carousel",
        templateStrategy: "Template selection",
        templateStrategyHint:
          "fixed = one specific template • lru = least-recently-used • llm-picks = LLM ranks • latest = newest",
        fixedTemplateKey: "Fixed template (key)",
        endSlideStrategy: "End-slide strategy",
        endSlideStrategyHint:
          "Rotation (LRU) only for now. Applied automatically to the pool, or falls back to format-type defaults when the pool is empty.",
        endSlidePool: "End-slide pool",
        endSlidePoolHint:
          "Pick one or more end-slide definitions. Empty = format-type defaults from the format-type registry are used.",
        endSlidePoolPlaceholder: "Select end-slides …",
        endSlidesLoadFailed: "Failed to load end-slide definitions",
        nextRunAt: "First run (UTC)",
        formatConfig: "Format config (JSON)",
        formatConfigHint:
          "Zod-validated per format-type. Schema hints below — copy/paste as a starting point.",
        isActive: "Active",
      },
      formatConfigSchemaHeading: "Expected schema for this format",
      formatConfigJsonInvalid: "Invalid JSON.",
    },

    formatType: {
      top_n_comparison: "Top-N comparison",
      head_to_head: "Head-to-head",
      story_arc_clickbait: "Story arc (clickbait)",
      lifestyle_listicle: "Lifestyle listicle",
      opinion_recommendation: "Opinion / recommendation",
    },

    family: {
      A: "Family A — data-driven",
      B: "Family B — hook-driven",
    },

    templateStrategy: {
      fixed: "Fixed",
      lru: "Least-recently-used (LRU)",
      "llm-picks": "LLM ranking",
      latest: "Latest",
    },

    endSlideStrategy: {
      rotation: "Rotation (LRU)",
    },

    endSlideOption: {
      inactive: "inactive",
    },
  },

  hooks: {
    title: "Hook library",
    description:
      "Reusable Family-B hook patterns with {variable} placeholders. The 65.5 brief-generators rotate via LRU.",
    empty: "No hooks for this format / language yet.",
    addHook: "New hook",
    languageLabel: "Language",
    languageDe: "German",
    languageEn: "English",
    formatTypeLabel: "Format type",
    columns: {
      pattern: "Pattern",
      variables: "Variables",
      usage: "Uses",
      lastUsed: "Last used",
      active: "Active",
    },
    inactiveChip: "Inactive",
    edit: {
      titleCreate: "New hook",
      titleEdit: "Edit hook",
      fields: {
        formatType: "Format type",
        language: "Language",
        pattern: "Hook pattern",
        patternHint:
          'Use {variable} placeholders, e.g. "I lost my {profession} job because of {tool}".',
        variables: "Variables (comma-separated)",
        variablesHint:
          "List of all placeholders in the pattern, without curly braces.",
        isActive: "Active",
      },
      previewHeading: "Preview",
      previewHint: "Rendered with sample values.",
      saveSuccess: "Hook saved.",
      saveFailed: "Save failed.",
      cancel: "Cancel",
      save: "Save",
    },
    samples: {
      profession: "copywriter",
      tool: "Claude",
      lifeArea: "daily life",
      persona: "Solopreneur",
      role: "designer",
      stance: "enthusiastic",
      context: "in the team",
    },
  },

  endSlides: {
    title: "End-slide definitions",
    description:
      "Final frame of every Theme-65 carousel. Pluggable types: follow-cta, comment-to-get, link-in-bio, tag-friend, save-share-cta, swipe-up, quote-action.",
    empty: "No end-slide definitions yet.",
    addEndSlide: "New end-slide",
    columns: {
      name: "Name",
      type: "Type",
      active: "Active",
    },
    inactiveChip: "Inactive",
    typeLabel: {
      "follow-cta": "Follow CTA",
      "comment-to-get": "Comment for resource",
      "link-in-bio": "Link in bio",
      "tag-friend": "Tag a friend",
      "save-share-cta": "Save / Share",
      "swipe-up": "Swipe up",
      "quote-action": "Quote action",
    },
    edit: {
      titleCreate: "New end-slide",
      titleEdit: "Edit end-slide",
      fields: {
        name: "Name (DE / EN)",
        nameHint: "Admin label for both UI locales. Shown according to the active login locale.",
        type: "Type",
        typeImmutable: "(not editable after creation)",
        config: "Config (JSON)",
        configHint:
          "Zod-validated per type. Provide rendered-slide copy as {\"de\": \"…\", \"en\": \"…\"}. Schema hints below.",
        isActive: "Active",
      },
      schemaHeading: "Expected schema for this type",
      saveSuccess: "End-slide saved.",
      saveFailed: "Save failed.",
      nameRequiredBoth: "Please fill in both languages (DE + EN).",
      cancel: "Cancel",
      save: "Save",
    },
  },
};
