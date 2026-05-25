<template>
  <q-dialog v-model="open" persistent @hide="onHide">
    <q-card class="preview-modal" dark>
      <q-card-section class="modal-header">
        <div class="header-title">
          {{ $t("settings.templates.modal.title", { name: displayLabel }) as string }}
        </div>
        <q-btn
          flat
          dense
          round
          icon="close"
          :aria-label="$t('settings.templates.modal.close') as string"
          @click="open = false"
        />
      </q-card-section>

      <q-card-section class="modal-body">
        <!-- LEFT: editor + controls -->
        <div class="editor-pane">
          <div class="pane-label">
            {{ $t("settings.templates.modal.sampleDataLabel") as string }}
          </div>
          <div class="pane-hint">
            {{ $t("settings.templates.modal.sampleDataHint") as string }}
          </div>

          <PipelineJsonEditor
            v-model="jsonText"
            :read-only="false"
            :min-height="320"
            @parse-error="onParseError"
          />

          <div class="control-row">
            <div class="control-group">
              <label class="control-label">{{ $t("settings.templates.modal.theme") as string }}</label>
              <select v-model="theme" class="control-select">
                <option value="dark">{{ $t("settings.templates.modal.themeDark") as string }}</option>
                <option value="light">{{ $t("settings.templates.modal.themeLight") as string }}</option>
              </select>
            </div>
            <div class="control-group">
              <label class="control-label">{{ $t("settings.templates.modal.locale") as string }}</label>
              <select v-model="locale" class="control-select">
                <option value="de">DE</option>
                <option value="en">EN</option>
              </select>
            </div>
          </div>

          <div class="button-row">
            <q-btn
              flat
              :label="$t('settings.templates.modal.autoFill') as string"
              :disable="!autoFillAvailable"
              @click="onAutoFill"
            />
            <q-btn
              flat
              :label="$t('settings.templates.modal.copyJson') as string"
              :disable="!jsonText"
              @click="onCopyJson"
            />
            <q-btn
              color="primary"
              :label="renderButtonLabel"
              :loading="pending"
              :disable="pending || invalidJson"
              @click="onRender"
            />
          </div>

          <div v-if="invalidJson && jsonText" class="error-banner" role="alert">
            {{ $t("settings.templates.modal.invalidJson") as string }}
          </div>

          <div v-if="failureMessage" class="error-banner" role="alert">
            <strong>{{ $t("settings.templates.modal.renderFailedTitle") as string }}:</strong>
            {{ failureMessage }}
          </div>

          <div v-if="successMs !== null" class="success-banner" role="status">
            {{ $t("settings.templates.modal.renderSuccess", { ms: successMs }) as string }}
          </div>
        </div>

        <!-- RIGHT: preview -->
        <div class="preview-pane">
          <div v-if="!previewUrls.length" class="preview-empty">
            <q-icon name="image" size="48px" />
            <div class="preview-empty-text">
              {{ $t("settings.templates.modal.sampleDataHint") as string }}
            </div>
          </div>
          <div v-else class="preview-grid">
            <div class="slides-heading-row">
              <div class="slides-heading">
                {{ $t("settings.templates.modal.slidesHeading", { count: previewUrls.length }) as string }}
              </div>
              <div v-if="renderedAt" class="rendered-at-hint">
                {{ $t("settings.templates.modal.lastRendered", { when: formattedRenderedAt }) as string }}
              </div>
            </div>
            <div class="slides-list">
              <img
                v-for="(url, idx) in previewUrls"
                :key="`${url}-${renderedAt ?? ''}`"
                :src="cacheBustedUrl(url)"
                :alt="`Slide ${idx + 1}`"
                class="slide-image"
                loading="lazy"
              />
            </div>
          </div>
        </div>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import { assetUrl } from "src/lib/asset-url";
import { getSampleData, hasSampleData } from "src/lib/template-sample-data";
import { usePreviewTemplate } from "src/composables/settings/usePreviewTemplate";
import PipelineJsonEditor from "src/components/runs/PipelineJsonEditor.vue";

