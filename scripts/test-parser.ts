import { parseMdxContent } from "../packages/adapters/astro-sync/src/import/parse-frontmatter";
import { readFileSync } from "fs";

const ASTRO = "/Users/marcelklaczinski/WebstormProjects/ki-wissensraum-neu";

const testFiles = [
  ASTRO + "/src/content/tools/de/suno.mdx",
  ASTRO + "/src/content/tools/de/mem-ai.mdx",
  ASTRO + "/src/content/tools/de/udio.mdx",
  ASTRO + "/src/content/tools/de/stable-audio.mdx",
  ASTRO + "/src/content/tools/de/notion-ai.mdx",
  ASTRO + "/src/content/tools/de/reflect.mdx",
  ASTRO + "/src/content/tools/de/tana.mdx",
];

for (const path of testFiles) {
  console.log("=== " + path.split("/").slice(-3).join("/") + " ===");
  const content = readFileSync(path, "utf-8");
  const relativePath = path.replace(ASTRO + "/", "");
  const result = parseMdxContent(relativePath, content);
  console.log("typed.clusterKey   :", JSON.stringify(result.typed.clusterKey));
  console.log("typed.clusterRole  :", JSON.stringify(result.typed.clusterRole));
  console.log("typed.intentType   :", JSON.stringify(result.typed.intentType));
  console.log("extras.clusterKey  :", JSON.stringify(result.extras?.clusterKey));
  console.log("extras.clusterRole :", JSON.stringify(result.extras?.clusterRole));
  console.log("");
}
