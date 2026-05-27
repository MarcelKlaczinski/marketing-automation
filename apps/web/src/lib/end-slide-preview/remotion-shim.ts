/**
 * Spec 65.V1.5c — Browser-side shim for Remotion's `AbsoluteFill`.
 *
 * The full `remotion` package is a heavy bundle (animation player + ffmpeg
 * runtime + Webcodecs polyfills) designed for video-rendering pipelines.
 * The end-slide components only import `AbsoluteFill`, which is literally
 * a div with `position: absolute; inset: 0`. This shim provides a
 * type-compatible drop-in so apps/web's Vite build resolves `remotion`
 * to a 1-KB module instead of pulling in the full package.
 *
 * Aliased in [quasar.config.ts](../../../quasar.config.ts) `extendViteConf`
 * via `resolve.alias: [{ find: /^remotion$/, replacement: <this-file> }]`.
 *
 * If a future end-slide component imports something else from `remotion`
 * (e.g. `Sequence`, `Img`, `Audio`), extend this shim with the same
 * "thin div / element wrapper" pattern. NEVER pull the actual remotion
 * package into the apps/web bundle — it's >5MB.
 */
import * as React from "react";

interface AbsoluteFillProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

const ABSOLUTE_FILL_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
};

export const AbsoluteFill = React.forwardRef<HTMLDivElement, AbsoluteFillProps>(
  function AbsoluteFill({ children, style, ...rest }, ref) {
    return React.createElement(
      "div",
      { ref, style: { ...ABSOLUTE_FILL_STYLE, ...style }, ...rest },
      children,
    );
  },
);
AbsoluteFill.displayName = "AbsoluteFill";

/**
 * `Img` stub — same as a native `<img>` tag. End-slide-components don't use
 * Img today; if they do in the future, this stub keeps the shim symmetric.
 */
export const Img = React.forwardRef<HTMLImageElement, React.ImgHTMLAttributes<HTMLImageElement>>(
  function Img(props, ref) {
    return React.createElement("img", { ref, ...props });
  },
);
Img.displayName = "Img";
