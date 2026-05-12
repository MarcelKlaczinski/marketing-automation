/**
 * One-off: generate hero image variants for chatgpt-preise-2026 base image,
 * then propagate the slug-based R2 key + public URL to the EN translation sibling.
 * Also verifies schemaJsonLd image URLs and logs warnings for any that reference
 * localhost URLs that should be updated.
 *
 * Run: bun --env-file .env apps/api/src/scripts/gen-missing-variants.ts
 */
import { db, articles } from "@marketing-auto/db";
import { HERO_VARIANTS } from "@marketing-auto/shared/hero-variants";
import { LOCAL_UPLOADS_ROOT } from "@marketing-auto/adapter-storage";
import { eq, and, ne } from "drizzle-orm";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const DE_ARTICLE_ID = "421f850b-aad9-41f0-ad8c-6d8bc6758d11";

// ─── Load article ─────────────────────────────────────────────────────────────
const [de] = await db.select().from(articles).where(eq(articles.id, DE_ARTICLE_ID)).limit(1);
if (!de) throw new Error("DE article not found");
// biome-ignore lint/suspicious/noConsoleLog: script output
console.log("DE article:", de.slug, "| R2 key:", de.heroImageR2Key);

const r2Key = de.heroImageR2Key;
if (!r2Key) throw new Error("DE article has no heroImageR2Key");

const keyParts = r2Key.split("/"); // ["toolwiki", "articles", "hero", "<slug>.webp"]
const prefix = keyParts.slice(0, -1).join("/");
const srcPath = join(LOCAL_UPLOADS_ROOT, ...keyParts);

if (!existsSync(srcPath)) {
  throw new Error(`Source file not found: ${srcPath}`);
}
// biome-ignore lint/suspicious/noConsoleLog: script output
console.log("Source:", srcPath);

// ─── Load sharp (Bun ESM returns { default: fn }, not fn directly) ───────────
type SharpCallable = (input: string) => import("sharp").Sharp;
const mod = await import("sharp");
const sharp = (mod as unknown as { default: SharpCallable }).default ?? (mod as unknown as SharpCallable);

const srcMeta = await sharp(srcPath).metadata();
// biome-ignore lint/suspicious/noConsoleLog: script output
console.log(`Source image: ${srcMeta.width}×${srcMeta.height} ${srcMeta.format}`);

// ─── Generate variants ────────────────────────────────────────────────────────
const variantDir = join(LOCAL_UPLOADS_ROOT, prefix);
await mkdir(variantDir, { recursive: true });

const slug = de.slug; // "chatgpt-preise-2026"
let generated = 0;
let skipped = 0;

for (const variant of HERO_VARIANTS) {
  for (const fmt of ["webp", "avif"] as const) {
    const varFilename = `${slug}${variant.suffix}.${fmt}`;
    const destPath = join(variantDir, varFilename);

    if (existsSync(destPath)) {
      // biome-ignore lint/suspicious/noConsoleLog: script output
      console.log(`  SKIP (exists): ${varFilename}`);
      skipped++;
      continue;
    }

    try {
      const pipeline = sharp(srcPath).resize(variant.width, variant.height, {
        fit: "cover",
        position: "center",
      });
      if (fmt === "webp") {
        await pipeline.webp({ quality: 82 }).toFile(destPath);
      } else {
        await pipeline.avif({ quality: 60, effort: 4 }).toFile(destPath);
      }
      // biome-ignore lint/suspicious/noConsoleLog: script output
      console.log(`  OK: ${varFilename}`);
      generated++;
    } catch (err) {
      // biome-ignore lint/suspicious/noConsoleLog: script output
      console.error(`  FAIL: ${varFilename}`, err);
    }
  }
}
// biome-ignore lint/suspicious/noConsoleLog: script output
console.log(`\nGenerated: ${generated}, Skipped: ${skipped}`);

// ─── Propagate hero to EN sibling ─────────────────────────────────────────────
if (!de.translationKey) {
  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log("No translationKey — skipping sibling propagation");
  process.exit(0);
}

const siblings = await db
  .select({ id: articles.id, slug: articles.slug, heroImageR2Key: articles.heroImageR2Key, schemaJsonLd: articles.schemaJsonLd })
  .from(articles)
  .where(and(eq(articles.translationKey, de.translationKey), ne(articles.id, DE_ARTICLE_ID)));

for (const sibling of siblings) {
  const siblingKeyFilename = sibling.heroImageR2Key?.split("/").at(-1)?.replace(/\.[^.]+$/, "");
  const siblingHasOwnHero = siblingKeyFilename === sibling.slug;

  if (siblingHasOwnHero) {
    // biome-ignore lint/suspicious/noConsoleLog: script output
    console.log(`\nSibling ${sibling.slug}: has own hero (${sibling.heroImageR2Key}) — skipping`);
    continue;
  }

  const newPublicUrl = de.heroImagePublicUrl; // same localhost URL, same file
  await db
    .update(articles)
    .set({
      heroImageR2Key: de.heroImageR2Key,
      heroImagePublicUrl: newPublicUrl,
      heroImageAltText: de.heroImageAltText, // will be overwritten if EN draft re-runs
      updatedAt: new Date(),
    })
    .where(eq(articles.id, sibling.id));

  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log(`\nSibling ${sibling.slug}: propagated hero → ${de.heroImageR2Key}`);

  // Warn if schemaJsonLd has the old UUID URL
  const schema = sibling.schemaJsonLd as unknown;
  const schemaStr = JSON.stringify(schema ?? "");
  if (schemaStr.includes("bcebe126") || schemaStr.includes("bad00d28")) {
    // biome-ignore lint/suspicious/noConsoleLog: script output
    console.warn(`  ⚠ schemaJsonLd still references old UUID image URL — re-run schema-extension pipeline`);
  }
}

// biome-ignore lint/suspicious/noConsoleLog: script output
console.log("\nDone.");
process.exit(0);
