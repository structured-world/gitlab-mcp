#!/usr/bin/env node

/**
 * Update MCP manifest tools section in package.json
 *
 * This script reads tool definitions from stdin (from yarn list-tools --json)
 * and updates the mcp.tools section in package.json.
 *
 * Usage:
 *   yarn list-tools --json | node scripts/update-mcp-manifest.js
 *   node scripts/update-mcp-manifest.js < tools.json
 *
 * The script also updates mcp.description with the current tool count.
 */

const fs = require("fs");
const path = require("path");

/**
 * Read all input from stdin
 * @returns {Promise<string>}
 */
function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("readable", () => {
      let chunk;
      while ((chunk = process.stdin.read()) !== null) {
        data += chunk;
      }
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

/**
 * Extract category from tool name based on CQRS naming convention
 * @param {string} toolName - Tool name like "browse_projects" or "manage_milestone"
 * @returns {string} - Category name
 */
function extractCategory(toolName) {
  // Map tool prefixes/patterns to categories
  const categoryMap = {
    browse_projects: "Projects",
    manage_project: "Projects",
    browse_namespaces: "Projects",
    manage_namespace: "Projects",
    browse_commits: "Repository",
    browse_events: "Activity",
    browse_users: "Users",
    browse_todos: "Activity",
    manage_todos: "Activity",
    browse_merge_requests: "Merge Requests",
    browse_mr_discussions: "Merge Requests",
    manage_merge_request: "Merge Requests",
    manage_mr_discussion: "Merge Requests",
    manage_draft_notes: "Merge Requests",
    browse_files: "Repository",
    manage_files: "Repository",
    browse_milestones: "Planning",
    manage_milestone: "Planning",
    browse_pipelines: "CI/CD",
    manage_pipeline: "CI/CD",
    manage_pipeline_job: "CI/CD",
    browse_variables: "CI/CD",
    manage_variable: "CI/CD",
    browse_wiki: "Content",
    manage_wiki: "Content",
    browse_work_items: "Planning",
    manage_work_item: "Planning",
    browse_labels: "Planning",
    manage_label: "Planning",
    browse_snippets: "Content",
    manage_snippet: "Content",
    browse_webhooks: "Integrations",
    manage_webhook: "Integrations",
    browse_integrations: "Integrations",
    manage_integration: "Integrations",
    browse_releases: "Releases",
    manage_release: "Releases",
    browse_refs: "Repository",
    manage_ref: "Repository",
    browse_members: "Access",
    manage_member: "Access",
    browse_search: "Discovery",
    browse_iterations: "Planning",
    manage_context: "Session",
  };

  return categoryMap[toolName] || "General";
}

/**
 * Check if tool is read-only based on naming convention
 * @param {string} toolName - Tool name
 * @returns {boolean}
 */
function isReadOnly(toolName) {
  return toolName.startsWith("browse_") || toolName === "manage_context";
}

/**
 * Transform tool data for MCP manifest
 * @param {Object} tool - Tool from list-tools --json
 * @returns {Object} - Simplified tool for manifest
 */
function transformTool(tool) {
  // Normalize tier: "unknown" means tool has no tier requirement, treat as "free"
  const tier = tool.tier && tool.tier !== "unknown" ? tool.tier : "free";

  return {
    name: tool.name,
    description: truncateDescription(tool.description),
    category: extractCategory(tool.name),
    tier,
    readOnly: isReadOnly(tool.name),
  };
}

/**
 * Truncate description to first sentence for manifest brevity
 * @param {string} description - Full tool description
 * @returns {string} - First sentence or truncated description
 */
function truncateDescription(description) {
  if (!description) return "";

  // Remove "Related:" section
  const relatedIndex = description.indexOf("Related:");
  let clean = relatedIndex > 0 ? description.substring(0, relatedIndex).trim() : description;

  // Take first sentence
  const firstSentenceEnd = clean.search(/\.\s/);
  if (firstSentenceEnd > 0 && firstSentenceEnd < 200) {
    return clean.substring(0, firstSentenceEnd + 1);
  }

  // Truncate if too long
  if (clean.length > 200) {
    return clean.substring(0, 197) + "...";
  }

  return clean;
}

async function main() {
  const packageJsonPath = path.resolve(process.cwd(), "package.json");

  // Read tools from stdin
  let toolsJson;
  try {
    const input = await readStdin();
    if (!input.trim()) {
      console.error("Error: No input received. Usage: yarn list-tools --json | node scripts/update-mcp-manifest.js");
      process.exit(1);
    }
    toolsJson = JSON.parse(input);
  } catch (error) {
    console.error("Error parsing tools JSON:", error.message);
    process.exit(1);
  }

  if (!Array.isArray(toolsJson)) {
    console.error("Error: Expected array of tools");
    process.exit(1);
  }

  // Read package.json
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch (error) {
    console.error("Error reading package.json:", error.message);
    process.exit(1);
  }

  // Ensure mcp section exists
  if (!pkg.mcp) {
    pkg.mcp = {};
  }

  // Transform and update tools
  const transformedTools = toolsJson.map(transformTool);
  pkg.mcp.tools = transformedTools;

  // Count tools by category for summary
  const categoryCounts = {};
  for (const tool of transformedTools) {
    categoryCounts[tool.category] = (categoryCounts[tool.category] || 0) + 1;
  }

  // Count read-only tools
  const readOnlyCount = transformedTools.filter((t) => t.readOnly).length;

  // Count unique entity types (categories)
  const entityCount = Object.keys(categoryCounts).length;

  // Update description with current counts
  pkg.mcp.description = `Model Context Protocol server for GitLab API - ${transformedTools.length} tools across ${entityCount} entity types with CQRS architecture, OAuth 2.1, and multiple transport modes`;

  // Write updated package.json
  try {
    fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + "\n");
  } catch (error) {
    console.error("Error writing package.json:", error.message);
    process.exit(1);
  }

  console.log(`MCP manifest updated: ${transformedTools.length} tools (${readOnlyCount} read-only), ${entityCount} categories`);
  console.log("Categories:", Object.entries(categoryCounts).map(([k, v]) => `${k}(${v})`).join(", "));
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
