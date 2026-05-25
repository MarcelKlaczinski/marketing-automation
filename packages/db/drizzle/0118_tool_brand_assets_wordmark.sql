-- Spec 65.2 follow-up — Marcel-request 2026-05-25: store BOTH the icon/mark
-- variant AND the wordmark (logo + brand text) so social templates can choose
-- per layout space ("Kurzform" vs "Wordbild"). lobe-icons publishes every
-- brand in both shapes (`<slug>-color.svg` for the mark, `<slug>-text.svg`
-- for the wordmark) — the adapter now picks both up; this column persists
-- the wordmark URL.
--
-- `logo_url` (existing) stays the canonical mark/symbol; `logo_wordmark_url`
-- is the optional second variant. Templates fall back to logo_url when the
-- wordmark isn't set (brands without a -text variant or Marcel-uploaded
-- custom logos).

ALTER TABLE tool_brand_assets
  ADD COLUMN logo_wordmark_url text;
