<template>
  <div class="not-found-page">
    <div class="not-found-card">
      <p class="not-found-code mono text-dim">404</p>
      <h1 class="not-found-title">{{ $t("errors.page404.title") }}</h1>
      <p class="not-found-desc text-secondary">{{ $t("errors.page404.description") }}</p>
      <router-link class="not-found-link" to="/">
        {{ $t("errors.page404.backHome") }}
      </router-link>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  name: "NotFoundPage",
});
</script>

<style scoped>
.not-found-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

.not-found-card {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
}

.not-found-code {
  font-size: 64px;
  font-weight: 700;
  line-height: 1;
}

.not-found-title {
  font-size: 22px;
  font-weight: 700;
}

.not-found-link {
  color: var(--accent-primary);
  font-size: 13px;
  font-weight: 500;
  margin-top: var(--space-2);
}
</style>
