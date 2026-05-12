import { join } from "node:path";
import { brandVoices, db, projects } from "@marketing-auto/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { ApprovedClusterSchema, CornerstoneSpecSchema } from "../04-cornerstone-list/steps.ts";
import {
  COLD_START_FILES,
  coldStartFile,
  fileExists,
  parseDataBlock,
  projectContextDir,
  readMarkdownIfExists,
} from "../shared/index.ts";

// ─── Output schemas ───────────────────────────────────────────────────────────

export const CheckItemSchema = z.object({
  section: z.string(),
  label: z.string(),
  checked: z.boolean(),
  note: z.string().optional(),
});

export type CheckItem = z.infer<typeof CheckItemSchema>;

export const GoLiveChecklistOutputSchema = z.object({
  checks: z.array(CheckItemSchema),
  readyToLaunch: z.boolean(),
  blockerCount: z.number().int().min(0),
});

export type GoLiveChecklistOutput = z.infer<typeof GoLiveChecklistOutputSchema>;

// ─── Step ─────────────────────────────────────────────────────────────────────

export class GenerateGoLiveChecklistStep extends BaseStep<
  { projectSlug: string },
  GoLiveChecklistOutput
> {
  readonly name = "generate-go-live-checklist";
  readonly inputSchema = z.object({ projectSlug: z.string() });
  readonly outputSchema = GoLiveChecklistOutputSchema;

  override estimatedCostEur(): number {
    return 0.0;
  }

  async execute(input: { projectSlug: string }, ctx: StepContext): Promise<GoLiveChecklistOutput> {
    const { projectSlug } = input;
    const checks: CheckItem[] = [];

    // ── Load project from DB ─────────────────────────────────────────────────
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, ctx.projectId))
      .limit(1);

    const [activeBrandVoice] = await db
      .select({ id: brandVoices.id })
      .from(brandVoices)
      .where(and(eq(brandVoices.projectId, ctx.projectId), eq(brandVoices.isActive, true)))
      .limit(1);

    // ── Section: Configuration ───────────────────────────────────────────────

    const contextPath = join(projectContextDir(projectSlug), "marketing-context.md");
    const contextMd = await readMarkdownIfExists(contextPath);
    checks.push({
      section: "Configuration",
      label: "marketing-context.md complete and synced to DB",
      checked: !!contextMd && contextMd.length > 200 && !!project?.marketingContextMd,
      note: !contextMd
        ? `File missing — create project-contexts/${projectSlug}/marketing-context.md`
        : !project?.marketingContextMd
          ? `File exists but not synced — run: bun --filter @marketing-auto/api sync-context ${projectSlug}`
          : undefined,
    });

    checks.push({
      section: "Configuration",
      label: "DB project row created with industry + pipeline-template",
      checked: !!project?.industry && !!project?.pipelineTemplate,
    });

    checks.push({
      section: "Configuration",
      label: "Brand voice version set as active in brand_voices table",
      checked: !!activeBrandVoice,
      note: !activeBrandVoice
        ? "No active brand voice found — run voice-refinement synthesize, then sync-context"
        : undefined,
    });

    const hasCostLimits = project?.costLimits && Object.keys(project.costLimits).length > 0;
    checks.push({
      section: "Configuration",
      label: "Cost limits set in projects.cost_limits",
      checked: !!hasCostLimits,
      note: !hasCostLimits
        ? "Set cost limits via the API or DB — guards against runaway spend in Article Pipeline"
        : undefined,
    });

    checks.push({
      section: "Configuration",
      label: "Environment-specific publishing config ready (Astro CMS adapter, Phase 3)",
      checked: false,
      note: "Manual — configure when Phase 3 CMS integration is set up",
    });

    // ── Section: Cold-Start Phases ───────────────────────────────────────────

    const voicePath = coldStartFile(projectSlug, COLD_START_FILES.voiceRefinement);
    const voiceExists = await fileExists(voicePath);
    checks.push({
      section: "Cold-Start Phases",
      label: "Voice refinement complete (01-voice-refinement.md exists)",
      checked: voiceExists,
      note: !voiceExists
        ? `Run: bun --filter @marketing-auto/api cold-start:voice-refinement ${projectSlug}`
        : undefined,
    });

    const competitorPath = coldStartFile(projectSlug, COLD_START_FILES.competitorAnalysis);
    const competitorExists = await fileExists(competitorPath);
    checks.push({
      section: "Cold-Start Phases",
      label: "Competitor analysis complete (02-competitor-analysis.md exists)",
      checked: competitorExists,
      note: !competitorExists
        ? `Run: bun --filter @marketing-auto/api cold-start:competitor-analysis ${projectSlug} analyze`
        : undefined,
    });

    const clusterPath = coldStartFile(projectSlug, COLD_START_FILES.clusterPlan);
    const clusterMd = await readMarkdownIfExists(clusterPath);
    checks.push({
      section: "Cold-Start Phases",
      label: "Cluster plan complete (03-cluster-plan.md exists)",
      checked: !!clusterMd,
      note: !clusterMd
        ? `Run: bun --filter @marketing-auto/api cold-start:cluster-plan ${projectSlug} expand`
        : undefined,
    });

    const cornerstonePath = coldStartFile(projectSlug, COLD_START_FILES.cornerstoneList);
    const cornerstoneMd = await readMarkdownIfExists(cornerstonePath);
    checks.push({
      section: "Cold-Start Phases",
      label: "Cornerstone list complete (04-cornerstone-list.md exists)",
      checked: !!cornerstoneMd,
      note: !cornerstoneMd
        ? `Run: bun --filter @marketing-auto/api cold-start:cornerstone-list ${projectSlug}`
        : undefined,
    });

    // ── Section: Cluster Plan ────────────────────────────────────────────────

    let clusterPillarsOk = false;

    if (clusterMd) {
      try {
        const allClusters = parseDataBlock(clusterMd, "clusters", z.array(ApprovedClusterSchema));
        const approved = allClusters.filter((c) => c.status === "approved");
        clusterPillarsOk = approved.length > 0 && approved.every((c) => !!c.pillar);

        checks.push({
          section: "Cluster Plan",
          label: `At least 5 clusters approved (found ${approved.length})`,
          checked: approved.length >= 5,
          note:
            approved.length < 5
              ? `Open ${clusterPath} and set "status: approved" on at least 5 clusters`
              : undefined,
        });

        const satelliteOk = approved.every((c) => c.satellite_keywords.length >= 5);
        checks.push({
          section: "Cluster Plan",
          label: "Each approved cluster has 5+ satellite keywords",
          checked: satelliteOk,
          note: !satelliteOk
            ? "Some clusters have fewer than 5 satellite keywords — re-run cluster-plan expand if needed"
            : undefined,
        });

        checks.push({
          section: "Cluster Plan",
          label: "All approved clusters have a pillar assigned",
          checked: clusterPillarsOk,
          note: !clusterPillarsOk
            ? "Some clusters are missing pillar assignments in the DATA block"
            : undefined,
        });
      } catch {
        checks.push({
          section: "Cluster Plan",
          label: "clusters DATA block parseable",
          checked: false,
          note: "Could not parse DATA:clusters block in 03-cluster-plan.md — check file structure",
        });
      }
    } else {
      checks.push({
        section: "Cluster Plan",
        label: "At least 5 clusters approved",
        checked: false,
        note: "Cluster plan not yet generated",
      });
      checks.push({
        section: "Cluster Plan",
        label: "Each approved cluster has 5+ satellite keywords",
        checked: false,
        note: "Cluster plan not yet generated",
      });
      checks.push({
        section: "Cluster Plan",
        label: "All approved clusters have a pillar assigned",
        checked: false,
        note: "Cluster plan not yet generated",
      });
    }

    // ── Section: Cornerstone Articles ────────────────────────────────────────

    if (cornerstoneMd) {
      try {
        const allCornerstones = parseDataBlock(
          cornerstoneMd,
          "cornerstones",
          z.array(CornerstoneSpecSchema.extend({ status: z.enum(["proposed", "approved"]) }))
        );
        const approved = allCornerstones.filter((c) => c.status === "approved");

        checks.push({
          section: "Cornerstone Articles",
          label: `At least 5 cornerstone articles approved (found ${approved.length})`,
          checked: approved.length >= 5,
          note:
            approved.length < 5
              ? `Open ${cornerstonePath} and set "status: approved" on at least 5 articles`
              : undefined,
        });

        const hasOutlines = approved.every(
          (c) =>
            c.proposed_title &&
            c.proposed_slug &&
            Array.isArray(c.h2_outline) &&
            c.h2_outline.length >= 3
        );
        checks.push({
          section: "Cornerstone Articles",
          label: "Each approved cornerstone has title, slug, outline, word count",
          checked: hasOutlines,
          note: !hasOutlines
            ? "Some approved cornerstones are missing required fields — check the DATA block"
            : undefined,
        });
      } catch {
        checks.push({
          section: "Cornerstone Articles",
          label: "cornerstones DATA block parseable",
          checked: false,
          note: "Could not parse DATA:cornerstones block in 04-cornerstone-list.md — check file structure",
        });
      }
    } else {
      checks.push({
        section: "Cornerstone Articles",
        label: "At least 5 cornerstone articles approved",
        checked: false,
        note: "Cornerstone list not yet generated",
      });
      checks.push({
        section: "Cornerstone Articles",
        label: "Each approved cornerstone has title, slug, outline, word count",
        checked: false,
        note: "Cornerstone list not yet generated",
      });
    }

    // ── Section: Technical ───────────────────────────────────────────────────

    checks.push({
      section: "Technical",
      label: "R2 bucket configured + custom domain",
      checked: false,
      note: "Manual — verify R2 bucket exists and custom domain is routed",
    });

    checks.push({
      section: "Technical",
      label: "Replicate API key validated (test image generated)",
      checked: false,
      note: "Manual — run a test image generation to confirm the key works",
    });

    checks.push({
      section: "Technical",
      label: "DataForSEO deposit funded",
      checked: false,
      note: "Manual — check DataForSEO account balance before running Article Pipeline",
    });

    checks.push({
      section: "Technical",
      label: "Astro repo connected (Phase 3)",
      checked: false,
      note: "Manual — required before Article Pipeline can publish",
    });

    // ── Section: Author / Brand ──────────────────────────────────────────────

    checks.push({
      section: "Author / Brand",
      label: "Author profile published with photo + bio",
      checked: false,
      note: "Manual — required for E-E-A-T signals",
    });

    checks.push({
      section: "Author / Brand",
      label: "Schema.org organization markup verified",
      checked: false,
      note: "Manual — validate with Google Rich Results Test after first publish",
    });

    checks.push({
      section: "Author / Brand",
      label: "Imprint + privacy policy pages live",
      checked: false,
      note: "Manual — required by German law (Impressumspflicht)",
    });

    // ── Section: Quality Gates ───────────────────────────────────────────────

    checks.push({
      section: "Quality Gates",
      label: "First article generated end-to-end via Article Pipeline (Phase 3)",
      checked: false,
      note: "Manual — complete after Article Pipeline is implemented",
    });

    checks.push({
      section: "Quality Gates",
      label: "First article reviewed and approved by Marcel",
      checked: false,
      note: "Manual",
    });

    checks.push({
      section: "Quality Gates",
      label: "First article published to staging environment",
      checked: false,
      note: "Manual",
    });

    checks.push({
      section: "Quality Gates",
      label: "Lighthouse score > 95 on staging",
      checked: false,
      note: "Manual — run Lighthouse after first staging publish",
    });

    // ── Summary ──────────────────────────────────────────────────────────────

    const blockers = checks.filter((c) => !c.checked);
    const readyToLaunch = blockers.length === 0;

    return { checks, readyToLaunch, blockerCount: blockers.length };
  }
}
