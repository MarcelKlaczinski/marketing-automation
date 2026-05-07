<template>
  <q-dialog :model-value="modelValue" persistent @update:model-value="$emit('update:modelValue', $event)">
    <q-card style="width: 720px; max-width: 95vw;">
      <q-card-section class="row items-center">
        <div class="text-h6">{{ $t('projects.create.title') }}</div>
        <q-space />
        <q-btn icon="close" flat round dense @click="onClose" />
      </q-card-section>

      <q-card-section>
        <q-stepper
          v-model="step"
          color="primary"
          animated
          flat
          header-nav
        >
          <q-step
            :name="1"
            :title="$t('projects.create.basicsStep')"
            icon="info"
            :done="step > 1"
          >
            <div class="q-gutter-md">
              <q-input
                v-model="form.name"
                :label="$t('projects.create.name')"
                outlined
                :rules="[(v: string) => !!v || $t('common.required') as string]"
              />
              <q-input
                v-model="form.slug"
                :label="$t('projects.create.slug')"
                outlined
                :hint="$t('projects.create.slugHint')"
                :rules="[
                  (v: string) => !!v || $t('common.required') as string,
                  (v: string) => /^[a-z0-9-]+$/.test(v) || $t('projects.create.slugInvalid') as string,
                ]"
              />
              <q-select
                v-model="form.industry"
                :label="$t('projects.create.industry')"
                outlined
                :options="industryOptions"
                emit-value
                map-options
              />
              <q-select
                v-model="form.pipelineTemplate"
                :label="$t('projects.create.pipelineTemplate')"
                outlined
                :options="templateOptions"
                emit-value
                map-options
              />
            </div>
          </q-step>

          <q-step
            :name="2"
            :title="$t('projects.create.contextStep')"
            icon="description"
          >
            <p class="text-body2 q-mb-md">{{ $t('projects.create.contextIntro') }}</p>
            <MarkdownEditor
              v-model="form.marketingContextMd"
              :height="320"
            />
          </q-step>
        </q-stepper>
      </q-card-section>

      <q-card-actions align="right" class="q-pa-md">
        <q-btn
          v-if="step > 1"
          flat
          :label="$t('common.back')"
          @click="step--"
        />
        <q-btn
          v-if="step < 2"
          color="primary"
          :label="$t('common.next')"
          :disable="!canProceedToContext"
          @click="step++"
        />
        <q-btn
          v-if="step === 2"
          color="primary"
          :label="$t('projects.create.createButton')"
          :loading="creating"
          @click="onCreate"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import MarkdownEditor from "src/components/common/MarkdownEditor.vue";
import { useNotify } from "src/composables/useNotify";
import { HttpError } from "src/lib/http-error";
import { useProjectsStore } from "src/stores/projects";
import { defineComponent } from "vue";

export default defineComponent({
  name: "ProjectCreateDialog",

  components: { MarkdownEditor },

  props: {
    modelValue: { type: Boolean, default: false },
  },

  emits: ["update:modelValue", "created"],

  setup() {
    return {
      projectsStore: useProjectsStore(),
      notify: useNotify(),
    };
  },

  data: () => ({
    step: 1,
    creating: false,
    lastAutoSlug: "",
    form: {
      name: "",
      slug: "",
      industry: "ai_education",
      pipelineTemplate: "educational",
      marketingContextMd: "",
    },
  }),

  computed: {
    industryOptions() {
      return [
        "ai_education",
        "automotive_dealer",
        "renewable_affiliate",
        "music_school",
        "other",
      ].map((v) => ({
        label: this.$t(`industries.${v}`),
        value: v,
      }));
    },

    templateOptions() {
      return ["educational", "affiliate_review", "local_business", "programmatic_seo"].map((v) => ({
        label: this.$t(`pipelineTemplates.${v}`),
        value: v,
      }));
    },

    canProceedToContext(): boolean {
      return !!this.form.name && !!this.form.slug && /^[a-z0-9-]+$/.test(this.form.slug);
    },
  },

  watch: {
    "form.name"(newName: string): void {
      if (!this.form.slug || this.form.slug === this.lastAutoSlug) {
        const suggested = newName
          .toLowerCase()
          .replace(/ä/g, "ae")
          .replace(/ö/g, "oe")
          .replace(/ü/g, "ue")
          .replace(/ß/g, "ss")
          .normalize("NFD")
          .replace(/\p{M}/gu, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "");
        this.form.slug = suggested;
        this.lastAutoSlug = suggested;
      }
    },
  },

  methods: {
    onClose(): void {
      this.reset();
      this.$emit("update:modelValue", false);
    },

    reset(): void {
      this.step = 1;
      this.creating = false;
      this.lastAutoSlug = "";
      this.form = {
        name: "",
        slug: "",
        industry: "ai_education",
        pipelineTemplate: "educational",
        marketingContextMd: "",
      };
    },

    async onCreate(): Promise<void> {
      this.creating = true;
      try {
        const payload: {
          slug: string;
          name: string;
          industry: string;
          pipelineTemplate: string;
          marketingContextMd?: string;
        } = {
          slug: this.form.slug,
          name: this.form.name,
          industry: this.form.industry,
          pipelineTemplate: this.form.pipelineTemplate,
        };
        if (this.form.marketingContextMd) {
          payload.marketingContextMd = this.form.marketingContextMd;
        }
        const created = await this.projectsStore.create(payload);
        this.notify.success(this.$t("projects.create.success", { name: created.name }));
        this.$emit("created", created.slug);
        this.reset();
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      } finally {
        this.creating = false;
      }
    },
  },
});
</script>
