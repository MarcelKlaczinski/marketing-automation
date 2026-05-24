import {
  db,
  articles,
  eq,
  and,
  sql,
} from "@marketing-auto/db";

const PROJECT_ID = "3fad7929-b06d-47ce-b6a1-8ac134362c42";

// ──────── Phase 1: Hero-column coverage ────────
console.log("# Phase 1 — Hero column coverage per collection × locale\n");

const cov = await db
  .select({
    collection: articles.collection,
    locale: articles.locale,
    source: articles.source,
    total: sql<number>`count(*)::int`,
    hasR2Key: sql<number>`count(*) FILTER (WHERE ${articles.heroImageR2Key} IS NOT NULL)::int`,
    hasPublicUrl: sql<number>`count(*) FILTER (WHERE ${articles.heroImagePublicUrl} IS NOT NULL)::int`,
    hasAltText: sql<number>`count(*) FILTER (WHERE ${articles.heroImageAltText} IS NOT NULL)::int`,
    hasOriginalR2: sql<number>`count(*) FILTER (WHERE ${articles.heroImageOriginalR2Key} IS NOT NULL)::int`,
  })
  .from(articles)
  .where(eq(articles.projectId, PROJECT_ID))
  .groupBy(articles.collection, articles.locale, articles.source)
  .orderBy(articles.collection, articles.locale, articles.source);

console.log("| collection | locale | source | total | hero_r2_key | hero_public_url | hero_alt_text | hero_original_r2 |");
console.log("|---|---|---|---|---|---|---|---|");
for (const r of cov) {
  console.log(
    `| ${r.collection} | ${r.locale} | ${r.source} | ${r.total} | ${r.hasR2Key} | ${r.hasPublicUrl} | ${r.hasAltText} | ${r.hasOriginalR2} |`,
  );
}

// Column existence check
console.log("\n## Hero column existence (information_schema)\n");
const cols = await db.execute(sql`
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_name = 'articles' AND column_name LIKE 'hero%'
  ORDER BY column_name
`);
for (const c of cols as Array<Record<string, unknown>>) {
  console.log(`  ${c.column_name as string} : ${c.data_type as string} (nullable=${c.is_nullable as string})`);
}

// ──────── Phase 2: domain_extras hero key coverage ────────
console.log("\n\n# Phase 2 — domain_extras hero-key coverage (imported only)\n");

const heroKeyCov = await db
  .select({
    collection: articles.collection,
    total: sql<number>`count(*)::int`,
    hasHeroImage: sql<number>`count(*) FILTER (WHERE ${articles.domainExtras} ? 'heroImage')::int`,
    hasImage: sql<number>`count(*) FILTER (WHERE ${articles.domainExtras} ? 'image')::int`,
    hasCover: sql<number>`count(*) FILTER (WHERE ${articles.domainExtras} ? 'cover')::int`,
    hasHeroImageAlt: sql<number>`count(*) FILTER (WHERE ${articles.domainExtras} ? 'heroImageAlt')::int`,
  })
  .from(articles)
  .where(and(eq(articles.projectId, PROJECT_ID), eq(articles.source, "imported")))
  .groupBy(articles.collection)
  .orderBy(articles.collection);

console.log("| collection | total | has heroImage | has image | has cover | has heroImageAlt |");
console.log("|---|---|---|---|---|---|");
for (const r of heroKeyCov) {
  console.log(`| ${r.collection} | ${r.total} | ${r.hasHeroImage} | ${r.hasImage} | ${r.hasCover} | ${r.hasHeroImageAlt} |`);
}

// Sample 40 actual hero-image path values
console.log("\n\n## Sample 40 imported articles: heroImage + image values\n");
const samples = await db
  .select({
    collection: articles.collection,
    locale: articles.locale,
    slug: articles.slug,
    heroImage: sql<string | null>`${articles.domainExtras}->>'heroImage'`,
    image: sql<string | null>`${articles.domainExtras}->>'image'`,
    cover: sql<string | null>`${articles.domainExtras}->>'cover'`,
    heroImageAlt: sql<string | null>`${articles.domainExtras}->>'heroImageAlt'`,
  })
  .from(articles)
  .where(and(eq(articles.projectId, PROJECT_ID), eq(articles.source, "imported")))
  .orderBy(articles.collection, articles.locale, articles.slug)
  .limit(60);

