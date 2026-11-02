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

import * as fs from 'fs';
import * as path from 'path';
import {
  extractActions,
  loadToolCatalog,
  type JsonSchemaProperty,
  type ActionInfo,
} from './tool-catalog.js';

interface MarkerMatch {
  toolName: string;
  startIdx: number;
  endIdx: number;
}

/**
 * Generate markdown action table for a tool.
 */
function generateActionsTable(actions: ActionInfo[]): string {
  const lines: string[] = [];
  lines.push('| Action | Description |');
  lines.push('|--------|-------------|');
  for (const action of actions) {
    const desc = action.description.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
    lines.push(`| \`${action.name}\` | ${desc} |`);
  }
  return lines.join('\n');
}

/**
 * Find all @autogen:tool markers in file content.
 */
function findMarkers(content: string): MarkerMatch[] {
  const markers: MarkerMatch[] = [];
  const startPattern = /<!-- @autogen:tool (\S+) -->/g;
  const endPattern = '<!-- @autogen:end -->';

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
  content?: string,
): boolean {
  const fileContent = content ?? fs.readFileSync(filePath, 'utf8');
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
          `Available tools: ${Array.from(toolSchemas.keys()).sort().join(', ')}`,
      );
    }

    const actions = extractActions(schema);
    if (actions.length === 0) {
      throw new Error(`Tool "${marker.toolName}" has no extractable actions in ${filePath}`);
    }

    const table = generateActionsTable(actions);
    const startTag = `<!-- @autogen:tool ${marker.toolName} -->`;
    const endTag = '<!-- @autogen:end -->';
    const replacement = `${startTag}\n${table}\n${endTag}`;

    result = result.slice(0, marker.startIdx) + replacement + result.slice(marker.endIdx);
  }

  if (result !== fileContent) {
    fs.writeFileSync(filePath, result, 'utf8');
    return true;
  }

  return false;
}

interface Placeholders {
  toolCount: number;
  toolGroupCount: number;
  cqrsToolCount: number;
  helperToolCount: number;
  readonlyToolCount: number;
  actionCount: number;
  version: string;
}

/**
 * Replace catalog counts, CQRS/helper counts, read-only counts, action counts,
 * and __VERSION__ placeholders. Returns true if file was modified.
 */
function replacePlaceholders(filePath: string, placeholders: Placeholders): boolean {
  const content = fs.readFileSync(filePath, 'utf8');
  const result = content
    .replace(/__TOOL_COUNT__/g, String(placeholders.toolCount))
    .replace(/__ACTION_COUNT__/g, String(placeholders.actionCount))
    .replaceAll('__TOOL_GROUP_COUNT__', String(placeholders.toolGroupCount))
    .replaceAll('__CQRS_TOOL_COUNT__', String(placeholders.cqrsToolCount))
    .replaceAll('__HELPER_TOOL_COUNT__', String(placeholders.helperToolCount))
    .replace(/__READONLY_TOOL_COUNT__/g, String(placeholders.readonlyToolCount))
    .replace(/__VERSION__/g, placeholders.version);

  if (result !== content) {
    fs.writeFileSync(filePath, result, 'utf8');
    return true;
  }
  return false;
}

/**
 * Get version from RELEASE_VERSION env var or package.json.
 * RELEASE_VERSION is set by CI from the latest GitHub release tag.
 */
function getVersion(projectRoot: string): string {
  // CI provides RELEASE_VERSION from latest GitHub release
  if (process.env.RELEASE_VERSION) {
    return process.env.RELEASE_VERSION;
  }

  // Fallback to package.json version (may be dev version)
  const packageJsonPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      version?: string;
    };
    return packageJson.version ?? '0.0.0';
  }

  return '0.0.0';
}

/**
 * Main entry point. Scans docs/tools/*.md and injects action tables.
 * Also generates .md/.txt from .in templates with tool, group, CQRS/helper,
 * __READONLY_TOOL_COUNT__, and __VERSION__ placeholders replaced by actual values.
 */
export function main(): void {
  // Find project root (where package.json is)
  let projectRoot = process.cwd();
  while (!fs.existsSync(path.join(projectRoot, 'package.json'))) {
    const parent = path.dirname(projectRoot);
    if (parent === projectRoot) break;
    projectRoot = parent;
  }

  const docsToolsDir = path.join(projectRoot, 'docs', 'tools');
  if (!fs.existsSync(docsToolsDir)) {
    console.error(`Error: docs/tools/ directory not found at ${docsToolsDir}`);
    process.exit(1);
  }

  // Load all tool schemas from registry
  const { tools: allTools, metrics } = loadToolCatalog();
  const toolSchemas = new Map<string, JsonSchemaProperty>();
  for (const tool of allTools) {
    toolSchemas.set(tool.name, tool.inputSchema);
  }

  const version = getVersion(projectRoot);
  console.log(
    `  ${metrics.description}, ${metrics.readonlyToolCount} available in read-only mode, Version: ${version}`,
  );

  const placeholders: Placeholders = {
    ...metrics,
    version,
  };

  // Generate docs from .in templates (*.md.in -> *.md, *.txt.in -> *.txt)
  const docsDir = path.join(projectRoot, 'docs');
  let templateCount = 0;
  if (fs.existsSync(docsDir)) {
    function processTemplates(dir: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        // Skip build artifacts and dependencies; .git/coverage/tmp are not present in docs/
        if (entry.isDirectory() && !['node_modules', '.vitepress', 'dist'].includes(entry.name)) {
          processTemplates(fullPath);
        } else if (
          entry.isFile() &&
          (entry.name.endsWith('.md.in') || entry.name.endsWith('.txt.in'))
        ) {
          const outputPath = fullPath.replace(/\.in$/, '');
          fs.copyFileSync(fullPath, outputPath);
          replacePlaceholders(outputPath, placeholders);
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
    .filter((f) => f.endsWith('.md'))
    .map((f) => path.join(docsToolsDir, f));

  let modifiedCount = 0;
  let markerCount = 0;

  for (const filePath of mdFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
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
    `inject-tool-refs: ${markerCount} marker(s) in ${mdFiles.length} file(s), ${modifiedCount} updated.`,
  );
}

// Exported for unit testing
export { generateActionsTable, findMarkers, processFile, replacePlaceholders, getVersion };
export type { MarkerMatch, Placeholders };

// Auto-execute when run directly
if (process.env.NODE_ENV !== 'test') {
  main();
}
