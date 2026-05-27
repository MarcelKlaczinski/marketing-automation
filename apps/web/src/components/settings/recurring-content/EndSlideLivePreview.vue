<template>
  <div class="end-slide-preview">
    <div class="preview-controls">
      <span class="preview-label">{{ $t("recurringContent.endSlides.preview.label") as string }}</span>
      <div class="preview-spacer" />
      <q-btn-toggle
        v-model="theme"
        :options="themeOptions"
        dense
        no-caps
        toggle-color="primary"
        text-color="white"
      />
    </div>

    <div v-if="parseError" class="preview-error">
      {{ $t("recurringContent.endSlides.preview.parseError") as string }}: {{ parseError }}
    </div>
    <div v-else-if="loading" class="preview-loading">
      {{ $t("recurringContent.endSlides.preview.loading") as string }}
    </div>
    <div v-else-if="mountError" class="preview-error">
      {{ $t("recurringContent.endSlides.preview.mountError") as string }}: {{ mountError }}
    </div>

    <!--
      Spec 65.V1.5c — React-in-Vue mount point. The lazy import of React +
      the end-slide HostSlide happens in mounted(); the createRoot lives on
      `reactRoot` (non-reactive, see Vue Options API rule for non-Vue
      objects). beforeUnmount() unmounts to release memory.
    -->
    <div
      ref="reactHost"
      class="preview-canvas"
      :style="canvasStyle"
    />

    <small class="preview-hint">
      {{ $t("recurringContent.endSlides.preview.hint") as string }}
    </small>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";

/**
 * Shape that the EndSlideEditModal passes in. `configJson` is the raw
 * (unparsed) JSON string; we parse + validate against the per-type Zod
 * schema at preview-render time so a malformed config produces a hint
 * instead of a crash.
 */
interface PreviewInput {
  type: string;
  configJson: string;
  nameDe: string;
  nameEn: string;
  locale: "de" | "en";
}

/**
 * Non-Vue React-root handle. Underscore-prefix marks it as non-reactive
 * (per apps/web/CLAUDE.md IntersectionObserver pattern). The actual type
 * is `Root` from `react-dom/client` but we don't import that type-only
 * statically to keep the React deps out of the SSR/build manifest until
 * the modal opens.
 */
interface ReactRootLike {
  render: (el: unknown) => void;
  unmount: () => void;
}

