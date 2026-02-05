import { defineConfig, type HeadConfig } from "vitepress";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

const base = (process.env.DOCS_BASE as `/${string}/` | undefined) ?? "/gitlab-mcp/";
const hostname = "https://gitlab-mcp.sw.foundation";

// Dynamic values from build context
const softwareVersion = pkg.version;
const toolCount = process.env.TOOL_COUNT || "44"; // Set by build script, fallback to known value
const entityCount = process.env.ENTITY_COUNT || "18";
const siteDescription = `MCP server connecting AI agents to GitLab API with ${toolCount} tools across ${entityCount} entity types`;

// Types for structured data frontmatter
interface FAQItem {
  question: string;
  answer: string;
}

interface HowToStep {
  name?: string;
  text: string;
}

interface PageDataWithFrontmatter {
  relativePath: string;
  title?: string;
  description?: string;
  frontmatter?: {
    faq?: FAQItem[];
    howto?: {
      name?: string;
      description?: string;
      steps?: HowToStep[];
    };
  };
}

// JSON-LD Structured Data for SEO
function generateStructuredData(pageData: PageDataWithFrontmatter): object[] {
  const cleanPath = pageData.relativePath.replace(/(?:index)?\.md$/, "");
  const pageUrl = new URL(cleanPath, `${hostname}${base}`).href;
  const schemas: object[] = [];

  // WebSite schema (global, on every page)
  const siteUrl = `${hostname}${base}`.replace(/\/$/, ""); // Remove trailing slash for canonical URL
  schemas.push({
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "GitLab MCP",
    url: siteUrl,
    description: siteDescription,
    publisher: {
      "@type": "Organization",
      name: "sw.foundation",
      url: "https://sw.foundation",
    },
  });

  // BreadcrumbList schema (dynamic based on URL path)
  const pathSegments = cleanPath.split("/").filter(Boolean);
  if (pathSegments.length > 0) {
    const breadcrumbItems = [
      { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
    ];

    let currentPath = "";
    pathSegments.forEach((segment, index) => {
      currentPath += `/${segment}`;
      const name = segment
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
      breadcrumbItems.push({
        "@type": "ListItem",
        position: index + 2,
        name: index === pathSegments.length - 1 ? (pageData.title || name) : name,
        item: index === pathSegments.length - 1 ? pageUrl : `${siteUrl}${currentPath}/`,
      });
    });

    schemas.push({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: breadcrumbItems,
    });
  }

  // SoftwareApplication schema (home and installation pages only)
  const isHomePage = cleanPath === "" || cleanPath === "/";
  const isInstallationPage = cleanPath.includes("installation") || cleanPath.includes("quick-start");
  if (isHomePage || isInstallationPage) {
    schemas.push({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "GitLab MCP Server",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Windows, macOS, Linux",
      url: siteUrl,
      downloadUrl: "https://www.npmjs.com/package/@structured-world/gitlab-mcp",
      softwareVersion,
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
      author: {
        "@type": "Organization",
        name: "sw.foundation",
        url: "https://sw.foundation",
      },
    });
  }

  // FAQPage schema (when faq array is in frontmatter)
  const faq = pageData.frontmatter?.faq;
  if (faq && Array.isArray(faq) && faq.length > 0) {
    schemas.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faq.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: item.answer,
        },
      })),
    });
  }

  // HowTo schema (when howto object is in frontmatter)
  const howto = pageData.frontmatter?.howto;
  if (howto && howto.steps && Array.isArray(howto.steps) && howto.steps.length > 0) {
    schemas.push({
      "@context": "https://schema.org",
      "@type": "HowTo",
      name: howto.name || pageData.title || "How To Guide",
      description: howto.description || pageData.description,
      step: howto.steps.map((step, index) => ({
        "@type": "HowToStep",
        position: index + 1,
        name: step.name || `Step ${index + 1}`,
        text: step.text,
      })),
    });
  }

  return schemas;
}

