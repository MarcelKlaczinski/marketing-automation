-- Spec 54.6: extend rejected_topic_candidates.reason CHECK to include manual_dismissal
-- Manual dismissal is written by the trends UI when Marcel clicks "Dismiss" on a brief.

ALTER TABLE "rejected_topic_candidates"
  DROP CONSTRAINT "rejected_topic_candidates_reason_check";

ALTER TABLE "rejected_topic_candidates"
  ADD CONSTRAINT "rejected_topic_candidates_reason_check"
  CHECK ("reason" IN (
    'existing_coverage',
    'low_score',
    'excluded_by_scope',
    'low_signal_volume',
    'manual_dismissal'
  ));
