import { readFile, writeFile, mkdir, access, rename } from "node:fs/promises";
import { dirname } from "node:path";

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readMarkdownIfExists(path: string): Promise<string | null> {
  if (!(await fileExists(path))) return null;
  return readFile(path, "utf-8");
}

/**
 * Writes content to path atomically: write to .tmp then rename.
 * Guarantees no partial-write is visible if the process is interrupted.
 */
export async function writeMarkdownAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, content, "utf-8");
  await rename(tmpPath, path);
}
