# DS Components — Shared Render-Time Primitives

These three components deduplicate the parts of the DS HTML that are
genuinely identical across all 5 social-media templates.

- `<DsGlow>` — the radial brand/accent glow that every template uses for visual energy
- `<DsTop>` — the eyebrow + slide-counter row at the top of every slide (4/5 templates identical CSS)
- `<DsFoot>` — the logo + CTA row at the bottom of every slide (4/5 templates identical CSS)

That's the complete inventory. Resist the urge to add `<DsScoreNumber>`,
`<DsWinnerBadge>`, `<DsToolCard>`, etc. — these have template-specific styling
despite consuming the same tokens, and inlining is clearer per REMOTION.md guidance.

## Token consumption

Every DS component takes `tokens: DsTokens` (from `deriveDsTokens(brandTokens, theme)`).
Components NEVER reach into `brandTokens` directly — that's `deriveDsTokens`'s job.

## Layout-shift safety

All components follow Spec 59.3.5 patterns: fixed-px sizes, no `flex-grow` on content,
truncation via CSS ellipsis where applicable.
