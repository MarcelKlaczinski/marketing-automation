-- Spec 54.10: Add translation_auto_trigger to projects
-- Controls whether the Blog Pipeline auto-triggers EN translation after DE article completes.
-- Default TRUE: toolwiki gets auto-translation. Set to FALSE to opt out per project.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS translation_auto_trigger boolean NOT NULL DEFAULT true;
