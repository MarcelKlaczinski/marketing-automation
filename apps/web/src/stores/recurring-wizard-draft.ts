/**
 * Spec 65.V1.5b — Recurring-content wizard draft store (Pinia + LocalStorage).
 *
 * Persists wizard-in-progress state per-project so a Marcel-interrupted run
 * (browser-close, mid-wizard nav, project-switch) can resume from where it
 * was left.
 *
 * Storage key: `recurring-wizard-draft-<projectSlug>` via Quasar's
 * `LocalStorage` plugin. 7-day expiry — anything older is treated as
 * abandoned and cleared on next load.
 *
 * The draft mirrors the create-definition POST body shape so the Review
 * step can submit `draft` directly without re-mapping.
 */
import { LocalStorage } from "quasar";
import { defineStore } from "pinia";

const STORAGE_KEY_PREFIX = "recurring-wizard-draft";
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type OutputTargets = { article: boolean; social: boolean };

export interface RecurringWizardDraft {
  formatType: string | null;
  formatConfig: Record<string, unknown>;
  name: string;
  frequency: string; // weekly | biweekly | monthly | cron expression
  outputTargets: OutputTargets;
  templateSelectionStrategy: "fixed" | "lru" | "llm-picks" | "latest";
  fixedTemplateKey: string | null;
  /** null = inherit project default; true/false = per-definition override. */
  autoApproveOverride: boolean | null;
  /**
   * Spec 65.16 — per-definition image-style preset override.
   * null = inherit project default; preset key = win over for this definition.
   */
  socialImageStylePresetOverride: "dark-neon-grid" | "light-editorial" | "blue-tech-gradient" | null;
  targetLocales: string[];
  /** Furthest step ever reached (0..3). Used to gate forward nav. */
  furthestStep: number;
  /** Stamp written on every saveDraft(); drives 7d expiry. */
  lastSavedAt: number;
}

function buildInitialDraft(): RecurringWizardDraft {
  return {
    formatType: null,
    formatConfig: {},
    name: "",
    frequency: "weekly",
    outputTargets: { article: false, social: true },
    templateSelectionStrategy: "lru",
    fixedTemplateKey: null,
    autoApproveOverride: null,
    socialImageStylePresetOverride: null,
    targetLocales: ["de"],
    furthestStep: 0,
    lastSavedAt: 0,
  };
}

function storageKey(projectSlug: string): string {
  return `${STORAGE_KEY_PREFIX}-${projectSlug}`;
}

export const useRecurringWizardDraftStore = defineStore("recurring-wizard-draft", {
  state: () => ({
    /** Currently-loaded draft. NEVER mutate directly — go through patchDraft. */
    draft: buildInitialDraft() as RecurringWizardDraft,
    /** Which project the draft belongs to. Reset clears this. */
    projectSlug: null as string | null,
    /** Whether localStorage held an existing draft when we loaded — drives restore dialog. */
    hasRestorableDraft: false,
  }),
  actions: {
    /**
     * Idempotent loader. Call on wizard entry. Hydrates from localStorage if a
     * non-expired draft exists for the project; otherwise leaves the in-memory
     * state at initial values. Sets `hasRestorableDraft = true` so the
     * WizardLayout can prompt Marcel before applying the load.
     */
    loadDraft(projectSlug: string): void {
      if (this.projectSlug === projectSlug) return; // already loaded
      this.projectSlug = projectSlug;
      const raw = LocalStorage.getItem(storageKey(projectSlug));
      if (!raw || typeof raw !== "object") {
        this.draft = buildInitialDraft();
        this.hasRestorableDraft = false;
        return;
      }
      // Safe cast: `raw` came from Quasar LocalStorage which serialises via
      // JSON.parse, so we have a plain object (or null already handled above).
      // Partial<> is used because older drafts may lack fields added by later
      // schema revisions — the buildInitialDraft() merge below fills those in.
      const stored = raw as Partial<RecurringWizardDraft>;
      const lastSaved = typeof stored.lastSavedAt === "number" ? stored.lastSavedAt : 0;
      if (Date.now() - lastSaved > DRAFT_TTL_MS) {
        // Expired — wipe + start fresh.
        LocalStorage.removeItem(storageKey(projectSlug));
        this.draft = buildInitialDraft();
        this.hasRestorableDraft = false;
        return;
      }
      // Defensive merge: stored draft may be from an older schema; the
      // initial-draft values fill in missing fields.
      this.draft = { ...buildInitialDraft(), ...stored };
      this.hasRestorableDraft = true;
    },

    /** Patch one or more fields + persist atomically. */
    patchDraft(patch: Partial<RecurringWizardDraft>): void {
      this.draft = { ...this.draft, ...patch, lastSavedAt: Date.now() };
      if (this.projectSlug) {
        LocalStorage.set(storageKey(this.projectSlug), this.draft);
      }
    },

    /** Bump `furthestStep` if the user reached a new step. */
    markStepReached(step: number): void {
      if (step > this.draft.furthestStep) {
        this.patchDraft({ furthestStep: step });
      }
    },

    /** Wipe draft + storage. Call after successful create or on explicit cancel. */
    clearDraft(): void {
      if (this.projectSlug) {
        LocalStorage.removeItem(storageKey(this.projectSlug));
      }
      this.draft = buildInitialDraft();
      this.projectSlug = null;
      this.hasRestorableDraft = false;
    },

    /**
     * Marcel chose "Discard" on the restore dialog — clear the persisted blob
     * but keep `projectSlug` set so we don't re-prompt on the next route enter.
     */
    discardRestorable(): void {
      if (this.projectSlug) {
        LocalStorage.removeItem(storageKey(this.projectSlug));
      }
      this.draft = buildInitialDraft();
      this.hasRestorableDraft = false;
    },
  },
});
