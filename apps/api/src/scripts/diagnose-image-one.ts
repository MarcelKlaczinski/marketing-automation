import { db, articles, projects } from "@marketing-auto/db";
import { eq, and, sql } from "drizzle-orm";

const [proj] = await db.select({ id: projects.id, slug: projects.slug }).from(projects).where(eq(projects.slug, "toolwiki")).limit(1);
if (!proj) { console.log("no toolwiki"); process.exit(0); }

const enId = "f0986555-a53e-4593-97ec-10a3e80c83f6";

async function loadArticle(id: string) {
  const [row] = await db
    .select({
      id: articles.id,
      slug: articles.slug,
      locale: articles.locale,
      collection: articles.collection,
      status: articles.status,
      title: articles.title,
      metaDescription: articles.metaDescription,
      translationKey: articles.translationKey,
      outline: articles.outline,
      bodyMd: articles.bodyMd,
      wordCount: articles.wordCount,
      selfReviewScore: articles.selfReviewScore,
      selfReviewIssues: articles.selfReviewIssues,
      frontmatterExtras: articles.frontmatterExtras,
      heroImageR2Key: articles.heroImageR2Key,
      heroImagePublicUrl: articles.heroImagePublicUrl,
      heroImageAltText: articles.heroImageAltText,
      author: articles.author,
      clusterId: articles.clusterId,
      tags: articles.tags,
      category: articles.category,
      subcategory: articles.subcategory,
      createdAt: articles.createdAt,
      updatedAt: articles.updatedAt,
    })
    .from(articles)
    .where(eq(articles.id, id))
    .limit(1);
  return row;
}

const en = await loadArticle(enId);
if (!en) {
  console.log("EN article not found");
  process.exit(0);
}

let de: typeof en | undefined;
if (en.translationKey) {
  const [row] = await db
    .select({
      id: articles.id,
      slug: articles.slug,
      locale: articles.locale,
      collection: articles.collection,
      status: articles.status,
      title: articles.title,
      metaDescription: articles.metaDescription,
      translationKey: articles.translationKey,
      outline: articles.outline,
      bodyMd: articles.bodyMd,
      wordCount: articles.wordCount,
      selfReviewScore: articles.selfReviewScore,
      selfReviewIssues: articles.selfReviewIssues,
      frontmatterExtras: articles.frontmatterExtras,
      heroImageR2Key: articles.heroImageR2Key,
      heroImagePublicUrl: articles.heroImagePublicUrl,
      heroImageAltText: articles.heroImageAltText,
      author: articles.author,
      clusterId: articles.clusterId,
      tags: articles.tags,
      category: articles.category,
      subcategory: articles.subcategory,
      createdAt: articles.createdAt,
      updatedAt: articles.updatedAt,
    })
    .from(articles)
    .where(
      and(
        eq(articles.projectId, proj.id),
        eq(articles.translationKey, en.translationKey),
        sql`${articles.id} <> ${enId}`,
      ),
    )
    .limit(1);
  de = row;
}

function summary(label: string, a: typeof en) {
  console.log(`\n========================== ${label} ==========================`);
  console.log(JSON.stringify({
    id: a.id,
    slug: a.slug,
    locale: a.locale,
    collection: a.collection,
    status: a.status,
    title: a.title,
    metaDescription: a.metaDescription,
    author: a.author,
    clusterId: a.clusterId,
    category: a.category,
    subcategory: a.subcategory,
    wordCount: a.wordCount,
    selfReviewScore: a.selfReviewScore,
    bodyMdLen: a.bodyMd?.length ?? 0,
    tags: a.tags,
    heroImageR2Key: a.heroImageR2Key,
    heroImagePublicUrl: a.heroImagePublicUrl,
    heroImageAltText: a.heroImageAltText,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }, null, 2));

  console.log("\n--- outline ---");
  console.log(JSON.stringify(a.outline, null, 2));

  console.log("\n--- frontmatterExtras ---");
  console.log(JSON.stringify(a.frontmatterExtras, null, 2));

  console.log("\n--- selfReviewIssues ---");
  console.log(JSON.stringify(a.selfReviewIssues, null, 2));

  console.log("\n--- bodyMd ---");
  console.log(a.bodyMd ?? "(empty)");
}

summary("EN", en);
if (de) summary("DE", de);
else console.log("\n(no DE sibling found)");
