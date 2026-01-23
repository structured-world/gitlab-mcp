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
      { text: "Prompts", link: "/prompts/" },
      { text: "Guides", link: "/guides/" },
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
        {
          text: "By Use-Case",
          collapsed: false,
          items: [
            { text: "Code Review", link: "/tools/code-review" },
            { text: "CI/CD", link: "/tools/ci-cd" },
            { text: "Project Management", link: "/tools/project-management" },
            { text: "Repository", link: "/tools/repository" },
          ],
        },
      ],
      "/prompts/": [
        {
          text: "Prompt Library",
          items: [{ text: "Overview", link: "/prompts/" }],
        },
        {
          text: "Quick Start",
          collapsed: false,
          items: [
            { text: "First Steps", link: "/prompts/quick-start/first-steps" },
            { text: "Explore a Repo", link: "/prompts/quick-start/explore-repo" },
            { text: "Check Status", link: "/prompts/quick-start/check-status" },
          ],
        },
        {
          text: "Code Review",
          collapsed: false,
          items: [
            { text: "Review an MR", link: "/prompts/code-review/review-mr" },
            { text: "Suggest Changes", link: "/prompts/code-review/suggest-changes" },
            { text: "Apply Feedback", link: "/prompts/code-review/apply-feedback" },
          ],
        },
        {
          text: "CI/CD",
          collapsed: false,
          items: [
            { text: "Debug Failures", link: "/prompts/ci-cd/debug-failure" },
            { text: "Check Status", link: "/prompts/ci-cd/check-status" },
            { text: "Trigger Deploy", link: "/prompts/ci-cd/trigger-deploy" },
          ],
        },
        {
          text: "Project Management",
          collapsed: false,
          items: [
            { text: "Sprint Planning", link: "/prompts/project-management/sprint-planning" },
            { text: "Issue Triage", link: "/prompts/project-management/issue-triage" },
            { text: "Release Notes", link: "/prompts/project-management/release-notes" },
          ],
        },
        {
          text: "By Role",
          collapsed: false,
          items: [
            { text: "Developer", link: "/prompts/by-role/developer" },
            { text: "DevOps", link: "/prompts/by-role/devops" },
            { text: "Team Lead", link: "/prompts/by-role/team-lead" },
            { text: "Product Manager", link: "/prompts/by-role/pm" },
          ],
        },
      ],
      "/guides/": [
        {
          text: "Step-by-Step Guides",
          items: [
            { text: "Overview", link: "/guides/" },
            { text: "Complete Code Review", link: "/guides/complete-code-review" },
            { text: "Setup CI Notifications", link: "/guides/setup-ci-notifications" },
            { text: "Automate Releases", link: "/guides/automate-releases" },
            { text: "Multi-GitLab Setup", link: "/guides/multi-gitlab-setup" },
            { text: "Team Onboarding", link: "/guides/team-onboarding" },
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
