// Minimal type shim for culori v4 (no @types package available)
declare module "culori" {
  export type Color = Record<string, unknown>;
  export function parse(color: string): Color | undefined;
  export function wcagContrast(a: Color, b: Color): number;
}
