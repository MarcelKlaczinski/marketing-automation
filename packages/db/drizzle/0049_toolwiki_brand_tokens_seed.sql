-- Spec 57.1 A.5 — Seed toolwiki brand tokens with values previously hardcoded in templates.
-- Colors: surfaceSecondary, eyebrowColor, pricingFree/Freemium/Paid
-- Typography: rankBadge*, footer* sizing fields
-- Zero visual regression: these match the exact hardcoded values from lib/theme.ts + components.
UPDATE projects
SET brand_tokens = brand_tokens || jsonb_build_object(
    'colors', (COALESCE(brand_tokens->'colors', '{}'::jsonb) || jsonb_build_object(
        'surfaceSecondary', 'oklch(22% 0.02 248)',
        'eyebrowColor',     'oklch(85% 0.10 168)',
        'pricingFree',      '#22c55e',
        'pricingFreemium',  '#3b82f6',
        'pricingPaid',      '#f59e0b'
    )),
    'typography', (COALESCE(brand_tokens->'typography', '{}'::jsonb) || jsonb_build_object(
        'rankBadgeSize',          72,
        'rankBadgeWeight',        900,
        'rankBadgeLetterSpacing', '-0.03em',
        'footerWebsiteSize',      20,
        'footerHandleSize',       16,
        'footerLabelSize',        18,
        'footerGap',              2
    ))
)
WHERE slug = 'toolwiki';
