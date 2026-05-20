-- Spec 60.6: add LLM suggestion tracking columns to template_renders
ALTER TABLE template_renders
  ADD COLUMN suggested_template    text,
  ADD COLUMN suggestion_confidence numeric(3,2),
  ADD COLUMN suggestion_reason     text,
  ADD COLUMN user_override         boolean NOT NULL DEFAULT false;
