/**
 * V1.6.1 — Seed Toolwiki brand-stamp logo (Spec 65.15 fix).
 *
 * Phase 0 of the V1.6 post-mortem rebuild: live audit found that the existing
 * `project_brand_assets` row with `asset_key='main'` has `source='wordmark'`,
 * which `resolveLogoUrl` (Spec 65.15) intentionally skips because wordmarks
 * are structurally inappropriate as 48px corner watermarks. Result: zero
 * brand-stamp on every Family-B render despite the DsBrandStamp wiring being
 * correct.
 *
 * Fix-strategy (Marcel-Decision §B): insert two new `inline-svg` rows under
 * `asset_key='main-light'` and `asset_key='main-dark'` so the resolver's
 * 3-tier chain hits them first per theme (Spec 65.15 chain:
 *   <key>-<theme> → <key> → <key>-<oppositeTheme>
 * ). The existing `main` row stays untouched for whatever other surfaces
 * read it.
 *
 * Idempotent: UPSERT via `onConflictDoUpdate` on the
 * `(project_id, asset_type, asset_key)` unique constraint. Re-running the
 * script refreshes the inline_svg content without duplicating rows.
 *
 * Usage:
 *   bun --filter @marketing-auto/api seed-toolwiki-logo
 */
import { createLogger } from "@marketing-auto/shared";
import { and, db, eq, projects, projectBrandAssets } from "@marketing-auto/db";

const log = createLogger("seed-toolwiki-logo");

// Marcel-provided HTML wrapper extracted into two standalone SVGs.
// Cleanup applied:
//   - outer `class="..."` attribute (Tailwind: block/dark:hidden/h-10/etc.)
//     removed — Remotion doesn't process Tailwind and the dark:hidden /
//     hidden:dark:block toggles only made sense in the Astro context.
//   - `data-astro-cid-mkctru6g=""` attributes removed (Astro-only scoped CSS noise).
//   - Internal `class="tw-card ..."` and `class="tw-word"` / `class="tw-ai"`
//     kept — harmless without CSS, the visual styling comes from inline
//     `fill=` / `font-family=` attrs.

const LIGHT_SVG = `<svg viewBox="0 0 720 156" role="img" aria-label="toolwiki.ai" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="tw-card-back-l" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#7dd3fc"/>
      <stop offset="55%" stop-color="#0ea5e9"/>
      <stop offset="100%" stop-color="#0284c7"/>
    </linearGradient>
    <linearGradient id="tw-card-mid-l" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#a5b4fc"/>
      <stop offset="55%" stop-color="#818cf8"/>
      <stop offset="100%" stop-color="#4f46e5"/>
    </linearGradient>
    <linearGradient id="tw-card-front-l" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#93c5fd"/>
      <stop offset="55%" stop-color="#60a5fa"/>
      <stop offset="100%" stop-color="#2563eb"/>
    </linearGradient>
    <linearGradient id="tw-edge-l" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="tw-ink-l" x1="0%" y1="0%" x2="100%" y2="55%">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="50%" stop-color="#6366f1"/>
      <stop offset="100%" stop-color="#0ea5e9"/>
    </linearGradient>
    <filter id="tw-glow-l" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="6"/>
      <feMerge>
        <feMergeNode/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <g transform="translate(10 4) scale(2.1)">
    <g class="tw-card tw-card--back" transform="rotate(-12 22 32)">
      <rect x="11" y="13" width="22" height="38" rx="3" fill="url(#tw-card-back-l)"/>
      <rect x="11" y="13" width="22" height="6" rx="3" fill="url(#tw-edge-l)"/>
      <rect x="14" y="24" width="16" height="1.2" rx="0.6" fill="#ffffff" opacity="0.4"/>
      <rect x="14" y="29" width="13" height="1.2" rx="0.6" fill="#ffffff" opacity="0.3"/>
      <rect x="14" y="34" width="15" height="1.2" rx="0.6" fill="#ffffff" opacity="0.35"/>
      <rect x="14" y="39" width="10" height="1.2" rx="0.6" fill="#ffffff" opacity="0.25"/>
    </g>
    <g class="tw-card tw-card--mid">
      <rect x="21" y="11" width="22" height="42" rx="3" fill="url(#tw-card-mid-l)"/>
      <rect x="21" y="11" width="22" height="6" rx="3" fill="url(#tw-edge-l)"/>
      <rect x="24" y="22" width="16" height="1.2" rx="0.6" fill="#ffffff" opacity="0.45"/>
      <rect x="24" y="27" width="13" height="1.2" rx="0.6" fill="#ffffff" opacity="0.35"/>
      <rect x="24" y="32" width="15" height="1.2" rx="0.6" fill="#ffffff" opacity="0.4"/>
      <rect x="24" y="37" width="10" height="1.2" rx="0.6" fill="#ffffff" opacity="0.3"/>
      <rect x="24" y="42" width="12" height="1.2" rx="0.6" fill="#ffffff" opacity="0.3"/>
    </g>
    <g class="tw-card tw-card--front" transform="rotate(12 42 32)">
      <rect x="31" y="13" width="22" height="38" rx="3" fill="url(#tw-card-front-l)"/>
      <rect x="31" y="13" width="22" height="6" rx="3" fill="url(#tw-edge-l)"/>
      <rect x="34" y="24" width="16" height="1.2" rx="0.6" fill="#ffffff" opacity="0.4"/>
      <rect x="34" y="29" width="13" height="1.2" rx="0.6" fill="#ffffff" opacity="0.3"/>
      <rect x="34" y="34" width="15" height="1.2" rx="0.6" fill="#ffffff" opacity="0.35"/>
      <rect x="34" y="39" width="10" height="1.2" rx="0.6" fill="#ffffff" opacity="0.25"/>
    </g>
  </g>
  <text x="158" y="103" font-size="72" letter-spacing="-1">
    <tspan class="tw-word" font-family="'Geist Mono', 'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace" font-weight="500" fill="#0F172A">toolwiki</tspan><tspan class="tw-ai" font-family="'Fraunces', 'Times New Roman', Times, serif" font-style="italic" font-weight="700" font-size="86" fill="url(#tw-ink-l)" filter="url(#tw-glow-l)" dx="8">.ai</tspan>
  </text>
</svg>`;

