import { db, articles } from "@marketing-auto/db";
import { eq } from "drizzle-orm";

const [a] = await db.select({
  author: articles.author,
  heroImageR2Key: articles.heroImageR2Key,
  heroImagePublicUrl: articles.heroImagePublicUrl,
  slug: articles.slug,
  domainExtras: articles.domainExtras,
}).from(articles).where(eq(articles.id, '421f850b-aad9-41f0-ad8c-6d8bc6758d11')).limit(1);

if (!a) { console.error("Article not found"); process.exit(1); }

console.log("author:", a.author);
console.log("r2Key:", a.heroImageR2Key);
console.log("publicUrl:", a.heroImagePublicUrl);
console.log("slug:", a.slug);
const extras = (a.domainExtras || {}) as Record<string, unknown>;
console.log("extras keys:", Object.keys(extras).join(", "));
console.log("faq count:", ((extras.faq as unknown[]) || []).length);
console.log("faq:", JSON.stringify(extras.faq || [], null, 2));
console.log("category:", extras.category);
console.log("intentType:", extras.intentType);

process.exit(0);