export default defineConfig({
  title: "GitLab MCP",
  titleTemplate: ":title | GitLab MCP",
  lang: "en-US",
  cleanUrls: true,
  description: siteDescription,
  base,

  transformHead({ pageData }) {
    const head: HeadConfig[] = [];
    const title = pageData.title || "GitLab MCP";
    const description = pageData.description || siteDescription;
    const cleanPath = pageData.relativePath.replace(/(?:index)?\.md$/, "");
    const url = new URL(cleanPath, `${hostname}${base}`).href;

    // Open Graph meta tags
    head.push(["meta", { property: "og:title", content: title }]);
    head.push(["meta", { property: "og:description", content: description }]);
    head.push(["meta", { property: "og:url", content: url }]);

    // Twitter Card meta tags
    head.push(["meta", { name: "twitter:card", content: "summary_large_image" }]);
    head.push(["meta", { name: "twitter:title", content: title }]);
    head.push(["meta", { name: "twitter:description", content: description }]);

    // Canonical URL
    head.push(["link", { rel: "canonical", href: url }]);

    // JSON-LD Structured Data
    const structuredData = generateStructuredData(pageData);
    for (const schema of structuredData) {
      head.push(["script", { type: "application/ld+json" }, JSON.stringify(schema)]);
    }

    return head;
  },

  // MCPB bundle is downloaded from GitHub releases during docs build.
  // Links use versioned filenames (e.g., gitlab-mcp-6.43.0.mcpb) injected at build time.
  // Until first .mcpb release exists, the link is a dead link — safe to ignore.
  ignoreDeadLinks: [/\/downloads\/gitlab-mcp-[\d.]+\.mcpb$/],

  sitemap: {
    hostname,
    transformItems: (items) =>
      items.map((item) => ({
        ...item,
        lastmod: new Date().toISOString().split("T")[0],
      })),
  },

  head: [
    ["link", { rel: "icon", type: "image/x-icon", href: "/favicon.ico" }],
    ["link", { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" }],
    ["link", { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" }],
    ["meta", { property: "og:image", content: "https://gitlab-mcp.sw.foundation/og-image.png" }],
    ["meta", { property: "og:image:width", content: "1200" }],
    ["meta", { property: "og:image:height", content: "630" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:site_name", content: "GitLab MCP" }],
  ],

  themeConfig: {
    logo: "/logo.png",

    outline: {
      level: [2, 3],
      label: "On this page",
    },

    nav: [
      { text: "Guide", link: "/guide/" },
      { text: "Tools", link: "/tools/" },
      { text: "Prompts", link: "/prompts/" },
      { text: "Guides", link: "/guides/" },
      { text: "Clients", link: "/clients/" },
      { text: "CLI", link: "/cli/" },
      {
        text: "More",
        items: [
          { text: "Security", link: "/security/oauth" },
          { text: "Advanced", link: "/advanced/tls" },
          { text: "Deployment", link: "/deployment/" },
          { text: "Troubleshooting", link: "/troubleshooting/" },
        ],
      },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "Getting Started",
          items: [
            { text: "Introduction", link: "/guide/" },
            { text: "Quick Start", link: "/guide/quick-start" },
            { text: "Authentication", link: "/guide/authentication" },
          ],
        },
        {
          text: "Installation",
          collapsed: false,
          items: [
            { text: "Overview", link: "/guide/installation/" },
            { text: "Setup Wizard", link: "/guide/installation/wizard" },
            { text: "npm / npx", link: "/guide/installation/npm" },
            { text: "Docker", link: "/guide/installation/docker" },
            { text: "Claude Desktop", link: "/guide/installation/claude-desktop" },
            { text: "VS Code", link: "/guide/installation/vscode" },
            { text: "Codex", link: "/guide/installation/codex" },
            { text: "Manual", link: "/guide/installation/manual" },
          ],
        },
        {
          text: "Configuration",
          collapsed: false,
          items: [
            { text: "Environment Variables", link: "/guide/configuration" },
            { text: "Multi-Instance", link: "/guide/multi-instance" },
            { text: "Auto-Discovery", link: "/guide/auto-discovery" },
            { text: "Transport Modes", link: "/guide/transport" },
          ],
        },
      ],
      "/configuration/": [
        {
          text: "Configuration Reference",
          items: [
            { text: "Instance Configuration", link: "/configuration/instances" },
            { text: "Rate Limiting", link: "/configuration/rate-limiting" },
          ],
        },
      ],
      "/cli/": [
        {
          text: "CLI Reference",
          items: [
            { text: "Overview", link: "/cli/" },
            { text: "setup", link: "/cli/setup" },
            { text: "init", link: "/cli/init" },
            { text: "install", link: "/cli/install" },
            { text: "instances", link: "/cli/instances" },
            { text: "docker", link: "/cli/docker" },
            { text: "list-tools", link: "/cli/list-tools" },
          ],
        },
      ],
      "/clients/": [
        {
          text: "MCP Clients",
          items: [
            { text: "Overview", link: "/clients/" },
            { text: "Claude Desktop", link: "/clients/claude-desktop" },
            { text: "Claude Code", link: "/clients/claude-code" },
            { text: "Cursor", link: "/clients/cursor" },
            { text: "VS Code", link: "/clients/vscode" },
            { text: "Windsurf", link: "/clients/windsurf" },
            { text: "Cline", link: "/clients/cline" },
            { text: "Roo Code", link: "/clients/roo-code" },
          ],
        },
      ],
      "/deployment/": [
        {
          text: "Deployment",
          items: [
            { text: "Overview", link: "/deployment/" },
            { text: "Local stdio", link: "/deployment/local-stdio" },
            { text: "Docker Standalone", link: "/deployment/docker-standalone" },
            { text: "Docker + PostgreSQL", link: "/deployment/docker-postgres" },
            { text: "Docker Compose", link: "/deployment/docker-compose" },
          ],
        },
      ],
      "/troubleshooting/": [
        {
          text: "Troubleshooting",
          items: [
            { text: "Common Issues", link: "/troubleshooting/" },
            { text: "Connection", link: "/troubleshooting/connection" },
            { text: "Clients", link: "/troubleshooting/clients" },
            { text: "Docker", link: "/troubleshooting/docker" },
          ],
        },
      ],
      "/tools/": [
        {
          text: "Tool Reference",
          items: [
            { text: "Overview", link: "/tools/" },
            { text: "Full API Reference", link: "/tools/api-reference" },
          ],
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
            { text: "Federation Architecture", link: "/advanced/federation" },
            { text: "Tier Detection", link: "/advanced/tier-detection" },
            { text: "Context Switching", link: "/advanced/context-switching" },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/structured-world/gitlab-mcp" },
      { icon: "npm", link: "https://www.npmjs.com/package/@structured-world/gitlab-mcp" },
      {
        icon: { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>' },
        link: `${base}sponsor`,
        ariaLabel: "Support the project",
      },
    ],

    search: {
      provider: "local",
    },

    editLink: {
      pattern: ({ filePath }) => {
        // Files generated from .md.in templates - these don't exist in git as .md
        const templatedFiles = [
          "index.md",
          "guide/index.md",
          "guide/authentication.md",
          "guide/installation/claude-desktop.md",
          "tools/index.md",
          "clients/claude-desktop.md",
        ];

        // Files fully generated at build time - no source to edit
        const generatedFiles = ["tools/api-reference.md"];

        const relativePath = filePath.replace(/^docs\//, "");

        // Hide edit link for fully generated files
        if (generatedFiles.includes(relativePath)) {
          return "";
        }

        const isTemplated = templatedFiles.includes(relativePath);
        const targetPath = isTemplated ? `${filePath}.in` : filePath;

        return `https://github.com/structured-world/gitlab-mcp/edit/main/${targetPath}`;
      },
      text: "Edit this page on GitHub",
    },

    footer: {
      message: "Released under the Apache 2.0 License.",
      copyright: "Copyright © 2024-present Dmitry Prudnikov",
    },
  },
});
