<template>
  <div class="tool-picker">
    <q-select
      v-model="selected"
      :options="filteredOptions"
      :loading="loading"
      :multiple="multiple"
      :max-values="maxValues"
      :label="label"
      use-input
      use-chips
      dense
      outlined
      dark
      clearable
      hide-dropdown-icon
      input-debounce="150"
      option-value="id"
      option-label="title"
      emit-value
      map-options
      :hint="hint"
      @filter="onFilter"
    >
      <template #no-option>
        <q-item>
          <q-item-section class="text-grey">
            {{ $t("recurringContent.wizard.config.toolPicker.noOptions") as string }}
          </q-item-section>
        </q-item>
      </template>
    </q-select>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import { apiGet } from "src/lib/api";

interface ToolOption {
  id: string;
  slug: string;
  title: string;
}

export default defineComponent({
  name: "ToolPicker",

  props: {
    modelValue: {
      type: [String, Array] as PropType<string | string[] | null>,
      default: null,
    },
    multiple: { type: Boolean, default: false },
    maxValues: { type: Number, default: 100 },
    label: { type: String, default: "" },
    hint: { type: String, default: "" },
    locale: { type: String, default: "de" },
  },

  emits: ["update:modelValue"],

  data: () => ({
    options: [] as ToolOption[],
    filteredOptions: [] as ToolOption[],
    loading: false,
  }),

  computed: {
    slug(): string {
      const v = this.$route.params.slug;
      return Array.isArray(v) ? (v[0] ?? "") : v ?? "";
    },
    selected: {
      get(): string | string[] | null {
        return this.modelValue;
      },
      set(v: string | string[] | null) {
        this.$emit("update:modelValue", v);
      },
    },
  },

  async mounted() {
    await this.fetchTools();
  },

  methods: {
    async fetchTools(): Promise<void> {
      if (this.options.length || this.loading) return;
      this.loading = true;
      try {
        const data = await apiGet<{ items: ToolOption[] }>(
          `/projects/${this.slug}/articles?collection=tools&locale=${this.locale}&limit=500`,
        );
        this.options = (data.items ?? [])
          .filter((t) => typeof t.id === "string" && t.id.length > 0)
          .map((t) => ({ id: t.id, slug: t.slug, title: t.title ?? t.slug }))
          .sort((a, b) => a.title.localeCompare(b.title));
        this.filteredOptions = this.options;
      } catch (err) {
        this.options = [];
        this.filteredOptions = [];
        this.$q.notify({
          type: "negative",
          message:
            err instanceof Error
              ? err.message
              : (this.$t("recurringContent.wizard.config.toolPicker.loadError") as string),
        });
      } finally {
        this.loading = false;
      }
    },

    // q-select autocomplete filter signature (q-select calls back with done()).
    onFilter(needle: string, done: (cb: () => void) => void): void {
      const lower = needle.toLowerCase();
      done(() => {
        this.filteredOptions = !lower
          ? this.options
          : this.options.filter(
              (t) =>
                t.title.toLowerCase().includes(lower) ||
                t.slug.toLowerCase().includes(lower),
            );
      });
    },
  },
});
</script>

<style scoped>
.tool-picker {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>
