<template>
  <router-link
    :to="to"
    class="nav-item"
    active-class="nav-item--active"
    exact-active-class=""
  >
    <!-- Active left bar (CSS ::before on active) -->
    <span class="nav-item-icon" aria-hidden="true">
      <!-- Dashboard -->
      <svg v-if="icon === 'dashboard'" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="1" y="1" width="6" height="6" rx="1.5" />
        <rect x="9" y="1" width="6" height="6" rx="1.5" />
        <rect x="1" y="9" width="6" height="6" rx="1.5" />
        <rect x="9" y="9" width="6" height="6" rx="1.5" />
      </svg>
      <!-- Activity -->
      <svg v-else-if="icon === 'activity'" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="1,8 4,5 7,11 10,2 13,8 16,8" />
      </svg>
      <!-- Failures -->
      <svg v-else-if="icon === 'failures'" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
        <circle cx="8" cy="8" r="6.5" />
        <line x1="8" y1="5" x2="8" y2="8.5" />
        <circle cx="8" cy="11" r="0.5" fill="currentColor" />
      </svg>
      <!-- Clusters -->
      <svg v-else-if="icon === 'clusters'" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
        <circle cx="8" cy="8" r="2" />
        <circle cx="8" cy="2" r="1.5" />
        <circle cx="13.5" cy="11" r="1.5" />
        <circle cx="2.5" cy="11" r="1.5" />
        <line x1="8" y1="3.5" x2="8" y2="6" />
        <line x1="12.6" y1="10.1" x2="9.7" y2="8.7" />
        <line x1="3.4" y1="10.1" x2="6.3" y2="8.7" />
      </svg>
      <!-- Articles -->
      <svg v-else-if="icon === 'articles'" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
        <rect x="2" y="1" width="12" height="14" rx="1.5" />
        <line x1="5" y1="5" x2="11" y2="5" />
        <line x1="5" y1="8" x2="11" y2="8" />
        <line x1="5" y1="11" x2="9" y2="11" />
      </svg>
      <!-- Briefs -->
      <svg v-else-if="icon === 'briefs'" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
        <path d="M2 3.5h12M2 7h8M2 10.5h10M2 14h6" />
      </svg>
      <!-- Cost -->
      <svg v-else-if="icon === 'cost'" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
        <circle cx="8" cy="8" r="6.5" />
        <path d="M10 6a2.5 2.5 0 1 0 0 5H6a2.5 2.5 0 1 0 0-5" />
        <line x1="8" y1="3.5" x2="8" y2="5" />
        <line x1="8" y1="11" x2="8" y2="12.5" />
      </svg>
      <!-- Settings -->
      <svg v-else-if="icon === 'settings'" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
        <circle cx="8" cy="8" r="2.5" />
        <path d="M8 1.5v1.3M8 13.2v1.3M1.5 8h1.3M13.2 8h1.3M3.4 3.4l.9.9M11.7 11.7l.9.9M12.6 3.4l-.9.9M4.3 11.7l-.9.9" />
      </svg>
      <!-- Article Tools (pen + wrench) -->
      <svg v-else-if="icon === 'articleTools'" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2 12.5h4l6.5-6.5-4-4L2 8.5z" />
        <line x1="10" y1="4" x2="12" y2="6" />
      </svg>
      <!-- Fallback generic dot -->
      <svg v-else width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="3" fill="currentColor" opacity="0.5" />
      </svg>
    </span>

    <span class="nav-item-label text-sm">{{ label }}</span>

    <!-- Badge -->
    <span
      v-if="badge !== undefined"
      class="nav-badge"
      :class="`nav-badge--${badgeVariant}`"
    >
      <span v-if="badgeVariant === 'live'" class="nav-badge-pulse" />
      {{ badge }}
    </span>
  </router-link>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";

type BadgeVariant = "default" | "live" | "urgent";

/**
 * Single sidebar navigation item.
 * Active state shows a glowing left bar via ::before pseudo-element.
 * Supports badge variants: default (muted), live (cyan pulse), urgent (red).
 */
export default defineComponent({
  name: "NavItem",

  props: {
    to: { type: String, required: true },
    icon: { type: String, required: true },
    label: { type: String, required: true },
    badge: { type: Number, default: undefined },
    badgeVariant: {
      type: String as PropType<BadgeVariant>,
      default: "default",
    },
  },
});
</script>

<style scoped>
.nav-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 7px var(--space-3);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  text-decoration: none;
  position: relative;
  transition: background var(--transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1)),
              color var(--transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1));
  /* Overflow needed so the active glow bar can extend beyond padding area */
  overflow: visible;
}

@media (hover: hover) and (pointer: fine) {
  .nav-item:hover {
    background: var(--bg-glass-strong);
    color: var(--text-primary);
  }
}

.nav-item:active {
  transform: scale(0.98);
  transition-duration: 160ms;
}

/* Mobile: expand touch target to ≥ 44px */
@media (max-width: 767px) {
  .nav-item {
    min-height: 44px;
    padding: 12px var(--space-3);
  }
}

/* === Active state === */
.nav-item--active {
  background: var(--bg-glass-strong);
  color: var(--text-primary);
}

/* Glowing left accent bar — spec C.3 */
.nav-item--active::before {
  content: '';
  position: absolute;
  left: -12px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 18px;
  background: var(--accent-primary);
  border-radius: 0 2px 2px 0;
  box-shadow: 0 0 8px var(--accent-primary-glow);
}

/* Icon */
.nav-item-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  color: inherit;
}

/* Label */
.nav-item-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

/* Badge */
.nav-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  flex-shrink: 0;
  position: relative;
}

.nav-badge--default {
  background: var(--bg-glass-strong);
  color: var(--text-tertiary);
  border: 1px solid var(--border-subtle);
}

.nav-badge--live {
  background: var(--status-running-bg);
  color: var(--status-running);
  border: 1px solid rgba(0, 212, 255, 0.2);
}

.nav-badge--urgent {
  background: var(--status-failed-bg);
  color: var(--status-failed);
  border: 1px solid rgba(255, 77, 109, 0.2);
}

/* Pulsing ring on live badge */
.nav-badge-pulse {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--status-running);
  position: relative;
}

.nav-badge-pulse::after {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: 50%;
  border: 1px solid var(--status-running);
  animation: livePulse 1.5s ease-out infinite;
}
</style>
