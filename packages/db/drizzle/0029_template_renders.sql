-- Spec 54a: Template-Library Foundation
-- template_renders tracks every carousel render attempt per article × template × locale × theme.

CREATE TABLE "template_renders" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "article_id"      uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  "template_key"    text NOT NULL,
  "locale"          text NOT NULL,
  "theme"           text NOT NULL,
  "status"          text NOT NULL DEFAULT 'pending',
  "render_input"    jsonb NOT NULL,
  "output_files"    jsonb,
  "cost_usd"        numeric(8,4),
  "duration_ms"     integer,
  "error"           text,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "completed_at"    timestamptz
);

CREATE INDEX template_renders_article_id_idx ON template_renders(article_id);
CREATE INDEX template_renders_template_key_idx ON template_renders(template_key);
CREATE INDEX template_renders_status_idx ON template_renders(status);

-- Prevents duplicate in-flight/ready renders for the same combo.
-- Failed renders are allowed to be retried (not covered by this unique index).
CREATE UNIQUE INDEX template_renders_unique_combo
  ON template_renders(article_id, template_key, locale, theme)
  WHERE status IN ('pending', 'rendering', 'ready');
