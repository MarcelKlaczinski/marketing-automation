declare module "culori" {
  type Color = { mode: string; [key: string]: unknown };

  export function converter(
    mode: string
  ): (color: string | Color | null | undefined) => ({ l?: number; c?: number; h?: number; r?: number; g?: number; b?: number; alpha?: number; mode: string } | undefined);

  export function formatHex(color: Color): string | undefined;

  export function wcagContrast(a: string | Color, b: string | Color): number;
}
