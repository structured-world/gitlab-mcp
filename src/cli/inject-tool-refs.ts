#!/usr/bin/env node

/**
 * Scans docs/tools/*.md for markers:
 *   <!-- @autogen:tool TOOL_NAME -->...<!-- @autogen:end -->
 *
 * Replaces content between markers with freshly generated
 * action tables from the tool registry schemas.
 *
 * Run: yarn inject-tool-refs
 * Used in: docs.yml workflow before yarn docs:build
 */

import * as fs from "fs";
import * as path from "path";
import { RegistryManager } from "../registry-manager.js";

interface JsonSchemaProperty {
  type?: string;
  properties?: Record<string, JsonSchemaProperty>;
  oneOf?: JsonSchemaProperty[];
  enum?: unknown[];
  const?: unknown;
  description?: string;
  [key: string]: unknown;
}

interface ActionInfo {
  name: string;
  description: string;
}

interface MarkerMatch {
  toolName: string;
  startIdx: number;
  endIdx: number;
}

// Fallback action descriptions when schema doesn't provide one
const ACTION_DESCRIPTIONS: Record<string, string> = {
  list: "List items with filtering and pagination",
  get: "Get a single item by ID",
  create: "Create a new item",
  update: "Update an existing item",
  delete: "Delete an item",
  search: "Search for items",
  diffs: "Get file changes/diffs",
  compare: "Compare two branches or commits",
  merge: "Merge a merge request",
  approve: "Approve a merge request",
  unapprove: "Remove approval from a merge request",
  cancel: "Cancel a running operation",
  retry: "Retry a failed operation",
  play: "Run a manual job",
  publish: "Publish draft notes",
  resolve: "Resolve a discussion thread",
  disable: "Disable the integration",
  test: "Test a webhook",
};

/**
 * Extract actions from a tool's inputSchema (JSON Schema format).
 * Handles discriminated unions (oneOf with const) and flat enums.
 */
function extractActions(schema: JsonSchemaProperty): ActionInfo[] {
  const actions: ActionInfo[] = [];

  // Discriminated union: oneOf with action.const
  if (schema.oneOf && Array.isArray(schema.oneOf)) {
    for (const branch of schema.oneOf) {
      const actionProp = branch.properties?.action;
      const actionName = actionProp?.const as string | undefined;
      if (actionName) {
        const description =
          (actionProp?.description as string) ??
          ACTION_DESCRIPTIONS[actionName] ??
          `Perform ${actionName} operation`;
        actions.push({ name: actionName, description });
      }
    }
    return actions;
  }

  // Flat schema: action.enum
  const actionProp = schema.properties?.action;
  if (actionProp?.enum && Array.isArray(actionProp.enum)) {
    for (const actionName of actionProp.enum) {
      if (typeof actionName === "string") {
        const description = ACTION_DESCRIPTIONS[actionName] ?? `Perform ${actionName} operation`;
        actions.push({ name: actionName, description });
      }
    }
  }

  return actions;
}

/**
 * Generate markdown action table for a tool.
 */
function generateActionsTable(actions: ActionInfo[]): string {
  const lines: string[] = [];
  lines.push("| Action | Description |");
  lines.push("|--------|-------------|");
  for (const action of actions) {
    const desc = action.description.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
    lines.push(`| \`${action.name}\` | ${desc} |`);
  }
  return lines.join("\n");
}

/**
 * Find all @autogen:tool markers in file content.
 */
function findMarkers(content: string): MarkerMatch[] {
  const markers: MarkerMatch[] = [];
  const startPattern = /<!-- @autogen:tool (\S+) -->/g;
  const endPattern = "<!-- @autogen:end -->";

  let match: RegExpExecArray | null;
  while ((match = startPattern.exec(content)) !== null) {
    const toolName = match[1];
    const startIdx = match.index;
    const afterStart = startIdx + match[0].length;

    const endIdx = content.indexOf(endPattern, afterStart);
    if (endIdx === -1) {
      throw new Error(`Missing <!-- @autogen:end --> for tool "${toolName}"`);
    }

    markers.push({
      toolName,
      startIdx,
      endIdx: endIdx + endPattern.length,
    });
  }

  return markers;
}

/**
 * Process a single markdown file: find markers and inject action tables.
 * Returns true if file was modified.
 */
function processFile(
  filePath: string,
  toolSchemas: Map<string, JsonSchemaProperty>,
  content?: string
): boolean {
  const fileContent = content ?? fs.readFileSync(filePath, "utf8");
  const markers = findMarkers(fileContent);

  if (markers.length === 0) return false;

  // Process markers from end to start to preserve indices
  let result = fileContent;
  for (let i = markers.length - 1; i >= 0; i--) {
    const marker = markers[i];
    const schema = toolSchemas.get(marker.toolName);

    if (!schema) {
      throw new Error(
        `Unknown tool "${marker.toolName}" in ${filePath}. ` +
          `Available tools: ${Array.from(toolSchemas.keys()).sort().join(", ")}`
      );
    }

    const actions = extractActions(schema);
    if (actions.length === 0) {
      throw new Error(`Tool "${marker.toolName}" has no extractable actions in ${filePath}`);
    }

    const table = generateActionsTable(actions);
    const startTag = `<!-- @autogen:tool ${marker.toolName} -->`;
    const endTag = "<!-- @autogen:end -->";
    const replacement = `${startTag}\n${table}\n${endTag}`;

    result = result.slice(0, marker.startIdx) + replacement + result.slice(marker.endIdx);
  }

  if (result !== fileContent) {
    fs.writeFileSync(filePath, result, "utf8");
    return true;
  }

  return false;
}