/**
 * Spec 65.0 Day 5 — Template preview modal.
 *
 * Shows a JSON editor (CodeMirror via the reusable PipelineJsonEditor), a
 * theme/locale picker, and a "Render" button that POSTs to the Day-4
 * preview endpoint. Output PNGs render in the right pane, served via
 * `/renders/preview/...` (wrapped through `assetUrl()` per the dev
 * cross-origin gotcha in apps/web/CLAUDE.md).
 *
 * Auto-fill loads a hardcoded sample-data example from
 * `src/lib/template-sample-data.ts`. Templates without an entry hide the
 * Auto-fill button rather than break — Q6 "last brief" auto-fill is
 * deferred to a later session (real briefs don't carry the composition-
 * input shape; bridging needs server-side transform).
 */
export default defineComponent({
  name: "TemplatePreviewModal",

  components: { PipelineJsonEditor },

  props: {
    modelValue: { type: Boolean, required: true },
    slug: { type: String, required: true },
    templateKey: { type: String, required: true },
    displayName: { type: String as unknown as PropType<string | null>, default: null },
    /**
     * Spec 65.0 Day 5 — persisted render from the last preview, if any.
     * The modal pre-populates with these so users see the last render
     * without having to hit "Render" again. Empty array → blank right pane
     * with the empty-state hint.
     */
    initialPreviewUrls: {
      type: Array as unknown as PropType<string[]>,
      default: () => [],
    },
    initialRenderedAt: {
      type: String as unknown as PropType<string | null>,
      default: null,
    },
  },

  emits: {
    "update:modelValue": (_value: boolean) => true,
    rendered: (_payload: { previewUrls: string[]; renderedAt: string }) => true,
  },

  setup() {
    const preview = usePreviewTemplate();
    return { preview };
  },

  data: () => ({
    jsonText: "",
    theme: "dark" as "dark" | "light",
    locale: "de" as "de" | "en",
    invalidJson: false,
    successMs: null as number | null,
    failureMessage: null as string | null,
    previewUrls: [] as string[],
    /**
     * ISO string from the most recent render (persisted on disk) — null
     * when the user has never rendered this template. Displayed as a
     * "Last rendered" hint above the slides.
     */
    renderedAt: null as string | null,
  }),

  computed: {
    open: {
      get(): boolean {
        return this.modelValue;
      },
      set(value: boolean): void {
        this.$emit("update:modelValue", value);
      },
    },
    displayLabel(): string {
      return this.displayName ?? this.templateKey;
    },
    autoFillAvailable(): boolean {
      return hasSampleData(this.templateKey);
    },
    pending(): boolean {
      return this.preview.pending.value;
    },
    renderButtonLabel(): string {
      if (this.pending) return this.$t("settings.templates.modal.rendering") as string;
      return this.$t("settings.templates.modal.render") as string;
    },
    formattedRenderedAt(): string {
      if (!this.renderedAt) return "";
      const date = new Date(this.renderedAt);
      if (Number.isNaN(date.getTime())) return this.renderedAt;
      const locale = this.$i18n.locale === "de" ? "de-DE" : "en-US";
      return date.toLocaleString(locale, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    },
  },

  watch: {
    modelValue(next: boolean): void {
      if (next) {
        // Reset transient state when re-opening the modal.
        this.successMs = null;
        this.failureMessage = null;
        // Spec 65.0 Day 5: pre-load the previously persisted slides so the
        // user sees the last render without having to click Render again.
        this.previewUrls = [...this.initialPreviewUrls];
        this.renderedAt = this.initialRenderedAt;
        if (!this.jsonText) this.onAutoFill();
      }
    },
  },

  methods: {
    assetUrl(path: string | null | undefined): string {
      return assetUrl(path);
    },
    /**
     * Cache-bust the slide URLs after each render so the browser doesn't
     * keep showing the prior render's bytes. Path is deterministic by
     * design (Spec 65.0 Day 5: re-renders overwrite the same files), so
     * the URL itself doesn't change — only the query string does.
     */
    cacheBustedUrl(path: string): string {
      const base = assetUrl(path);
      if (!this.renderedAt) return base;
      const v = encodeURIComponent(this.renderedAt);
      return base.includes("?") ? `${base}&v=${v}` : `${base}?v=${v}`;
    },
    onParseError(_reason: string): void {
      // PipelineJsonEditor only emits `parse-error` on actual failures,
      // and clears it implicitly via the watcher when the doc parses again.
      this.invalidJson = true;
    },
    onAutoFill(): void {
      const data = getSampleData(this.templateKey);
      if (!data) return;
      this.jsonText = JSON.stringify(data, null, 2);
      this.invalidJson = false;
    },
    async onCopyJson(): Promise<void> {
      try {
        await navigator.clipboard.writeText(this.jsonText);
        this.$q.notify({
          type: "positive",
          message: this.$t("settings.templates.modal.copyJsonSuccess") as string,
          position: "bottom",
        });
      } catch {
        // Silent — clipboard may be denied in test envs.
      }
    },
    async onRender(): Promise<void> {
      this.successMs = null;
      this.failureMessage = null;
      this.previewUrls = [];

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(this.jsonText) as Record<string, unknown>;
      } catch {
        this.invalidJson = true;
        return;
      }

      const result = await this.preview.submit({
        slug: this.slug,
        templateKey: this.templateKey,
        sampleData: parsed,
        theme: this.theme,
        locale: this.locale,
      });

      if ("status" in result && result.status !== undefined) {
        // Failure shape.
        this.failureMessage = result.message ?? result.error;
      } else if ("sessionId" in result) {
        this.previewUrls = result.previewUrls;
        this.successMs = result.renderDurationMs;
        this.renderedAt = result.renderedAt;
        this.$emit("rendered", {
          previewUrls: result.previewUrls,
          renderedAt: result.renderedAt,
        });
      }
    },
    onHide(): void {
      this.preview.reset();
      this.successMs = null;
      this.failureMessage = null;
    },
  },
});
</script>

