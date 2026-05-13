═══════════════════════════════════════════════════════════════════
SPEC 52a — Asset-Library Expansion + Tool-Icon-Fix
═══════════════════════════════════════════════════════════════════

CONTEXT

Spec 51a Phase A+B implementiert Carousel-Generation mit Tool-Icons.
Aktueller Bug: Tool-Icons werden als Emojis gerendert statt echte Brand-Logos.

Beispiele aus generierten Slides:
- Recraft   → 🎨 (Künstler-Palette-Emoji)
- Ideogram  → ✍️ (Handschrift-Emoji)
- Midjourney → 🌈 (Regenbogen-Emoji)
- Flux Pro  → ⚡ (Blitz-Emoji)
- DALL·E 4  → 🤖 (Roboter-Emoji)

Root Cause: lobe-icons hat keine Einträge für diese Tools. Der aktuelle
Fallback liefert Emojis (vermutlich aus extract-tools-step LLM-Output)
statt deterministic Avatar oder besserer Quelle.

GOAL: Asset-Resolution erweitern um 3 priorisierte Sources mit DB-Cache.
Nur neue Posts profitieren — existing Posts mit Emoji-Logos bleiben unverändert
(Spec entscheidet bewusst kein Auto-Re-render).

═══════════════════════════════════════════════════════════════════
NON-GOAL
═══════════════════════════════════════════════════════════════════

- Kein Asset-Browser-UI (Spec 52b)
- Keine Color-Settings UI (Spec 52b)
- Keine Custom-Asset-Upload UI (Spec 52b)
- Keine AI-Fallback für fehlende Logos (Future Spec)
- Kein Auto-Re-Render existing Posts
- Keine Trademark-Compliance-Checks (editorial use für toolwiki OK)
- Keine Performance-Analytics

═══════════════════════════════════════════════════════════════════
RESOLUTION-CHAIN (Pflicht-Reihenfolge)
═══════════════════════════════════════════════════════════════════

Bei jedem resolveToolIcon(projectId, toolSlug):

1. CHECK project_brand_assets — wenn Cache-Hit → return
2. SOURCE: simple-icons (Tech/SaaS Brand-Logos, CC0)
3. SOURCE: iconify (Aggregator, "logos" + "skill-icons" sets)
4. SOURCE: lobe-icons (AI-focused, existing)
5. FALLBACK: deterministic HSL Avatar mit Initials (z.B. "MJ", "FP")

NEVER: Emoji-Fallback

Bei jedem Hit (Step 2-5): Cache-Write in project_brand_assets.

═══════════════════════════════════════════════════════════════════
SECTION 1: NPM-Packages Installation
═══════════════════════════════════════════════════════════════════

Im Workspace-Root + apps/api + packages/social:

bun add simple-icons
# 3000+ Brand-Logos als JSON: { title, slug, hex, svg }
# Größe: ~5 MB

bun add @iconify/json
# 200+ icon-sets, ~150 MB unpacked
# ALTERNATIVE: @iconify/utils + lazy-fetch per Set (kleiner)

EMPFEHLUNG: @iconify/utils + on-demand Fetch
- Reduzierte Bundle-Size
- Nur die Sets ladenwir wir tatsächlich brauchen
- "logos" set: 1200+ tech-Logos
- "skill-icons" set: 300+ skill-Icons

bun add @iconify/utils @iconify-json/logos @iconify-json/skill-icons

VERIFY:
- node_modules/simple-icons/icons/midjourney.svg ✓
- node_modules/@iconify-json/logos/icons.json (~3 MB) ✓
- node_modules/@iconify-json/skill-icons/icons.json (~500 KB) ✓

═══════════════════════════════════════════════════════════════════
SECTION 2: Icon-Source-Adapter
═══════════════════════════════════════════════════════════════════

DATEI: packages/social/src/icon-sources/

Pattern: jede Source als Adapter mit gleicher Interface.

──────────────────────────────────────────────────────────────────
2.1: Interface
──────────────────────────────────────────────────────────────────

DATEI: packages/social/src/icon-sources/types.ts

export type IconSource = "simple-icons" | "iconify" | "lobe-icons";

export interface ResolvedIconAsset {
source: IconSource;
sourceRef: string;        // Internal identifier (slug + set)
svgContent: string;       // Inline SVG (raw)
brandColor?: string;      // Hex color from source (where available)
format: "svg";
}

export interface IconSourceAdapter {
name: IconSource;
/**
* Try to resolve an icon for a given tool slug.
* Returns null if not found in this source.
  */
  tryResolve(toolSlug: string): Promise<ResolvedIconAsset | null>;
  }

