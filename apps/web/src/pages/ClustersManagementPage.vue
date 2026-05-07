<template>
  <q-page padding>
    <ProjectPauseBanner :slug="slug" />

    <div class="row items-center q-mb-lg">
      <div class="col">
        <q-breadcrumbs class="text-body2 q-mb-xs">
          <q-breadcrumbs-el :label="$t('projects.title')" :to="{ name: 'projects' }" />
          <q-breadcrumbs-el
            :label="projectName ?? slug"
            :to="{ name: 'project-detail', params: { slug } }"
          />
          <q-breadcrumbs-el :label="$t('clusters.pageTitle')" />
        </q-breadcrumbs>
        <h1 class="text-h5 q-my-none">{{ $t('clusters.pageTitle') }}</h1>
      </div>
      <div class="col-auto">
        <q-btn
          color="primary"
          icon="add"
          :label="$t('clusters.actions.newPillar') as string"
          @click="onCreatePillar"
        />
      </div>
    </div>

    <div v-if="loading && pillars.length === 0" class="text-center q-pa-xl">
      <q-spinner size="3em" color="primary" />
    </div>

    <div v-else-if="pillars.length === 0" class="empty-state">
      <q-icon name="account_tree" size="64px" color="grey-5" />
      <p class="text-body1 q-mt-md">{{ $t('clusters.empty') }}</p>
      <p class="text-caption text-grey-7">{{ $t('clusters.emptyHint') }}</p>
    </div>

    <div v-else class="pillar-list">
      <PillarSection
        v-for="(pillar, idx) in pillars"
        :key="pillar.id"
        :pillar="pillar"
        :clusters="clustersByPillar[pillar.id] ?? []"
        :all-clusters="allClusters"
        :all-pillars="pillars"
        :is-first="idx === 0"
        :is-last="idx === pillars.length - 1"
        :slug="slug"
        @rename="onRenamePillar"
        @delete="onDeletePillar"
        @move="onMovePillar"
        @cluster-create="onCreateCluster"
        @cluster-rename="onRenameCluster"
        @cluster-delete="onDeleteCluster"
        @cluster-move="onMoveCluster"
        @cluster-change-pillar="onChangeClusterPillar"
        @cluster-move-articles="onMoveArticlesDialog"
      />
    </div>

    <ClusterCreateDialog
      v-model="createPillarDialog.open"
      :title="$t('clusters.dialogs.createPillar') as string"
      :name-label="$t('clusters.fields.pillarName') as string"
      :description-field="true"
      @confirm="confirmCreatePillar"
    />

    <ClusterCreateDialog
      v-model="createClusterDialog.open"
      :title="$t('clusters.dialogs.createCluster') as string"
      :name-label="$t('clusters.fields.clusterName') as string"
      :extra-field-label="$t('clusters.fields.primaryKeyword') as string"
      :extra-field-optional="true"
      @confirm="confirmCreateCluster"
    />

    <ConfirmDeleteDialog
      v-model="deletePillarDialog.open"
      :title="$t('clusters.dialogs.deletePillar') as string"
      :message="$t('clusters.dialogs.deletePillarMessage', { name: deletePillarDialog.pillarName }) as string"
      :loading="deletePillarDialog.loading"
      @confirm="confirmDeletePillar"
    />

    <ConfirmDeleteDialog
      v-model="deleteClusterDialog.open"
      :title="$t('clusters.dialogs.deleteCluster') as string"
      :message="deleteClusterDialog.message"
      :loading="deleteClusterDialog.loading"
      @confirm="confirmDeleteCluster"
    />

    <ArticleMoveDialog
      v-model="moveArticlesDialog.open"
      :slug="slug"
      :from-cluster="moveArticlesDialog.cluster"
      :all-clusters="allClusters"
      @confirm="confirmMoveArticles"
    />
  </q-page>
</template>