console.log("| collection/locale/slug | heroImage | image | cover | heroImageAlt? |");
console.log("|---|---|---|---|---|");
for (const s of samples) {
  const hi = s.heroImage ? s.heroImage.slice(0, 70) : "—";
  const im = s.image ? s.image.slice(0, 70) : "—";
  const cv = s.cover ? s.cover.slice(0, 70) : "—";
  const ha = s.heroImageAlt ? `"${s.heroImageAlt.slice(0, 40)}…"` : "—";
  console.log(`| ${s.collection}/${s.locale}/${s.slug} | ${hi} | ${im} | ${cv} | ${ha} |`);
}

// Distinct heroImage path prefixes
console.log("\n\n## Distinct heroImage path prefixes (first segment after leading slash)\n");
const prefixes = await db.execute(sql`
  SELECT
    split_part(trim(leading '/' from (domain_extras->>'heroImage')), '/', 1) AS prefix,
    count(*)::int AS cnt
  FROM articles
  WHERE project_id = ${PROJECT_ID}::uuid
    AND source = 'imported'
    AND domain_extras ? 'heroImage'
  GROUP BY prefix
  ORDER BY cnt DESC
`);
for (const r of prefixes as Array<Record<string, unknown>>) {
  console.log(`  ${(r.prefix as string) || "(empty)"} : ${r.cnt}`);
}

// Distinct image prefixes (tools collection)
console.log("\n## Distinct image-field path prefixes (tools mostly)\n");
const imgPrefixes = await db.execute(sql`
  SELECT
    split_part(trim(leading '/' from (domain_extras->>'image')), '/', 1) AS prefix,
    count(*)::int AS cnt
  FROM articles
  WHERE project_id = ${PROJECT_ID}::uuid
    AND source = 'imported'
    AND domain_extras ? 'image'
  GROUP BY prefix
  ORDER BY cnt DESC
`);
for (const r of imgPrefixes as Array<Record<string, unknown>>) {
  console.log(`  ${(r.prefix as string) || "(empty)"} : ${r.cnt}`);
}

// Distinct file extensions across heroImage values
console.log("\n## Distinct file extensions in heroImage values\n");
const exts = await db.execute(sql`
  SELECT
    lower(regexp_replace((domain_extras->>'heroImage'), '^.*\\.([^./]+)$', '\\1')) AS ext,
    count(*)::int AS cnt
  FROM articles
  WHERE project_id = ${PROJECT_ID}::uuid
    AND source = 'imported'
    AND domain_extras ? 'heroImage'
    AND domain_extras->>'heroImage' ~ '\\.[a-zA-Z0-9]+$'
  GROUP BY ext
  ORDER BY cnt DESC
`);
for (const r of exts as Array<Record<string, unknown>>) {
  console.log(`  ${r.ext as string} : ${r.cnt}`);
}

const extsImage = await db.execute(sql`
  SELECT
    lower(regexp_replace((domain_extras->>'image'), '^.*\\.([^./]+)$', '\\1')) AS ext,
    count(*)::int AS cnt
  FROM articles
  WHERE project_id = ${PROJECT_ID}::uuid
    AND source = 'imported'
    AND domain_extras ? 'image'
    AND domain_extras->>'image' ~ '\\.[a-zA-Z0-9]+$'
  GROUP BY ext
  ORDER BY cnt DESC
`);
console.log("\n## Distinct file extensions in image (tools) values\n");
for (const r of extsImage as Array<Record<string, unknown>>) {
  console.log(`  ${r.ext as string} : ${r.cnt}`);
}

process.exit(0);
