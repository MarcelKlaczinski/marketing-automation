import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { SlideOutput } from "../types.ts";

const OUTPUT_BASE = resolve(process.cwd(), "renders");

/**
 * Writes rendered slide Buffers to disk and returns SlideOutput[].
 * Path: <OUTPUT_BASE>/<articleId>/<templateKey>/<locale>-<theme>/slide-NN.png
 */
export async function writeSlides(
  buffers: Buffer[],
  articleId: string,
  templateKey: string,
  locale: string,
  theme: string,
  dimensions: { width: number; height: number },
): Promise<SlideOutput[]> {
  const dir = resolve(OUTPUT_BASE, articleId, templateKey, `${locale}-${theme}`);
  await mkdir(dir, { recursive: true });

  const outputs: SlideOutput[] = [];
  for (let i = 0; i < buffers.length; i++) {
    const fileName = `slide-${String(i + 1).padStart(2, "0")}.png`;
    const filePath = resolve(dir, fileName);
    await writeFile(filePath, buffers[i]!);
    outputs.push({ filePath, width: dimensions.width, height: dimensions.height });
  }
  return outputs;
}