<style scoped>
.preview-modal {
  width: min(1200px, 95vw);
  max-width: 1200px;
  background: var(--bg-base);
  color: var(--text-primary);
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--border-subtle);
  padding: 14px 20px;
}

.header-title {
  font-size: 16px;
  font-weight: 600;
}

.modal-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  padding: 20px;
  min-height: 480px;
}

.editor-pane,
.preview-pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pane-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-tertiary);
}

.pane-hint {
  font-size: 12px;
  color: var(--text-tertiary);
}

.control-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.control-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.control-label {
  font-size: 11px;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.control-select {
  background: var(--bg-glass-strong);
  color: var(--text-primary);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  font-size: 13px;
}

.button-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 4px;
}

.error-banner {
  background: color-mix(in oklch, var(--color-error, #e53e3e) 12%, transparent);
  border: 1px solid color-mix(in oklch, var(--color-error, #e53e3e) 35%, transparent);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  font-size: 13px;
  color: var(--color-error, #e53e3e);
}

.success-banner {
  background: color-mix(in oklch, var(--color-success, #16a34a) 12%, transparent);
  border: 1px solid color-mix(in oklch, var(--color-success, #16a34a) 35%, transparent);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  font-size: 13px;
  color: var(--color-success, #16a34a);
}

.preview-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  flex: 1;
  min-height: 320px;
  background: var(--bg-glass-strong);
  border: 1px dashed var(--border-soft);
  border-radius: var(--radius-md);
  color: var(--text-tertiary);
  padding: 24px;
  text-align: center;
}

.preview-empty-text {
  font-size: 12px;
  max-width: 280px;
  line-height: 1.4;
}

.preview-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.slides-heading-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.slides-heading {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-tertiary);
}

.rendered-at-hint {
  font-size: 11px;
  color: var(--text-tertiary);
  font-style: italic;
}

.slides-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 60vh;
  overflow-y: auto;
}

.slide-image {
  width: 100%;
  aspect-ratio: 4 / 5;
  object-fit: cover;
  background: var(--bg-glass-strong);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
}

@media (max-width: 900px) {
  .modal-body {
    grid-template-columns: 1fr;
  }

  .preview-pane {
    border-top: 1px solid var(--border-subtle);
    padding-top: 16px;
  }
}
</style>
