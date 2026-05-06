# Spec 33: Settings + Credential Management

**Phase:** 4 (Web App Wave 2)
**Estimated Effort:** 1 day (1-2 sessions)
**Dependencies:** Spec 32 (installer wizard — reuses Step components), Spec 31 (auth)
**Status:** Ready for implementation
**Recommended Model:** Sonnet 4.6 (mostly UI composition; Spec 32 did the architectural lifting)

---

## Goal

Build the **post-onboarding Settings page** at `/settings` with three tabs: Adapters, System, Profile. The Adapters tab reuses Spec 32's Step components in a non-wizard layout, letting Marcel re-configure or rotate credentials anytime after initial setup. The System tab shows infrastructure status (Postgres, Redis, deployment mode). The Profile tab shows the logged-in user info + logout.

After this spec:
- Marcel can edit any adapter credential without going through the installer wizard
- Re-verify any adapter on demand
- See system metadata (deployment mode, API version, last verified timestamps)
- View their account info and log out

This spec is structurally simple but unblocks multiple later workflows: rotating an Anthropic key, swapping R2 buckets, fixing a broken SMTP config without re-running the installer.

## Architecture Decisions

**Decision 1: Reuse Spec 32's Step components as-is.**
The `StepAnthropic.vue`, `StepReplicate.vue`, etc. components are designed to work standalone. Settings tab embeds them in a tab layout without the stepper navigation wrapper. Spec 32 was deliberately structured to make this trivial.

**Decision 2: Tab-based layout, not separate pages.**
`/settings` is one page with three tabs (`?tab=adapters`, `?tab=system`, `?tab=profile`). URL-driven so links into specific sections work. Default tab: `adapters`.

**Decision 3: Read-only system info — Postgres/Redis cannot be reconfigured via UI.**
Spec 32 already established this. Repeated here for consistency. The System tab shows status + env-var config hints.

**Decision 4: Profile tab is minimal in this spec.**
For Welle 2, Profile shows email, last login, logout button. Future "edit profile" features (display name, avatar, email change) are not in scope. The session table from Spec 04 doesn't track display name today; adding that is a separate concern.

**Decision 5: No "factory reset" or "delete all credentials" button.**
Destructive actions stay out of UI. If Marcel wants to clear credentials, he uses the per-adapter Disconnect button (which Spec 32 already implements via `DELETE /api/system/credentials/:service/:key`).

**Decision 6: Settings is auth-required.**
Already covered by Spec 31's route guard, but explicit here. No anonymous access to credential management.

## Non-Goals