export default defineComponent({
  name: "EndSlideLivePreview",

  props: {
    input: { type: Object as PropType<PreviewInput>, required: true },
  },

  data: () => ({
    theme: "dark" as "light" | "dark",
    loading: true,
    parseError: "",
    mountError: "",
    _reactRoot: null as ReactRootLike | null,
    // 1080×1080 source → scaled to fit the modal width.
    canvasSize: 360,
  }),

  computed: {
    themeOptions(): Array<{ label: string; value: "light" | "dark" }> {
      return [
        { label: this.$t("recurringContent.endSlides.preview.themeLight") as string, value: "light" },
        { label: this.$t("recurringContent.endSlides.preview.themeDark") as string, value: "dark" },
      ];
    },
    canvasStyle(): Record<string, string> {
      // Scale the 1080×1080 source down to `canvasSize` via CSS transform.
      // The inner React content is sized at 1080px (matches Remotion's
      // composition); the wrapper applies `transform: scale(...)` so the
      // headless layout matches the eventual carousel render byte-for-byte.
      const scale = this.canvasSize / 1080;
      return {
        width: `${this.canvasSize}px`,
        height: `${this.canvasSize}px`,
        position: "relative",
        overflow: "hidden",
        borderRadius: "12px",
        background: this.theme === "dark" ? "#0a0a0a" : "#fafafa",
        "--preview-scale": String(scale),
      };
    },
  },

  watch: {
    "input.type"() {
      void this.rerender();
    },
    "input.configJson"() {
      void this.rerender();
    },
    "input.locale"() {
      void this.rerender();
    },
    "input.nameDe"() {
      void this.rerender();
    },
    "input.nameEn"() {
      void this.rerender();
    },
    theme() {
      void this.rerender();
    },
  },

  async mounted() {
    await this.mountReact();
  },

  beforeUnmount() {
    if (this._reactRoot) {
      try {
        this._reactRoot.unmount();
      } catch (err) {
        // biome-ignore lint/suspicious/noConsoleLog: dev-only diagnostic
        if (import.meta.env.DEV) console.warn("[EndSlideLivePreview] unmount failed", err);
      }
      this._reactRoot = null;
    }
  },

  methods: {
    async mountReact(): Promise<void> {
      this.loading = true;
      this.parseError = "";
      this.mountError = "";
      try {
        // Lazy-load React + the end-slide component bundle. The Vite alias
        // configured in quasar.config.ts maps `remotion` to a 5-line shim,
        // so the React tree is ~200KB gzipped including HostSlide's 7
        // concrete components.
        const [{ createRoot }] = await Promise.all([
          import("react-dom/client"),
        ]);
        const host = this.$refs.reactHost as HTMLElement | undefined;
        if (!host) {
          this.mountError = "Mount point not ready";
          this.loading = false;
          return;
        }
        // createRoot returns a Root which has render/unmount; the
        // ReactRootLike shape narrows what we actually use.
        this._reactRoot = createRoot(host) as unknown as ReactRootLike;
        await this.rerender();
      } catch (err) {
        this.mountError = err instanceof Error ? err.message : "Failed to mount React preview";
      } finally {
        this.loading = false;
      }
    },

    async rerender(): Promise<void> {
      if (!this._reactRoot) return;
      this.parseError = "";

      // Parse the raw configJson string + validate against the per-type Zod
      // schema before constructing the discriminated `EndSlideData` shape.
      let config: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(this.input.configJson || "{}");
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          this.parseError = this.$t(
            "recurringContent.wizard.config.notAnObject",
          ) as string;
          return;
        }
        // Safe cast: the type-guard above narrows `parsed` to a plain
        // object (not null, not an array). The per-type Zod schema below
        // re-validates the actual shape before passing to HostSlide.
        config = parsed as Record<string, unknown>;
      } catch (err) {
        this.parseError = err instanceof Error ? err.message : "Invalid JSON";
        return;
      }

      try {
        // Lazy-load the end-slide React module + schemas. The Vite alias
        // resolves @marketing-auto/social/end-slide-components to the
        // source `.tsx` barrel — esbuild JIT-compiles at import time.
        const [React, EndSlideMod] = await Promise.all([
          import("react"),
          // Cross-package import resolved at runtime by Vite alias configured
          // in [quasar.config.ts](../../../../quasar.config.ts). apps/web does
          // not have a tsconfig path for @marketing-auto/* (per the
          // CLAUDE.md DO-NOT) — this is the documented single-component
          // exception for the end-slide live-preview React-in-Vue interop
          // (Spec 65.V1.5c Marcel-Decision §0). The ESLint/tsc warning is
          // suppressed; runtime resolution works via the Vite alias.
          // @ts-expect-error — package resolved via Vite alias at runtime
          import("@marketing-auto/social/end-slide-components"),
        ]);

        // Narrow the lazy-imported module to just what we read. The full
        // types live in `packages/social/src/end-slide-components/types.ts`
        // — we can't import them statically because of the cross-package
        // boundary (see the @ts-expect-error above).
        const mod = EndSlideMod as unknown as {
          HostSlide: unknown;
          END_SLIDE_CONFIG_SCHEMAS: Record<string, { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: { errors: Array<{ path: Array<string | number>; message: string }> } } }>;
          endSlideDataSchema: { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: { errors: Array<{ path: Array<string | number>; message: string }> } } };
        };
        const { HostSlide, END_SLIDE_CONFIG_SCHEMAS, endSlideDataSchema } = mod;

        // Validate the per-type config; surface schema errors cleanly.
        const typeKey = this.input.type as keyof typeof END_SLIDE_CONFIG_SCHEMAS;
        const schema = END_SLIDE_CONFIG_SCHEMAS[typeKey];
        if (!schema) {
          this.parseError = `Unknown end-slide type: ${this.input.type}`;
          return;
        }
        const parsedConfig = schema.safeParse(config);
        if (!parsedConfig.success) {
          this.parseError = (parsedConfig.error?.errors ?? [])
            .map((e) => `${e.path.join(".")}: ${e.message}`)
            .join("; ") || "Invalid config";
          return;
        }

        // Compose the discriminated `EndSlideData` payload that HostSlide
        // expects.
        const data = {
          type: this.input.type,
          config: parsedConfig.data,
          name: { de: this.input.nameDe, en: this.input.nameEn },
        };
        const dataParsed = endSlideDataSchema.safeParse(data);
        if (!dataParsed.success) {
          this.parseError = (dataParsed.error?.errors ?? [])
            .map((e) => `${e.path.join(".")}: ${e.message}`)
            .join("; ") || "Invalid end-slide data";
          return;
        }

        // Build the React tree. The outer wrapper applies the scale
        // transform so 1080×1080 fits inside `canvasSize`.
        const scale = this.canvasSize / 1080;
        const tree = React.createElement(
          "div",
          {
            style: {
              position: "absolute",
              top: 0,
              left: 0,
              width: "1080px",
              height: "1080px",
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            },
          },
          // `HostSlide` is typed `unknown` after the type-narrow above
          // (cross-package types can't be imported statically). React.createElement
          // accepts unknown as the component type at runtime; this cast scopes
          // the unsafety to one call site.
          React.createElement(
            HostSlide as React.FC<{
              data: unknown;
              theme: "light" | "dark";
              locale: "de" | "en";
              brandTokens: Record<string, unknown>;
            }>,
            {
              data: dataParsed.data,
              theme: this.theme,
              locale: this.input.locale,
              brandTokens: {},
            },
          ),
        );

        this._reactRoot.render(tree);
      } catch (err) {
        this.mountError = err instanceof Error ? err.message : "Render failed";
      }
    },
  },
});
</script>

<style scoped>
.end-slide-preview {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.preview-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}
.preview-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}
.preview-spacer {
  flex: 1;
}

.preview-canvas {
  margin: 0 auto;
}

.preview-loading,
.preview-error {
  padding: 12px;
  border-radius: 8px;
  background: var(--surface-strong);
  font-size: 13px;
  text-align: center;
}
.preview-error {
  color: var(--text-error);
  background: color-mix(in oklch, var(--text-error) 12%, transparent);
}

.preview-hint {
  font-size: 11px;
  color: var(--text-tertiary);
  text-align: center;
}
</style>
