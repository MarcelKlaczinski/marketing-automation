<template>
  <div class="inventory-page">
    <h1 class="page-title">{{ $t("settings.inventory.title") as string }}</h1>
    <p class="page-description">{{ $t("settings.inventory.description") as string }}</p>

    <!-- A2 T2: Cron control section -->
    <section class="cron-section">
      <h2 class="section-heading">{{ $t("settings.inventory.cron.title") as string }}</h2>
      <div class="cron-cards">
        <div
          v-for="kind in cronKinds"
          :key="kind"
          class="cron-card"
        >
          <div class="cron-card-header">
            <div>
              <div class="cron-card-title">{{ $t(`settings.inventory.cron.${kind}.label`) as string }}</div>
              <div class="cron-card-desc">{{ $t(`settings.inventory.cron.${kind}.description`) as string }}</div>
            </div>
            <q-toggle
              :model-value="cronEnabled(kind)"
              dark
              color="primary"
              :disable="cronToggling === kind"
              @update:model-value="(v: boolean) => onToggleCron(kind, v)"
            />
          </div>
          <div class="cron-card-meta">
            <div class="cron-meta-row">
              <span class="cron-meta-label">{{ $t("settings.inventory.cron.pattern") as string }}:</span>
              <code class="cron-meta-value">{{ cronPattern(kind) }}</code>
            </div>
            <div class="cron-meta-row">
              <span class="cron-meta-label">{{ $t("settings.inventory.cron.lastRun") as string }}:</span>
              <span class="cron-meta-value">{{ formatRelative(cronLastRunAt(kind)) }}</span>
            </div>
          </div>
          <div class="cron-card-actions">
            <q-btn
              dense
              flat
              icon="play_arrow"
              color="primary"
              :loading="cronRunning === kind"
              :label="$t('settings.inventory.cron.runNow') as string"
              @click="onRunNow(kind)"
            />
          </div>
        </div>
      </div>
    </section>

    <!-- Top bar -->
    <div class="inventory-toolbar">
      <div class="counts">
        <span class="count-pill">
          <strong>{{ counts.tool }}</strong> {{ $t("settings.inventory.counts.tools") as string }}
        </span>
        <span class="count-pill">
          <strong>{{ counts.skill }}</strong> {{ $t("settings.inventory.counts.skills") as string }}
        </span>
        <span v-if="pendingApprovalCount > 0" class="count-pill count-pill-warning">
          <strong>{{ pendingApprovalCount }}</strong> {{ $t("settings.inventory.counts.pendingApproval") as string }}
        </span>
      </div>
      <div class="toolbar-actions">
        <q-select
          v-model="approvalStatusFilter"
          :options="approvalStatusOptions"
          :label="$t('settings.inventory.filters.approvalStatus') as string"
          dense
          outlined
          dark
          emit-value
          map-options
          class="filter-select"
        />
        <q-select
          v-model="objectTypeFilter"
          :options="objectTypeOptions"
          :label="$t('settings.inventory.filters.objectType') as string"
          dense
          outlined
          dark
          clearable
          emit-value
          map-options
          class="filter-select"
        />
        <q-select
          v-model="fetchStatusFilter"
          :options="fetchStatusOptions"
          :label="$t('settings.inventory.filters.fetchStatus') as string"
          dense
          outlined
          dark
          clearable
          emit-value
          map-options
          class="filter-select"
        />
        <q-btn
          color="primary"
          :loading="refreshAllPending"
          :label="$t('settings.inventory.refreshAll') as string"
          icon="refresh"
          @click="onRefreshAll"
        />
        <q-btn
          color="primary"
          outline
          icon="add"
          :label="$t('settings.inventory.addRow') as string"
          @click="openCreateDialog"
        />
      </div>
    </div>

    <!-- A2 T2: Bulk-action bar (only when ≥1 row selected) -->
    <div v-if="selectedIds.size > 0" class="bulk-action-bar">
      <div class="bulk-action-count">
        {{ $t("settings.inventory.bulk.selectedCount", { n: selectedIds.size }, selectedIds.size) as string }}
      </div>
      <div class="bulk-action-buttons">
        <q-btn
          flat
          dense
          :label="$t('settings.inventory.bulk.clearSelection') as string"
          @click="clearSelection"
        />
        <q-btn
          color="positive"
          icon="check"
          :loading="bulkBusy"
          :label="$t('settings.inventory.bulk.approveSelected') as string"
          @click="onBulkApprove"
        />
        <q-btn
          color="negative"
          icon="block"
          outline
          :loading="bulkBusy"
          :label="$t('settings.inventory.bulk.rejectSelected') as string"
          @click="onBulkReject"
        />
      </div>
    </div>

    <!-- Loading + empty states -->
    <div v-if="listLoading" class="state-message">{{ $t("common.loading") as string }}</div>
    <div v-else-if="!items.length" class="state-message">
      {{ $t("settings.inventory.empty") as string }}
    </div>

    <!-- Table -->
    <div v-else class="inventory-table-wrap">
      <table class="inventory-table">
        <thead>
          <tr>
            <th v-if="showSelectionColumn" class="col-select">
              <q-checkbox
                :model-value="headerCheckboxState"
                indeterminate-value="indeterminate"
                dark
                dense
                @update:model-value="onToggleSelectAll"
              />
            </th>
            <th>{{ $t("settings.inventory.cols.displayName") as string }}</th>
            <th>{{ $t("settings.inventory.cols.type") as string }}</th>
            <th>{{ $t("settings.inventory.cols.sourceIdentifier") as string }}</th>
            <th>{{ $t("settings.inventory.cols.stars") as string }}</th>
            <th>{{ $t("settings.inventory.cols.latestRelease") as string }}</th>
            <th>{{ $t("settings.inventory.cols.status") as string }}</th>
            <th>{{ $t("settings.inventory.cols.lastFetched") as string }}</th>
            <th>{{ $t("settings.inventory.cols.interval") as string }}</th>
            <th class="col-actions">{{ $t("settings.inventory.cols.actions") as string }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in items"
            :key="row.id"
            :class="{ 'row-pending-approval': row.approvedAt === null }"
          >
            <td v-if="showSelectionColumn" class="col-select">
              <q-checkbox
                v-if="row.approvedAt === null"
                :model-value="selectedIds.has(row.id)"
                dark
                dense
                @update:model-value="(v: boolean) => onToggleSelect(row.id, v)"
              />
            </td>
            <td class="cell-name">
              {{ row.displayName }}
              <span v-if="row.approvedAt === null" class="pending-pill">
                {{ $t("settings.inventory.cols.pendingApprovalShort") as string }}
              </span>
            </td>
            <td>
              <span class="type-badge" :class="`type-${row.objectType}`">
                {{ $t(`settings.inventory.objectType.${row.objectType}`) as string }}
              </span>
            </td>
            <td class="mono">{{ row.sourceIdentifier }}</td>
            <td>{{ starsOf(row) }}</td>
            <td>{{ releaseOf(row) }}</td>
            <td>
              <span class="status-badge" :class="`status-${row.fetchStatus}`">
                {{ $t(`settings.inventory.fetchStatus.${row.fetchStatus}`) as string }}
              </span>
              <q-tooltip v-if="row.fetchError">{{ row.fetchError }}</q-tooltip>
            </td>
            <td>{{ formatRelative(row.lastFetchedAt) }}</td>
            <td>{{ formatInterval(row.refreshIntervalHours) }}</td>
            <td class="col-actions">
              <q-btn
                v-if="row.approvedAt === null"
                flat
                round
                dense
                icon="check"
                size="sm"
                color="positive"
                :loading="approvingId === row.id"
                @click="onApproveRow(row.id)"
              >
                <q-tooltip>{{ $t("settings.inventory.actions.approve") as string }}</q-tooltip>
              </q-btn>
              <q-btn
                flat
                round
                dense
                icon="refresh"
                size="sm"
                :loading="refreshingId === row.id"
                @click="onRefreshRow(row.id)"
              >
                <q-tooltip>{{ $t("settings.inventory.actions.refresh") as string }}</q-tooltip>
              </q-btn>
              <q-btn
                flat
                round
                dense
                icon="edit"
                size="sm"
                @click="openEditDialog(row)"
              >
                <q-tooltip>{{ $t("settings.inventory.actions.edit") as string }}</q-tooltip>
              </q-btn>
              <q-btn
                flat
                round
                dense
                icon="delete"
                size="sm"
                color="negative"
                @click="onDelete(row)"
              >
                <q-tooltip>{{ $t("settings.inventory.actions.delete") as string }}</q-tooltip>
              </q-btn>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Create / Edit dialog -->
    <q-dialog v-model="dialogOpen" :dark="true">
      <q-card dark style="min-width: 480px; max-width: 600px">
        <q-card-section>
          <div class="text-h6">
            {{
              editTarget
                ? ($t("settings.inventory.editTitle") as string)
                : ($t("settings.inventory.createTitle") as string)
            }}
          </div>
        </q-card-section>

        <q-card-section class="q-pt-none form-fields">
          <q-input
            v-if="!editTarget"
            v-model="form.sourceIdentifier"
            :label="$t('settings.inventory.form.sourceIdentifier') as string"
            :hint="$t('settings.inventory.form.sourceIdentifierHint') as string"
            outlined
            dense
            dark
          />
          <q-select
            v-if="!editTarget"
            v-model="form.objectType"
            :options="objectTypeFormOptions"
            :label="$t('settings.inventory.form.objectType') as string"
            outlined
            dense
            dark
            emit-value
            map-options
          />
          <q-input
            v-model="form.displayName"
            :label="$t('settings.inventory.form.displayName') as string"
            outlined
            dense
            dark
          />
          <q-input
            v-model="form.description"
            :label="$t('settings.inventory.form.description') as string"
            type="textarea"
            outlined
            dense
            dark
            rows="2"
          />
          <q-input
            v-model.number="form.refreshIntervalHours"
            :label="$t('settings.inventory.form.refreshIntervalHours') as string"
            :hint="$t('settings.inventory.form.refreshIntervalHint') as string"
            type="number"
            outlined
            dense
            dark
          />
        </q-card-section>

        <q-card-actions align="right">
          <q-btn
            flat
            :label="$t('common.cancel') as string"
            color="white"
            @click="dialogOpen = false"
          />
          <q-btn
            color="primary"
            :loading="savePending"
            :label="$t('common.save') as string"
            @click="onSave"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { apiDelete, apiGet, apiPatch, apiPost } from "src/lib/api";
import type {
  InventoryGithubMetadata,
  InventoryListResponse,
  InventoryRow,
} from "src/composables/useInventory";

interface EditForm {
  sourceIdentifier: string;
  objectType: "tool" | "skill";
  displayName: string;
  description: string;
  refreshIntervalHours: number;
}

const EMPTY_FORM: EditForm = {
  sourceIdentifier: "",
  objectType: "tool",
  displayName: "",
  description: "",
  refreshIntervalHours: 168,
};

// A2 Tranche 2: inventory cron-status shape mirrors the API route response
// in `apps/api/src/routes/projects/inventory.ts` GET /:slug/inventory/cron-status.
interface InventoryCronEntry {
  isActive: boolean;
  cronPattern: string;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastRunError: string | null;
  nextRunAt: string | null;
}
interface InventoryCronStatus {
  refresh:   InventoryCronEntry;
  discovery: InventoryCronEntry;
}
type InventoryCronKind = "refresh" | "discovery";
const INVENTORY_JOB_TYPE_BY_KIND: Record<InventoryCronKind, string> = {
  refresh:   "github_inventory_refresh",
  discovery: "github_inventory_discovery",
};

function defaultCronEntry(pattern: string): InventoryCronEntry {
  return {
    isActive: false,
    cronPattern: pattern,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunError: null,
    nextRunAt: null,
  };
}

// Direct apiGet + watcher pattern per apps/web/CLAUDE.md DO-NOT rule:
// "DO NOT use TanStack Query when the queryKey depends on a reactive value
// that lives in data() — setup() runs before data() and cannot receive
// reactive data() values." The previous version called useInventory()
// inside a computed property which re-subscribed TanStack Query on every
// reactive cycle, producing infinite loading.
export default defineComponent({
  name: "SettingsInventoryPage",

  data: () => ({
    items: [] as InventoryRow[],
    counts: { tool: 0, skill: 0 } as { tool: number; skill: number },
    objectTypeFilter: null as "tool" | "skill" | null,
    fetchStatusFilter: null as "pending" | "fetching" | "ok" | "error" | null,
    /** A2 T2: approval-status filter. 'all' shows both; 'approved' only approved;
     *  'pending' only unapproved (Auto-Discovery candidates). */
    approvalStatusFilter: "all" as "all" | "approved" | "pending",
    listLoading: false,
    refreshAllPending: false,
    savePending: false,
    dialogOpen: false,
    editTarget: null as InventoryRow | null,
    form: { ...EMPTY_FORM },
    refreshingId: null as string | null,
    approvingId: null as string | null,
    pollTimerId: 0,
    /** A2 T2: bulk-selected row IDs. Replaced with a new Set on every
     *  mutation so Vue reactivity catches the change (Set.add/.delete are
     *  not tracked by the reactive proxy). */
    selectedIds: new Set<string>(),
    bulkBusy: false,
    /** A2 T2: cron control state. */
    cronStatus: {
      refresh:   defaultCronEntry("*/15 * * * *"),
      discovery: defaultCronEntry("0 4 * * 0"),
    } as InventoryCronStatus,
    cronToggling: null as "refresh" | "discovery" | null,
    cronRunning: null as "refresh" | "discovery" | null,
  }),

  computed: {
    projectSlug(): string {
      return this.$route.params.slug as string;
    },

    objectTypeOptions() {
      return [
        { label: this.$t("settings.inventory.objectType.tool") as string, value: "tool" },
        { label: this.$t("settings.inventory.objectType.skill") as string, value: "skill" },
      ];
    },

    objectTypeFormOptions() {
      return this.objectTypeOptions;
    },

    fetchStatusOptions() {
      return [
        { label: this.$t("settings.inventory.fetchStatus.pending") as string, value: "pending" },
        { label: this.$t("settings.inventory.fetchStatus.fetching") as string, value: "fetching" },
        { label: this.$t("settings.inventory.fetchStatus.ok") as string, value: "ok" },
        { label: this.$t("settings.inventory.fetchStatus.error") as string, value: "error" },
      ];
    },

    approvalStatusOptions() {
      return [
        { label: this.$t("settings.inventory.filters.approvalStatusAll") as string, value: "all" },
        { label: this.$t("settings.inventory.filters.approvalStatusApproved") as string, value: "approved" },
        { label: this.$t("settings.inventory.filters.approvalStatusPending") as string, value: "pending" },
      ];
    },

    cronKinds(): InventoryCronKind[] {
      return ["refresh", "discovery"];
    },

    /** Show the selection column only when filter narrows to pending — keeps the
     *  table uncluttered in the default approved-only view. */
    showSelectionColumn(): boolean {
      return this.approvalStatusFilter === "pending" || this.approvalStatusFilter === "all";
    },

    pendingApprovalCount(): number {
      return this.items.filter((r) => r.approvedAt === null).length;
    },

    headerCheckboxState(): boolean | "indeterminate" {
      const eligible = this.items.filter((r) => r.approvedAt === null);
      if (eligible.length === 0) return false;
      const selectedCount = eligible.filter((r) => this.selectedIds.has(r.id)).length;
      if (selectedCount === 0) return false;
      if (selectedCount === eligible.length) return true;
      return "indeterminate";
    },
  },

  watch: {
    objectTypeFilter() {
      this.clearSelection();
      void this.fetchList();
    },
    fetchStatusFilter() {
      this.clearSelection();
      void this.fetchList();
    },
    approvalStatusFilter() {
      this.clearSelection();
      void this.fetchList();
    },
  },

  mounted() {
    void this.fetchList();
    void this.fetchCronStatus();
    // Surface cron-driven status changes within 15 seconds without re-subscribing
    // TanStack queries on every reactive cycle. setInterval — not setTimeout —
    // because the page is long-lived; cleared in beforeUnmount.
    this.pollTimerId = window.setInterval(() => {
      void this.fetchList();
      void this.fetchCronStatus();
    }, 15_000);
  },

  beforeUnmount() {
    if (this.pollTimerId) {
      window.clearInterval(this.pollTimerId);
      this.pollTimerId = 0;
    }
  },

  methods: {
    async fetchList() {
      this.listLoading = this.items.length === 0; // only show spinner on first load
      try {
        const params = new URLSearchParams();
        if (this.objectTypeFilter) params.set("objectType", this.objectTypeFilter);
        if (this.fetchStatusFilter) params.set("fetchStatus", this.fetchStatusFilter);
        // A2 T2: approval-status filter — `all` and `pending` need to include
        // unapproved rows; the backend default approvedOnly=true would hide them.
        if (this.approvalStatusFilter !== "approved") {
          params.set("approvedOnly", "false");
        }
        const qs = params.toString();
        const data = await apiGet<InventoryListResponse>(
          `/projects/${this.projectSlug}/inventory${qs ? `?${qs}` : ""}`,
        );
        let items = data.items;
        // Client-side filter for `pending` (backend has no native pending-only)
        if (this.approvalStatusFilter === "pending") {
          items = items.filter((r) => r.approvedAt === null);
        }
        this.items = items;
        this.counts = data.counts;
      } catch (err) {
        this.$q.notify({
          type: "negative",
          message: err instanceof Error ? err.message : "list_failed",
        });
      } finally {
        this.listLoading = false;
      }
    },

    async fetchCronStatus() {
      try {
        const data = await apiGet<InventoryCronStatus>(
          `/projects/${this.projectSlug}/inventory/cron-status`,
        );
        this.cronStatus = data;
      } catch (err) {
        // Non-blocking — keep defaults visible if the endpoint fails.
        // Surfaces as the "Never run" indicator since lastRunAt stays null.
        // biome-ignore lint/suspicious/noConsoleLog: dev-only diagnostic; UI keeps working
        if (err instanceof Error && import.meta.env.DEV) console.warn("cron-status fetch:", err.message);
      }
    },

    cronEnabled(kind: InventoryCronKind): boolean {
      return this.cronStatus[kind].isActive;
    },
    cronPattern(kind: InventoryCronKind): string {
      return this.cronStatus[kind].cronPattern;
    },
    cronLastRunAt(kind: InventoryCronKind): string | null {
      return this.cronStatus[kind].lastRunAt;
    },

    async onToggleCron(kind: InventoryCronKind, isActive: boolean) {
      this.cronToggling = kind;
      try {
        await apiPatch(
          `/projects/${this.projectSlug}/inventory/cron-status`,
          {
            jobType: INVENTORY_JOB_TYPE_BY_KIND[kind],
            isActive,
          },
        );
        // Optimistic update — refetch in background to sync any server-side
        // pattern adjustments
        this.cronStatus[kind].isActive = isActive;
        void this.fetchCronStatus();
        this.$q.notify({
          type: "positive",
          message: this.$t(
            isActive ? "settings.inventory.cron.enabled" : "settings.inventory.cron.disabled",
          ) as string,
        });
      } catch (err) {
        this.$q.notify({
          type: "negative",
          message: err instanceof Error ? err.message : "cron_toggle_failed",
        });
      } finally {
        this.cronToggling = null;
      }
    },

    async onRunNow(kind: InventoryCronKind) {
      this.cronRunning = kind;
      try {
        const path =
          kind === "refresh"
            ? `/projects/${this.projectSlug}/inventory/refresh`
            : `/projects/${this.projectSlug}/inventory/discovery/run`;
        await apiPost<{ jobId: string }>(path, {});
        this.$q.notify({
          type: "positive",
          message: this.$t("settings.inventory.cron.runEnqueued") as string,
        });
      } catch (err) {
        this.$q.notify({
          type: "negative",
          message: err instanceof Error ? err.message : "run_failed",
        });
      } finally {
        this.cronRunning = null;
      }
    },

    // ─── Selection + bulk actions ────────────────────────────────────────

    onToggleSelect(id: string, selected: boolean | "indeterminate") {
      const next = new Set(this.selectedIds);
      if (selected === true) next.add(id);
      else next.delete(id);
      this.selectedIds = next;
    },

    onToggleSelectAll(value: boolean | "indeterminate") {
      const wantSelected = value === true;
      const next = new Set<string>();
      if (wantSelected) {
        for (const r of this.items) {
          if (r.approvedAt === null) next.add(r.id);
        }
      }
      this.selectedIds = next;
    },

    clearSelection() {
      this.selectedIds = new Set<string>();
    },

    async onApproveRow(id: string) {
      this.approvingId = id;
      try {
        await apiPost(`/projects/${this.projectSlug}/inventory/${id}/approve`, {});
        this.$q.notify({
          type: "positive",
          message: this.$t("settings.inventory.bulk.approvedSingleSuccess") as string,
        });
        await this.fetchList();
      } catch (err) {
        this.$q.notify({
          type: "negative",
          message: err instanceof Error ? err.message : "approve_failed",
        });
      } finally {
        this.approvingId = null;
      }
    },

    async onBulkApprove() {
      if (this.selectedIds.size === 0) return;
      this.bulkBusy = true;
      try {
        const result = await apiPost<{
          approved: number;
          alreadyApproved: number;
          notFound: number;
        }>(`/projects/${this.projectSlug}/inventory/discovery/approve`, {
          ids: Array.from(this.selectedIds),
        });
        this.$q.notify({
          type: "positive",
          message: this.$t(
            "settings.inventory.bulk.approvedSuccess",
            { n: result.approved },
            result.approved,
          ) as string,
        });
        this.clearSelection();
        await this.fetchList();
      } catch (err) {
        this.$q.notify({
          type: "negative",
          message: err instanceof Error ? err.message : "bulk_approve_failed",
        });
      } finally {
        this.bulkBusy = false;
      }
    },

    onBulkReject() {
      if (this.selectedIds.size === 0) return;
      this.$q.dialog({
        title: this.$t("settings.inventory.bulk.rejectConfirmTitle") as string,
        message: this.$t(
          "settings.inventory.bulk.rejectConfirmMessage",
          { n: this.selectedIds.size },
          this.selectedIds.size,
        ) as string,
        cancel: { flat: true, color: "white" },
        ok: { color: "negative", label: this.$t("settings.inventory.bulk.rejectConfirmOk") as string },
        dark: true,
        persistent: true,
      }).onOk(async () => {
        this.bulkBusy = true;
        try {
          const result = await apiPost<{ rejected: number; skipped: number }>(
            `/projects/${this.projectSlug}/inventory/discovery/reject`,
            { ids: Array.from(this.selectedIds) },
          );
          this.$q.notify({
            type: "positive",
            message: this.$t(
              "settings.inventory.bulk.rejectedSuccess",
              { n: result.rejected },
              result.rejected,
            ) as string,
          });
          this.clearSelection();
          await this.fetchList();
        } catch (err) {
          this.$q.notify({
            type: "negative",
            message: err instanceof Error ? err.message : "bulk_reject_failed",
          });
        } finally {
          this.bulkBusy = false;
        }
      });
    },

    starsOf(row: InventoryRow): string {
      // Pending/error rows have `{}` runtime even though the column type asserts
      // populated. Gate on fetchStatus to avoid reading undefined fields.
      if (row.fetchStatus !== "ok") return "—";
      const meta = row.githubMetadata as InventoryGithubMetadata;
      return typeof meta.starsCount === "number" ? meta.starsCount.toLocaleString() : "—";
    },

    releaseOf(row: InventoryRow): string {
      if (row.fetchStatus !== "ok") return "—";
      const meta = row.githubMetadata as InventoryGithubMetadata;
      const release = meta.latestRelease;
      if (!release) return "—";
      return release.tag;
    },

    formatRelative(iso: string | null): string {
      if (!iso) return "—";
      const date = new Date(iso);
      const locale = this.$i18n.locale === "de" ? "de-DE" : "en-US";
      return date.toLocaleString(locale, {
        dateStyle: "short",
        timeStyle: "short",
      });
    },

    formatInterval(hours: number): string {
      if (hours % 24 === 0) {
        const days = hours / 24;
        return this.$t("settings.inventory.intervalDays", { n: days }, days) as string;
      }
      return this.$t("settings.inventory.intervalHours", { n: hours }, hours) as string;
    },

    openCreateDialog() {
      this.editTarget = null;
      this.form = { ...EMPTY_FORM };
      this.dialogOpen = true;
    },

    openEditDialog(row: InventoryRow) {
      this.editTarget = row;
      this.form = {
        sourceIdentifier: row.sourceIdentifier,
        objectType: row.objectType,
        displayName: row.displayName,
        description: row.description ?? "",
        refreshIntervalHours: row.refreshIntervalHours,
      };
      this.dialogOpen = true;
    },

    async onSave() {
      this.savePending = true;
      try {
        if (this.editTarget) {
          await apiPatch<InventoryRow>(
            `/projects/${this.projectSlug}/inventory/${this.editTarget.id}`,
            {
              displayName: this.form.displayName,
              description: this.form.description || null,
              refreshIntervalHours: this.form.refreshIntervalHours,
            },
          );
        } else {
          if (!this.form.sourceIdentifier.trim() || !this.form.displayName.trim()) {
            this.$q.notify({
              type: "negative",
              message: this.$t("settings.inventory.errors.required") as string,
            });
            this.savePending = false;
            return;
          }
          await apiPost<InventoryRow>(`/projects/${this.projectSlug}/inventory`, {
            objectType: this.form.objectType,
            sourceIdentifier: this.form.sourceIdentifier.trim(),
            displayName: this.form.displayName.trim(),
            description: this.form.description.trim() || null,
            refreshIntervalHours: this.form.refreshIntervalHours,
          });
        }
        this.dialogOpen = false;
        this.$q.notify({
          type: "positive",
          message: this.$t("settings.inventory.savedSuccess") as string,
        });
        await this.fetchList();
      } catch (err) {
        this.$q.notify({
          type: "negative",
          message: err instanceof Error ? err.message : "save_failed",
        });
      } finally {
        this.savePending = false;
      }
    },

    onDelete(row: InventoryRow) {
      this.$q.dialog({
        title: this.$t("settings.inventory.deleteConfirmTitle") as string,
        message: this.$t("settings.inventory.deleteConfirmMessage", {
          name: row.displayName,
        }) as string,
        cancel: { flat: true, color: "white" },
        ok: { color: "negative", label: this.$t("common.delete") as string },
        dark: true,
        persistent: true,
      }).onOk(async () => {
        try {
          await apiDelete<{ deleted: boolean }>(
            `/projects/${this.projectSlug}/inventory/${row.id}`,
          );
          this.$q.notify({
            type: "positive",
            message: this.$t("settings.inventory.deletedSuccess") as string,
          });
          await this.fetchList();
        } catch (err) {
          this.$q.notify({
            type: "negative",
            message: err instanceof Error ? err.message : "delete_failed",
          });
        }
      });
    },

    async onRefreshRow(id: string) {
      this.refreshingId = id;
      try {
        await apiPost<{ jobId: string }>(
          `/projects/${this.projectSlug}/inventory/${id}/refresh`,
          {},
        );
        this.$q.notify({
          type: "positive",
          message: this.$t("settings.inventory.refreshEnqueued") as string,
        });
      } catch (err) {
        this.$q.notify({
          type: "negative",
          message: err instanceof Error ? err.message : "refresh_failed",
        });
      } finally {
        this.refreshingId = null;
      }
    },

    async onRefreshAll() {
      this.refreshAllPending = true;
      try {
        await apiPost<{ jobId: string; mode: string }>(
          `/projects/${this.projectSlug}/inventory/refresh`,
          {},
        );
        this.$q.notify({
          type: "positive",
          message: this.$t("settings.inventory.refreshAllEnqueued") as string,
        });
      } catch (err) {
        this.$q.notify({
          type: "negative",
          message: err instanceof Error ? err.message : "refresh_failed",
        });
      } finally {
        this.refreshAllPending = false;
      }
    },
  },
});
</script>

<style scoped>
.inventory-page {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-bottom: var(--space-7);
}

.page-title {
  font-size: 24px;
  font-weight: 700;
  margin: 0;
  color: var(--text-primary);
}

.page-description {
  margin: 0;
  font-size: 14px;
  color: var(--text-secondary);
}

.inventory-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.counts {
  display: flex;
  gap: 8px;
}

.count-pill {
  padding: 4px 10px;
  background: var(--bg-glass);
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--text-secondary);
}

