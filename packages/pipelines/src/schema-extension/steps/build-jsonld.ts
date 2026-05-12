import { hasVariants } from "@marketing-auto/shared/hero-variants";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";

const InputSchema = z.object({
  article: z.object({
    title: z.string(),
    slug: z.string(),
    locale: z.string().nullable(),
    metaDescription: z.string(),
    schemaJsonLd: z.array(z.record(z.unknown())),
    heroImagePublicUrl: z.string().url().nullable(),
    heroImageR2Key: z.string().nullable(),
  }),
  project: z.object({
    slug: z.string(),
    name: z.string(),
    domain: z.string(),
  }),
  cluster: z
    .object({
      name: z.string(),
      pillar: z.string(),
    })
    .nullable(),
  detection: z.object({
    hasFaq: z.boolean(),
    hasHowTo: z.boolean(),
    faqQuestions: z.array(z.object({ question: z.string(), answer: z.string() })),
    howToSteps: z.array(z.object({ name: z.string(), text: z.string() })),
    howToName: z.string().nullable(),
    howToTotalTime: z.string().nullable(),
  }),
});

const OutputSchema = z.object({
  schemaJsonLd: z.array(z.record(z.unknown())),
  addedTypes: z.array(z.enum(["BreadcrumbList", "FAQPage", "HowTo"])),
});

export class BuildJsonLdStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "build-jsonld";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number {
    return 0;
  }

  async execute(input: z.infer<typeof InputSchema>, _ctx: StepContext) {
    const baseUrl = `https://${input.project.domain}`;
    const localePath = input.article.locale ? `/${input.article.locale}` : "";
    const articleUrl = `${baseUrl}${localePath}/blog/${input.article.slug}`;

    // Use absolute production URL for the hero image:
    // - If variants have been generated (slug-based r2Key), point at the Astro static path
    // - Otherwise, use the stored public URL only when it is not a localhost dev URL
    const heroImageAbsoluteUrl = (() => {
      if (input.article.heroImageR2Key && hasVariants(input.article.heroImageR2Key)) {
        return `${baseUrl}/gen/${input.article.slug}/hero.webp`;
      }
      const raw = input.article.heroImagePublicUrl;
      if (raw && !raw.includes("localhost") && !raw.includes("127.0.0.1")) {
        return raw;
      }
      return null;
    })();

    const additions: Array<Record<string, unknown>> = [];
    const addedTypes: Array<"BreadcrumbList" | "FAQPage" | "HowTo"> = [];

    // BreadcrumbList — always emitted
    additions.push(
      buildBreadcrumb({
        baseUrl,
        localePath,
        articleTitle: input.article.title,
        articleUrl,
        cluster: input.cluster,
      })
    );
    addedTypes.push("BreadcrumbList");

    // FAQPage — if ≥3 questions detected
    if (input.detection.hasFaq && input.detection.faqQuestions.length >= 3) {
      additions.push(buildFaqPage(input.detection.faqQuestions));
      addedTypes.push("FAQPage");
    }

    // HowTo — if ≥3 steps and a name
    if (
      input.detection.hasHowTo &&
      input.detection.howToSteps.length >= 3 &&
      input.detection.howToName
    ) {
      additions.push(
        buildHowTo({
          name: input.detection.howToName,
          steps: input.detection.howToSteps,
          totalTime: input.detection.howToTotalTime,
          heroImageUrl: heroImageAbsoluteUrl,
        })
      );
      addedTypes.push("HowTo");
    }

    // Replace any existing entries of the same @type (re-runs are idempotent)
    const existingMinusOurs = input.article.schemaJsonLd.filter((s) => {
      const t = (s["@type"] as string) ?? "";
      return !addedTypes.includes(t as "BreadcrumbList" | "FAQPage" | "HowTo");
    });

    return {
      schemaJsonLd: [...existingMinusOurs, ...additions],
      addedTypes,
    };
  }
}

function buildBreadcrumb(input: {
  baseUrl: string;
  localePath: string;
  articleTitle: string;
  articleUrl: string;
  cluster: { name: string; pillar: string } | null;
}): Record<string, unknown> {
  const items: Array<Record<string, unknown>> = [
    { "@type": "ListItem", position: 1, name: "Home", item: input.baseUrl },
    { "@type": "ListItem", position: 2, name: "Blog", item: `${input.baseUrl}${input.localePath}/blog` },
  ];

  let position = 3;
  if (input.cluster) {
    items.push({
      "@type": "ListItem",
      position,
      name: input.cluster.name,
      item: `${input.baseUrl}/cluster/${slugify(input.cluster.name)}`,
    });
    position++;
  }

  items.push({
    "@type": "ListItem",
    position,
    name: input.articleTitle,
    item: input.articleUrl,
  });

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items,
  };
}

function buildFaqPage(
  questions: Array<{ question: string; answer: string }>
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: questions.map((q) => ({
      "@type": "Question",
      name: q.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: q.answer,
      },
    })),
  };
}

function buildHowTo(input: {
  name: string;
  steps: Array<{ name: string; text: string }>;
  totalTime: string | null;
  heroImageUrl: string | null;
}): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: input.name,
    ...(input.heroImageUrl ? { image: input.heroImageUrl } : {}),
    step: input.steps.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.name,
      text: s.text,
    })),
  };
  if (input.totalTime) obj.totalTime = input.totalTime;
  return obj;
}

// Umlauts before NFD per Spec 20 lesson #7 (Slugify-Order)
function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
