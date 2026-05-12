import { and, eq } from "drizzle-orm";
import { db, projectBrandAssets, projects, type ProjectBrandAsset } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { z } from "zod";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const log = createLogger("brand-asset-service");

// ─── Brand token Zod schema (mirrors BrandTokens DB type) ────────────────────

export const brandTokensSchema = z.object({
  colors: z
    .object({
      primary: z.string().optional(),
      primaryHue: z.number().optional(),
      accent: z.string().optional(),
      surface: z.string().optional(),
      surfaceDark: z.string().optional(),
      ink: z.string().optional(),
      inkMuted: z.string().optional(),
      wikiCream: z.string().optional(),
    })
    .optional(),
  typography: z
    .object({
      fontFamily: z.string().optional(),
      headingWeight: z.number().optional(),
      bodyWeight: z.number().optional(),
      eyebrowLetterSpacing: z.string().optional(),
    })
    .optional(),
  voice: z
    .object({
      locale: z.string().optional(),
      addressForm: z.string().optional(),
      forbiddenWords: z.array(z.string()).optional(),
      signaturePhrases: z.array(z.string()).optional(),
    })
    .optional(),
  social: z
    .object({
      instagramHandle: z.string().optional(),
      websiteUrl: z.string().optional(),
      logoAssetKey: z.string().optional(),
    })
    .optional(),
});

export type ParsedBrandTokens = z.infer<typeof brandTokensSchema>;

// ─── Resolved icon shapes ─────────────────────────────────────────────────────

export type ResolvedIcon =
  | { type: "path"; filePath: string; sourceRef: string }   // lobe-icons: absolute path to PNG
  | { type: "url"; url: string }                             // r2 or external URL
  | { type: "svg"; svg: string }                             // inline SVG
  | { type: "avatar"; initials: string; hue: number };      // deterministic HSL fallback

// ─── Tool-slug → lobe-icons name mapping (edge cases) ────────────────────────

const TOOL_SLUG_TO_LOBE: Record<string, string> = {
  chatgpt: "openai",
  "gpt-4": "openai",
  "gpt-4o": "openai",
  "claude-ai": "claude",
  "gemini-ai": "gemini",
  "dall-e": "openai",
  "stable-diffusion": "stablediffusion",
};

// ─── lobe-icons path resolution ──────────────────────────────────────────────

const LOBE_ICONS_BASE = resolve(
  fileURLToPath(import.meta.url),
  "../../../node_modules/@lobehub/icons-static-png"
);

function lobeIconPath(slug: string, theme: "dark" | "light", variant?: "color" | "text"): string {
  const suffix = variant ? `-${variant}` : "";
  return resolve(LOBE_ICONS_BASE, theme, `${slug}${suffix}.png`);
}

async function findLobeIcon(slug: string, theme: "dark" | "light"): Promise<string | null> {
  // Prefer -color variant, fall back to plain
  for (const variant of ["color", undefined] as const) {
    const p = lobeIconPath(slug, theme, variant as "color" | undefined);
    if (await Bun.file(p).exists()) return p;
  }
  return null;
}

export function getLobeIconRef(slug: string): string {
  return `${slug}-color`;
}

// ─── Deterministic HSL avatar ─────────────────────────────────────────────────

function hashToHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getBrandTokens(projectId: string): Promise<ParsedBrandTokens> {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    columns: { brandTokens: true },
  });
  if (!project) throw new Error(`Project ${projectId} not found`);
  return brandTokensSchema.parse(project.brandTokens ?? {});
}

export async function resolveToolIcon(
  projectId: string,
  toolSlug: string,
  theme: "dark" | "light" = "dark"
): Promise<ResolvedIcon> {
  // 1. Look up DB asset record
  const asset = await db.query.projectBrandAssets.findFirst({
    where: and(
      eq(projectBrandAssets.projectId, projectId),
      eq(projectBrandAssets.assetType, "tool_icon"),
      eq(projectBrandAssets.assetKey, toolSlug)
    ),
  });

  if (asset) {
    if (asset.source === "lobe-icons" && asset.sourceRef) {
      const lobeSlug = asset.sourceRef.replace(/-color$|-text$/, "");
      const filePath = await findLobeIcon(lobeSlug, theme);
      if (filePath) return { type: "path", filePath, sourceRef: asset.sourceRef };
    }
    if (asset.source === "r2" && asset.sourceRef) {
      return { type: "url", url: `https://pub.toolwiki.ai/${asset.sourceRef}` };
    }
    if (asset.source === "inline-svg" && asset.inlineSvg) {
      return { type: "svg", svg: asset.inlineSvg };
    }
  }

  // 2. Try resolving via lobe-icons directly (without a DB record)
  const lobeSlug = TOOL_SLUG_TO_LOBE[toolSlug] ?? toolSlug;
  const filePath = await findLobeIcon(lobeSlug, theme);
  if (filePath) {
    log.debug({ toolSlug, lobeSlug, theme }, "resolved tool icon via lobe-icons (no DB record)");
    return { type: "path", filePath, sourceRef: getLobeIconRef(lobeSlug) };
  }

  // 3. Deterministic avatar fallback
  log.debug({ toolSlug }, "no icon found — using deterministic avatar");
  return {
    type: "avatar",
    initials: toolSlug.slice(0, 2).toUpperCase(),
    hue: hashToHue(toolSlug),
  };
}

export async function getProjectAssets(
  projectId: string,
  assetType?: string
): Promise<ProjectBrandAsset[]> {
  const conditions = [eq(projectBrandAssets.projectId, projectId)];
  if (assetType) conditions.push(eq(projectBrandAssets.assetType, assetType));
  return db.query.projectBrandAssets.findMany({ where: and(...conditions) });
}

export async function upsertBrandAsset(
  asset: Omit<typeof projectBrandAssets.$inferInsert, "id" | "createdAt" | "updatedAt">
): Promise<ProjectBrandAsset> {
  // Build the update set conditionally to satisfy exactOptionalPropertyTypes
  const updateSet: Record<string, unknown> = {
    source: asset.source,
    metadata: asset.metadata ?? {},
    updatedAt: new Date(),
  };
  if (asset.sourceRef !== undefined) updateSet.sourceRef = asset.sourceRef;
  if (asset.inlineSvg !== undefined) updateSet.inlineSvg = asset.inlineSvg;
  if (asset.displayName !== undefined) updateSet.displayName = asset.displayName;

  const rows = await db
    .insert(projectBrandAssets)
    .values(asset)
    .onConflictDoUpdate({
      target: [projectBrandAssets.projectId, projectBrandAssets.assetType, projectBrandAssets.assetKey],
      // biome-ignore lint/suspicious/noExplicitAny: conditional build for exactOptionalPropertyTypes
      set: updateSet as any,
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("upsertBrandAsset: no row returned");
  return row;
}

// Re-export for use in seed script
export { findLobeIcon, TOOL_SLUG_TO_LOBE, LOBE_ICONS_BASE };
