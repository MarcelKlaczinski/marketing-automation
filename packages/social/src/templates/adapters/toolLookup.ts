// @marketing-auto/db imported lazily inside buildToolLookup() to avoid
// triggering getEnv() at module evaluation time (breaks unit tests without env vars).
import type { ToolReference } from "./types.ts";

// Brand-color fallbacks for well-known tool slugs — used when the tool article in DB
// has no iconSvg / iconInitials / iconHue in domainExtras.
// Exported so getToolContext() in tool.ts can apply the same fallback for single-article lookups.
export const KNOWN_TOOL_ICONS: Record<string, { iconInitials?: string; iconHue?: number; iconSvg?: string }> = {
  cursor:     { iconInitials: "CU", iconHue: 220, iconSvg: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M11.9 2.7L0 21.3h23.8Zm0 3.918L20.857 19.5H3Z"/></svg>' },
  windsurf:   { iconInitials: "WI", iconHue: 145, iconSvg: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M3 7h18l-3 3H3zm0 4h14l-3 3H3zm0 4h10l-3 3H3z"/></svg>' },
  codeium:    { iconInitials: "CO", iconHue: 175, iconSvg: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M13 2L4 14h7l-1.5 8L19 10h-7L13 2z"/></svg>' },
  chatgpt:    { iconInitials: "GP", iconHue: 160 },
  claude:     { iconInitials: "CL", iconHue: 200 },
  copilot:    { iconInitials: "CP", iconHue: 240 },
  recraft:    { iconInitials: "RC", iconHue: 220 },
  ideogram:   { iconInitials: "ID", iconHue: 280 },
  midjourney: { iconInitials: "MJ", iconHue: 50  },
  perplexity: { iconInitials: "PX", iconHue: 195 },
  gemini:     { iconInitials: "GE", iconHue: 35  },
  grok:       { iconInitials: "GK", iconHue: 270 },
  runway:     { iconInitials: "RW", iconHue: 310 },
  kling:      { iconInitials: "KL", iconHue: 255 },
  sora:       { iconInitials: "SO", iconHue: 15  },
  synthesia:  { iconInitials: "SY", iconHue: 200 },
  heygen:     { iconInitials: "HG", iconHue: 180 },
  descript:   { iconInitials: "DE", iconHue: 240 },
  figma:      { iconInitials: "FI", iconHue: 310 },
  canva:      { iconInitials: "CA", iconHue: 170 },
  notion:     { iconInitials: "NO", iconHue: 220 },
  linear:     { iconInitials: "LN", iconHue: 250 },
  gamma:      { iconInitials: "GA", iconHue: 285, iconSvg: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M3 3h18v3.5H7V21H3V3z"/></svg>' },
  tome:       { iconInitials: "TO", iconHue: 230 },
  beautiful:  { iconInitials: "BA", iconHue: 340 },
  pitch:      { iconInitials: "PT", iconHue: 210 },
  prezi:      { iconInitials: "PR", iconHue: 15  },
  jasper:     { iconInitials: "JA", iconHue: 150 },
  writesonic: { iconInitials: "WS", iconHue: 195 },
  grammarly:  { iconInitials: "GR", iconHue: 130 },
  deepl:      { iconInitials: "DL", iconHue: 245 },
  elevenlabs: { iconInitials: "EL", iconHue: 155 },
  murf:       { iconInitials: "MU", iconHue: 270 },
  luma:       { iconInitials: "LU", iconHue: 40  },
  pika:       { iconInitials: "PI", iconHue: 300 },
  leonardo:   { iconInitials: "LE", iconHue: 25  },
  adobe:      { iconInitials: "AD", iconHue: 355 },
  airtable:   { iconInitials: "AT", iconHue: 175 },
  clickup:    { iconInitials: "CK", iconHue: 270 },
  asana:      { iconInitials: "AS", iconHue: 355 },
  monday:     { iconInitials: "MO", iconHue: 355 },
  zapier:     { iconInitials: "ZA", iconHue: 15  },
  make:       { iconInitials: "MK", iconHue: 265 },
};

export async function buildToolLookup(
  toolSlugs: string[],
  locale: "de" | "en",
  projectId: string,
): Promise<Map<string, ToolReference>> {
  if (toolSlugs.length === 0) return new Map();

  const { db, articles, projectBrandAssets, and, eq, inArray } = await import("@marketing-auto/db");

  const toolArticles = await db
    .select()
    .from(articles)
    .where(
      and(
        eq(articles.projectId, projectId),
        eq(articles.collection, "tools"),
        eq(articles.locale, locale),
        inArray(articles.slug, toolSlugs),
      ),
    );

  const refMap = new Map<string, ToolReference>(
    toolArticles.map((t) => {
      const extras = (t.domainExtras ?? {}) as {
        logoUrl?: string;
        pricingTier?: "free" | "freemium" | "paid" | "enterprise";
        priceFrom?: number;
        primaryCategory?: string;
        endSlideToken?: string;
        iconSvg?: string;
        iconInitials?: string;
        iconHue?: number;
      };

      const ref: ToolReference = { slug: t.slug, name: t.title ?? t.slug };
      if (extras.logoUrl !== undefined) ref.logoUrl = extras.logoUrl;
      if (extras.pricingTier !== undefined) ref.pricingTier = extras.pricingTier;
      if (extras.priceFrom !== undefined) ref.priceFrom = extras.priceFrom;
      if (extras.primaryCategory !== undefined) ref.primaryCategory = extras.primaryCategory;
      if (extras.endSlideToken !== undefined) ref.endSlideToken = extras.endSlideToken;
      if (extras.iconSvg !== undefined) ref.iconSvg = extras.iconSvg;
      if (extras.iconInitials !== undefined) ref.iconInitials = extras.iconInitials;
      if (extras.iconHue !== undefined) ref.iconHue = extras.iconHue;

      return [t.slug, ref];
    }),
  );

  // For tools missing icon data, query project_brand_assets (populated by resolveToolIcon pipeline).
  // This is where simple-icons / lobe-icons are cached after the icon-resolution step runs.
  const slugsNeedingIcons = [...refMap.entries()]
    .filter(([, ref]) => ref.iconSvg === undefined && ref.iconInitials === undefined)
    .map(([slug]) => slug);

  if (slugsNeedingIcons.length > 0) {
    const brandAssets = await db
      .select({
        assetKey: projectBrandAssets.assetKey,
        source: projectBrandAssets.source,
        inlineSvg: projectBrandAssets.inlineSvg,
      })
      .from(projectBrandAssets)
      .where(
        and(
          eq(projectBrandAssets.projectId, projectId),
          eq(projectBrandAssets.assetType, "tool_icon"),
          inArray(projectBrandAssets.assetKey, slugsNeedingIcons),
        ),
      );

    for (const asset of brandAssets) {
      const ref = refMap.get(asset.assetKey);
      if (!ref || !asset.inlineSvg || asset.source === "deterministic-avatar") continue;
      ref.iconSvg = asset.inlineSvg;
    }
  }

  // Live resolution chain for slugs still missing icon data — calls resolveToolIcon
  // (simple-icons → iconify → lobe-icons → deterministic avatar) and writes the result
  // to project_brand_assets so the next render hits the cache. Without this step a slug
  // that has never been resolved upstream falls all the way through to KNOWN_TOOL_ICONS
  // (initials-only — no brand logo), even though a perfectly good logo exists in
  // simple-icons. Lazy import to keep the heavy pipelines bundle off the test-time path.
  const stillMissing = [...refMap.entries()].filter(
    ([, ref]) => ref.iconSvg === undefined && ref.iconInitials === undefined,
  );
  if (stillMissing.length > 0) {
    const { resolveToolIcon } = await import("@marketing-auto/pipelines/icon-resolver");
    await Promise.all(
      stillMissing.map(async ([slug, ref]) => {
        try {
          const resolved = await resolveToolIcon(projectId, slug);
          if (resolved.type === "svg") {
            ref.iconSvg = resolved.svg;
          } else {
            ref.iconInitials = resolved.initials;
            ref.iconHue = resolved.hue;
          }
        } catch {
          // adapter / network failure → KNOWN_TOOL_ICONS fallback below
        }
      }),
    );
  }

  // Last resort: KNOWN_TOOL_ICONS hardcoded fallback for tools still without icon data.
  for (const [slug, ref] of refMap.entries()) {
    if (ref.iconSvg === undefined && ref.iconInitials === undefined) {
      const defaults = KNOWN_TOOL_ICONS[slug];
      if (defaults !== undefined) {
        if (defaults.iconSvg !== undefined) ref.iconSvg = defaults.iconSvg;
        if (defaults.iconInitials !== undefined) ref.iconInitials = defaults.iconInitials;
        if (defaults.iconHue !== undefined) ref.iconHue = defaults.iconHue;
      }
    }
  }

  return refMap;
}
