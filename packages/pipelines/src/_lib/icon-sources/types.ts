export type IconSource = "simple-icons" | "iconify" | "lobe-icons";

export interface ResolvedIconAsset {
  source: IconSource;
  sourceRef: string;
  svgContent: string;
  brandColor?: string;
  format: "svg";
}

export interface IconSourceAdapter {
  name: IconSource;
  tryResolve(toolSlug: string): Promise<ResolvedIconAsset | null>;
}
