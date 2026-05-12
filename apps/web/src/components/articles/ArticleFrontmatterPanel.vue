<template>
  <div>
    <!-- ── YAML preview ───────────────────────────────────────────────────────── -->
    <q-card flat bordered class="q-mb-md">
      <q-card-section class="q-pb-none">
        <div class="row items-center">
          <div class="col text-subtitle2">{{ $t('articles.frontmatter.title') }}</div>
          <div class="col-auto">
            <q-btn flat dense round icon="content_copy" size="sm"
              :aria-label="$t('articles.frontmatter.copy') as string"
              @click="onCopy" />
          </div>
        </div>
      </q-card-section>
      <q-card-section>
        <pre v-if="frontmatterYaml" class="frontmatter-code">{{ frontmatterYaml }}</pre>
        <q-skeleton v-else-if="loading" type="rect" height="140px" />
        <div v-else class="text-grey-6 text-caption">{{ $t('articles.frontmatter.empty') }}</div>
      </q-card-section>
    </q-card>

    <!-- ── No schema warning ──────────────────────────────────────────────────── -->
    <q-banner v-if="!loading && !hasSchema" rounded class="bg-warning text-dark q-mb-md">
      <template #avatar>
        <q-icon name="warning" />
      </template>
      {{ $t('articles.frontmatter.noSchema') }}
      <template #action>
        <q-btn
          flat dense
          icon="cloud_download"
          :label="$t('articles.frontmatter.runImport') as string"
          :loading="importing"
          @click="onRunImport"
        />
      </template>
    </q-banner>

    <!-- ── Structured field editor ───────────────────────────────────────────── -->
    <q-card v-if="hasSchema" flat bordered class="q-mb-md">
      <q-card-section>
        <div class="row items-center q-mb-md">
          <div class="col text-subtitle2">{{ $t('articles.frontmatter.fieldsTitle') }}</div>
          <div class="col-auto">
            <q-btn
              flat dense
              icon="auto_fix_high"
              color="primary"
              :label="$t('articles.frontmatter.suggestAll') as string"
              :loading="suggesting"
              @click="onSuggestAll"
            />
          </div>
        </div>

        <!-- Enum fields (category, intentType, etc.) -->
        <div v-for="field in enumFields" :key="field.name" class="q-mb-md">
          <div class="row items-center q-gutter-sm">
            <q-select
              v-model="extras[field.name]"
              :options="field.enumValues"
              :label="fieldLabel(field.name)"
              :hint="suggestReason(field.name)"
              outlined dense emit-value map-options
              class="col"
            />
            <q-icon
              v-if="suggestReason(field.name)"
              name="info_outline"
              color="primary"
              size="sm"
              class="col-auto cursor-pointer"
            >
              <q-tooltip>{{ suggestReason(field.name) }}</q-tooltip>
            </q-icon>
          </div>
        </div>

        <!-- String array fields (tags) -->
        <div v-for="field in stringArrayFields" :key="field.name" class="q-mb-md">
          <div class="text-caption text-grey-7 q-mb-xs">{{ fieldLabel(field.name) }}</div>
          <div class="row items-center q-gutter-xs q-mb-xs flex-wrap">
            <q-chip
              v-for="(tag, i) in (extrasArray(field.name))"
              :key="i"
              removable
              @remove="removeTag(field.name, i)"
              dense
              color="primary"
              text-color="white"
            >
              {{ tag }}
            </q-chip>
            <q-input
              v-model="tagInput[field.name]"
              dense borderless
              :placeholder="$t('articles.frontmatter.addTag') as string"
              class="tag-input"
              @keydown.enter.prevent="addTag(field.name)"
              @keydown.comma.prevent="addTag(field.name)"
            />
          </div>
          <div v-if="suggestReason(field.name)" class="text-caption text-primary">
            <q-icon name="info_outline" size="xs" /> {{ suggestReason(field.name) }}
          </div>
        </div>

        <!-- Object array fields (faq) -->
        <div v-for="field in objectArrayFields" :key="field.name" class="q-mb-md">
          <div class="row items-center q-mb-sm">
            <div class="col text-caption text-grey-7">
              {{ fieldLabel(field.name) }}
              <span class="q-ml-xs text-grey-5">({{ extrasObjectArray(field.name).length }})</span>
            </div>
            <q-btn flat dense size="xs" icon="add" :label="$t('articles.frontmatter.addItem') as string"
              @click="addFaqItem(field.name)" />
          </div>

          <div v-for="(item, i) in extrasObjectArray(field.name)" :key="i" class="faq-item q-mb-sm">
            <div class="row items-center">
              <div class="col text-caption text-grey-6 q-mb-xs">{{ i + 1 }}.</div>
              <q-btn flat round dense size="xs" icon="delete" color="negative"
                @click="removeFaqItem(field.name, i)" />
            </div>
            <q-input :model-value="item['question'] as string" dense outlined
              :label="$t('articles.frontmatter.faqQuestion') as string" class="q-mb-xs"
              @update:model-value="(v) => { item['question'] = v }" />
            <q-input :model-value="item['answer'] as string" dense outlined type="textarea" autogrow
              :label="$t('articles.frontmatter.faqAnswer') as string"
              @update:model-value="(v) => { item['answer'] = v }" />
          </div>
        </div>

        <!-- Save button -->
        <div class="row justify-end q-mt-sm">
          <q-btn
            color="primary"
            :label="$t('common.save') as string"
            :loading="saving"
            :disable="!hasChanges"
            @click="onSave"
          />
        </div>
      </q-card-section>
    </q-card>

    <!-- ── Local Astro preview ────────────────────────────────────────────────── -->
    <q-btn
      color="secondary"
      icon="open_in_new"
      :label="$t('articles.frontmatter.previewBtn') as string"
      :loading="previewing"
      :disable="!frontmatterYaml"
      @click="onPreview"
    />
    <div class="text-caption text-grey-6 q-mt-xs">
      {{ $t('articles.frontmatter.previewHint') }}
    </div>
  </div>
