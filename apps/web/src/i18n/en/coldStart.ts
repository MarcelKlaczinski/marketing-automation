export default {
  // ── Wizard (Spec 56.4) ────────────────────────────────────────────────────
  title: "Set up a new project",
  addProject: "+ Add project",
  saveAndExit: "Save & continue later",
  abandon: "Cancel",
  skip: "Skip",
  phaseLabel: "Phase {current} of {total}",

  abandonConfirm: {
    title: "Cancel wizard?",
    message: "The draft will be deleted. You can start a new project at any time.",
  },

  new: {
    title: "Start a new project",
    description:
      "Set up a new marketing project in a few steps — from the basics to your first content plan.",
    start: "Start project",
    resumeDraft: "Resume draft",
  },

  phases: {
    basics: {
      label: "Basics",
      title: "Tell us about your project",
      description: "Enter the basic information so we can set up your project.",
      fields: {
        name: "Project name",
        domain: "Domain",
        domainHelper: "Optional — used for automatic brand discovery.",
        industry: "Industry",
        targetLocales: "Target languages",
        marketingContext: "Marketing context",
        marketingContextHelper:
          "Optional — briefly describe your audience, tone, and unique selling points. Can also be filled in later under Settings.",
      },
      placeholders: {
        name: "e.g. KI-Wissensraum",
        domain: "example.com",
        industry: "e.g. AI tools, automotive, e-commerce",
        marketingContext: "Our target audience is ...",
      },
    },
    brand: {
      label: "Brand",
      title: "Brand identity",
      description:
        "Let us automatically detect your brand colors, typography, and voice from your domain — or enter them manually.",
      discovery: {
        title: "Auto-detect brand",
        description:
          "We analyze your website and extract colors, typography, and tone automatically. This takes about 15–30 seconds.",
        start: "Detect brand",
        enterManually: "Enter manually",
      },
      discovering: {
        title: "Analyzing brand …",
        description: "We are reading your website and extracting brand tokens.",
      },
      review: {
        title: "Review brand tokens",
        description: "Review and adjust the detected values.",
      },
      rediscover: "Re-detect",
      fields: {
        domain: "Domain",
        primary: "Primary color",
        secondary: "Secondary color",
        headingFont: "Heading font",
        voice: "Brand voice",
      },
      placeholders: {
        domain: "example.com",
        voice: "Describe your brand tone: professional, approachable, direct …",
      },
    },
    seed: {
      label: "Content",
      title: "Content foundation",
      description:
        "Generate initial content pillars and author personas to form the basis of your content strategy.",
      pillars: {
        title: "Content pillars",
        description: "Content pillars structure your content plan. We suggest 3–5 pillars.",
        generate: "Generate pillars",
        regenerate: "Regenerate",
        add: "Add pillar",
      },
      authors: {
        title: "Author personas",
        description:
          "Author personas give your content a human voice. We suggest 3 personas.",
        generate: "Generate personas",
        regenerate: "Regenerate",
      },
    },
    astro: {
      label: "Astro",
      title: "Astro integration",
      description:
        "Connect a local Astro repository so that generated content can be synced directly.",
      info: {
        title: "Why Astro?",
        description:
          "The platform generates Markdown files and syncs them directly to your Astro repository, where they become real blog posts.",
        skipNote:
          "You can skip this step and set up the integration later in Settings.",
      },
      fields: {
        repoPath: "Path to Astro repository",
        repoPathHelper: "Absolute path on your machine, e.g. /Users/me/my-blog",
        deployTarget: "Deploy target",
        contentPath: "Content directory",
      },
      placeholders: {
        repoPath: "/Users/me/my-astro-blog",
        contentPath: "src/content",
      },
      deployTargets: {
        vercel: "Vercel",
        netlify: "Netlify",
        cloudflarePages: "Cloudflare Pages",
        selfHosted: "Self-Hosted",
      },
    },
    confirm: {
      label: "Confirm",
      title: "Ready to launch?",
      description: "Review your inputs and create the project. You can adjust everything later.",
      basics: "Basic information",
      brand: "Brand",
      pillars: "Content pillars",
      authors: "Author personas",
      launch: "Create project",
      cost: {
        title: "Estimated costs",
        description: "Approximate costs for initial content generation after launch.",
        initialPillars: "Initial cluster generation",
        firstMonth: "Estimated month 1 costs",
      },
    },
  },

  locales: {
    de: "German",
    en: "English",
  },

  pillarCard: {
    name: "Pillar name",
    namePlaceholder: "e.g. AI tool reviews",
    description: "Description",
    descriptionPlaceholder: "What does this content pillar cover?",
    keywords: "Keywords",
  },

  authorCard: {
    name: "Name",
    namePlaceholder: "e.g. Alex Miller",
    role: "Role",
    rolePlaceholder: "e.g. AI expert",
    bio: "Bio",
    bioPlaceholder: "Brief description of this persona …",
    expertise: "Topical expertise",
    addTopic: "Add topic",
  },

  errors: {
    launchFailed: "Failed to create project. Please try again.",
    initFailed: "Failed to start draft. Please try again.",
  },

  // ── Pipeline execution (Spec 35, existing keys below) ────────────────────
  intro:
    "Cold-Start initializes a new project with Brand Voice, Competitor Analysis, Cluster Plan, and Cornerstone Articles. The 5 phases can be run individually or sequentially.",

  lockedHint: "Complete the previous phase to unlock this one",
  costSoFar: "Cost so far",

  statusLabels: {
    pending: "Pending",
    running: "Running",
    awaiting_review: "Awaiting Review",
    complete: "Complete",
  },

  phase1: {
    title: "Brand Voice",
    description: "Generate brand questions and synthesize a marketing context from the answers.",
    idleDescription:
      'Click "Generate Questions" to start the voice refinement process. You\'ll receive ~10 questions about the brand.',
    generateQuestions: "Generate Questions",
    questionsRunning: "Generating questions...",
    questionsFailed: "Question generation failed",
    answerHint:
      "Answer the questions as thoroughly as possible. The answers will be used to create the marketing context.",
    answerPlaceholder: "Enter your answer here...",
    synthesizeButton: "Create Marketing Context",
    synthesizeRunning: "Creating marketing context...",
    synthesizeFailed: "Synthesis failed",
    complete: "Brand Voice saved. You can find the marketing context in the Overview tab.",
    regenerate: "Regenerate",
  },

  phase2: {
    title: "Competitor Analysis",
    description: "Analyze top competitors via DataForSEO + Anthropic.",
    idleDescription:
      'Click "Start Analysis" — the pipeline will automatically identify the top 3–5 competitors and analyze their keywords.',
    startButton: "Start Analysis",
    identifying: "Identifying competitors...",
    running: "Analyzing competitors...",
    failed: "Analysis failed",
    noCompetitors: "No competitors identified — please try again.",
    complete: "Competitor analysis complete.",
    regenerate: "Re-analyze",
    competitorsLabel: "Analyzed Competitors",
    gapsLabel: "Content Gaps",
    avoidLabel: "Topics to Avoid",
    reportLabel: "Full Report",
    confirmation: {
      title: "Ready for Competitor Analysis?",
      body: "{count} competitors identified. Analysis will cost ~€{cost} (DataForSEO).",
      tooManyCompetitors:
        "{count} competitors exceed the maximum of {max}. Please trim the list before starting.",
      cancel: "Cancel",
      runAnalysis: "Start Analysis",
    },
  },

  phase3: {
    title: "Cluster Plan",
    description: "Generate a topic cluster plan based on Brand Voice and competitors.",
    idleDescription:
      'Click "Create Cluster Plan" — the pipeline will propose 3–7 topic clusters each with a cornerstone keyword.',
    startButton: "Create Cluster Plan",
    running: "Creating cluster plan...",
    failed: "Cluster plan failed",
    complete: "Cluster plan created.",
    regenerate: "Recreate Cluster Plan",
    importedComplete: "{count} clusters were automatically imported from frontmatter — no manual cluster plan needed.",
    optInLabel: "Generate additional cluster suggestions",
    optInDescription:
      "Let the LLM pipeline generate additional cluster suggestions that are not yet covered by your imported clusters. You can review and select the suggestions afterward.",
    generateAdditional: "Generate Additional Clusters",
    brownfieldMode: "Brownfield Mode",
    brownfieldExplanation:
      "The LLM will propose new clusters that complement your existing {count} clusters. You will need to manually filter out any duplicates afterward.",
  },

  phase4: {
    title: "Cornerstones",
    description: "Generate cornerstone articles per cluster and review them.",
    idleDescription:
      'Click "Generate Cornerstones" — one cornerstone article proposal will be created per cluster.',
    noClusters: "No cluster plan available. Please complete Phase 3 first.",
    generate: "Generate Cornerstones",
    running: "Generating cornerstones...",
    failed: "Cornerstone generation failed",
    reviewIntro: "Review each cornerstone individually. You can approve, edit, or reject it.",
    proceed: "Proceed with {count} approved cornerstone(s)",
    statusLabels: {
      proposed: "Proposed",
      approved: "Approved",
      rejected: "Rejected",
    },
    cardActions: {
      approve: "Approve",
      edit: "Edit",
      reject: "Reject",
      save: "Save",
      cancel: "Cancel",
    },
    cardFields: {
      title: "Title",
      keyword: "Cornerstone Keyword",
      description: "Meta Description",
    },
    idleDescriptionMultiLang:
      "For each of the {count} approved clusters, one cornerstone spec per language will be generated.",
    localesLabel: "Languages for generation",
    localeOptionDe: "German (DE)",
    localeOptionEn: "English (EN)",
    reviewIntroMultiLang:
      "Review the DE+EN pairs. Approve them individually or as a pair, then generate the articles.",
    generateArticles: "{count} cluster(s): generate articles",
    regenerate: "Regenerate",
    articlesEnqueued: "{total} article generation(s) started",
    openStandaloneView: "Open standalone view",
  },

  phase5: {
    title: "Go-Live Checklist",
    description: "Generate a markdown checklist with next steps toward go-live.",
    idleDescription:
      'Click "Generate Checklist" — you\'ll receive a personalized list of next steps.',
    startButton: "Generate Checklist",
    running: "Creating checklist...",
    failed: "Checklist generation failed",
    complete: "Cold-Start complete. You can now generate articles.",
  },
};
