/**
 * Type declaration for Google Analytics gtag function.
 * Augments the Window interface for type-safe gtag calls.
 *
 * @see https://developers.google.com/analytics/devguides/collection/gtagjs
 */
declare global {
  interface Window {
    gtag?: (
      command: "event" | "config" | "set" | string,
      target: string,
      params?: Record<string, unknown>
    ) => void;
  }
}

export {};
