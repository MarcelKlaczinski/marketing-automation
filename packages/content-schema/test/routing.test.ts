import { describe, expect, it } from "bun:test";
import {
  ASTRO_FOLDER_TO_COLLECTION,
  COLLECTION_ASTRO_NAME,
  astroFolderFor,
  collectionForAstroFolder,
} from "../src/enums/routing.ts";

describe("COLLECTION_ASTRO_NAME (Spec multi-domain-evolution S2.2)", () => {
  it("maps each collection key to its Astro folder", () => {
    expect(COLLECTION_ASTRO_NAME).toEqual({
      blog: "blog",
      comparison: "comparisons",
      "ki-wissen": "ki-wissen",
      tools: "tools",
      usecases: "usecases",
    });
  });

  it("renames `comparison` → `comparisons` (singular enum vs plural folder)", () => {
    // The single critical key where the source-of-truth differs from the
    // Astro folder name. Pre-S2.2 a typo in any of the 4 in-tree copies
    // produced silent routing breakage.
    expect(COLLECTION_ASTRO_NAME.comparison).toBe("comparisons");
  });
});

describe("ASTRO_FOLDER_TO_COLLECTION reverse map", () => {
  it("is the exact inverse of COLLECTION_ASTRO_NAME", () => {
    for (const [key, folder] of Object.entries(COLLECTION_ASTRO_NAME)) {
      expect(ASTRO_FOLDER_TO_COLLECTION[folder as keyof typeof ASTRO_FOLDER_TO_COLLECTION]).toBe(key as never);
    }
  });

  it("inverts the comparison rename: `comparisons` (folder) → `comparison` (key)", () => {
    expect(ASTRO_FOLDER_TO_COLLECTION.comparisons).toBe("comparison");
  });
});

describe("astroFolderFor() defensive lookup", () => {
  it("returns the folder for a known collection key", () => {
    expect(astroFolderFor("comparison")).toBe("comparisons");
    expect(astroFolderFor("blog")).toBe("blog");
    expect(astroFolderFor("ki-wissen")).toBe("ki-wissen");
  });

  it("returns the input unchanged for an unknown key (forward-compat)", () => {
    // When a future tenant introduces a collection key that doesn't have an
    // Astro folder rename, callers should see the identity mapping.
    expect(astroFolderFor("guides")).toBe("guides");
    expect(astroFolderFor("wirtschaftlichkeit")).toBe("wirtschaftlichkeit");
  });
});

describe("collectionForAstroFolder() defensive reverse lookup", () => {
  it("returns the collection key for a known folder", () => {
    expect(collectionForAstroFolder("comparisons")).toBe("comparison");
    expect(collectionForAstroFolder("blog")).toBe("blog");
    expect(collectionForAstroFolder("ki-wissen")).toBe("ki-wissen");
  });

  it("returns null for an unknown folder so callers can 400 at the HTTP boundary", () => {
    expect(collectionForAstroFolder("nope")).toBeNull();
    expect(collectionForAstroFolder("tool-categories")).toBeNull();
  });
});
