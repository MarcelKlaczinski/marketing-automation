<template>
  <span class="kbd-shortcut" :class="{ 'kbd-sm': small }">
    <kbd
      v-for="(key, i) in keyList"
      :key="i"
      class="kbd-key mono"
    >{{ key }}</kbd>
  </span>
</template>

<script lang="ts">
import { defineComponent } from "vue";

/**
 * Keyboard shortcut display component. Renders one or more key symbols in
 * styled <kbd> elements. Pass keys as a space-separated string:
 *   keys="⌘ K"  →  renders [⌘] [K]
 *   keys="Ctrl Shift P"  →  renders [Ctrl] [Shift] [P]
 */
export default defineComponent({
  name: "KbdShortcut",

  props: {
    /** Space-separated key labels, e.g. "⌘ K" or "Ctrl Shift P" */
    keys: {
      type: String,
      required: true,
    },
    /** Smaller size variant for use in dense UIs */
    small: {
      type: Boolean,
      default: false,
    },
  },

  computed: {
    keyList(): string[] {
      return this.keys.trim().split(/\s+/);
    },
  },
});
</script>

<style scoped>
.kbd-shortcut {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.kbd-key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-family: var(--font-mono);
  line-height: 1;
  color: var(--text-tertiary);
  background: var(--bg-glass-strong);
  border: 1px solid var(--border-soft);
  box-shadow: inset 0 -1px 0 var(--border-medium);
}

/* Small variant */
.kbd-sm .kbd-key {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  font-size: 10px;
  border-radius: 4px;
}
</style>
