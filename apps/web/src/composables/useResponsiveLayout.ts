import { ref, onMounted, onUnmounted } from "vue";

const MOBILE_BREAKPOINT = 1024; // matches sidebar collapse breakpoint in AppShell

/**
 * Tracks whether the viewport is in mobile (< 1024 px) or desktop mode.
 * Registers a resize listener on mount and cleans up on unmount.
 *
 * SSR-safe: defaults to `false` (desktop) when `window` is unavailable.
 */
export function useResponsiveLayout() {
  const isMobile = ref(
    typeof window !== "undefined" ? window.innerWidth < MOBILE_BREAKPOINT : false,
  );

  function handleResize(): void {
    isMobile.value = window.innerWidth < MOBILE_BREAKPOINT;
  }

  onMounted(() => {
    // Re-evaluate immediately in case SSR defaulted differently.
    isMobile.value = window.innerWidth < MOBILE_BREAKPOINT;
    window.addEventListener("resize", handleResize);
  });

  onUnmounted(() => {
    window.removeEventListener("resize", handleResize);
  });

  return { isMobile };
}