──────────────────────────────────────────────────────────────────
2.2: simple-icons Adapter
──────────────────────────────────────────────────────────────────

DATEI: packages/social/src/icon-sources/simple-icons.ts

import * as simpleIcons from "simple-icons";
import type { IconSourceAdapter, ResolvedIconAsset } from "./types";

// Mapping toolwiki-slug → simple-icons key
// simple-icons exports as: simpleIcons.siMidjourney
const TOOLWIKI_TO_SIMPLE_ICONS: Record<string, string> = {
"midjourney": "midjourney",
"openai": "openai",
"chatgpt": "openai",       // brand-family
"dall-e": "openai",
"dall-e-3": "openai",
"dall-e-4": "openai",
"claude": "anthropic",     // simple-icons hat Anthropic, nicht Claude
"anthropic": "anthropic",
"gemini": "googlegemini",
"google-gemini": "googlegemini",
"figma": "figma",
"canva": "canva",
"notion": "notion",
"runway": "runway",
"stability": "stabilityai",
"stable-diffusion": "stabilityai",
"elevenlabs": "elevenlabs",
"github-copilot": "githubcopilot",
"perplexity": "perplexity",
// ...wird im Lauf der Entwicklung wachsen
};

export const simpleIconsAdapter: IconSourceAdapter = {
name: "simple-icons",
async tryResolve(toolSlug: string) {
const mapped = TOOLWIKI_TO_SIMPLE_ICONS[toolSlug] ?? toolSlug;
const exportKey = `si${mapped.charAt(0).toUpperCase()}${mapped.slice(1).replace(/-/g, "")}`;

    // Dynamic property access on simple-icons module
    const icon = (simpleIcons as any)[exportKey];
    if (!icon) return null;
    
    return {
      source: "simple-icons",
      sourceRef: mapped,
      svgContent: icon.svg,
      brandColor: `#${icon.hex}`,
      format: "svg",
    };
},
};

──────────────────────────────────────────────────────────────────
2.3: Iconify Adapter
──────────────────────────────────────────────────────────────────

DATEI: packages/social/src/icon-sources/iconify.ts

import { getIconData, iconToSVG } from "@iconify/utils";
import logosIcons from "@iconify-json/logos/icons.json";
import skillIcons from "@iconify-json/skill-icons/icons.json";
import type { IconSourceAdapter, ResolvedIconAsset } from "./types";

// Try lookups in priority order across multiple iconify sets
const ICONIFY_SETS = [
{ prefix: "logos", data: logosIcons },
{ prefix: "skill-icons", data: skillIcons },
];

// Some toolwiki slugs need transformation for iconify lookup
const TOOLWIKI_TO_ICONIFY: Record<string, string[]> = {
"midjourney": ["midjourney", "midjourney-icon"],
"chatgpt": ["chatgpt", "openai-icon"],
"claude": ["claude-icon", "anthropic-icon"],
"dall-e": ["openai-icon"],
"gemini": ["google-gemini-icon"],
"notion": ["notion-icon"],
"figma": ["figma"],
// ...
};

export const iconifyAdapter: IconSourceAdapter = {
name: "iconify",
async tryResolve(toolSlug: string) {
const candidates = TOOLWIKI_TO_ICONIFY[toolSlug] ?? [toolSlug];

    for (const set of ICONIFY_SETS) {
      for (const candidate of candidates) {
        const iconData = getIconData(set.data, candidate);
        if (iconData) {
          const svg = iconToSVG(iconData);
          return {
            source: "iconify",
            sourceRef: `${set.prefix}:${candidate}`,
            svgContent: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${svg.attributes.viewBox}">${svg.body}</svg>`,
            format: "svg",
          };
        }
      }
    }
    
    return null;
},
};

──────────────────────────────────────────────────────────────────
2.4: lobe-icons Adapter
──────────────────────────────────────────────────────────────────

DATEI: packages/social/src/icon-sources/lobe-icons.ts

Wrap existing functionality (was in seed-tool-icons.ts und/oder
brand-asset-service.ts steckte) als IconSourceAdapter.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { IconSourceAdapter, ResolvedIconAsset } from "./types";
import { TOOLWIKI_TO_LOBE_ICONS } from "../../apps/api/src/lib/tool-icon-mapping";

// Hinweis: lobe-icons-static-png liefert PNGs, nicht SVGs.
// Für Konsistenz mit anderen Adaptern: SVG-Variante nutzen wenn verfügbar,
// sonst PNG → embed as data URI.

