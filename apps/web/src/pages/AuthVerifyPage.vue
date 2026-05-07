<template>
  <q-card class="q-pa-lg">
    <q-card-section class="text-center">
      <q-spinner-dots v-if="state === 'loading'" size="3em" color="primary" class="q-mb-md" />
      <q-icon
        v-else-if="state === 'success'"
        name="check_circle"
        size="3em"
        color="positive"
        class="q-mb-md"
      />
      <q-icon v-else name="error" size="3em" color="negative" class="q-mb-md" />

      <div class="text-h6">
        <span v-if="state === 'loading'">{{ $t('auth.verify.loading') }}</span>
        <span v-else-if="state === 'success'">{{ $t('auth.verify.success') }}</span>
        <span v-else>{{ $t('auth.verify.failure') }}</span>
      </div>

      <div v-if="state === 'failure'" class="text-body2 q-mt-md text-grey-7">
        {{ failureReason }}
      </div>

      <q-btn
        v-if="state === 'failure'"
        :label="$t('auth.verify.tryAgain')"
        color="primary"
        class="q-mt-md"
        :to="{ name: 'login' }"
      />
    </q-card-section>
  </q-card>
</template>

<script lang="ts">
import { api } from "src/lib/api-client";
import { HttpError } from "src/lib/http-error";
import { useAuthStore } from "src/stores/auth";
import { defineComponent } from "vue";

type VerifyState = "loading" | "success" | "failure";

export default defineComponent({
  name: "AuthVerifyPage",

  setup() {
    return {
      authStore: useAuthStore(),
    };
  },

  data: () => ({
    state: "loading" as VerifyState,
    failureReason: "",
  }),

  async mounted() {
    const rawToken = this.$route.query.token;
    const token = Array.isArray(rawToken) ? (rawToken[0] ?? "") : (rawToken ?? "");
    if (!token) {
      this.state = "failure";
      this.failureReason = this.$t("auth.verify.failure") as string;
      return;
    }

    try {
      const res = await api.post<{ ok: boolean; data: { user: { id: string; email: string } } }>(
        "/auth/magic-link/verify",
        { token }
      );

      this.authStore.user = res.data.data.user;
      this.state = "success";

      setTimeout(() => {
        void this.$router.push({ name: "inbox" });
      }, 800);
    } catch (e) {
      this.state = "failure";
      if (e instanceof HttpError) {
        this.failureReason = e.userMessage;
      } else {
        this.failureReason = this.$t("auth.verify.failure") as string;
      }
    }
  },
});
</script>
