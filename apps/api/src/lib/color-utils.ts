import { converter, formatHex, wcagContrast } from "culori";

const toOklch = converter("oklch");

export function hexToOklch(hex: string): { l: number; c: number; h: number } {
  const result = toOklch(hex);
  return {
    l: Math.round((result?.l ?? 0) * 100),           // 0–100
    c: Math.round((result?.c ?? 0) * 1000) / 1000,   // 0–0.4
    h: Math.round(result?.h ?? 0),                    // 0–360
  };
}

export function oklchToHex(l: number, c: number, h: number): string {
  return formatHex({ mode: "oklch", l: l / 100, c, h }) ?? "#000000";
}

export function wcagContrastRatio(hexA: string, hexB: string): number {
  return Math.round(wcagContrast(hexA, hexB) * 100) / 100;
}