interface CountPlaceholders {
  toolCount: number;
  entityCount: number;
  readonlyToolCount: number;
}

/**
 * Replace __TOOL_COUNT__, __ENTITY_COUNT__, and __READONLY_TOOL_COUNT__ placeholders in a file.
 * Returns true if file was modified.
 */
function replaceCountPlaceholders(filePath: string, counts: CountPlaceholders): boolean {
  const content = fs.readFileSync(filePath, "utf8");
  const result = content
    .replace(/__TOOL_COUNT__/g, String(counts.toolCount))
    .replace(/__ENTITY_COUNT__/g, String(counts.entityCount))
    .replace(/__READONLY_TOOL_COUNT__/g, String(counts.readonlyToolCount));

  if (result !== content) {
    fs.writeFileSync(filePath, result, "utf8");
    return true;
  }
  return false;
}

/**
 * Count entity types by scanning src/entities/ subdirectories with registry.ts files.
 * Note: fs.existsSync is safe (returns boolean, never throws) so no try/catch needed.
 */
function countEntities(projectRoot: string): number {
  const entitiesDir = path.join(projectRoot, "src", "entities");
  if (!fs.existsSync(entitiesDir)) return 0;

  // readdirSync may throw on permission errors, but that's a fatal misconfiguration
  return fs
    .readdirSync(entitiesDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && fs.existsSync(path.join(entitiesDir, d.name, "registry.ts")))
    .length;
}

/**
 * Main entry point. Scans docs/tools/*.md and injects action tables.
 * Also generates .md/.txt from .in templates with __TOOL_COUNT__, __ENTITY_COUNT__,
 * and __READONLY_TOOL_COUNT__ placeholders replaced by actual counts.
 */
export function main(): void {
  // Find project root (where package.json is)
  let projectRoot = process.cwd();
  while (!fs.existsSync(path.join(projectRoot, "package.json"))) {
    const parent = path.dirname(projectRoot);
    if (parent === projectRoot) break;
    projectRoot = parent;
  }

  const docsToolsDir = path.join(projectRoot, "docs", "tools");
  if (!fs.existsSync(docsToolsDir)) {
    console.error(`Error: docs/tools/ directory not found at ${docsToolsDir}`);
    process.exit(1);
  }

  // Load all tool schemas from registry
  const registryManager = RegistryManager.getInstance();
  const allTools = registryManager.getAllToolDefinitionsUnfiltered();
  const toolSchemas = new Map<string, JsonSchemaProperty>();
  for (const tool of allTools) {
    toolSchemas.set(tool.name, tool.inputSchema as JsonSchemaProperty);
  }

  const toolCount = allTools.length;
  const entityCount = countEntities(projectRoot);
  // Read-only tools: browse_* (queries) + manage_context (read-only despite manage_ prefix)
  // Same pattern used in prepare-release.sh for consistency
  const readonlyToolCount = allTools.filter(
    t => t.name.startsWith("browse_") || t.name === "manage_context"
  ).length;
  console.log(
    `  Tool count: ${toolCount}, Entity count: ${entityCount}, Read-only: ${readonlyToolCount}`
  );

  const counts: CountPlaceholders = { toolCount, entityCount, readonlyToolCount };

  // Generate docs from .in templates (*.md.in -> *.md, *.txt.in -> *.txt)
  const docsDir = path.join(projectRoot, "docs");
  let templateCount = 0;
  if (fs.existsSync(docsDir)) {
    function processTemplates(dir: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        // Skip build artifacts and dependencies; .git/coverage/tmp are not present in docs/
        if (entry.isDirectory() && !["node_modules", ".vitepress", "dist"].includes(entry.name)) {
          processTemplates(fullPath);
        } else if (
          entry.isFile() &&
          (entry.name.endsWith(".md.in") || entry.name.endsWith(".txt.in"))
        ) {
          const outputPath = fullPath.replace(/\.in$/, "");
          fs.copyFileSync(fullPath, outputPath);
          replaceCountPlaceholders(outputPath, counts);
          templateCount++;
          const relPath = path.relative(projectRoot, outputPath);
          console.log(`  Generated: ${relPath} (from ${entry.name})`);
        }
      }
    }
    processTemplates(docsDir);
    if (templateCount > 0) {
      console.log(`  Generated ${templateCount} file(s) from .in templates`);
    }
  }

  // Find all .md files in docs/tools/
  const mdFiles = fs
    .readdirSync(docsToolsDir)
    .filter(f => f.endsWith(".md"))
    .map(f => path.join(docsToolsDir, f));

  let modifiedCount = 0;
  let markerCount = 0;

  for (const filePath of mdFiles) {
    const content = fs.readFileSync(filePath, "utf8");
    const markers = findMarkers(content);
    markerCount += markers.length;

    if (markers.length > 0) {
      const modified = processFile(filePath, toolSchemas, content);
      if (modified) {
        modifiedCount++;
        const relPath = path.relative(projectRoot, filePath);
        console.log(`  Updated: ${relPath} (${markers.length} marker(s))`);
      }
    }
  }

  console.log(
    `inject-tool-refs: ${markerCount} marker(s) in ${mdFiles.length} file(s), ${modifiedCount} updated.`
  );
}

// Exported for unit testing
export {
  extractActions,
  generateActionsTable,
  findMarkers,
  processFile,
  replaceCountPlaceholders,
  countEntities,
};
export type { JsonSchemaProperty, ActionInfo, MarkerMatch };

// Auto-execute when run directly
if (process.env.NODE_ENV !== "test") {
  main();
}