.count-pill strong {
  color: var(--text-primary);
  margin-right: 2px;
}

.toolbar-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.filter-select {
  min-width: 160px;
}

.state-message {
  padding: 32px 16px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 14px;
}

.inventory-table-wrap {
  overflow-x: auto;
  background: var(--bg-glass);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
}

.inventory-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.inventory-table thead th {
  text-align: left;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-subtle);
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
}

.inventory-table tbody td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-primary);
  vertical-align: middle;
}

.inventory-table tbody tr:last-child td {
  border-bottom: none;
}

.cell-name {
  font-weight: 500;
}

.mono {
  font-family: var(--font-family-mono, monospace);
  font-size: 12px;
  color: var(--text-secondary);
}

.col-actions {
  text-align: right;
  white-space: nowrap;
}

.type-badge,
.status-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.type-tool {
  background: rgba(96, 165, 250, 0.18);
  color: rgb(147, 197, 253);
}

.type-skill {
  background: rgba(168, 140, 255, 0.18);
  color: rgb(196, 181, 253);
}

.status-pending {
  background: rgba(148, 163, 184, 0.18);
  color: rgb(203, 213, 225);
}

.status-fetching {
  background: rgba(250, 204, 21, 0.18);
  color: rgb(253, 224, 71);
}

.status-ok {
  background: rgba(74, 222, 128, 0.18);
  color: rgb(134, 239, 172);
}

