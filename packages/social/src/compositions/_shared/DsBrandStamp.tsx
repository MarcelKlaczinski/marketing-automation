/**
 * Spec 65.15 — Brand-stamp logo watermark for Cover + End slides (bookends).
 *
 * Renders the project's logo as a subtle bottom-right corner stamp to close
 * Marcel's "Recognition-Anchor -2" gap from the niche-analysis (live-test
 * 2026-05-27). Consumed centrally by Family-A Cover slides + Family-B
 * `SlideComposition` cover branch + both families' `RenderEndSlide` dispatchers.
 *
 * Graceful-null: when `logoUrl` is missing or empty, renders nothing — never a
 * broken-image. Projects without a logo asset uploaded simply see no stamp.
 *
 * Position is fixed bottom-right per Marcel's V1.6 choice (configurable
 * deferred to V1.7). Opacity 0.7 is the deliberate "subtle watermark" target
 * — if recognition suffers on certain backgrounds, bump opacity OR introduce
 * theme-variant logos (already supported by `resolveLogoUrl`) before
 * reaching for adaptive contrast logic.
 */
import type React from "react";
import { Img } from "remotion";

interface DsBrandStampProps {
  /**
   * Logo URL (R2 public URL or `data:image/svg+xml;base64,…`). Null/empty/undefined
   * → render nothing. The explicit `| undefined` is required under
   * `exactOptionalPropertyTypes` so callers can pass through optional fields.
   */
  logoUrl?: string | null | undefined;
  /** Distance from the bottom + right edge in px. Default 48. */
  marginPx?: number;
  /** Opacity 0..1. Default 0.7 — subtle watermark target. */
  opacity?: number;
  /** Logo `max-width` in px. Default 120 (≈11% of 1080px slide width). */
  maxWidthPx?: number;
}

export const DsBrandStamp: React.FC<DsBrandStampProps> = ({
  logoUrl,
  marginPx = 48,
  opacity = 0.7,
  maxWidthPx = 120,
}) => {
  if (!logoUrl) return null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: marginPx,
        right: marginPx,
        opacity,
        zIndex: 100,
        pointerEvents: "none",
      }}
    >
      <Img
        src={logoUrl}
        style={{
          maxWidth: maxWidthPx,
          height: "auto",
          display: "block",
        }}
      />
    </div>
  );
};
