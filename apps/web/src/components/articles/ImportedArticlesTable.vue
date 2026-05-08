<template>
  <q-table
    :rows="paddedRows"
    :columns="columns"
    row-key="key"
    :pagination="{ rowsPerPage: 20 }"
    flat
    dense
    @row-click="(_, row) => onRowClick(row)"
  >
    <template #body-cell-deTitle="props">
      <q-td :props="props">
        <span v-if="props.row.de">{{ props.row.de.title || props.row.de.slug }}</span>
        <span v-else class="text-grey-5">—</span>
      </q-td>
    </template>

    <template #body-cell-enTitle="props">
      <q-td :props="props">
        <span v-if="props.row.en">{{ props.row.en.title || props.row.en.slug }}</span>
        <span v-else class="text-grey-5">—</span>
      </q-td>
    </template>

    <template #body-cell-deSlug="props">
      <q-td :props="props">
        <code v-if="props.row.de" class="text-caption">{{ props.row.de.slug }}</code>
        <span v-else class="text-grey-5">—</span>
      </q-td>
    </template>

    <template #body-cell-enSlug="props">
      <q-td :props="props">
        <code v-if="props.row.en" class="text-caption">{{ props.row.en.slug }}</code>
        <span v-else class="text-grey-5">—</span>
      </q-td>
    </template>

    <template #body-cell-publishedAt="props">
      <q-td :props="props">
        <span v-if="props.row.de?.publishedAt">
          {{ new Date(props.row.de.publishedAt).toLocaleDateString() }}
        </span>
        <span v-else class="text-grey-5">—</span>
      </q-td>
    </template>
  </q-table>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import type { QTableProps } from "quasar";

type ImportedArticleRow = {
  id: string;
  collection: string;
  locale: string;
  slug: string;
  title: string | null;
  category: string | null;
  subcategory: string | null;
  author: string | null;
  tags: string[] | null;
  publishedAt: string | null;
  frontmatterUpdatedAt: string | null;
  frontmatterExtras: Record<string, unknown>;
};

type Pair = {
  translationKey: string | null;
  de: ImportedArticleRow | null;
  en: ImportedArticleRow | null;
};

type PaddedPair = Pair & { key: string };

type ColDef = {
  name: string;
  label: string;
  field: string | ((row: Pair) => unknown);
};

const COLLECTION_COLUMNS: Record<string, ColDef[]> = {
  blog: [
    { name: "deTitle", label: "Title (DE)", field: "de.title" },
    { name: "enTitle", label: "Title (EN)", field: "en.title" },
    { name: "category", label: "Category", field: (r) => r.de?.category ?? "—" },
    { name: "author", label: "Author", field: (r) => r.de?.author ?? "—" },
    { name: "publishedAt", label: "Published", field: "de.publishedAt" },
  ],
  "ki-wissen": [
    { name: "deTitle", label: "Title (DE)", field: "de.title" },
    { name: "enTitle", label: "Title (EN)", field: "en.title" },
    { name: "category", label: "Category", field: (r) => r.de?.category ?? "—" },
    { name: "deSlug", label: "Slug (DE)", field: "de.slug" },
    { name: "enSlug", label: "Slug (EN)", field: "en.slug" },
  ],
  comparisons: [
    { name: "deTitle", label: "Title (DE)", field: "de.title" },
    { name: "enTitle", label: "Title (EN)", field: "en.title" },
    {
      name: "toolSlugs",
      label: "Tools",
      field: (r) => ((r.de?.frontmatterExtras?.toolSlugs ?? []) as string[]).join(", "),
    },
    { name: "winner", label: "Winner", field: (r) => r.de?.frontmatterExtras?.winner ?? "—" },
  ],
  usecases: [
    { name: "deTitle", label: "Title (DE)", field: "de.title" },
    { name: "enTitle", label: "Title (EN)", field: "en.title" },
    { name: "category", label: "Category", field: (r) => r.de?.category ?? "—" },
  ],
  tools: [
    { name: "deTitle", label: "Tool (DE)", field: "de.title" },
    { name: "enTitle", label: "Tool (EN)", field: "en.title" },
    { name: "category", label: "Category", field: (r) => r.de?.category ?? "—" },
    { name: "subcategory", label: "Subcategory", field: (r) => r.de?.subcategory ?? "—" },
    { name: "pricing", label: "Pricing", field: (r) => r.de?.frontmatterExtras?.pricing ?? "—" },
    { name: "rating", label: "Rating", field: (r) => r.de?.frontmatterExtras?.rating ?? "—" },
  ],
  "tool-categories": [
    { name: "deTitle", label: "Title (DE)", field: "de.title" },
    { name: "enTitle", label: "Title (EN)", field: "en.title" },
    { name: "deSlug", label: "Slug (DE)", field: "de.slug" },
    { name: "enSlug", label: "Slug (EN)", field: "en.slug" },
  ],
  authors: [
    { name: "deTitle", label: "Author (DE)", field: "de.title" },
    { name: "enTitle", label: "Author (EN)", field: "en.title" },
    { name: "deSlug", label: "Slug", field: "de.slug" },
  ],
  "special-landings": [
    { name: "deTitle", label: "Title (DE)", field: "de.title" },
    { name: "enTitle", label: "Title (EN)", field: "en.title" },
    { name: "deSlug", label: "Slug", field: "de.slug" },
  ],
};

export default defineComponent({
  name: "ImportedArticlesTable",

  emits: ["row-click"],

  props: {
    collection: { type: String, required: true },
    pairs: { type: Array as PropType<Pair[]>, required: true },
  },

  computed: {
    paddedRows(): PaddedPair[] {
      return this.pairs.map((p, idx) => ({
        ...p,
        key: p.translationKey ?? `${p.de?.id ?? p.en?.id ?? idx}`,
      }));
    },

    columns(): QTableProps["columns"] {
      const config = COLLECTION_COLUMNS[this.collection] ?? COLLECTION_COLUMNS["blog"]!;
      return config.map((c) => ({ ...c, align: "left" as const }));
    },
  },

  methods: {
    onRowClick(row: PaddedPair): void {
      const articleId = row.de?.id ?? row.en?.id;
      if (articleId) this.$emit("row-click", articleId);
    },
  },
});
</script>
