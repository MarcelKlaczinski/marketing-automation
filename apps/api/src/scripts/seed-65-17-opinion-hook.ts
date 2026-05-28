/**
 * Spec 65.17 follow-up — Seed one moderate-drama opinion-recommendation hook
 * + one weekly recurring_content_definition that uses it.
 *
 * Marcel-Brief: "mach mal noch eine super hook mit /social für Instagram
 * und bau mir daraus einen recurring content"
 *
 * Hook designed via the /social skill framework + Spec 65.14 drama-intensity
 * guidance:
 *   - Pattern:   "Ich habe {n} KI-Tools getestet. {tool} hat als einziges überzeugt."
 *   - Variables: ["n", "tool"]
 *   - Drama:     moderate (curator-confidence + positive-framing, NOT aggressive
 *                contrarian like the existing 5 Toolwiki opinion hooks)
 *   - Language:  de
 *
 * Why opinion_recommendation (and not story_arc / lifestyle):
 *   - Single-tool advocacy frame matches "{tool} hat als einziges überzeugt"
 *   - 6-slide carousel (Cover → HotTake → Reasoning ×2 → TopPick → End) fits
 *     the "tested, picked one" narrative
 *   - Drama-intensity gap: Toolwiki has 5 opinion hooks live, ALL aggressive
 *     (RIP/Vergiss/contrarian patterns); zero moderate — this fills the gap
 *
 * Featured tool: Claude — broadest persona-appeal across solopreneurs /
 * marketers / creators / developers + 100% persona-score coverage in DE.
 * Marcel can clone the definition with a different `recommendedToolId` to
 * make sibling rubrics for Midjourney / ChatGPT / Cursor / Perplexity etc.
 *
 * Definition stays `is_active = false` so Marcel reviews via the Settings
 * UI before the first cron fire. Activation flips the active flag.
 *
 * Idempotent: re-running skips inserts when a hook with this exact pattern
 * already exists for the project (avoids dupes).
 */
import { db, hookTemplates, recurringContentDefinitions } from "@marketing-auto/db";
import { and, eq, sql } from "drizzle-orm";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("seed-65-17-opinion-hook");

const PROJECT_SLUG = "toolwiki";

// Hook spec — derived from /social skill framework + Spec 65.14 patterns.
const HOOK_PATTERN =
  "Ich habe {n} KI-Tools getestet. {tool} hat als einziges überzeugt.";
const HOOK_VARIABLES = ["n", "tool"] as const;
const HOOK_DRAMA_INTENSITY = "moderate" as const;
const HOOK_LANGUAGE = "de" as const;

// Featured tool slug (Claude — broad persona appeal, DE 100% scored).
const FEATURED_TOOL_SLUG = "claude";

// Recurring-content definition shape.
const DEFINITION_NAME = "Wöchentliche KI-Tool-Empfehlung (Curator-Confidence)";
const FREQUENCY = "weekly";

/** Next Friday 14:00 UTC — peak Instagram-engagement window for DACH-market. */
function computeNextFriday14Utc(): Date {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 5=Fri
  const daysUntilFriday = (5 - dayOfWeek + 7) % 7 || 7;
  const next = new Date(now);
  next.setUTCDate(now.getUTCDate() + daysUntilFriday);
  next.setUTCHours(14, 0, 0, 0);
  return next;
}

