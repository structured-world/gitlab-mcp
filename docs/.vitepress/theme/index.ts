import { h } from "vue";
import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import googleAnalytics from "vitepress-plugin-google-analytics";
import "./style.css";
import BugReportWidget from "./components/BugReportWidget.vue";

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      "layout-bottom": () => h(BugReportWidget),
    });
  },
  enhanceApp({ app }) {
    googleAnalytics({
      id: import.meta.env.VITE_GA_ID || "G-RY1XJ7LR5F",
    });
  },
} satisfies Theme;
