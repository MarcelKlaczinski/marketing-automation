<template>
  <div class="inventory-page">
    <h1 class="page-title">{{ $t("settings.inventory.title") as string }}</h1>
    <p class="page-description">{{ $t("settings.inventory.description") as string }}</p>

    <!-- Top bar -->
    <div class="inventory-toolbar">
      <div class="counts">
        <span class="count-pill">
          <strong>{{ counts.tool }}</strong> {{ $t("settings.inventory.counts.tools") as string }}
        </span>
        <span class="count-pill">
          <strong>{{ counts.skill }}</strong> {{ $t("settings.inventory.counts.skills") as string }}
        </span>
      </div>
      <div class="toolbar-actions">
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
          <tr v-for="row in items" :key="row.id">
            <td class="cell-name">{{ row.displayName }}</td>
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
import {
  useInventory,
  type InventoryGithubMetadata,
  type InventoryRow,
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

export default defineComponent({
  name: "SettingsInventoryPage",

  setup() {
    return {};
  },

  data: () => ({
    objectTypeFilter: null as "tool" | "skill" | null,
    fetchStatusFilter: null as "pending" | "fetching" | "ok" | "error" | null,
    dialogOpen: false,
    editTarget: null as InventoryRow | null,
    form: { ...EMPTY_FORM },
    refreshingId: null as string | null,
  }),

  computed: {
    projectSlug(): string {
      return this.$route.params.slug as string;
    },

    inventory() {
      // useInventory is a Composition-API composable; calling it inside a
      // computed gives us reactive access to its mutations + query. Since the
      // slug is stable for this route, plain string-form is fine.
      return useInventory(this.projectSlug, {
        ...(this.objectTypeFilter !== null && { objectType: this.objectTypeFilter }),
        ...(this.fetchStatusFilter !== null && { fetchStatus: this.fetchStatusFilter }),
      });
    },

    items(): InventoryRow[] {
      return this.inventory.listQuery.data.value?.items ?? [];
    },

    counts(): { tool: number; skill: number } {
      return this.inventory.listQuery.data.value?.counts ?? { tool: 0, skill: 0 };
    },

    listLoading(): boolean {
      return this.inventory.listQuery.isLoading.value && !this.inventory.listQuery.data.value;
    },

    refreshAllPending(): boolean {
      return this.inventory.refreshAllMutation.isPending.value;
    },

    savePending(): boolean {
      return (
        this.inventory.createMutation.isPending.value ||
        this.inventory.patchMutation.isPending.value
      );
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
  },

  methods: {
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
      try {
        if (this.editTarget) {
          await this.inventory.patchMutation.mutateAsync({
            id: this.editTarget.id,
            input: {
              displayName: this.form.displayName,
              description: this.form.description || null,
              refreshIntervalHours: this.form.refreshIntervalHours,
            },
          });
        } else {
          if (!this.form.sourceIdentifier.trim() || !this.form.displayName.trim()) {
            this.$q.notify({
              type: "negative",
              message: this.$t("settings.inventory.errors.required") as string,
            });
            return;
          }
          await this.inventory.createMutation.mutateAsync({
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
      } catch (err) {
        this.$q.notify({
          type: "negative",
          message: err instanceof Error ? err.message : "save_failed",
        });
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
          await this.inventory.deleteMutation.mutateAsync(row.id);
          this.$q.notify({
            type: "positive",
            message: this.$t("settings.inventory.deletedSuccess") as string,
          });
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
        await this.inventory.refreshRowMutation.mutateAsync(id);
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
      try {
        await this.inventory.refreshAllMutation.mutateAsync(undefined);
        this.$q.notify({
          type: "positive",
          message: this.$t("settings.inventory.refreshAllEnqueued") as string,
        });
      } catch (err) {
        this.$q.notify({
          type: "negative",
          message: err instanceof Error ? err.message : "refresh_failed",
        });
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
</style>