async function main(): Promise<void> {
  // 1. Resolve project_id.
  const projectRows = await db.execute<{ id: string }>(
    sql`SELECT id FROM projects WHERE slug = ${PROJECT_SLUG} LIMIT 1`,
  );
  const projectId = projectRows[0]?.id;
  if (!projectId) {
    throw new Error(`Project '${PROJECT_SLUG}' not found`);
  }
  log.info({ projectId }, "Resolved project");

  // 2. Resolve featured tool article-id (DE locale, must have score + logo).
  const toolRows = await db.execute<{ id: string; title: string | null }>(sql`
    SELECT a.id, a.title
    FROM articles a
    WHERE a.project_id = ${projectId}
      AND a.collection = 'tools'
      AND a.locale = 'de'
      AND a.slug = ${FEATURED_TOOL_SLUG}
      AND EXISTS (SELECT 1 FROM tool_persona_scores tps WHERE tps.tool_id = a.id)
      AND EXISTS (SELECT 1 FROM tool_brand_assets tba WHERE tba.tool_id = a.id AND tba.logo_url IS NOT NULL)
    LIMIT 1
  `);
  const featuredToolId = toolRows[0]?.id;
  const featuredToolTitle = toolRows[0]?.title;
  if (!featuredToolId) {
    throw new Error(
      `Featured tool '${FEATURED_TOOL_SLUG}' not found OR lacks persona-score / logo`,
    );
  }
  log.info(
    { featuredToolId, title: featuredToolTitle },
    "Resolved featured tool",
  );

  // 3. Idempotency check — skip hook insert if an identical pattern already
  //    exists for this project + format-type + language.
  const existingHook = await db
    .select({ id: hookTemplates.id })
    .from(hookTemplates)
    .where(
      and(
        eq(hookTemplates.projectId, projectId),
        eq(hookTemplates.formatType, "opinion_recommendation"),
        eq(hookTemplates.language, HOOK_LANGUAGE),
        eq(hookTemplates.pattern, HOOK_PATTERN),
      ),
    )
    .limit(1);

  let hookId: string;
  if (existingHook[0]) {
    hookId = existingHook[0].id;
    log.warn({ hookId }, "Hook with identical pattern already exists — skipping insert");
  } else {
    const insertedHook = await db
      .insert(hookTemplates)
      .values({
        projectId,
        formatType: "opinion_recommendation",
        language: HOOK_LANGUAGE,
        pattern: HOOK_PATTERN,
        variables: [...HOOK_VARIABLES],
        dramaIntensity: HOOK_DRAMA_INTENSITY,
        isActive: true,
      })
      .returning({ id: hookTemplates.id });
    hookId = insertedHook[0]?.id ?? "";
    if (!hookId) throw new Error("Hook insert returned no row");
    log.info({ hookId, pattern: HOOK_PATTERN }, "Inserted new hook");
  }

  // 4. Idempotency check — skip definition insert if one with the same name
  //    already exists for this project.
  const existingDef = await db
    .select({ id: recurringContentDefinitions.id })
    .from(recurringContentDefinitions)
    .where(
      and(
        eq(recurringContentDefinitions.projectId, projectId),
        eq(recurringContentDefinitions.name, DEFINITION_NAME),
      ),
    )
    .limit(1);

  let definitionId: string;
  if (existingDef[0]) {
    definitionId = existingDef[0].id;
    log.warn(
      { definitionId },
      "Recurring-content definition with same name already exists — skipping insert",
    );
  } else {
    const formatConfig: Record<string, unknown> = {
      recommendedToolId: featuredToolId,
      opinionStance: "enthusiastic", // straightforward advocacy
      affiliateAngle: false, // keep it value-prop-only, no monetary references
      // No `competitorTool` set — hook-picker drops `{established}` patterns
      // automatically, so my `{n} + {tool}` pattern is the only eligible
      // moderate-drama hook for this fire (good — predictable rendering).
    };

    const insertedDef = await db
      .insert(recurringContentDefinitions)
      .values({
        projectId,
        name: DEFINITION_NAME,
        formatType: "opinion_recommendation",
        formatConfig,
        frequency: FREQUENCY,
        nextRunAt: computeNextFriday14Utc(),
        outputTargets: { article: false, social: true },
        templateSelectionStrategy: "fixed",
        fixedTemplateKey: "opinion-recommendation",
        endSlideStrategy: "rotation",
        endSlidePool: [], // empty → falls back to format-type defaults (link-in-bio, tag-friend)
        targetLocales: ["de"], // Phase-0 reality: DE persona-coverage 100%, EN 15%
        isActive: false, // Marcel reviews via Settings UI before activating
      })
      .returning({
        id: recurringContentDefinitions.id,
        nextRunAt: recurringContentDefinitions.nextRunAt,
      });
    definitionId = insertedDef[0]?.id ?? "";
    if (!definitionId) throw new Error("Definition insert returned no row");
    log.info(
      {
        definitionId,
        name: DEFINITION_NAME,
        nextRunAt: insertedDef[0]?.nextRunAt,
        featuredTool: featuredToolTitle,
      },
      "Inserted new recurring-content definition (is_active=false)",
    );
  }

  // 5. Report.
  console.log("\n────────────────────────────────────────────────────────");
  console.log(`✓ Hook ID:            ${hookId}`);
  console.log(`✓ Definition ID:      ${definitionId}`);
  console.log(`✓ Project:            ${PROJECT_SLUG} (${projectId})`);
  console.log(`✓ Featured Tool:      ${featuredToolTitle} (${featuredToolId})`);
  console.log(`✓ is_active:          false (review in Settings UI before activating)`);
  console.log("");
  console.log("Next steps for Marcel:");
  console.log(`  1. Open: /projects/${PROJECT_SLUG}/settings/recurring-content/${definitionId}`);
  console.log("  2. Run 'Dry-Run' to preview the brief without persisting");
  console.log("  3. Run 'Sample-Image' to preview the NB2 visual with current preset");
  console.log("  4. Toggle is_active → ON to enable weekly cron fire");
  console.log("────────────────────────────────────────────────────────\n");

  process.exit(0);
}

main().catch((err) => {
  log.error({ err: err instanceof Error ? err.message : String(err) }, "Seed failed");
  process.exit(1);
});
