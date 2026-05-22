import { describe, expect, it } from "bun:test";
import {
  cleanupOrphanHeroes,
  type DatabasePort,
  type StoragePort,
} from "../../src/scripts/cleanup-orphan-heroes.ts";

/**
 * Spec 64.10: smoke tests for cleanup-orphan-heroes.
 *
 * The script's I/O is fully decorated via StoragePort + DatabasePort, so these
 * tests run against in-memory fakes — no DB, no R2, no filesystem.
 */

function makeStorage(keys: string[], deleteFn: (key: string) => Promise<boolean> = async () => true): StoragePort {
  return {
    list: async () => keys,
    delete: deleteFn,
  };
}

function makeDb(referenced: string[]): DatabasePort {
  return {
    loadReferencedKeys: async () => new Set(referenced),
  };
}

describe("cleanup-orphan-heroes (Spec 64.10)", () => {
  const PREFIX = "toolwiki/articles/hero";
  const UUID_A = "18038f56-0b0c-439e-a51f-6a5f333d0b4b";
  const UUID_B = "1c149824-f57a-4036-8a54-4e50a2bfb941";
  const UUID_C = "2a3825fa-b35d-4c07-9581-673521b479bd";

  it("identifies UUID-shape orphan keys not referenced in the DB (dry-run)", async () => {
    const storage = makeStorage([`${PREFIX}/${UUID_A}.webp`, `${PREFIX}/${UUID_B}.webp`]);
    const database = makeDb([`${PREFIX}/${UUID_A}.webp`]);

    const summary = await cleanupOrphanHeroes({
      storagePrefix: PREFIX,
      dryRun: true,
      storage,
      database,
    });

    expect(summary.totalKeys).toBe(2);
    expect(summary.candidateKeys).toBe(2);
    expect(summary.skippedNonUuidKeys).toBe(0);
    expect(summary.orphanedKeys).toBe(1);
    expect(summary.deletedKeys).toBe(0); // dry-run never deletes
    expect(summary.sampleOrphans).toContain(`${PREFIX}/${UUID_B}.webp`);
  });

  it("protects hero_image_original_r2_key entries (64.6c forensic copies)", async () => {
    const storage = makeStorage([
      `${PREFIX}/${UUID_A}.webp`,
      `${PREFIX}/originals/${UUID_A}.png`,
      `${PREFIX}/${UUID_B}.webp`,
    ]);
    const database = makeDb([`${PREFIX}/${UUID_A}.webp`, `${PREFIX}/originals/${UUID_A}.png`]);

    const summary = await cleanupOrphanHeroes({
      storagePrefix: PREFIX,
      dryRun: true,
      storage,
      database,
    });

    expect(summary.candidateKeys).toBe(3);
    expect(summary.orphanedKeys).toBe(1);
    expect(summary.sampleOrphans).toEqual([`${PREFIX}/${UUID_B}.webp`]);
  });

  it("requires --apply (dryRun=false) to actually delete", async () => {
    const deleted: string[] = [];
    const storage = makeStorage([`${PREFIX}/${UUID_A}.webp`], async (key) => {
      deleted.push(key);
      return true;
    });
    const database = makeDb([]);

    // Dry-run: no delete call.
    const drySummary = await cleanupOrphanHeroes({
      storagePrefix: PREFIX,
      dryRun: true,
      storage,
      database,
    });
    expect(drySummary.deletedKeys).toBe(0);
    expect(deleted).toHaveLength(0);

    // Apply: orphan deleted.
    const applySummary = await cleanupOrphanHeroes({
      storagePrefix: PREFIX,
      dryRun: false,
      storage,
      database,
    });
    expect(applySummary.deletedKeys).toBe(1);
    expect(deleted).toEqual([`${PREFIX}/${UUID_A}.webp`]);
  });

  it("handles delete errors gracefully without aborting the run", async () => {
    const storage = makeStorage(
      [`${PREFIX}/${UUID_A}.webp`, `${PREFIX}/${UUID_B}.webp`, `${PREFIX}/${UUID_C}.webp`],
      async (key) => {
        if (key.includes(UUID_B)) throw new Error("R2 unavailable");
        return true;
      },
    );
    const database = makeDb([]);

    const summary = await cleanupOrphanHeroes({
      storagePrefix: PREFIX,
      dryRun: false,
      storage,
      database,
    });

    expect(summary.orphanedKeys).toBe(3);
    expect(summary.deletedKeys).toBe(2);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]?.key).toBe(`${PREFIX}/${UUID_B}.webp`);
    expect(summary.errors[0]?.error).toContain("R2 unavailable");
  });

  it("skips Astro responsive-image artifacts (slug-named, non-UUID filenames)", async () => {
    // Astro emits keys like `<slug>-<aspect>-<width>.webp` / `.avif`. None of
    // these are pipeline-generated hero keys; the script must never flag them
    // as orphans even though the DB has no row referencing them.
    const storage = makeStorage([
      `${PREFIX}/${UUID_A}.webp`, // real pipeline output
      `${PREFIX}/ai-fundamentals-overview-16x9-1280.webp`, // Astro responsive
      `${PREFIX}/ai-fundamentals-overview-16x9-1280.avif`, // Astro responsive
      `${PREFIX}/ai-fundamentals-overview-1x1-400.avif`, // Astro responsive
      `${PREFIX}/ai-fundamentals-overview-4x3-320.avif`, // Astro responsive
    ]);
    const database = makeDb([]); // pretend DB has nothing — even then Astro files must survive

    const summary = await cleanupOrphanHeroes({
      storagePrefix: PREFIX,
      dryRun: false,
      storage,
      database,
    });

    expect(summary.totalKeys).toBe(5);
    expect(summary.candidateKeys).toBe(1);
    expect(summary.skippedNonUuidKeys).toBe(4);
    expect(summary.orphanedKeys).toBe(1);
    expect(summary.deletedKeys).toBe(1);
    expect(summary.sampleOrphans).toEqual([`${PREFIX}/${UUID_A}.webp`]);
  });
});
