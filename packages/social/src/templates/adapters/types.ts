export interface ToolReference {
  slug: string;
  name: string;
  logoUrl?: string;
  pricingTier?: "free" | "freemium" | "paid" | "enterprise";
  priceFrom?: number;
  primaryCategory?: string;
  endSlideToken?: string;
  iconSvg?: string;
  iconInitials?: string;
  iconHue?: number;
}

export interface ProConItem {
  text: string;
  category?: string;
}

export interface UseCaseVerdict {
  useCase: string;
  winner: string;
  reason: string;
  score?: number;
}

export interface PricingRow {
  tool: string;
  free: boolean;
  monthly?: number;
}
