import { describe, it, expect } from "bun:test";
import { z } from "zod";
import { parseDataBlock, renderDataBlock, DataBlockParseError } from "../../src/cold-start/shared/data-block-parser.ts";

const ClusterSchema = z.array(z.object({
  name: z.string(),
  status: z.string(),
}));

const VALID_MARKDOWN = `
# My Plan

Some prose here.

<!-- DATA:clusters BEGIN -->
- name: "Claude Marketing"
  status: proposed
- name: "LLM Setup"
  status: approved
<!-- DATA:clusters END -->

## Notes
More prose.
`;

describe("parseDataBlock", () => {
  it("extracts and parses a valid YAML block", () => {
    const result = parseDataBlock(VALID_MARKDOWN, "clusters", ClusterSchema);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: "Claude Marketing", status: "proposed" });
    expect(result[1]).toEqual({ name: "LLM Setup", status: "approved" });
  });

  it("throws DataBlockParseError when block name is not found", () => {
    expect(() => parseDataBlock(VALID_MARKDOWN, "nonexistent", ClusterSchema))
      .toThrow(DataBlockParseError);
    expect(() => parseDataBlock(VALID_MARKDOWN, "nonexistent", ClusterSchema))
      .toThrow('DATA block "nonexistent" not found');
  });

  it("throws DataBlockParseError when BEGIN marker exists but END is missing", () => {
    const broken = `
<!-- DATA:clusters BEGIN -->
- name: "Test"
  status: proposed
`;
    expect(() => parseDataBlock(broken, "clusters", ClusterSchema))
      .toThrow(DataBlockParseError);
    expect(() => parseDataBlock(broken, "clusters", ClusterSchema))
      .toThrow("missing its END marker");
  });

  it("throws DataBlockParseError when END marker has a different name", () => {
    const broken = `
<!-- DATA:clusters BEGIN -->
- name: "Test"
  status: proposed
<!-- DATA:other END -->
`;
    expect(() => parseDataBlock(broken, "clusters", ClusterSchema))
      .toThrow(DataBlockParseError);
    expect(() => parseDataBlock(broken, "clusters", ClusterSchema))
      .toThrow('"other"');
  });

  it("throws DataBlockParseError when YAML is malformed", () => {
    const broken = `
<!-- DATA:clusters BEGIN -->
- name: "unclosed string
  status: [bad yaml
<!-- DATA:clusters END -->
`;
    expect(() => parseDataBlock(broken, "clusters", ClusterSchema))
      .toThrow(DataBlockParseError);
    expect(() => parseDataBlock(broken, "clusters", ClusterSchema))
      .toThrow("YAML parse failed");
  });

  it("throws ZodError when schema validation fails", () => {
    const strictSchema = z.array(z.object({ name: z.string(), count: z.number() }));
    // clusters block has no "count" field → Zod should reject
    expect(() => parseDataBlock(VALID_MARKDOWN, "clusters", strictSchema)).toThrow();
  });

  it("exposes blockName on the error", () => {
    try {
      parseDataBlock(VALID_MARKDOWN, "missing-block", ClusterSchema);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(DataBlockParseError);
      expect((e as DataBlockParseError).blockName).toBe("missing-block");
    }
  });

  it("handles a block with whitespace around delimiters", () => {
    const md = `
<!--  DATA:items  BEGIN  -->
- name: "A"
  status: ok
<!--  DATA:items  END  -->
`;
    const ItemSchema = z.array(z.object({ name: z.string(), status: z.string() }));
    const result = parseDataBlock(md, "items", ItemSchema);
    expect(result[0]?.name).toBe("A");
  });
});

describe("renderDataBlock", () => {
  it("wraps YAML content in BEGIN/END markers", () => {
    const rendered = renderDataBlock("clusters", [{ name: "Test", status: "proposed" }]);
    expect(rendered).toContain("<!-- DATA:clusters BEGIN -->");
    expect(rendered).toContain("<!-- DATA:clusters END -->");
    expect(rendered).toContain("name: Test");
  });

  it("round-trips through parseDataBlock", () => {
    const data = [
      { name: "Claude Marketing", status: "proposed" },
      { name: "LLM Setup", status: "approved" },
    ];
    const block = renderDataBlock("clusters", data);
    const md = `# Header\n\n${block}\n\n## Footer`;
    const parsed = parseDataBlock(md, "clusters", ClusterSchema);
    expect(parsed).toEqual(data);
  });

  it("handles nested objects", () => {
    const NestedSchema = z.array(z.object({
      name: z.string(),
      keywords: z.array(z.string()),
    }));
    const data = [{ name: "Test", keywords: ["kw1", "kw2"] }];
    const block = renderDataBlock("nested", data);
    const parsed = parseDataBlock(`\n${block}\n`, "nested", NestedSchema);
    expect(parsed[0]?.keywords).toEqual(["kw1", "kw2"]);
  });
});