</template>

<script lang="ts">
import { api } from "src/lib/api-client";
import { HttpError } from "src/lib/http-error";
import { defineComponent } from "vue";

interface FrontmatterField {
  name: string;
  type: string;
  required: boolean;
  hasDefault: boolean;
  enumValues?: string[];
  objectShape?: string;
}

interface FrontmatterSuggestions {
  values: Record<string, unknown>;
  reasoning: Record<string, string>;
  enumOptions: Record<string, string[]>;
}

function articleId(detail: Record<string, unknown>): string {
  return (detail.article as { id: string }).id;
}

function projectSlug(detail: Record<string, unknown>): string {
  return (detail.article as { projectSlug: string }).projectSlug;
}

export default defineComponent({
  name: "ArticleFrontmatterPanel",

  props: {
    detail: { type: Object, required: true },
  },

  data: () => ({
    frontmatterYaml: null as string | null,
    slug: "",
    schema: null as FrontmatterField[] | null,
    // Current extras — working copy edited in-place
    extras: {} as Record<string, unknown>,
    // Snapshot at load time — for hasChanges detection
    _extrasSnapshot: "",
    suggestions: null as FrontmatterSuggestions | null,
    tagInput: {} as Record<string, string>,
    loading: false,
    saving: false,
    suggesting: false,
    previewing: false,
    importing: false,
  }),

  computed: {
    hasSchema(): boolean {
      return !!(this.schema?.length);
    },

    enumFields(): FrontmatterField[] {
      return (this.schema ?? []).filter(
        (f) => f.enumValues?.length && f.type === "string"
      );
    },

    stringArrayFields(): FrontmatterField[] {
      return (this.schema ?? []).filter((f) => f.type === "string_array");
    },

    objectArrayFields(): FrontmatterField[] {
      return (this.schema ?? []).filter((f) => f.type === "object_array");
    },

    hasChanges(): boolean {
      return JSON.stringify(this.extras) !== this._extrasSnapshot;
    },
  },

  created() {
    void this.loadFrontmatter();
  },

  methods: {
    async loadFrontmatter(): Promise<void> {
      this.loading = true;
      try {
        const id = articleId(this.detail as Record<string, unknown>);
        const res = await api.get<{
          ok: boolean;
          data: {
            yaml: string;
            slug: string;
            extras: Record<string, unknown>;
            schema: FrontmatterField[] | null;
          };
        }>(`/articles/${id}/frontmatter`);

        this.frontmatterYaml = res.data.data.yaml;
        this.slug = res.data.data.slug;
        this.schema = res.data.data.schema ?? null;
        this.extras = JSON.parse(JSON.stringify(res.data.data.extras ?? {})) as Record<string, unknown>;
        this._extrasSnapshot = JSON.stringify(this.extras);

        // Ensure object_array fields are arrays
        for (const f of this.objectArrayFields) {
          if (!Array.isArray(this.extras[f.name])) {
            this.extras[f.name] = [];
          }
        }
        for (const f of this.stringArrayFields) {
          if (!Array.isArray(this.extras[f.name])) {
            this.extras[f.name] = [];
          }
        }
      } catch {
        this.frontmatterYaml = null;
      } finally {
        this.loading = false;
      }
    },

    fieldLabel(name: string): string {
      const labels: Record<string, string> = {
        category: this.$t("articles.frontmatter.fields.category") as string,
        intentType: this.$t("articles.frontmatter.fields.intentType") as string,
        tags: this.$t("articles.frontmatter.fields.tags") as string,
        faq: this.$t("articles.frontmatter.fields.faq") as string,
        clusterRole: this.$t("articles.frontmatter.fields.clusterRole") as string,
      };
      return labels[name] ?? name;
    },

    suggestReason(fieldName: string): string {
      return (this.suggestions?.reasoning?.[fieldName] as string | undefined) ?? "";
    },

    extrasArray(fieldName: string): string[] {
      const val = this.extras[fieldName];
      return Array.isArray(val) ? (val as string[]) : [];
    },

    extrasObjectArray(fieldName: string): Record<string, unknown>[] {
      const val = this.extras[fieldName];
      return Array.isArray(val) ? (val as Record<string, unknown>[]) : [];
    },

    addTag(fieldName: string): void {
      const val = (this.tagInput[fieldName] ?? "").trim();
      if (!val) return;
      if (!Array.isArray(this.extras[fieldName])) this.extras[fieldName] = [];
      (this.extras[fieldName] as string[]).push(val);
      this.tagInput[fieldName] = "";
    },

    removeTag(fieldName: string, idx: number): void {
      const arr = this.extras[fieldName] as string[];
      arr.splice(idx, 1);
    },

    addFaqItem(fieldName: string): void {
      if (!Array.isArray(this.extras[fieldName])) this.extras[fieldName] = [];
      (this.extras[fieldName] as Record<string, unknown>[]).push({ question: "", answer: "" });
    },

    removeFaqItem(fieldName: string, idx: number): void {
      const arr = this.extras[fieldName] as Record<string, unknown>[];
      arr.splice(idx, 1);
    },

    async onSuggestAll(): Promise<void> {
      this.suggesting = true;
      try {
        const id = articleId(this.detail as Record<string, unknown>);
        const res = await api.post<{ ok: boolean; data: FrontmatterSuggestions }>(
          `/articles/${id}/frontmatter-suggest`
        );
        this.suggestions = res.data.data;

        // Fill in missing fields (or all if extras is empty)
        const isEmpty = Object.keys(this.extras).length === 0;
        for (const [key, value] of Object.entries(res.data.data.values)) {
          if (isEmpty || !(key in this.extras)) {
            this.extras[key] = value;
          }
        }

        // Auto-save immediately — suggestions cost money, data must not be lost on tab close
        await api.patch(`/articles/${id}/frontmatter-extras`, { extras: this.extras });
        this._extrasSnapshot = JSON.stringify(this.extras);
        await this.loadFrontmatter();

        this.$q.notify({
          type: "positive",
          message: this.$t("articles.frontmatter.suggestDone") as string,
        });
      } catch (e) {
        const msg = e instanceof HttpError ? e.userMessage : this.$t("articles.frontmatter.suggestError") as string;
        this.$q.notify({ type: "negative", message: msg });
      } finally {
        this.suggesting = false;
      }
    },

    async onSave(): Promise<void> {
      this.saving = true;
      try {
        const id = articleId(this.detail as Record<string, unknown>);
        await api.patch(`/articles/${id}/frontmatter-extras`, { extras: this.extras });
        this._extrasSnapshot = JSON.stringify(this.extras);
        // Reload YAML preview to reflect saved values
        await this.loadFrontmatter();
        this.$q.notify({
          type: "positive",
          message: this.$t("articles.frontmatter.saveSuccess") as string,
        });
      } catch (e) {
        const msg = e instanceof HttpError ? e.userMessage : "";
        if (msg) this.$q.notify({ type: "negative", message: msg });
      } finally {
        this.saving = false;
      }
    },

    async onRunImport(): Promise<void> {
      this.importing = true;
      try {
        const slug = projectSlug(this.detail as Record<string, unknown>);
        await api.post(`/projects/${slug}/astro-import`, {});
        this.$q.notify({
          type: "positive",
          message: this.$t("articles.frontmatter.importStarted") as string,
        });
        // Poll for schema availability — retry loadFrontmatter after a short delay
        setTimeout(() => { void this.loadFrontmatter(); }, 8000);
      } catch (e) {
        const msg = e instanceof HttpError ? e.userMessage : this.$t("articles.frontmatter.importError") as string;
        this.$q.notify({ type: "negative", message: msg });
      } finally {
        this.importing = false;
      }
    },

    onCopy(): void {
      void navigator.clipboard.writeText(this.frontmatterYaml ?? "");
      this.$q.notify({
        type: "positive",
        message: this.$t("articles.frontmatter.copied") as string,
      });
    },

    async onPreview(): Promise<void> {
      this.previewing = true;
      try {
        const id = articleId(this.detail as Record<string, unknown>);
        const res = await api.post<{ ok: boolean; data: { url: string; slug: string; repoPath: string } }>(
          `/articles/${id}/local-preview`
        );
        window.open(res.data.data.url, "_blank");
      } catch (e) {
        const msg = e instanceof HttpError ? e.userMessage : this.$t("articles.frontmatter.previewHint") as string;
        this.$q.notify({ type: "negative", message: msg });
      } finally {
        this.previewing = false;
      }
    },
  },
});
</script>

<style lang="scss" scoped>
.frontmatter-code {
  font-family: 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
  background: var(--q-grey-1, #fafafa);
  padding: 12px;
  border-radius: 4px;
  overflow-x: auto;
  white-space: pre;
  color: var(--q-text-primary, rgba(0,0,0,0.87));
  margin: 0;
}

body.body--dark .frontmatter-code {
  background: rgba(255,255,255,0.05);
  color: rgba(255,255,255,0.87);
}

.tag-input {
  min-width: 80px;
  max-width: 160px;
}

.faq-item {
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 6px;
  padding: 10px;

  body.body--dark & {
    border-color: rgba(255,255,255,0.1);
  }
}
</style>
