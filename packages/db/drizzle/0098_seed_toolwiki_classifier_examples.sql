-- Spec multi-domain-evolution S4.4 site 9: seed Toolwiki classifier_examples
-- with the 12 examples Spec 64.14 added to packages/pipelines/src/topic-
-- sources/trend-discovery/prompts.ts (6 counter-examples that MUST NOT
-- classify as knowledge + 6 positive examples that SHOULD).
--
-- The hardcoded prompt-text fallback in prompts.ts (kept for back-compat
-- when classifier_examples IS NULL) carries these same 12 examples
-- verbatim, so the synthesizer prompt for Toolwiki is byte-identical
-- whether the value is read from DB or from the hardcoded fallback.
--
-- Idempotent via guarded UPDATE — only writes when the column is still NULL.

UPDATE "projects" SET "classifier_examples" = '{
  "knowledge": {
    "counterExamples": [
      {"title": "I''ve joined Anthropic", "reasonExcluded": "personal/career event; no concept explained", "correctIntent": "news"},
      {"title": "OpenAI releases GPT-5", "reasonExcluded": "event-driven product launch", "correctIntent": "news"},
      {"title": "Claude vs ChatGPT: which is better?", "reasonExcluded": "tool pair, not a theme", "correctIntent": "comparison"},
      {"title": "How to use Cursor with Python", "reasonExcluded": "tool-centric step-by-step", "correctIntent": "tutorial"},
      {"title": "5 ways AI changes marketing", "reasonExcluded": "industry-application enumeration", "correctIntent": "use_case"},
      {"title": "Anthropic raises $500M Series E", "reasonExcluded": "corporate event", "correctIntent": "news"}
    ],
    "positiveExamples": [
      {"title": "Was ist Retrieval-Augmented Generation?", "reasonIncluded": "concept question, no tool focus"},
      {"title": "Wie funktionieren Transformer-Modelle?", "reasonIncluded": "mechanism explainer"},
      {"title": "Prompt Engineering Grundlagen", "reasonIncluded": "evergreen practitioner primer"},
      {"title": "Embeddings einfach erklärt", "reasonIncluded": "concept primer"},
      {"title": "Was ist der Unterschied zwischen Supervised und Unsupervised Learning?", "reasonIncluded": "concept comparison without tool focus"},
      {"title": "Vector Databases erklärt", "reasonIncluded": "technology-category explainer"}
    ]
  }
}'::jsonb
WHERE "slug" = 'toolwiki'
  AND "classifier_examples" IS NULL;
