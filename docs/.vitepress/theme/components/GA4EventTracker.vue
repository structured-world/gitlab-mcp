<script setup lang="ts">
/**
 * GA4 Event Tracker Component
 *
 * Invisible component that hooks into VitePress to track:
 * - Search queries (VitePress local search)
 * - File downloads (.mcpb bundles)
 * - Outbound link clicks
 *
 * All tracking respects user consent - events are silently dropped
 * if analytics consent is denied.
 */
import { onMounted, onUnmounted } from "vue";
import { trackSearch, trackFileDownload, trackOutboundClick } from "../composables/useGA4Tracking";

// Debounce timeout for search tracking (avoid tracking every keystroke)
const SEARCH_DEBOUNCE_MS = 1000;
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastTrackedSearch = "";

/**
 * Handle search input changes from VitePress local search
 */
function handleSearchInput(event: Event): void {
  const target = event.target as HTMLInputElement;
  if (!target || target.type !== "search") {
    return;
  }

  const searchTerm = target.value.trim();

  // Clear existing timer
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
  }

  // Don't track empty searches
  if (!searchTerm) {
    return;
  }

  // Debounce to avoid tracking every keystroke
  // Duplicate check inside setTimeout to allow re-searching same term after debounce
  searchDebounceTimer = setTimeout(() => {
    // Skip if same search term was just tracked (prevents duplicate events)
    if (searchTerm === lastTrackedSearch) {
      return;
    }
    lastTrackedSearch = searchTerm;
    trackSearch(searchTerm);
  }, SEARCH_DEBOUNCE_MS);
}

/**
 * Handle click events for downloads and outbound links
 */
function handleClick(event: MouseEvent): void {
  const target = event.target as HTMLElement;
  const link = target.closest("a");

  if (!link || !link.href) {
    return;
  }

  const href = link.href;

  // Track .mcpb file downloads (only when pathname ends with .mcpb)
  try {
    const downloadUrl = new URL(href);
    if (downloadUrl.pathname.endsWith(".mcpb")) {
      trackFileDownload(href);
      return;
    }
  } catch {
    // Invalid URL, continue to outbound link check
  }

  // Track outbound links (external domains)
  try {
    const url = new URL(href);
    if (url.hostname !== window.location.hostname) {
      trackOutboundClick(href);
    }
  } catch {
    // Invalid URL, ignore
  }
}

onMounted(() => {
  // Listen for search input (VitePress search modal uses input[type="search"])
  // Use capture phase to ensure we see events before any component stops propagation
  document.addEventListener("input", handleSearchInput, { capture: true });

  // Listen for clicks on links (use bubbling phase - sufficient for link tracking)
  document.addEventListener("click", handleClick);
});

onUnmounted(() => {
  document.removeEventListener("input", handleSearchInput, { capture: true });
  document.removeEventListener("click", handleClick);

  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
  }
});
</script>

<template>
  <!-- Invisible component - no DOM output -->
</template>
