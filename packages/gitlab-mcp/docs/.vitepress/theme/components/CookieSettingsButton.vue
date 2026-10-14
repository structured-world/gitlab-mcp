<script setup lang="ts">
/**
 * Reopens the cookie preference centre on every page. The banner's "Customize" is gone once a
 * visitor has chosen, and withdrawing consent must be as easy as giving it (GDPR Art. 7(3)).
 */
import { useConsent } from '@structured-world/vue-privacy/vitepress';

// useConsent() injects the consent manager, so it runs in setup, not in the click handler.
const { showPreferenceCenter } = useConsent();

function openPreferences(): void {
  showPreferenceCenter();
}
</script>

<template>
  <button type="button" class="cookie-settings" @click="openPreferences">Cookie settings</button>
</template>

<style scoped>
.cookie-settings {
  position: fixed;
  left: 24px;
  bottom: 24px;
  z-index: 100;
  padding: 6px 12px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  border: 1px solid var(--vp-c-divider);
  border-radius: 16px;
  font-size: 12px;
  cursor: pointer;
  transition:
    color 0.2s ease,
    border-color 0.2s ease;
}

.cookie-settings:hover,
.cookie-settings:focus-visible {
  color: var(--vp-c-text-1);
  border-color: var(--vp-c-brand-1);
}

@media (max-width: 640px) {
  .cookie-settings {
    left: 16px;
    bottom: 16px;
  }
}
</style>
