/**
 * Spec 65.0 Day 4 — Template preview service.
 *
 * Renders a template with caller-supplied (or fixture) sample data and
 * writes the slide PNGs to a per-session preview directory under
 * `<cwd>/renders/preview/<sessionId>/`. The existing static handler in
 * `server.ts` serves these via `/renders/preview/...` URLs.
 *
 * Preview-mode (per Spec 65.0 §7.1 + §13 Q7 default):
 *   - No R2 upload
 *   - No `articles` / `social_posts` / `template_renders` DB row
 *   - No cost tracking (rendering is local Remotion + Sharp — no external API call)
 *   - Ephemeral files cleaned up via `cleanupStalePreviewDirs()` at server boot
 *
 * The service bypasses `template.render()` (which needs an Article-shaped DB
 * row + ArticleDiscovery row) and calls the render-server functions directly
 * — mirrors the `packages/social/scripts/visual-render-all.ts` pattern.
 */
import { mkdir, readdir, rm, stat as fsStat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "@marketing-auto/shared";
import {
  DEFAULT_BRAND_TOKENS,
  type BrandTokens,
} from "@marketing-auto/shared/brand-tokens";
import { templateRegistry } from "@marketing-auto/social/templates";
import type { Locale, Theme, TemplateKey } from "@marketing-auto/social/templates";
import { db, eq, getTemplate, projects } from "@marketing-auto/db";
import { getBrandTokens } from "./brand-asset-service.ts";
import { resolveToolIcon, type ResolvedIcon } from "./icon-resolver.ts";

const log = createLogger("template-preview-service");

type RenderServerCallable = (input: Record<string, unknown>) => Promise<{
  slides: Buffer[];
  sequenceCount?: number;
}>;

let _renderServer: Record<string, unknown> | null = null;

/**
 * Dynamic-import the Remotion render-server lazily. Keeps Remotion + headless
 * Chrome out of the API process's cold-boot path (heavy module load).
 * Cached after first call.
 */
async function loadRenderServer(): Promise<Record<string, unknown>> {
  if (_renderServer) return _renderServer;
  _renderServer = (await import(
    "@marketing-auto/social/render-server"
  )) as Record<string, unknown>;
  return _renderServer;
}

export interface PreviewInput {
  projectId: string;
  /**
   * Slug used for the deterministic on-disk path
   * `<cwd>/renders/preview/<projectSlug>/<templateKey>/slide-NN.png`.
   * Passing both id (for DB lookups) + slug (for URLs) avoids a duplicate
   * resolveProjectIdBySlug call inside the service.
   */
  projectSlug: string;
  templateKey: string;
  /**
   * The full composition input as the render-server function expects it
   * — same shape as the composition's Zod schema (e.g. `ComparisonGrid4Input`,
   * `SingleToolSpotlightInput`). The caller is responsible for constructing
   * a valid payload; the preview service does NOT transform fixture data
   * because `mockFixtures[X].input` is the `buildInput`-output shape
   * (`ToolContext`/`Grid4Context`), not the composition's input shape.
   *
   * Day-5 UI work (§7.3 auto-fill) is where convenience layers (last-brief
   * data, fixture-derived examples) get bolted on top of this raw API.
   */
  sampleData: Record<string, unknown>;
  /**
   * Top-level overrides — these win over fields embedded inside sampleData.
   * Useful for Settings UI "render with both themes" / "render with both
   * locales" / "render with project tokens vs custom" pickers.
   */
  theme?: Theme;
  locale?: Locale;
  /** Optional brand-tokens override; falls back to the project's stored tokens. */
  brandTokensOverride?: BrandTokens;
}

export interface PreviewResult {
  /**
   * Deterministic path key — `<projectSlug>/<templateKey>`. Persistent
   * across renders; re-renders overwrite under the same key.
   */
  sessionId: string;
  /** First slide URL — usable as a thumbnail / cover preview. */
  previewUrl: string;
  /** All slide URLs in order. */
  previewUrls: string[];
  slideCount: number;
  renderDurationMs: number;
  /** ISO timestamp of when the render completed. Useful for "last rendered" UI. */
  renderedAt: string;
}

export type PreviewError =
  | { kind: "project_not_found" }
  | { kind: "template_not_found"; templateKey: string }
  | { kind: "template_not_in_registry"; templateKey: string }
  | { kind: "no_render_function"; templateKey: string }
  | { kind: "render_failed"; message: string };

/**
 * The on-disk preview root, relative to `process.cwd()`. The existing
 * `serveStatic({ root: "./" })` middleware in `server.ts` serves files from
 * here at `/renders/preview/...`. The API process's cwd is `apps/api/` in
 * dev + prod; tests may run from repo root which writes to a different
 * `<root>/renders/preview/` — fine because tests don't hit the static
 * handler directly.
 */
function previewRoot(): string {
  return join(process.cwd(), "renders", "preview");
}

/**
 * Run a preview render. Throws on infrastructure errors; returns a
 * discriminated-union `PreviewError | PreviewResult` for caller-actionable
 * outcomes so the route can map each to the right HTTP status.
 */
export async function previewTemplate(
  input: PreviewInput,
): Promise<PreviewResult | PreviewError> {
  // 1. Resolve template metadata via the DB layer (Spec 65.0 Day 1-2).
  //    `getTemplate` prefers the project-scoped row, falling back to global.
  const dbRow = await getTemplate({
    projectId: input.projectId,
    templateKey: input.templateKey,
  });
  if (!dbRow) {
    return { kind: "template_not_found", templateKey: input.templateKey };
  }

  // 2. Pull the in-memory template definition — needed for `renderServerFn`.
  //    The registry is the canonical source for the render path; the DB row
  //    is metadata-only.
  let template;
  try {
    template = templateRegistry.getById(input.templateKey as TemplateKey);
  } catch {
    return { kind: "template_not_in_registry", templateKey: input.templateKey };
  }
  void dbRow; // DB row only used as gate above; meta consumed via the registry def.

  // 3. Resolve the render-server function for this template. The template
  //    self-declares its render-server export via `renderServerFn` — single
  //    source of truth shared with each template's own `render()` method.
  //    Memory D125: avoids the two-source-enum-gotcha that a parallel
  //    Record<key, fnName> map would re-introduce.
  const fnName = template.renderServerFn;
  const mod = await loadRenderServer();
  const renderFn = mod[fnName] as RenderServerCallable | undefined;
  if (typeof renderFn !== "function") {
    return { kind: "no_render_function", templateKey: input.templateKey };
  }

  // 4. Merge run-time overrides into the caller-supplied sample data.
  //    Top-level fields on `input` (theme/locale/brandTokensOverride) win
  //    over the same fields embedded inside sampleData — useful for the
  //    Settings UI's "render with both themes" picker without forcing the
  //    user to mutate sampleData manually.
  const source = input.sampleData;
  const theme: Theme = input.theme ?? (source.theme as Theme) ?? "dark";
  const locale: Locale = input.locale ?? (source.locale as Locale) ?? "de";
  const brandTokens: BrandTokens = input.brandTokensOverride
    ?? (source.brandTokens as BrandTokens | undefined)
    ?? (await getBrandTokens(input.projectId).catch(() => DEFAULT_BRAND_TOKENS));
  const renderInput: Record<string, unknown> = {
    ...source,
    theme,
    locale,
    brandTokens,
  };

  // 5b. Spec 65.0 Day 5 fix — match production: auto-resolve real tool
  //     logos for any `tools[]` array (or singular `tool`) with a `slug`.
  //     Production renders call `buildToolLookup()` inside `buildInput()`
  //     to hydrate `iconSvg` via the simple-icons → iconify → lobe-icons
  //     chain. Preview bypasses `buildInput()` (no Article DB row), so we
  //     run the same resolver here. Caller-supplied `iconSvg` always wins.
  await enrichToolIcons(renderInput, input.projectId);

  // 6. Render.
  const sessionId = `${input.projectSlug}/${input.templateKey}`;
  const startedAt = Date.now();
  let renderResult: { slides: Buffer[]; sequenceCount?: number };
  try {
    renderResult = await renderFn(renderInput);
  } catch (err) {
    log.warn(
      { err, templateKey: input.templateKey, projectId: input.projectId },
      "Preview render threw — likely Zod-schema mismatch on sampleData",
    );
    return {
      kind: "render_failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  const renderDurationMs = Date.now() - startedAt;

  // 7. Persist slides under the deterministic preview directory. Wipe the
  //    existing dir first so an old render with N slides doesn't leak
  //    leftover slide-{N..} files when the new render produces fewer.
  const sessionDir = join(previewRoot(), input.projectSlug, input.templateKey);
  await rm(sessionDir, { recursive: true, force: true }).catch(() => undefined);
  await mkdir(sessionDir, { recursive: true });
  const previewUrls: string[] = [];
  for (let i = 0; i < renderResult.slides.length; i++) {
    const buf = renderResult.slides[i];
    if (!buf) continue;
    const fileName = `slide-${String(i).padStart(2, "0")}.png`;
    await writeFile(join(sessionDir, fileName), buf);
    previewUrls.push(
      `/renders/preview/${input.projectSlug}/${input.templateKey}/${fileName}`,
    );
  }
  if (previewUrls.length === 0) {
    return { kind: "render_failed", message: "Render produced 0 slides" };
  }
  // Non-null assertion safe: just-checked `previewUrls.length > 0`.
  const firstUrl = previewUrls[0] as string;

  log.info(
    {
      sessionId,
      templateKey: input.templateKey,
      projectId: input.projectId,
      projectSlug: input.projectSlug,
      slideCount: previewUrls.length,
      renderDurationMs,
    },
    "Template preview rendered",
  );

  return {
    sessionId,
    previewUrl: firstUrl,
    previewUrls,
    slideCount: previewUrls.length,
    renderDurationMs,
    renderedAt: new Date().toISOString(),
  };
}

/**
 * Spec 65.0 Day 5 — walk the render input and resolve real tool logos for
 * any object with a `slug` field via the same production icon-resolver
 * chain (`resolveToolIcon` → simple-icons / iconify / lobe-icons /
 * deterministic avatar). Mutates `renderInput` in place. Caller-supplied
 * `iconSvg` always takes precedence; only adds it when missing.
 *
 * Handles three shapes that occur across the 5 V1 templates:
 *   - `generated.tools[]` (comparison-grid-3/4)
 *   - `tools[]` at top level (verdict-per-use-case)
 *   - `body.tool` singular (single-tool-spotlight)
 *
 * pro-con-verdict doesn't carry a tools array (single tool's icon comes
 * via `generated.iconInitials` + `generated.iconHue`); we resolve that
 * too when `generated.iconSlug` is set as a convenience field.
 */
async function enrichToolIcons(
  renderInput: Record<string, unknown>,
  projectId: string,
): Promise<void> {
  // Collect every (slug, applyResolved) pair we need to process; dedup
  // slugs so we only hit the resolver once per unique tool.
  type Apply = (resolved: ResolvedIcon) => void;
  const work = new Map<string, Apply[]>();
  const addWork = (slug: string, apply: Apply): void => {
    const arr = work.get(slug) ?? [];
    arr.push(apply);
    work.set(slug, arr);
  };

  const visitToolLike = (toolObj: Record<string, unknown>): void => {
    if (typeof toolObj.iconSvg === "string" && toolObj.iconSvg.length > 0) return;
    const slug = typeof toolObj.slug === "string" ? toolObj.slug : null;
    if (!slug) return;
    addWork(slug, (resolved) => {
      if (resolved.type === "svg") {
        toolObj.iconSvg = resolved.svg;
      } else if (resolved.type === "avatar") {
        // Only overwrite avatar fields if caller didn't already set them.
        if (typeof toolObj.iconInitials !== "string") toolObj.iconInitials = resolved.initials;
        if (typeof toolObj.iconHue !== "number") toolObj.iconHue = resolved.hue;
      }
    });
  };

  // generated.tools[] (comparison-grid-3 / comparison-grid-4)
  const generated = renderInput.generated;
  if (typeof generated === "object" && generated !== null) {
    const gen = generated as Record<string, unknown>;
    const tools = gen.tools;
    if (Array.isArray(tools)) {
      for (const t of tools) {
        if (typeof t === "object" && t !== null) visitToolLike(t as Record<string, unknown>);
      }
    }
    // pro-con-verdict: single-tool convenience — `generated.iconSlug` →
    // resolves to `generated.iconSvg` so the composition can use it.
    if (typeof gen.iconSlug === "string" && typeof gen.iconSvg !== "string") {
      addWork(gen.iconSlug, (resolved) => {
        if (resolved.type === "svg") gen.iconSvg = resolved.svg;
        else {
          if (typeof gen.iconInitials !== "string") gen.iconInitials = resolved.initials;
          if (typeof gen.iconHue !== "number") gen.iconHue = resolved.hue;
        }
      });
    }
  }

  // tools[] top-level (verdict-per-use-case)
  if (Array.isArray(renderInput.tools)) {
    for (const t of renderInput.tools) {
      if (typeof t === "object" && t !== null) visitToolLike(t as Record<string, unknown>);
    }
  }

  // body.tool singular (single-tool-spotlight)
  const body = renderInput.body;
  if (typeof body === "object" && body !== null) {
    const tool = (body as Record<string, unknown>).tool;
    if (typeof tool === "object" && tool !== null) {
      visitToolLike(tool as Record<string, unknown>);
    }
  }

  if (work.size === 0) return;

  // Resolve in parallel; per-slug failures degrade silently (the deterministic
  // avatar fallback is good enough for preview).
  await Promise.all(
    [...work.entries()].map(async ([slug, applies]) => {
      try {
        const resolved = await resolveToolIcon(projectId, slug);
        for (const apply of applies) apply(resolved);
      } catch (err) {
        log.warn({ err, slug }, "Preview tool-icon resolution failed");
      }
    }),
  );
}

/**
 * Spec 65.0 Day 5 — return URLs of persisted slides for one
 * (projectSlug, templateKey) pair, or null when no render has ever
 * happened. Used by `GET /:slug/templates` to surface a thumbnail per row
 * + by the preview modal to pre-populate with the last render.
 */
export async function loadPersistedPreviewState(opts: {
  projectSlug: string;
  templateKey: string;
}): Promise<{ previewUrls: string[]; renderedAt: string } | null> {
  const sessionDir = join(previewRoot(), opts.projectSlug, opts.templateKey);
  let entries: string[];
  try {
    entries = await readdir(sessionDir);
  } catch {
    return null;
  }
  const slideFiles = entries
    .filter((n) => /^slide-\d{2}\.png$/.test(n))
    .sort();
  if (slideFiles.length === 0) return null;
  // The dir's mtime is a reasonable "last rendered" signal — every render
  // wipes the dir and writes fresh files inside.
  let renderedAt = new Date().toISOString();
  try {
    const info = await fsStat(sessionDir);
    renderedAt = new Date(info.mtimeMs).toISOString();
  } catch {
    // Fallback to "now" if stat fails (shouldn't happen since readdir worked).
  }
  return {
    previewUrls: slideFiles.map(
      (n) => `/renders/preview/${opts.projectSlug}/${opts.templateKey}/${n}`,
    ),
    renderedAt,
  };
}

/**
 * Spec 65.0 Day 5: sweep ONLY the legacy Day-4 `preview-<uuid>/` directories
 * under `<cwd>/renders/preview/`. The new persistent-render path is
 * `<projectSlug>/<templateKey>/slide-NN.png` — those dirs don't start with
 * `preview-` and are deliberately preserved across boots so users can
 * revisit the last render. Re-rendering overwrites at the same path
 * (handled in `previewTemplate()`).
 *
 * Test callers can override the directory; production calls with no args
 * use the conventional `<cwd>/renders/preview/`.
 */
export async function cleanupLegacyPreviewSessions(opts?: {
  maxAgeMs?: number;
  directory?: string;
}): Promise<number> {
  const root = opts?.directory ?? previewRoot();
  const cutoff = Date.now() - (opts?.maxAgeMs ?? 60 * 60 * 1000);
  let deleted = 0;
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    // Root doesn't exist yet — first boot. No-op.
    return 0;
  }
  for (const name of entries) {
    if (!name.startsWith("preview-")) continue;
    const dirPath = join(root, name);
    try {
      // `node:fs/promises.stat` is the portable way to read mtime on a
      // directory; `Bun.file(...).stat()` is file-only and returns invalid
      // mtime on directory paths.
      const info = await fsStat(dirPath);
      if (info.mtimeMs <= cutoff) {
        await rm(dirPath, { recursive: true, force: true });
        deleted += 1;
      }
    } catch {
      // Best-effort.
    }
  }
  if (deleted > 0) {
    log.info({ deleted, root, maxAgeMs: opts?.maxAgeMs }, "Swept stale preview dirs");
  }
  return deleted;
}

/**
 * Resolve a project by slug. Convenience wrapper for the route layer.
 * Returns null when the project doesn't exist.
 */
export async function resolveProjectIdBySlug(slug: string): Promise<string | null> {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  return project?.id ?? null;
}
