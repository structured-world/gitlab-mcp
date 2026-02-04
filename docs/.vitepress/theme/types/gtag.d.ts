/**
 * Type declaration for Google Analytics gtag function.
 * Augments the Window interface for type-safe gtag calls.
 */
declare global {
  interface Window {
    gtag?: (command: string, eventName: string, params: Record<string, unknown>) => void;
  }
}

export {};
