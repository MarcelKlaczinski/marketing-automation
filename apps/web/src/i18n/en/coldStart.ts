export default {
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
