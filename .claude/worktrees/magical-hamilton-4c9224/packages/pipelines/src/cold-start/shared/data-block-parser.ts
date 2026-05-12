import yaml from "yaml";
import type { z } from "zod";

const BLOCK_BEGIN = /<!--\s*DATA:([\w-]+)\s+BEGIN\s*-->/;
const BLOCK_END = /<!--\s*DATA:([\w-]+)\s+END\s*-->/;

export class DataBlockParseError extends Error {
  readonly blockName: string | undefined;

  constructor(message: string, blockName?: string) {
    super(message);
    this.name = "DataBlockParseError";
    if (blockName !== undefined) this.blockName = blockName;
  }
}

/**
 * Extracts a named DATA block from markdown content and parses its YAML body.
 * Throws DataBlockParseError if the block is missing or malformed.
 */
export function parseDataBlock<T>(markdown: string, blockName: string, schema: z.ZodType<T>): T {
  const lines = markdown.split("\n");
  let inBlock = false;
  let foundBegin = false;
  const yamlLines: string[] = [];

  for (const line of lines) {
    if (!inBlock) {
      const m = line.match(BLOCK_BEGIN);
      if (m && m[1] === blockName) {
        inBlock = true;
        foundBegin = true;
      }
    } else {
      const m = line.match(BLOCK_END);
      if (m) {
        if (m[1] !== blockName) {
          throw new DataBlockParseError(
            `DATA block "${blockName}" not closed properly — found END for "${m[1]}" instead.`,
            blockName
          );
        }
        const yamlText = yamlLines.join("\n").trim();
        let parsed: unknown;
        try {
          parsed = yaml.parse(yamlText);
        } catch (e) {
          throw new DataBlockParseError(
            `DATA block "${blockName}" YAML parse failed: ${e instanceof Error ? e.message : String(e)}`,
            blockName
          );
        }
        return schema.parse(parsed);
      }
      yamlLines.push(line);
    }
  }

  if (foundBegin) {
    throw new DataBlockParseError(
      `DATA block "${blockName}" is missing its END marker.`,
      blockName
    );
  }
  throw new DataBlockParseError(`DATA block "${blockName}" not found in markdown.`, blockName);
}

/**
 * Serialises data as a named DATA block for embedding in markdown.
 */
export function renderDataBlock(name: string, data: unknown): string {
  const yamlText = yaml.stringify(data).trimEnd();
  return [`<!-- DATA:${name} BEGIN -->`, yamlText, `<!-- DATA:${name} END -->`].join("\n");
}
