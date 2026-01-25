import { h, watch, nextTick } from "vue";
import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import { inBrowser } from "vitepress";
import "./style.css";
import BugReportWidget from "./components/BugReportWidget.vue";

// GA4 tracking ID - fallback is gitlab-mcp.sw.foundation production property
const GA_ID = import.meta.env.VITE_GA_ID || "G-RY1XJ7LR5F";

// Declare gtag types
declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

function initGoogleAnalytics() {
  if (!inBrowser || !GA_ID) return;

  // Avoid duplicate initialization
  if (window.dataLayer && window.gtag) return;

  // Load gtag script
  const script = document.createElement("script");
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  script.async = true;
  document.head.appendChild(script);

  // Initialize gtag
  window.dataLayer = window.dataLayer || [];
  window.gtag = function (...args: unknown[]) {
    window.dataLayer!.push(args);
  };

  // Set default consent - required for GA4 to send data
  // This grants analytics by default (no ads tracking)
  window.gtag("consent", "default", {
    analytics_storage: "granted",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });

  window.gtag("js", new Date());
  // Disable automatic page_view - we send manually to track SPA navigation
  window.gtag("config", GA_ID, { send_page_view: false });
}

function trackPageView(path: string) {
  if (!inBrowser || !window.gtag) return;

  window.gtag("event", "page_view", {
    page_path: path,
    page_location: window.location.href,
    page_title: document.title,
  });
}

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      "layout-bottom": () => h(BugReportWidget),
    });
  },
  enhanceApp({ router }) {
    if (inBrowser) {
      initGoogleAnalytics();

      // Track initial page view after DOM is ready
      nextTick(() => trackPageView(window.location.pathname));

      // Track subsequent SPA navigations
      watch(
        () => router.route.path,
        (path: string) => {
          // Wait for Vue to update DOM (including document.title) before tracking
          nextTick(() => trackPageView(path));
        }
      );
    }
  },
} satisfies Theme;