.status-error {
  background: rgba(248, 113, 113, 0.18);
  color: rgb(252, 165, 165);
}

.form-fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ─── A2 Tranche 2: cron control + bulk-action + approval styling ────────── */

.section-heading {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 8px 0;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.cron-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cron-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: 12px;
}

.cron-card {
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cron-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.cron-card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.cron-card-desc {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 2px;
  line-height: 1.4;
}

.cron-card-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.cron-meta-row {
  display: flex;
  gap: 8px;
  align-items: baseline;
}

.cron-meta-label {
  color: var(--text-tertiary);
  min-width: 64px;
}

.cron-meta-value {
  color: var(--text-secondary);
  font-family: var(--font-family-mono, monospace);
  font-size: 11px;
}

.cron-card-actions {
  display: flex;
  justify-content: flex-end;
}

.count-pill-warning {
  background: rgba(250, 204, 21, 0.18);
  color: rgb(253, 224, 71);
}

.bulk-action-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: rgba(96, 165, 250, 0.12);
  border: 1px solid rgba(96, 165, 250, 0.32);
  border-radius: var(--radius-md);
}

.bulk-action-count {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.bulk-action-buttons {
  display: flex;
  gap: 8px;
  align-items: center;
}

.col-select {
  width: 40px;
  text-align: center;
  padding: 4px 8px !important;
}

.row-pending-approval {
  background: rgba(250, 204, 21, 0.04);
}

.pending-pill {
  display: inline-block;
  margin-left: 8px;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: rgba(250, 204, 21, 0.18);
  color: rgb(253, 224, 71);
}
</style>