const LOBE_ICONS_PATH = "node_modules/@lobehub/icons-static-png/dist";

export const lobeIconsAdapter: IconSourceAdapter = {
name: "lobe-icons",
async tryResolve(toolSlug: string) {
const mapped = TOOLWIKI_TO_LOBE_ICONS[toolSlug] ?? toolSlug;
const pngPath = join(LOBE_ICONS_PATH, `${mapped}.png`);

    if (!existsSync(pngPath)) return null;
    
    const pngBuffer = readFileSync(pngPath);
    const base64 = pngBuffer.toString("base64");
    
    return {
      source: "lobe-icons",
      sourceRef: mapped,
      svgContent: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><image href="data:image/png;base64,${base64}" width="256" height="256"/></svg>`,
      format: "svg",
    };
},
};

═══════════════════════════════════════════════════════════════════
SECTION 3: Resolver Service mit Cache
═══════════════════════════════════════════════════════════════════

DATEI: apps/api/src/lib/icon-resolver.ts (NEU)

Service-File-Pattern wie brand-asset-service.ts.

import { db } from "@org/db";
import { projectBrandAssets } from "@org/db/schema";
import { eq, and } from "drizzle-orm";

import { simpleIconsAdapter } from "@org/social/icon-sources/simple-icons";
import { iconifyAdapter } from "@org/social/icon-sources/iconify";
import { lobeIconsAdapter } from "@org/social/icon-sources/lobe-icons";
import type { IconSourceAdapter, ResolvedIconAsset } from "@org/social/icon-sources/types";

// Priority order (matters!)
const RESOLUTION_CHAIN: IconSourceAdapter[] = [
simpleIconsAdapter,
iconifyAdapter,
lobeIconsAdapter,
];

export type ResolvedIcon =
| { type: "svg"; svg: string; source: string; sourceRef: string; brandColor?: string }
| { type: "avatar"; initials: string; hue: number };

/**
* Resolve a tool icon with cache-first, priority-fallback strategy.
* Returns either a real logo (svg) or deterministic avatar fallback.
* Never returns emoji.
  */
  export async function resolveToolIcon(
  projectId: string,
  toolSlug: string
  ): Promise<ResolvedIcon> {
  // STEP 1: Check DB cache
  const cached = await db.query.projectBrandAssets.findFirst({
  where: and(
  eq(projectBrandAssets.projectId, projectId),
  eq(projectBrandAssets.assetType, "tool_icon"),
  eq(projectBrandAssets.assetKey, toolSlug)
  )
  });

if (cached) {
if (cached.source === "simple-icons" ||
cached.source === "iconify" ||
cached.source === "lobe-icons") {
if (cached.inlineSvg) {
return {
type: "svg",
svg: cached.inlineSvg,
source: cached.source,
sourceRef: cached.sourceRef ?? "",
brandColor: cached.metadata?.brandColor as string | undefined,
};
}
}
if (cached.source === "deterministic-avatar") {
return {
type: "avatar",
initials: toolSlug.slice(0, 2).toUpperCase(),
hue: hashToHue(toolSlug),
};
}
// Falls cached.source === "emoji" oder ungültig: re-resolve (Bug-Fix)
}

// STEP 2-4: Try each source in priority order
for (const adapter of RESOLUTION_CHAIN) {
const resolved = await adapter.tryResolve(toolSlug);
if (resolved) {
// Cache the result
await db.insert(projectBrandAssets)
.values({
projectId,
assetType: "tool_icon",
assetKey: toolSlug,
source: resolved.source,
sourceRef: resolved.sourceRef,
inlineSvg: resolved.svgContent,
metadata: resolved.brandColor
? { brandColor: resolved.brandColor }
: {},
displayName: toolSlug,
})
.onConflictDoUpdate({
target: [projectBrandAssets.projectId, projectBrandAssets.assetType, projectBrandAssets.assetKey],
set: {
source: resolved.source,
sourceRef: resolved.sourceRef,
inlineSvg: resolved.svgContent,
metadata: resolved.brandColor
? { brandColor: resolved.brandColor }
: {},
updatedAt: new Date(),
}
});

      return {
        type: "svg",
        svg: resolved.svgContent,
        source: resolved.source,
        sourceRef: resolved.sourceRef,
        brandColor: resolved.brandColor,
      };
    }
}

// STEP 5: Fallback to deterministic avatar
await db.insert(projectBrandAssets)
.values({
projectId,
assetType: "tool_icon",
assetKey: toolSlug,
source: "deterministic-avatar",
sourceRef: null,
inlineSvg: null,
displayName: toolSlug,
})
.onConflictDoNothing();

return {
type: "avatar",
initials: toolSlug.slice(0, 2).toUpperCase(),
hue: hashToHue(toolSlug),
};
}

function hashToHue(s: string): number {
let h = 0;
for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
return h;
}

═══════════════════════════════════════════════════════════════════
SECTION 4: Pipeline-Integration
═══════════════════════════════════════════════════════════════════

DATEI: packages/pipelines/src/article/social-image/steps/resolve-assets.ts

Aktuell vermutlich vorhanden — muss aktualisiert werden um neuen Resolver
zu nutzen statt alten brand-asset-service.

VORHER (vermutet):
import { resolveToolIcon } from "@apps/api/lib/brand-asset-service";

NACHHER:
import { resolveToolIcon } from "@apps/api/lib/icon-resolver";

INPUT to step (unchanged):
{ projectId, articleId, extractedTools: ToolData[] }

OUTPUT (slightly enhanced):
{
resolvedIcons: Array<{
slug: string,
icon: ResolvedIcon  // { type: 'svg' | 'avatar', ... }
}>
}

WICHTIG: extract-tools-step muss aufhören Emojis zu extrahieren!
DATEI: packages/pipelines/src/article/social-image/steps/extract-tools.ts

PROMPT-ÄNDERUNG für Claude Haiku:
VORHER (vermutet):
"Extract for each tool: name, domain, emoji icon, tagline, strengths, pricing"

NACHHER:
"Extract for each tool: name, domain, tagline, strengths (3 bullets), pricing.
DO NOT include any icon, emoji, or visual representation — icons are
resolved separately from a brand asset library."

═══════════════════════════════════════════════════════════════════
SECTION 5: Remotion Component-Update
═══════════════════════════════════════════════════════════════════

DATEI: packages/social/src/shared/ToolIconImage.tsx

Komponente die einen ResolvedIcon rendert:

import type { ResolvedIcon } from "@apps/api/lib/icon-resolver";

interface Props {
icon: ResolvedIcon;
size: number;        // 80px für Tool-Slide
theme: "dark" | "light";
}

export const ToolIconImage: React.FC<Props> = ({ icon, size, theme }) => {
if (icon.type === "svg") {
return (
<div style={{
width: size,
height: size,
borderRadius: size / 2,
background: theme === "dark"
? "rgba(255,255,255,0.08)"
: "rgba(255,255,255,1)",
boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
display: "flex",
alignItems: "center",
justifyContent: "center",
}}>
<div
style={{ width: size * 0.6, height: size * 0.6 }}
dangerouslySetInnerHTML={{ __html: icon.svg }}
/>
</div>
);
}

// Avatar fallback
return (
<div style={{
width: size,
height: size,
borderRadius: size / 2,
background: `linear-gradient(135deg, hsl(${icon.hue} 70% 55%), hsl(${(icon.hue + 30) % 360} 70% 45%))`,
color: "white",
fontSize: size * 0.4,
fontWeight: 700,
display: "flex",
alignItems: "center",
justifyContent: "center",
}}>
{icon.initials}
</div>
);
};

═══════════════════════════════════════════════════════════════════
SECTION 6: Tests
═══════════════════════════════════════════════════════════════════

DATEI: apps/api/test/lib/icon-resolver.test.ts (NEU)

Test-Szenarien:

1. Cache-Hit: existing asset wird zurückgegeben ohne API-Call
2. Simple-Icons-Hit: midjourney → simple-icons SVG mit brandColor
3. Iconify-Hit: tool ohne simple-icons aber in logos-set
4. lobe-icons-Hit: AI-tool nur in lobe-icons
5. Deterministic-Fallback: completely unknown tool → avatar
6. NEVER emoji: even with unknown tool, no emoji string returned
7. Cache-Write: nach erstem Resolve, zweiter Call ist DB-only
8. Bug-Fix: existing emoji-cached entry → re-resolve to real source

DATEI: packages/social/test/icon-sources/simple-icons.test.ts
- Mock simple-icons module
- Test tryResolve returns correct shape for "midjourney"
- Test tryResolve returns null for unmapped slug

DATEI: packages/social/test/icon-sources/iconify.test.ts
- Test Iconify-Set lookup
- Test multi-candidate (e.g. "claude" tries "claude-icon" + "anthropic-icon")

═══════════════════════════════════════════════════════════════════
SECTION 7: Worker-Restart Convention
═══════════════════════════════════════════════════════════════════

Pipeline-Step-Code wird vom Worker geladen. Nach Implementation:

bun run worker:restart

Plus: Test-Re-render eines toolwiki Articles:
1. Trigger neues Carousel via UI/API für Recraft-vs-Ideogram Article
2. Verify generierte Slides: tatsächliche Logos statt Emojis
3. SQL-Check:
   SELECT asset_key, source, length(inline_svg) as svg_size
   FROM project_brand_assets
   WHERE source IN ('simple-icons', 'iconify');

═══════════════════════════════════════════════════════════════════
SECTION 8: Docs Update
═══════════════════════════════════════════════════════════════════

apps/api/CLAUDE.md neue Section:

## Tool-Icon Resolution

Resolution-Chain (in priority order):
1. project_brand_assets cache (project-scoped)
2. simple-icons (3000+ brand-logos, CC0)
3. iconify "logos" + "skill-icons" sets
4. lobe-icons (AI-focused, existing)
5. Deterministic HSL avatar with initials (never emoji)

Every successful resolution is cached to project_brand_assets.
Custom overrides (via future asset-management UI) take precedence.

Cache-Bust: DELETE row in project_brand_assets, next request re-resolves.

packages/social/CLAUDE.md:

## Icon-Source Adapters

Three adapters in priority order:
- simple-icons (Tech/SaaS brand logos)
- iconify (200k+ icons via @iconify/utils + curated sets)
- lobe-icons (AI-focused via static-png)

Adding new source:
1. Create adapter in src/icon-sources/<name>.ts
2. Implement IconSourceAdapter interface
3. Add to RESOLUTION_CHAIN in icon-resolver.ts

═══════════════════════════════════════════════════════════════════
ACCEPTANCE
═══════════════════════════════════════════════════════════════════

- [ ] simple-icons installed in packages/social
- [ ] @iconify/utils + @iconify-json/logos + skill-icons installed
- [ ] simpleIconsAdapter.tryResolve works for 5+ known tools
- [ ] iconifyAdapter.tryResolve works for 3+ tools not in simple-icons
- [ ] lobeIconsAdapter.tryResolve works (legacy compatibility)
- [ ] icon-resolver.ts mit Resolution-Chain + DB-Cache
- [ ] resolveToolIcon NEVER returns emoji
- [ ] Cache hit on second call (verified via SQL)
- [ ] extract-tools-step prompt strips emoji-extraction
- [ ] ToolIconImage.tsx renders SVG vs Avatar correctly
- [ ] 8+ tests pass (resolver + 3 adapters)
- [ ] Manual: Re-trigger Recraft-vs-Ideogram carousel → real logos visible
- [ ] CLAUDE.md updated
- [ ] Branch: feature/asset-library-expansion
- [ ] 4-6 granular commits

═══════════════════════════════════════════════════════════════════
EXISTING POSTS — Bewusst NICHT auto-re-render
═══════════════════════════════════════════════════════════════════

Marcels-Entscheidung: existing posts with emoji-logos bleiben unverändert.

Future Spec 52b kann Re-Render-Button im UI hinzufügen wenn gewünscht.

═══════════════════════════════════════════════════════════════════
ESTIMATED EFFORT
═══════════════════════════════════════════════════════════════════

Section 1 (npm-installs):          30 min
Section 2.1 (Adapter interface):   15 min
Section 2.2 (simple-icons):        60 min  (incl. mapping research)
Section 2.3 (iconify):             60 min
Section 2.4 (lobe-icons wrap):     30 min
Section 3 (resolver+cache):        60 min
Section 4 (pipeline-integration): 45 min  (incl. extract-tools prompt fix)
Section 5 (ToolIconImage):         30 min
Section 6 (tests):                 90 min
Section 7 (manual verify):         30 min
Section 8 (docs):                  15 min

Total: ~7h focused work
Plus +30% discovery buffer: ~9h realistic

═══════════════════════════════════════════════════════════════════
REPORT FORMAT
═══════════════════════════════════════════════════════════════════

audit/ASSET_LIBRARY_EXPANSION.md:

## Coverage-Verbesserung
Before (lobe-icons only): X/Y toolwiki tools mapped
After (3 sources): Z/Y toolwiki tools with real logos

Per Source Stats:
- simple-icons: N tools resolved
- iconify: M tools resolved
- lobe-icons: K tools resolved (legacy)
- deterministic-avatar: L tools (fallback)

## Test Manual
Trigger: 1 fresh Recraft-vs-Ideogram carousel
Result: Visual verification real logos present
Cost: ~$0.01 (unchanged)