- **No per-project credential overrides** — global credentials only (project-scoped credentials exist in DB but aren't surfaced in UI yet)
- **No bulk credential import/export** — manual entry only
- **No password change UI** (no passwords exist)
- **No multi-user management** — single-user system today
- **No audit log of credential changes** — `system_settings.last_verified_*` is the only history
- **No "test all adapters" bulk-verify button** — per-adapter Verify only (bulk would mask individual failures)
- **No env-var editor** — env vars stay in `.env`, edited externally

## Detailed Implementation

### Frontend: SettingsPage shell

`apps/web/src/pages/SettingsPage.vue`:

```vue
<template>
  <q-page padding>
    <h1 class="text-h5 q-mb-lg">{{ $t('settings.title') }}</h1>

    <q-tabs
      v-model="activeTab"
      align="left"
      class="text-grey-8 q-mb-lg"
      indicator-color="primary"
      active-color="primary"
      narrow-indicator
      @update:model-value="onTabChange"
    >
      <q-tab name="adapters" :label="$t('settings.tabs.adapters')" icon="api" />
      <q-tab name="system" :label="$t('settings.tabs.system')" icon="dns" />
      <q-tab name="profile" :label="$t('settings.tabs.profile')" icon="person" />
    </q-tabs>

    <q-tab-panels v-model="activeTab" animated class="bg-transparent">
      <q-tab-panel name="adapters" class="q-px-none">
        <SettingsAdaptersPanel />
      </q-tab-panel>
      <q-tab-panel name="system" class="q-px-none">
        <SettingsSystemPanel />
      </q-tab-panel>
      <q-tab-panel name="profile" class="q-px-none">
        <SettingsProfilePanel />
      </q-tab-panel>
    </q-tab-panels>
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import SettingsAdaptersPanel from 'src/components/settings/SettingsAdaptersPanel.vue';
import SettingsSystemPanel from 'src/components/settings/SettingsSystemPanel.vue';
import SettingsProfilePanel from 'src/components/settings/SettingsProfilePanel.vue';

type TabName = 'adapters' | 'system' | 'profile';

export default defineComponent({
  name: 'SettingsPage',

  components: {
    SettingsAdaptersPanel,
    SettingsSystemPanel,
    SettingsProfilePanel,
  },

  data: () => ({
    activeTab: 'adapters' as TabName,
  }),

  created() {
    const tabFromQuery = this.$route.query.tab;
    if (typeof tabFromQuery === 'string' && ['adapters', 'system', 'profile'].includes(tabFromQuery)) {
      this.activeTab = tabFromQuery as TabName;
    }
  },

  methods: {
    onTabChange(newTab: string | number | null): void {
      if (typeof newTab !== 'string') return;
      void this.$router.replace({ query: { ...this.$route.query, tab: newTab } });
    },
  },
});
</script>
```

### Frontend: Adapters Panel

`apps/web/src/components/settings/SettingsAdaptersPanel.vue`:

```vue
<template>
  <div>
    <p class="text-body2 q-mb-lg">{{ $t('settings.adapters.intro') }}</p>

    <div class="adapter-grid">
      <SettingsAdapterCard
        v-for="adapter in adapterList"
        :key="adapter.service"
        :service="adapter.service"
        :icon="adapter.icon"
        :title="$t(`installer.steps.${adapter.stepKey}.title`)"
        :description="$t(`installer.steps.${adapter.stepKey}.description`)"
        :status="systemStatusStore.adapters[adapter.statusKey]"
        :step-component="adapter.component"
        @configured="onAdapterChanged"
        @disconnected="onAdapterChanged"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, defineAsyncComponent } from 'vue';
import { useSystemStatusStore } from 'src/stores/system-status';
import SettingsAdapterCard from './SettingsAdapterCard.vue';

const adapterList = [
  {
    service: 'smtp',
    statusKey: 'smtp' as const,
    stepKey: 'smtp',
    icon: 'mail',
    component: defineAsyncComponent(() => import('src/components/installer/StepSmtp.vue')),
  },
  {
    service: 'anthropic',
    statusKey: 'anthropic' as const,
    stepKey: 'anthropic',
    icon: 'psychology',
    component: defineAsyncComponent(() => import('src/components/installer/StepAnthropic.vue')),
  },
  {
    service: 'replicate',
    statusKey: 'replicate' as const,
    stepKey: 'replicate',
    icon: 'image',
    component: defineAsyncComponent(() => import('src/components/installer/StepReplicate.vue')),
  },
  {
    service: 'r2',
    statusKey: 'r2' as const,
    stepKey: 'r2',
    icon: 'cloud',
    component: defineAsyncComponent(() => import('src/components/installer/StepR2.vue')),
  },
  {
    service: 'dataforseo',
    statusKey: 'dataforseo' as const,
    stepKey: 'dataforseo',
    icon: 'search',
    component: defineAsyncComponent(() => import('src/components/installer/StepDataforseo.vue')),
  },
  {
    service: 'github_app',
    statusKey: 'githubApp' as const,
    stepKey: 'githubApp',
    icon: 'code',
    component: defineAsyncComponent(() => import('src/components/installer/StepGithubApp.vue')),
  },
];

export default defineComponent({
  name: 'SettingsAdaptersPanel',

  components: {
    SettingsAdapterCard,
  },

  setup() {
    return { systemStatusStore: useSystemStatusStore() };
  },

  data: () => ({
    adapterList,
  }),

  methods: {
    async onAdapterChanged(): Promise<void> {
      await this.systemStatusStore.fetchStatus();
    },
  },
});
</script>

<style lang="scss" scoped>
.adapter-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;

  @media (min-width: 1024px) {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
```

### Frontend: AdapterCard component

`apps/web/src/components/settings/SettingsAdapterCard.vue`:

```vue
<template>
  <div class="adapter-card">
    <div class="adapter-card__header" @click="expanded = !expanded">
      <div class="adapter-card__icon">
        <q-icon :name="icon" size="24px" />
      </div>
      <div class="adapter-card__main">
        <div class="adapter-card__title">{{ title }}</div>
        <div class="adapter-card__caption">{{ description }}</div>
      </div>
      <div class="adapter-card__status">
        <span :class="statusClass">{{ statusLabel }}</span>
        <q-icon
          :name="expanded ? 'expand_less' : 'expand_more'"
          size="20px"
          class="q-ml-sm"
        />
      </div>
    </div>

    <div v-if="expanded" class="adapter-card__body">
      <component
        :is="stepComponent"
        @configured="onConfigured"
      />

      <div v-if="status.configured" class="adapter-card__danger-zone q-mt-lg">
        <q-btn
          flat
          color="negative"
          :label="$t('settings.adapters.disconnect')"
          icon="link_off"
          @click="confirmDisconnect"
        />
      </div>
    </div>

    <q-dialog v-model="disconnectDialogOpen">
      <q-card style="min-width: 320px;">
        <q-card-section>
          <div class="text-h6">{{ $t('settings.adapters.disconnectDialog.title') }}</div>
          <p class="q-mt-md">{{ $t('settings.adapters.disconnectDialog.description', { adapter: title }) }}</p>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat :label="$t('common.cancel')" v-close-popup />
          <q-btn
            flat
            color="negative"
            :label="$t('settings.adapters.disconnectDialog.confirm')"
            :loading="disconnecting"
            @click="doDisconnect"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType, type Component } from 'vue';
import { api } from 'src/lib/api-client';
import { useNotify } from 'src/composables/useNotify';
import { HttpError } from 'src/lib/http-error';

interface AdapterStatus {
  configured: boolean;
  verified: boolean | null;
  lastVerifiedAt: string | null;
  missingKeys?: string[];
}

export default defineComponent({
  name: 'SettingsAdapterCard',

  props: {
    service: { type: String, required: true },
    icon: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    status: { type: Object as PropType<AdapterStatus>, required: true },
    stepComponent: { type: [Object, Function] as PropType<Component>, required: true },
  },

  emits: ['configured', 'disconnected'],

  setup() {
    return { notify: useNotify() };
  },

  data: () => ({
    expanded: false,
    disconnectDialogOpen: false,
    disconnecting: false,
  }),

  computed: {
    statusClass(): string {
      if (this.status.verified === true) return 'status-pill status-pill--ok';
      if (this.status.configured) return 'status-pill status-pill--warn';
      return 'status-pill status-pill--off';
    },
    statusLabel(): string {
      if (this.status.verified === true) return this.$t('settings.adapters.status.verified');
      if (this.status.configured) return this.$t('settings.adapters.status.configured');
      return this.$t('settings.adapters.status.notConfigured');
    },
  },

  methods: {
    onConfigured(): void {
      this.$emit('configured');
    },
    confirmDisconnect(): void {
      this.disconnectDialogOpen = true;
    },
    async doDisconnect(): Promise<void> {
      this.disconnecting = true;
      try {
        // We need to know which keys exist for this service.
        // Naive approach: try deleting all known keys; backend handles 404 gracefully.
        // Better: call a dedicated endpoint that disconnects the whole adapter at once.
        // For Spec 33, we implement the simple approach + add the bulk endpoint server-side.
        await api.delete(`/system/credentials/${this.service}`);
        this.notify.success(this.$t('settings.adapters.disconnectDialog.success'));
        this.disconnectDialogOpen = false;
        this.$emit('disconnected');
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      } finally {
        this.disconnecting = false;
      }
    },
  },
});
</script>

<style lang="scss" scoped>
.adapter-card {
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 8px;
  background: var(--q-card-bg, #fff);
  transition: box-shadow 0.15s;

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }
}

.adapter-card__header {
  display: flex;
  align-items: center;
  padding: 16px;
  cursor: pointer;
  user-select: none;

  &:hover {
    background: rgba(0, 0, 0, 0.02);

    body.body--dark & {
      background: rgba(255, 255, 255, 0.03);
    }
  }
}

.adapter-card__icon {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  background: rgba(63, 81, 181, 0.1);
  border-radius: 8px;
  color: #3f51b5;
}

.adapter-card__main {
  flex-grow: 1;
  margin-left: 12px;
  min-width: 0;
}

.adapter-card__title {
  font-weight: 500;
  font-size: 15px;
}

.adapter-card__caption {
  font-size: 13px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.6));
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  body.body--dark & {
    color: rgba(255, 255, 255, 0.6);
  }
}

.adapter-card__status {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  margin-left: 12px;
}

.status-pill {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 999px;
  font-weight: 500;
}

.status-pill--ok {
  background: rgba(33, 186, 69, 0.12);
  color: #21ba45;
}

.status-pill--warn {
  background: rgba(242, 192, 55, 0.18);
  color: #b07b00;
}

.status-pill--off {
  background: rgba(0, 0, 0, 0.06);
  color: rgba(0, 0, 0, 0.5);

  body.body--dark & {
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.55);
  }
}

.adapter-card__body {
  padding: 0 16px 16px;
  border-top: 1px solid var(--q-grey-2, #f0f0f0);

  body.body--dark & {
    border-top-color: rgba(255, 255, 255, 0.06);
  }
}

.adapter-card__danger-zone {
  border-top: 1px dashed var(--q-grey-3, #e0e0e0);
  padding-top: 12px;

  body.body--dark & {
    border-top-color: rgba(255, 255, 255, 0.1);
  }
}
</style>
```

### Frontend: System Panel

`apps/web/src/components/settings/SettingsSystemPanel.vue`:

```vue
<template>
  <div>
    <p class="text-body2 q-mb-lg">{{ $t('settings.system.intro') }}</p>

    <div class="system-grid">
      <div class="system-card">
        <div class="system-card__label">{{ $t('settings.system.deploymentMode') }}</div>
        <div class="system-card__value">{{ deploymentMode }}</div>
        <div class="system-card__caption">
          {{ deploymentMode === 'lokal' ? $t('settings.system.lokalCaption') : $t('settings.system.selfHostedCaption') }}
        </div>
      </div>

      <div class="system-card">
        <div class="system-card__label">PostgreSQL</div>
        <div class="system-card__value">
          <q-icon
            :name="postgresStatus.verified ? 'check_circle' : 'error'"
            :color="postgresStatus.verified ? 'positive' : 'negative'"
            size="20px"
            class="q-mr-sm"
          />
          {{ postgresStatus.verified ? $t('settings.system.connected') : $t('settings.system.disconnected') }}
        </div>
        <div v-if="postgresStatus.lastVerifiedAt" class="system-card__caption">
          {{ $t('settings.system.lastChecked') }}: {{ formatDate(postgresStatus.lastVerifiedAt) }}
        </div>
      </div>

      <div class="system-card">
        <div class="system-card__label">Redis</div>
        <div class="system-card__value">
          <q-icon
            :name="redisStatus.verified ? 'check_circle' : 'error'"
            :color="redisStatus.verified ? 'positive' : 'negative'"
            size="20px"
            class="q-mr-sm"
          />
          {{ redisStatus.verified ? $t('settings.system.connected') : $t('settings.system.disconnected') }}
        </div>
        <div v-if="redisStatus.lastVerifiedAt" class="system-card__caption">
          {{ $t('settings.system.lastChecked') }}: {{ formatDate(redisStatus.lastVerifiedAt) }}
        </div>
      </div>

      <div class="system-card">
        <div class="system-card__label">{{ $t('settings.system.apiVersion') }}</div>
        <div class="system-card__value">{{ apiVersion || '—' }}</div>
        <div class="system-card__caption">Node {{ nodeVersion || '—' }}</div>
      </div>
    </div>

    <div class="q-mt-xl">
      <q-btn
        outline
        color="primary"
        :label="$t('settings.system.refreshButton')"
        icon="refresh"
        :loading="systemStatusStore.loading"
        @click="onRefresh"
      />
    </div>

    <q-banner v-if="!postgresStatus.verified || !redisStatus.verified" class="q-mt-lg bg-negative text-white">
      <template v-slot:avatar><q-icon name="warning" /></template>
      {{ $t('settings.system.coreUnreachable') }}
    </q-banner>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { api } from 'src/lib/api-client';
import { useSystemStatusStore } from 'src/stores/system-status';

interface SystemInfo {
  deploymentMode: 'lokal' | 'self_hosted';
  nodeVersion: string;
  apiVersion: string;
}

export default defineComponent({
  name: 'SettingsSystemPanel',

  setup() {
    return { systemStatusStore: useSystemStatusStore() };
  },

  data: () => ({
    deploymentMode: 'lokal' as 'lokal' | 'self_hosted',
    nodeVersion: '',
    apiVersion: '',
  }),

  computed: {
    postgresStatus() {
      return this.systemStatusStore.postgres;
    },
    redisStatus() {
      return this.systemStatusStore.redis;
    },
  },

  async created() {
    await this.fetchSystemInfo();
  },

  methods: {
    async fetchSystemInfo(): Promise<void> {
      try {
        const res = await api.get<{ ok: boolean; data: SystemInfo }>('/system/info');
        const info = res.data.data;
        this.deploymentMode = info.deploymentMode;
        this.nodeVersion = info.nodeVersion;
        this.apiVersion = info.apiVersion;
      } catch {
        // Silent — info endpoint is non-critical
      }
    },

    async onRefresh(): Promise<void> {
      await this.systemStatusStore.fetchStatus();
      await this.fetchSystemInfo();
    },

    formatDate(iso: string): string {
      const locale = this.$i18n.locale;
      return new Date(iso).toLocaleString(locale);
    },
  },
});
</script>

<style lang="scss" scoped>
.system-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;

  @media (min-width: 768px) {
    grid-template-columns: repeat(2, 1fr);
  }
}

.system-card {
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 8px;
  padding: 16px;
  background: var(--q-card-bg, #fff);

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }
}

.system-card__label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  margin-bottom: 8px;

  body.body--dark & {
    color: rgba(255, 255, 255, 0.55);
  }
}

.system-card__value {
  font-size: 18px;
  font-weight: 500;
  display: flex;
  align-items: center;
}

.system-card__caption {
  font-size: 13px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  margin-top: 6px;

  body.body--dark & {
    color: rgba(255, 255, 255, 0.55);
  }
}
</style>
```

### Frontend: Profile Panel

`apps/web/src/components/settings/SettingsProfilePanel.vue`:

```vue
<template>
  <div>
    <p class="text-body2 q-mb-lg">{{ $t('settings.profile.intro') }}</p>

    <div class="profile-grid">
      <div class="system-card">
        <div class="system-card__label">{{ $t('settings.profile.email') }}</div>
        <div class="system-card__value">{{ authStore.user?.email || '—' }}</div>
      </div>

      <div class="system-card">
        <div class="system-card__label">{{ $t('settings.profile.userId') }}</div>
        <div class="system-card__value text-caption" style="font-family: monospace;">
          {{ authStore.user?.id || '—' }}
        </div>
      </div>
    </div>

    <div class="q-mt-xl">
      <q-btn
        outline
        color="negative"
        :label="$t('app.logout')"
        icon="logout"
        @click="onLogout"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useAuthStore } from 'src/stores/auth';

export default defineComponent({
  name: 'SettingsProfilePanel',

  setup() {
    return { authStore: useAuthStore() };
  },

  methods: {
    async onLogout(): Promise<void> {
      await this.authStore.logout();
      void this.$router.push({ name: 'login' });
    },
  },
});
</script>

<style lang="scss" scoped>
.profile-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;

  @media (min-width: 768px) {
    grid-template-columns: repeat(2, 1fr);
  }
}

.system-card {
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 8px;
  padding: 16px;

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }
}

.system-card__label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  margin-bottom: 8px;
}

.system-card__value {
  font-size: 18px;
  font-weight: 500;
}
</style>
```

### Backend: Bulk Disconnect Endpoint

The `disconnect` button needs a single endpoint to remove all credentials for a service:

`apps/api/src/routes/system.ts` — add endpoint:

```typescript
systemRoutes.delete("/credentials/:service", requireAuth, async (c) => {
  const service = c.req.param("service");
  const validServices = ["anthropic", "replicate", "r2", "dataforseo", "smtp", "github_app"] as const;
  if (!validServices.includes(service as typeof validServices[number])) {
    return c.json({ ok: false, error: `Unknown service: ${service}` }, 400);
  }

  await db.delete(globalCredentials)
    .where(eq(globalCredentials.service, service));

  // Also clear last-verified status
  await db.delete(systemSettings)
    .where(eq(systemSettings.key, `last_verified_${service}`));

  return c.json({ ok: true, data: { service } });
});
```

This is in addition to the existing per-key delete endpoint.

### i18n: settings keys

`apps/web/src/i18n/de/settings.ts`:

```typescript
export default {
  title: 'Einstellungen',

  tabs: {
    adapters: 'Adapter',
    system: 'System',
    profile: 'Profil',
  },

  adapters: {
    intro: 'Verwalte die Verbindungen zu externen Diensten. Klicke auf einen Adapter um die Konfiguration zu ändern.',
    disconnect: 'Verbindung trennen',
    status: {
      verified: 'Verifiziert',
      configured: 'Konfiguriert',
      notConfigured: 'Nicht konfiguriert',
    },
    disconnectDialog: {
      title: 'Verbindung wirklich trennen?',
      description: 'Alle gespeicherten Anmeldedaten für {adapter} werden gelöscht. Du kannst sie jederzeit erneut konfigurieren.',
      confirm: 'Trennen',
      success: 'Verbindung getrennt',
    },
  },

  system: {
    intro: 'Status der Kern-Infrastruktur und Systemmetadaten.',
    deploymentMode: 'Modus',
    apiVersion: 'API-Version',
    connected: 'Verbunden',
    disconnected: 'Getrennt',
    lastChecked: 'Zuletzt geprüft',
    lokalCaption: 'Lokaler Entwicklungsmodus',
    selfHostedCaption: 'Self-hosted-Modus (Container)',
    refreshButton: 'Status aktualisieren',
    coreUnreachable: 'Kern-Infrastruktur (PostgreSQL/Redis) ist nicht erreichbar. Prüfe DATABASE_URL und REDIS_URL in deiner .env-Datei.',
  },

  profile: {
    intro: 'Dein Account.',
    email: 'E-Mail-Adresse',
    userId: 'Benutzer-ID',
  },
};
```

`apps/web/src/i18n/de/common.ts` (extend or create):
```typescript
export default {
  cancel: 'Abbrechen',
  save: 'Speichern',
  edit: 'Bearbeiten',
  delete: 'Löschen',
  confirm: 'Bestätigen',
};
```

Mirror in `en/`.

Update `apps/web/src/i18n/de/index.ts`:
```typescript
import settings from './settings';
import common from './common';
// ... add to default export
```

### Re-stub the SettingsPage import

Replace the stub in `apps/web/src/pages/SettingsPage.vue` (created in Spec 30) with the new full implementation. The route already exists.

## Acceptance Criteria

### Layout
- [ ] `/settings` page renders with three tabs
- [ ] URL query reflects active tab (`?tab=adapters`, `?tab=system`, `?tab=profile`)
- [ ] Direct links into specific tabs work (`/settings?tab=system` opens System tab)

### Adapters Tab
- [ ] All 6 adapters appear as cards (smtp, anthropic, replicate, r2, dataforseo, github_app)
- [ ] Cards show status pill: "Verifiziert" / "Konfiguriert" / "Nicht konfiguriert"
- [ ] Click on card expands to show the same form as in the installer
- [ ] Save + Verify buttons work identically to installer
- [ ] After save, status pill updates without page reload
- [ ] Disconnect button shows confirmation dialog and removes all credentials for that service
- [ ] After disconnect, status pill flips to "Nicht konfiguriert"

### System Tab
- [ ] Shows deployment mode (lokal / self_hosted)
- [ ] Shows Postgres + Redis connection status with last-checked timestamp
- [ ] Shows API version + Node version
- [ ] Refresh button re-fetches status

### Profile Tab
- [ ] Shows logged-in user's email + ID
- [ ] Logout button works (clears session, redirects to login)

### Backend
- [ ] `DELETE /api/system/credentials/:service` removes all credentials for service + clears last_verified
- [ ] Endpoint requires auth
- [ ] Returns `{ ok: true, data: { service } }` on success

### Mode-awareness
- [ ] Settings page works identically in lokal and self-hosted mode (deployment mode is just displayed)

## Testing Strategy

Manual smoke tests:

1. **Tab navigation**: Click each tab, verify URL updates and panel changes.
2. **Adapter expansion**: Click an adapter card, verify form expands. Edit a value, save, verify status updates.
3. **Adapter disconnect**: Click disconnect on a configured adapter. Confirm dialog. Verify status flips to "not configured" and the card collapses.
4. **System refresh**: Trigger refresh button. Watch network tab for `/api/system/status` and `/api/system/info` calls.
5. **Logout from profile**: Click logout, verify redirect to login and session cleared.
6. **Direct URL**: Visit `/settings?tab=profile` directly, verify Profile tab is active.

## Open Questions / Decisions Made

**Decision 1: Reuse Step components without adapter-specific wrappers.**
Spec 32's `StepBase.vue` + child Step components are self-contained. The card just embeds them. No fork needed.

**Decision 2: Bulk disconnect deletes all credentials atomically.**
Single DELETE call removes all keys for a service. Simpler than asking the user to delete each field individually.

**Decision 3: No "credential rotation" history.**
We don't track when each credential was last changed. Only `last_verified_at` exists. If audit history is needed later, add a `credential_changes` table.

**Decision 4: Profile tab is intentionally minimal.**
We don't have user-editable profile fields today. Adding name/avatar/etc. is a separate spec when it actually matters.

**Decision 5: System tab refresh is manual, not auto-polling.**
System status changes rarely (only when env vars change or services restart). Auto-polling would waste cycles. Manual refresh suffices.

## Implementation Order

**Single session, ~5-7h:**

1. Create `apps/web/src/components/settings/` directory with 4 files (Panel × 3, AdapterCard)
2. Replace `SettingsPage.vue` stub
3. Add i18n bundles (settings.ts, common.ts in both locales)
4. Add backend `DELETE /api/system/credentials/:service` endpoint
5. Manual smoke tests
6. Commit: `feat(web): settings page with adapter management (spec 33)`

If session runs long, split:
- Session 1: Layout + Adapters tab (most of the work)
- Session 2: System + Profile tabs + backend endpoint

## Splitting Plan

Optional split if session 1 grows beyond ~5h.

## Discovered During Implementation

(empty — fill during/after implementation)

## Deviations

(empty — fill during/after implementation)
