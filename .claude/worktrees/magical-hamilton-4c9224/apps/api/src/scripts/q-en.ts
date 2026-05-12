import { db, articles } from "@marketing-auto/db";
import { eq } from "drizzle-orm";

// Check schema image URL
const [a] = await db.select({ schemaJsonLd: articles.schemaJsonLd, outline: articles.outline })
  .from(articles).where(eq(articles.id, '654556e6-51ba-41c6-a07b-6b8696d25bec')).limit(1);

const schema = a?.schemaJsonLd as unknown[];
const imageUrls: string[] = [];
function extractUrls(obj: unknown): void {
  if (!obj || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if ((k === 'image' || k === 'thumbnailUrl' || k === 'url') && typeof v === 'string') imageUrls.push(`${k}: ${v}`);
    if (Array.isArray(v)) v.forEach(extractUrls);
    else if (typeof v === 'object') extractUrls(v);
  }
}
(schema ?? []).forEach(extractUrls);
console.log("Schema image URLs:", imageUrls);

// Fix heroImageAltText to English
const outline = a?.outline as { title?: string } | null;
const enTitle = outline?.title ?? "ChatGPT Pricing 2026";
await db.update(articles).set({
  heroImageAltText: `${enTitle} — hero image`,
  updatedAt: new Date(),
}).where(eq(articles.id, '654556e6-51ba-41c6-a07b-6b8696d25bec'));
console.log("Updated heroImageAltText to:", `${enTitle} — hero image`);

process.exit(0);