const DARK_SVG = `<svg viewBox="0 0 720 156" role="img" aria-label="toolwiki.ai" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="tw-card-back-d" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#bae6fd"/>
      <stop offset="55%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#0ea5e9"/>
    </linearGradient>
    <linearGradient id="tw-card-mid-d" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#c7d2fe"/>
      <stop offset="55%" stop-color="#818cf8"/>
      <stop offset="100%" stop-color="#6366f1"/>
    </linearGradient>
    <linearGradient id="tw-card-front-d" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#bfdbfe"/>
      <stop offset="55%" stop-color="#60a5fa"/>
      <stop offset="100%" stop-color="#3b82f6"/>
    </linearGradient>
    <linearGradient id="tw-edge-d" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.7"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="tw-ink-d" x1="0%" y1="0%" x2="100%" y2="55%">
      <stop offset="0%" stop-color="#60a5fa"/>
      <stop offset="50%" stop-color="#a5b4fc"/>
      <stop offset="100%" stop-color="#38bdf8"/>
    </linearGradient>
    <filter id="tw-glow-d" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="9"/>
      <feMerge>
        <feMergeNode/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <g transform="translate(10 4) scale(2.1)">
    <g class="tw-card tw-card--back" transform="rotate(-12 22 32)">
      <rect x="11" y="13" width="22" height="38" rx="3" fill="url(#tw-card-back-d)"/>
      <rect x="11" y="13" width="22" height="6" rx="3" fill="url(#tw-edge-d)"/>
      <rect x="14" y="24" width="16" height="1.2" rx="0.6" fill="#0f172a" opacity="0.35"/>
      <rect x="14" y="29" width="13" height="1.2" rx="0.6" fill="#0f172a" opacity="0.28"/>
      <rect x="14" y="34" width="15" height="1.2" rx="0.6" fill="#0f172a" opacity="0.32"/>
      <rect x="14" y="39" width="10" height="1.2" rx="0.6" fill="#0f172a" opacity="0.22"/>
    </g>
    <g class="tw-card tw-card--mid">
      <rect x="21" y="11" width="22" height="42" rx="3" fill="url(#tw-card-mid-d)"/>
      <rect x="21" y="11" width="22" height="6" rx="3" fill="url(#tw-edge-d)"/>
      <rect x="24" y="22" width="16" height="1.2" rx="0.6" fill="#0f172a" opacity="0.4"/>
      <rect x="24" y="27" width="13" height="1.2" rx="0.6" fill="#0f172a" opacity="0.32"/>
      <rect x="24" y="32" width="15" height="1.2" rx="0.6" fill="#0f172a" opacity="0.36"/>
      <rect x="24" y="37" width="10" height="1.2" rx="0.6" fill="#0f172a" opacity="0.28"/>
      <rect x="24" y="42" width="12" height="1.2" rx="0.6" fill="#0f172a" opacity="0.28"/>
    </g>
    <g class="tw-card tw-card--front" transform="rotate(12 42 32)">
      <rect x="31" y="13" width="22" height="38" rx="3" fill="url(#tw-card-front-d)"/>
      <rect x="31" y="13" width="22" height="6" rx="3" fill="url(#tw-edge-d)"/>
      <rect x="34" y="24" width="16" height="1.2" rx="0.6" fill="#0f172a" opacity="0.35"/>
      <rect x="34" y="29" width="13" height="1.2" rx="0.6" fill="#0f172a" opacity="0.28"/>
      <rect x="34" y="34" width="15" height="1.2" rx="0.6" fill="#0f172a" opacity="0.32"/>
      <rect x="34" y="39" width="10" height="1.2" rx="0.6" fill="#0f172a" opacity="0.22"/>
    </g>
  </g>
  <text x="158" y="103" font-size="72" letter-spacing="-1">
    <tspan class="tw-word" font-family="'Geist Mono', 'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace" font-weight="500" fill="#FAFAFA">toolwiki</tspan><tspan class="tw-ai" font-family="'Fraunces', 'Times New Roman', Times, serif" font-style="italic" font-weight="700" font-size="86" fill="url(#tw-ink-d)" filter="url(#tw-glow-d)" dx="8">.ai</tspan>
  </text>
</svg>`;

