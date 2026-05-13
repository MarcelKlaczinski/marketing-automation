-- Spec 53c: Article Discovery table for content-recycling analysis
-- Stores deterministic (Phase 1) and LLM-enriched (Phase 2) patterns per article.
-- Excludes 'authors' collection — only real content collections are analysed.

CREATE TABLE "article_discovery" (
  "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "article_id"            uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,

  -- Deterministic body/structure metrics (Phase 1)
  "word_count"            integer,
  "image_count"           integer,
  "header_count_h2"       integer,
  "header_count_h3"       integer,
  "header_slugs"          text[],
  "paragraph_count"       integer,
  "link_count_internal"   integer,
  "link_count_external"   integer,
  "code_block_count"      integer,
  "table_count"           integer,
  "list_count_ul"         integer,
  "list_count_ol"         integer,
  "has_affiliate_links"   boolean,

  -- Normalised cross-collection fields (Phase 1)
  "referenced_tools"      text[],
  "container_form_hint"   text,
  "completeness_score"    numeric(4, 3),
  "estimated_angles"      integer,

  -- LLM-enriched fields (Phase 2, initially NULL)
  "content_hooks"         jsonb NOT NULL DEFAULT '{}',
  "suggested_templates"   jsonb NOT NULL DEFAULT '[]',
  "narrative_arc"         text,
  "estimated_carousels"   integer,

  -- Bookkeeping
  "enrichment_run_at"     timestamptz,
  "enrichment_mode"       text,
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  "updated_at"            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX article_discovery_article_id_unique
  ON article_discovery(article_id);

CREATE INDEX article_discovery_container_form_idx
  ON article_discovery(container_form_hint);

CREATE INDEX article_discovery_enrichment_mode_idx
  ON article_discovery(enrichment_mode);
