import { h } from "vue";
import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import { enhanceWithConsent, ConsentBanner } from "@structured-world/vue-privacy/vitepress";
import { createKVStorage } from "@structured-world/vue-privacy";
import "./style.css";
import BugReportWidget from "./components/BugReportWidget.vue";

// GA4 tracking ID - fallback is gitlab-mcp.sw.foundation production property
const GA_ID = import.meta.env.VITE_GA_ID || "G-RY1XJ7LR5F";

// Enhance DefaultTheme with GDPR-compliant consent management and SPA page tracking.
// enhanceWithConsent automatically:
// - Sets consent defaults (denied for EU, granted for non-EU)
// - Loads gtag.js with send_page_view: false (SPA mode)
// - Tracks initial page view and watches router for SPA navigations
const consentTheme = enhanceWithConsent(DefaultTheme, {
  gaId: GA_ID,
  // KV storage via Cloudflare Worker (vue-privacy-worker) at gitlab-mcp.sw.foundation/api/consent*
  storage: createKVStorage("/api/consent"),
});

export default {
  ...consentTheme,
  Layout() {
    return h(consentTheme.Layout ?? DefaultTheme.Layout, null, {
      "layout-bottom": () => [h(ConsentBanner), h(BugReportWidget)],
    });
  },
} satisfies Theme;