async function upsertLogo(
  projectId: string,
  assetKey: string,
  displayName: string,
  inlineSvg: string,
): Promise<"inserted" | "updated"> {
  // Check if row exists for accurate insert vs update reporting.
  const existing = await db
    .select({ id: projectBrandAssets.id })
    .from(projectBrandAssets)
    .where(
      and(
        eq(projectBrandAssets.projectId, projectId),
        eq(projectBrandAssets.assetType, "logo"),
        eq(projectBrandAssets.assetKey, assetKey),
      ),
    )
    .limit(1);

  const op = existing.length > 0 ? "updated" : "inserted";

  await db
    .insert(projectBrandAssets)
    .values({
      projectId,
      assetType: "logo",
      assetKey,
      source: "inline-svg",
      sourceRef: null,
      inlineSvg,
      displayName,
      metadata: { spec: "65.15", origin: "marcel-provided-html" },
    })
    .onConflictDoUpdate({
      target: [projectBrandAssets.projectId, projectBrandAssets.assetType, projectBrandAssets.assetKey],
      set: {
        source: "inline-svg",
        sourceRef: null,
        inlineSvg,
        displayName,
        metadata: { spec: "65.15", origin: "marcel-provided-html" },
        updatedAt: new Date(),
      },
    });

  return op;
}

async function main(): Promise<void> {
  const slug = "toolwiki";
  const [project] = await db
    .select({ id: projects.id, slug: projects.slug })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);

  if (!project) {
    log.error({ slug }, "project not found");
    process.exit(1);
  }

  log.info({ projectId: project.id }, "seeding brand-stamp logo variants");

  const lightOp = await upsertLogo(
    project.id,
    "main-light",
    "Toolwiki Wordmark (light theme)",
    LIGHT_SVG,
  );
  log.info({ assetKey: "main-light", op: lightOp, bytes: LIGHT_SVG.length }, "light variant");

  const darkOp = await upsertLogo(
    project.id,
    "main-dark",
    "Toolwiki Wordmark (dark theme)",
    DARK_SVG,
  );
  log.info({ assetKey: "main-dark", op: darkOp, bytes: DARK_SVG.length }, "dark variant");

  log.info("done");
  process.exit(0);
}

void main().catch((err) => {
  log.error({ err: err instanceof Error ? err.message : String(err) }, "seed failed");
  process.exit(1);
});
