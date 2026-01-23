import { defineConfig } from "vitepress";

const base = (process.env.DOCS_BASE as `/${string}/` | undefined) ?? "/gitlab-mcp/";

export default defineConfig({
  title: "GitLab MCP",
  description: "Model Context Protocol server for GitLab API",
  base,

  themeConfig: {
    logo: "/logo.png",

    nav: [
      { text: "Guide", link: "/guide/" },
      { text: "Tools", link: "/tools/" },
      { text: "Security", link: "/security/oauth" },
      { text: "Advanced", link: "/advanced/tls" },
      { text: "CLI", link: "/cli/list-tools" },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "Getting Started",
          items: [
            { text: "Introduction", link: "/guide/" },
            { text: "Quick Start", link: "/guide/quick-start" },
          ],
        },
        {
          text: "Installation",
          collapsed: false,
          items: [
            { text: "npm / npx", link: "/guide/installation/npm" },
            { text: "Docker", link: "/guide/installation/docker" },
            { text: "VS Code", link: "/guide/installation/vscode" },
            { text: "Codex", link: "/guide/installation/codex" },
          ],
        },
        {
          text: "Configuration",
          collapsed: false,
          items: [
            { text: "Environment Variables", link: "/guide/configuration" },
            { text: "Auto-Discovery", link: "/guide/auto-discovery" },
            { text: "Transport Modes", link: "/guide/transport" },
          ],
        },
      ],
      "/security/": [
        {
          text: "Security",
          items: [
            { text: "OAuth Authentication", link: "/security/oauth" },
            { text: "Read-Only Mode", link: "/security/read-only" },
          ],
        },
      ],
      "/advanced/": [
        {
          text: "Advanced",
          items: [
            { text: "TLS / HTTPS", link: "/advanced/tls" },
            { text: "Customization", link: "/advanced/customization" },
          ],
        },
      ],
      "/cli/": [
        {
          text: "CLI Tools",
          items: [{ text: "list-tools", link: "/cli/list-tools" }],
        },
      ],
      "/tools/": [
        {
          text: "Tool Reference",
          items: [{ text: "Overview", link: "/tools/" }],
        },
      ],
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/structured-world/gitlab-mcp" },
      { icon: "npm", link: "https://www.npmjs.com/package/@structured-world/gitlab-mcp" },
    ],

    search: {
      provider: "local",
    },

    editLink: {
      pattern: "https://github.com/structured-world/gitlab-mcp/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },

    footer: {
      message: "Released under the Apache 2.0 License.",
      copyright: "Copyright © 2024-present Dmitry Prudnikov",
    },
  },
});
