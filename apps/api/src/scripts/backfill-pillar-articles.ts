import { db, clusters } from "@marketing-auto/db";
import { recalcPillarArticleId } from "../routes/clusters.ts";

async function main(): Promise<void> {
  const allClusters = await db.select({ id: clusters.id }).from(clusters);
  for (const c of allClusters) {
    await recalcPillarArticleId(c.id);
  }
  console.log(`Backfilled pillarArticleId for ${allClusters.length} clusters`);
}

void main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
