import { h } from "vue";
import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import "./style.css";
import BugReportWidget from "./components/BugReportWidget.vue";

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      "layout-bottom": () => h(BugReportWidget),
    });
  },
} satisfies Theme;