<script lang="ts">
import ArticleMoveDialog from "src/components/clusters/ArticleMoveDialog.vue";
import ClusterCreateDialog from "src/components/clusters/ClusterCreateDialog.vue";
import PillarSection from "src/components/clusters/PillarSection.vue";
import ConfirmDeleteDialog from "src/components/common/ConfirmDeleteDialog.vue";
import ProjectPauseBanner from "src/components/common/ProjectPauseBanner.vue";
import { useNotify } from "src/composables/useNotify";
import { HttpError } from "src/lib/http-error";
import { type Cluster, useClustersStore } from "src/stores/clusters";
import { type Pillar, usePillarsStore } from "src/stores/pillars";
import { useProjectsStore } from "src/stores/projects";
import { defineComponent } from "vue";

export default defineComponent({
  name: "ClustersManagementPage",

  components: {
    PillarSection,
    ClusterCreateDialog,
    ConfirmDeleteDialog,
    ArticleMoveDialog,
    ProjectPauseBanner,
  },

  props: {
    slug: { type: String, required: true },
  },

  setup() {
    return {
      pillarsStore: usePillarsStore(),
      clustersStore: useClustersStore(),
      projectsStore: useProjectsStore(),
      notify: useNotify(),
    };
  },

  data: () => ({
    createPillarDialog: { open: false },
    createClusterDialog: { open: false, pillarId: null as string | null },
    deletePillarDialog: {
      open: false,
      pillarId: null as string | null,
      pillarName: "",
      loading: false,
    },
    deleteClusterDialog: {
      open: false,
      clusterId: null as string | null,
      message: "",
      loading: false,
    },
    moveArticlesDialog: { open: false, cluster: null as Cluster | null },
  }),

  computed: {
    pillars(): Pillar[] {
      return this.pillarsStore.byProject[this.slug] ?? [];
    },

    allClusters(): Cluster[] {
      return this.clustersStore.byProject[this.slug] ?? [];
    },

    clustersByPillar(): Record<string, Cluster[]> {
      const result: Record<string, Cluster[]> = {};
      for (const c of this.allClusters) {
        if (!result[c.pillarId]) result[c.pillarId] = [];
        result[c.pillarId]!.push(c);
      }
      return result;
    },

    loading(): boolean {
      return this.pillarsStore.loading || this.clustersStore.loading;
    },

    projectName(): string | null {
      return this.projectsStore.list.find((p) => p.slug === this.slug)?.name ?? null;
    },
  },

  async created() {
    if (this.projectsStore.list.length === 0) {
      await this.projectsStore.fetchList();
    }
    await Promise.all([
      this.pillarsStore.fetchForProject(this.slug),
      this.clustersStore.fetchForProject(this.slug),
    ]);
  },

  methods: {
    onCreatePillar(): void {
      this.createPillarDialog = { open: true };
    },

    async confirmCreatePillar(payload: { name: string; description?: string }): Promise<void> {
      try {
        await this.pillarsStore.create(this.slug, payload.name, payload.description);
        this.notify.success(this.$t("clusters.notify.pillarCreated") as string);
        this.createPillarDialog.open = false;
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      }
    },

    async onRenamePillar(payload: {
      id: string;
      name: string;
      description: string | null;
    }): Promise<void> {
      try {
        await this.pillarsStore.update(this.slug, payload.id, {
          name: payload.name,
          description: payload.description,
        });
        this.notify.success(this.$t("clusters.notify.pillarUpdated") as string);
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      }
    },

    onDeletePillar(pillar: Pillar): void {
      if (pillar.clusterCount > 0) {
        this.notify.warn(
          this.$t("clusters.notify.cannotDeletePillarWithClusters", {
            count: pillar.clusterCount,
          }) as string
        );
        return;
      }
      this.deletePillarDialog = {
        open: true,
        pillarId: pillar.id,
        pillarName: pillar.name,
        loading: false,
      };
    },

    async confirmDeletePillar(): Promise<void> {
      if (!this.deletePillarDialog.pillarId) return;
      this.deletePillarDialog.loading = true;
      try {
        const result = await this.pillarsStore.delete(this.slug, this.deletePillarDialog.pillarId);
        if (result.deleted) {
          this.notify.success(this.$t("clusters.notify.pillarDeleted") as string);
          this.deletePillarDialog.open = false;
        } else {
          this.notify.warn(
            this.$t("clusters.notify.cannotDeletePillarWithClusters", {
              count: result.clusterCount ?? 0,
            }) as string
          );
          this.deletePillarDialog.open = false;
        }
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      } finally {
        this.deletePillarDialog.loading = false;
      }
    },

    async onMovePillar(payload: { id: string; direction: "up" | "down" }): Promise<void> {
      try {
        await this.pillarsStore.move(this.slug, payload.id, payload.direction);
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      }
    },

    onCreateCluster(pillarId: string): void {
      this.createClusterDialog = { open: true, pillarId };
    },

    async confirmCreateCluster(payload: { name: string; extra?: string }): Promise<void> {
      if (!this.createClusterDialog.pillarId) return;
      try {
        await this.clustersStore.create(
          this.slug,
          this.createClusterDialog.pillarId,
          payload.name,
          payload.extra
        );
        this.notify.success(this.$t("clusters.notify.clusterCreated") as string);
        this.createClusterDialog.open = false;
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      }
    },

    async onRenameCluster(payload: {
      id: string;
      name: string;
      primaryKeyword: string | null;
    }): Promise<void> {
      try {
        await this.clustersStore.update(this.slug, payload.id, {
          name: payload.name,
          primaryKeyword: payload.primaryKeyword,
        });
        this.notify.success(this.$t("clusters.notify.clusterUpdated") as string);
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      }
    },

    onDeleteCluster(cluster: Cluster): void {
      this.deleteClusterDialog = {
        open: true,
        clusterId: cluster.id,
        message:
          cluster.articleCount > 0
            ? (this.$t("clusters.dialogs.deleteClusterWithArticles", {
                name: cluster.name,
                count: cluster.articleCount,
              }) as string)
            : (this.$t("clusters.dialogs.deleteClusterMessage", { name: cluster.name }) as string),
        loading: false,
      };
    },

    async confirmDeleteCluster(): Promise<void> {
      if (!this.deleteClusterDialog.clusterId) return;
      this.deleteClusterDialog.loading = true;
      try {
        await this.clustersStore.delete(this.slug, this.deleteClusterDialog.clusterId);
        this.notify.success(this.$t("clusters.notify.clusterDeleted") as string);
        this.deleteClusterDialog.open = false;
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      } finally {
        this.deleteClusterDialog.loading = false;
      }
    },

    async onMoveCluster(payload: { id: string; direction: "up" | "down" }): Promise<void> {
      try {
        await this.clustersStore.move(this.slug, payload.id, payload.direction);
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      }
    },

    async onChangeClusterPillar(payload: { id: string; pillarId: string }): Promise<void> {
      try {
        await this.clustersStore.update(this.slug, payload.id, { pillarId: payload.pillarId });
        this.notify.success(this.$t("clusters.notify.clusterMoved") as string);
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      }
    },

    onMoveArticlesDialog(cluster: Cluster): void {
      this.moveArticlesDialog = { open: true, cluster };
    },

    async confirmMoveArticles(payload: {
      fromClusterId: string;
      articleIds: string[];
      toClusterId: string | null;
    }): Promise<void> {
      try {
        await this.clustersStore.moveArticles(
          this.slug,
          payload.fromClusterId,
          payload.articleIds,
          payload.toClusterId
        );
        this.notify.success(
          this.$t("clusters.notify.articlesMoved", {
            count: payload.articleIds.length,
          }) as string
        );
        this.moveArticlesDialog.open = false;
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      }
    },
  },
});
</script>

<style lang="scss" scoped>
.pillar-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.empty-state {
  text-align: center;
  padding: 80px 0;
}
</style>
