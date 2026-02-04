/**
 * GA4 custom event tracking composable for VitePress
 *
 * Provides consent-aware tracking for:
 * - Search events (VitePress local search)
 * - File downloads (.mcpb bundles)
 * - Outbound link clicks
 *
 * All events are silently dropped if analytics consent is denied.
 *
 * Privacy note: This module tracks search terms, download URLs, and outbound link URLs.
 * Query parameters are included in URL tracking. Consent must be granted before any
 * data is sent to Google Analytics.
 */
import { useConsent } from "@structured-world/vue-privacy/vitepress";
import "../types/gtag"; // Import gtag type declaration

/**
 * GA4 recommended event parameters
 * @see https://developers.google.com/analytics/devguides/collection/ga4/reference/events
 */
interface SearchEventParams {
  search_term: string;
}

interface FileDownloadEventParams {
  file_name: string;
  file_extension: string;
  link_url: string;
}

interface OutboundClickEventParams {
  link_url: string;
  link_domain: string;
  outbound: true;
}

/**
 * Check if analytics consent is granted.
 *
 * Note: useConsent() from vue-privacy's /vitepress export is designed to be called
 * outside of Vue component setup context. It uses a module-level singleton pattern
 * internally, making it safe to call from plain functions.
 */
function hasAnalyticsConsent(): boolean {
  const { getConsent } = useConsent();
  const consent = getConsent();
  return consent?.categories?.analytics === true;
}

/**
 * Send GA4 event if analytics consent is granted
 */
function sendEvent(
  eventName: string,
  params: SearchEventParams | FileDownloadEventParams | OutboundClickEventParams
): void {
  if (!hasAnalyticsConsent()) {
    return;
  }

  if (typeof window !== "undefined" && typeof window.gtag === "function") {
    window.gtag("event", eventName, params);
  }
}

/**
 * Track search event (GA4 recommended event).
 * Search terms are sent as-is to GA4 for analytics purposes.
 * @see https://developers.google.com/analytics/devguides/collection/ga4/reference/events#search
 */
export function trackSearch(searchTerm: string): void {
  if (!searchTerm || searchTerm.trim().length === 0) {
    return;
  }

  sendEvent("search", {
    search_term: searchTerm.trim(),
  });
}

/**
 * Track file download event (GA4 recommended event)
 * @see https://developers.google.com/analytics/devguides/collection/ga4/reference/events#file_download
 */
export function trackFileDownload(linkUrl: string): void {
  if (!linkUrl) {
    return;
  }

  // Extract filename from URL, handling relative paths and invalid URLs gracefully
  let fileName: string;
  let fileExtension: string;

  try {
    // Use window.location.href as base for relative URL resolution
    const baseHref =
      typeof window !== "undefined" && window.location ? window.location.href : undefined;
    const url = baseHref ? new URL(linkUrl, baseHref) : new URL(linkUrl);
    const pathname = url.pathname;
    fileName = pathname.split("/").pop() || pathname;
    fileExtension = fileName.includes(".") ? fileName.split(".").pop() || "" : "";
  } catch {
    // Fallback: derive filename directly from the raw link URL
    const sanitized = linkUrl.split("#")[0].split("?")[0];
    fileName = sanitized.split("/").pop() || sanitized;
    fileExtension = fileName.includes(".") ? fileName.split(".").pop() || "" : "";
  }

  sendEvent("file_download", {
    file_name: fileName,
    file_extension: fileExtension,
    link_url: linkUrl,
  });
}

/**
 * Track outbound link click (GA4 recommended event).
 * Full URLs including query parameters are tracked for analytics purposes.
 * @see https://developers.google.com/analytics/devguides/collection/ga4/reference/events#click
 */
export function trackOutboundClick(linkUrl: string): void {
  if (!linkUrl) {
    return;
  }

  try {
    const url = new URL(linkUrl);
    const linkDomain = url.hostname;

    // Only track if it's actually an external domain
    if (linkDomain === window.location.hostname) {
      return;
    }

    sendEvent("click", {
      link_url: linkUrl,
      link_domain: linkDomain,
      outbound: true,
    });
  } catch {
    // Invalid URL, skip tracking
  }
}

/**
 * Composable for GA4 event tracking
 */
export function useGA4Tracking() {
  return {
    trackSearch,
    trackFileDownload,
    trackOutboundClick,
    hasAnalyticsConsent,
  };
}
