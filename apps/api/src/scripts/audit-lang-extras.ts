import { db, articles, projects, eq, sql } from "@marketing-auto/db";

async function main() {
  const [proj] = await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, "toolwiki")).limit(1);
  if (!proj) throw new Error("project toolwiki not found");

  console.log("=== EN articles with 'Beitragsbild' suffix in hero_image_alt_text ===");
  const b1 = await db.execute(sql`
    SELECT id, slug, locale, hero_image_alt_text
    FROM articles
    WHERE locale='en' AND project_id=${proj.id}
      AND hero_image_alt_text LIKE '%Beitragsbild%'
  `);
  console.log("rows:", b1.length);
  for (const r of b1) console.log(JSON.stringify(r, null, 2));

  console.log("\n=== All EN articles in toolwiki — minimal snapshot ===");
  const all = await db.execute(sql`
    SELECT id, slug, source, locale, translation_key, title,
           hero_image_alt_text, meta_description,
           length(coalesce(body_md,'')) as body_len,
           frontmatter_extras->>'excerpt' as fm_excerpt,
           frontmatter_extras->>'category' as fm_category,
           frontmatter_extras->>'seoTitle' as fm_seoTitle,
           created_at
    FROM articles
    WHERE locale='en' AND project_id=${proj.id}
    ORDER BY created_at DESC
  `);
  console.log("count:", all.length);
  for (const r of all) console.log(JSON.stringify(r, null, 2));

  console.log("\n=== EN articles: detect German stopwords in text fields ===");
  const stops = await db.execute(sql`
    SELECT id, slug,
           hero_image_alt_text,
           meta_description,
           title,
           CASE WHEN hero_image_alt_text ~* '\\m(der|die|das|und|oder|für|von|mit|über|nach|werden|nicht|sind|ist|ein|eine|einer)\\M' THEN 'YES' ELSE 'no' END AS alt_de,
           CASE WHEN meta_description ~* '\\m(der|die|das|und|oder|für|von|mit|über|nach|werden|nicht|sind|ist|ein|eine|einer)\\M' THEN 'YES' ELSE 'no' END AS meta_de,
           CASE WHEN title ~* '\\m(der|die|das|und|oder|für|von|mit|über|nach|werden|nicht|sind|ist|ein|eine|einer)\\M' THEN 'YES' ELSE 'no' END AS title_de
    FROM articles
    WHERE locale='en' AND project_id=${proj.id}
  `);
  for (const r of stops) console.log(JSON.stringify(r));

  console.log("\n=== EN articles: schema.org JSON-LD sample ===");
  const sjld = await db.execute(sql`
    SELECT id, slug, jsonb_pretty(schema_json_ld) AS sjld
    FROM articles
    WHERE locale='en' AND project_id=${proj.id}
      AND schema_json_ld IS NOT NULL
    ORDER BY created_at DESC LIMIT 4
  `);
  for (const r of sjld) console.log(JSON.stringify(r, null, 2));

  console.log("\n=== Hero-image cost_logs for EN articles (the 2 EN generations) ===");
  const heroEn = await db.execute(sql`
    SELECT cl.id, cl.created_at, cl.cost_eur, cl.operation, cl.metadata,
           a.id AS article_id, a.slug, a.locale, a.translation_key,
           a.hero_image_r2_key, a.created_at AS article_created_at,
           (SELECT id FROM articles WHERE translation_key=a.translation_key AND locale='de' AND project_id=${proj.id} LIMIT 1) AS de_sibling_id
    FROM cost_logs cl
    LEFT JOIN articles a ON a.id::text = (cl.metadata->>'articleId')
    WHERE cl.service='replicate'
      AND cl.operation LIKE 'hero%'
      AND a.locale='en'
      AND a.project_id=${proj.id}
    ORDER BY cl.created_at DESC
  `);
  console.log("count:", heroEn.length);
  for (const r of heroEn) console.log(JSON.stringify(r, null, 2));

  console.log("\n=== All EN articles frontmatter_extras key inventory ===");
  const keys = await db.execute(sql`
    SELECT id, slug, jsonb_object_keys(frontmatter_extras) AS fe_key
    FROM articles
    WHERE locale='en' AND project_id=${proj.id}
    ORDER BY id, fe_key
  `);
  for (const r of keys) console.log(JSON.stringify(r));

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
