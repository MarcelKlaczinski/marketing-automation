import { db } from "./packages/db/src/client.ts";
import { sql } from "drizzle-orm";

const count = await db.execute(sql`SELECT COUNT(*) as total FROM articles`);
console.log("ARTICLE_COUNT:", JSON.stringify(count.rows));

const dist = await db.execute(sql`
  SELECT source, collection, locale, COUNT(*) as cnt
  FROM articles 
  GROUP BY source, collection, locale
  ORDER BY source, collection, locale
`);
console.log("DISTRIBUTION:", JSON.stringify(dist.rows));

const statusDist = await db.execute(sql`
  SELECT status, COUNT(*) as cnt FROM articles GROUP BY status ORDER BY cnt DESC
`);
console.log("STATUS:", JSON.stringify(statusDist.rows));

const tableCheck = await db.execute(sql`
  SELECT table_name FROM information_schema.tables 
  WHERE table_schema = 'public' AND table_name LIKE 'article%'
  ORDER BY table_name
`);
console.log("ARTICLE_TABLES:", JSON.stringify(tableCheck.rows));

const fmSample = await db.execute(sql`
  SELECT collection, tags, category, subcategory, frontmatter_extras
  FROM articles 
  WHERE source = 'imported'
  ORDER BY created_at DESC
  LIMIT 5
`);
console.log("FM_SAMPLE:", JSON.stringify(fmSample.rows));

process.exit(0);
