#!/usr/bin/env node

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-non-null-assertion, no-case-declarations */
import * as fs from "fs";
import * as path from "path";
import { RegistryManager } from "./registry-manager";
import { ToolAvailability } from "./services/ToolAvailability";

interface JsonSchemaProperty {
  type?: string;
  $ref?: string;
  properties?: Record<string, JsonSchemaProperty>;
  items?: JsonSchemaProperty;
  enum?: unknown[];
  oneOf?: JsonSchemaProperty[];
  anyOf?: JsonSchemaProperty[];
  description?: string;
  required?: string[];
  _def?: {
    schema?: {
      _def?: {
        checks?: Array<{ message?: string }>;
      };
    };
  };
  [key: string]: unknown;
}

interface CliOptions {
  format: "markdown" | "json" | "simple" | "export";
  entity?: string;
  tool?: string;
  showEnv?: boolean;
  verbose?: boolean;
  detail?: boolean;
  noExamples?: boolean;
  toc?: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    format: "markdown",
    showEnv: false,
    verbose: false,
    detail: false,
    noExamples: false,
    toc: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--json":
        options.format = "json";
        break;
      case "--simple":
        options.format = "simple";
        break;
      case "--export":
        options.format = "export";
        break;
      case "--entity":
        options.entity = args[++i];
        break;
      case "--tool":
        options.tool = args[++i];
        break;
      case "--env":
        options.showEnv = true;
        break;
      case "--verbose":
      case "-v":
        options.verbose = true;
        break;
      case "--detail":
        options.detail = true;
        break;
      case "--no-examples":
        options.noExamples = true;
        break;
      case "--toc":
        options.toc = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
GitLab MCP Tool Lister

Usage: yarn list-tools [options]

Options:
  --json              Output in JSON format
  --simple            Simple list of tool names
  --export            Generate complete TOOLS.md documentation
  --entity <name>     Filter by entity (e.g., workitems, labels, mrs)
  --tool <name>       Show details for specific tool
  --env               Show environment configuration
  --verbose, -v       Show additional details
  --detail            Show all tools with their input schemas
  --no-examples       Skip example JSON blocks (for --export)
  --toc               Include table of contents (for --export)
  --help, -h          Show this help

Examples:
  yarn list-tools                                # List all tools in markdown
  yarn list-tools --json                         # JSON output
  yarn list-tools --export                       # Generate TOOLS.md to stdout
  yarn list-tools --export > docs/TOOLS.md       # Generate TOOLS.md to file
  yarn list-tools --export --toc                 # With table of contents
  yarn list-tools --export --no-examples         # Skip example JSON blocks
  yarn list-tools --entity workitems             # Only work items tools
  yarn list-tools --tool list_work_items         # Specific tool details
  GITLAB_READONLY=true yarn list-tools           # Show read-only tools
  GITLAB_DENIED_TOOLS_REGEX="^create" yarn list-tools  # Test filtering

Environment Variables:
  GITLAB_READONLY              Show only read-only tools
  GITLAB_DENIED_TOOLS_REGEX    Regex pattern to exclude tools
  GITLAB_ALLOWED_TOOLS_REGEX   Regex pattern to include tools
  `);
}

function resolveJsonSchemaType(prop: JsonSchemaProperty, schema: JsonSchemaProperty): string {
  // Handle $ref references
  if (prop.$ref) {
    const refPath = prop.$ref.replace("#/properties/", "");
    const referencedProp = schema.properties?.[refPath];
    if (referencedProp) {
      return resolveJsonSchemaType(referencedProp, schema);
    }
    return "reference";
  }

  // Handle direct type
  if (prop.type) {
    if (prop.type === "array" && prop.items) {
      const itemType = resolveJsonSchemaType(prop.items, schema);
      return `${itemType}[]`;
    }
    return prop.type;
  }

  // Handle enum without explicit type (usually string)
  if (prop.enum) {
    return "enum";
  }

  // Handle union types
  if (prop.oneOf ?? prop.anyOf) {
    const unionTypes =
      (prop.oneOf ?? prop.anyOf)?.map(option => resolveJsonSchemaType(option, schema)) ?? [];
    return unionTypes.join(" | ");
  }

  return "unknown";
}

function getParameterDescription(schema: JsonSchemaProperty): string[] {
  const params: string[] = [];

  if (schema.properties) {
    for (const [key, value] of Object.entries(schema.properties)) {
      const prop = value;
      const required = schema.required?.includes(key) ?? false;
      const type = resolveJsonSchemaType(prop, schema);
      const description = prop.description ?? "";

      let paramStr = `  - \`${key}\` (${type}${required ? ", required" : ", optional"})`;
      if (description) {
        paramStr += `: ${description}`;
      }
      params.push(paramStr);
    }
  }

  // Handle refinements (like list_work_items with exactly one of groupPath/projectPath)
  if (schema._def?.schema?._def?.checks) {
    const checks = schema._def.schema._def.checks;
    for (const check of checks) {
      if (check.message) {
        params.push(`  - **Validation**: ${check.message}`);
      }
    }
  }

  return params;
}

function printEnvironmentInfo(): void {
  console.log("=== Environment Configuration ===\n");
  console.log(`GITLAB_READONLY: ${process.env.GITLAB_READONLY ?? "false"}`);
  console.log(`GITLAB_DENIED_TOOLS_REGEX: ${process.env.GITLAB_DENIED_TOOLS_REGEX ?? "(not set)"}`);
  console.log(
    `GITLAB_ALLOWED_TOOLS_REGEX: ${process.env.GITLAB_ALLOWED_TOOLS_REGEX ?? "(not set)"}`
  );
  console.log(`GITLAB_API_URL: ${process.env.GITLAB_API_URL ?? "https://gitlab.com"}`);
  console.log();
}

function getToolTierInfo(toolName: string): string {
  const requirement = ToolAvailability.getToolRequirement(toolName);
  if (!requirement) return "";

  const tierBadge =
    {
      free: "Free",
      premium: "Premium",
      ultimate: "Ultimate",
    }[requirement.requiredTier] ?? requirement.requiredTier;

  return `[tier: ${tierBadge}]`;
}

// Map of entity names to their CQRS tool names
const ENTITY_TOOLS: Record<string, string[]> = {
  Core: [
    "browse_projects",
    "browse_namespaces",
    "browse_commits",
    "browse_events",
    "create_branch",
    "create_group",
    "manage_repository",
    "list_project_members",
    "list_group_iterations",
    "download_attachment",
    "get_users",
  ],
  "Work Items": ["browse_work_items", "manage_work_item"],
  "Merge Requests": [
    "browse_merge_requests",
    "browse_mr_discussions",
    "manage_merge_request",
    "manage_mr_discussion",
    "manage_draft_notes",
  ],
  Labels: ["browse_labels", "manage_label"],
  Wiki: ["browse_wiki", "manage_wiki"],
  Pipelines: ["browse_pipelines", "manage_pipeline", "manage_pipeline_job"],
  Variables: ["browse_variables", "manage_variable"],
  Milestones: ["browse_milestones", "manage_milestone"],
  Files: ["browse_files", "manage_files"],
  Snippets: ["browse_snippets", "manage_snippet"],
  Webhooks: ["list_webhooks", "manage_webhook"],
  Integrations: ["list_integrations", "manage_integration"],
  Todos: ["list_todos", "manage_todos"],
};

function groupToolsByEntity(tools: any[]): Map<string, any[]> {
  const grouped = new Map<string, any[]>();

  // Build reverse lookup: tool name -> entity
  const toolToEntity = new Map<string, string>();
  for (const [entity, toolNames] of Object.entries(ENTITY_TOOLS)) {
    for (const toolName of toolNames) {
      toolToEntity.set(toolName, entity);
    }
  }

  for (const tool of tools) {
    const entity = toolToEntity.get(tool.name) ?? "Other";

    if (!grouped.has(entity)) {
      grouped.set(entity, []);
    }
    grouped.get(entity)!.push(tool);
  }

  // Sort entities in a logical order
  const entityOrder = [
    "Core",
    "Work Items",
    "Merge Requests",
    "Labels",
    "Milestones",
    "Pipelines",
    "Variables",
    "Files",
    "Wiki",
    "Snippets",
    "Webhooks",
    "Integrations",
    "Todos",
    "Other",
  ];

  const sortedGrouped = new Map<string, any[]>();
  for (const entity of entityOrder) {
    if (grouped.has(entity)) {
      sortedGrouped.set(entity, grouped.get(entity)!);
    }
  }

  return sortedGrouped;
}

interface ActionInfo {
  name: string;
  description: string;
}

interface ParameterInfo {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

/**
 * Extract actions from a CQRS schema.
 * Looks for action enum in properties.action.enum
 */
function extractActions(schema: JsonSchemaProperty): ActionInfo[] {
  const actions: ActionInfo[] = [];

  // Check for action enum in properties
  const actionProp = schema.properties?.action;
  if (actionProp?.enum && Array.isArray(actionProp.enum)) {
    for (const actionName of actionProp.enum) {
      if (typeof actionName === "string") {
        // Try to find description for this action from descriptions in field descriptions
        let description = "";

        // Look through all properties for hints about what this action does
        if (actionName === "list") description = "List items with filtering and pagination";
        else if (actionName === "get") description = "Get a single item by ID";
        else if (actionName === "create") description = "Create a new item";
        else if (actionName === "update") description = "Update an existing item";
        else if (actionName === "delete") description = "Delete an item";
        else if (actionName === "search") description = "Search for items";
        else if (actionName === "diffs") description = "Get file changes/diffs";
        else if (actionName === "compare") description = "Compare two branches or commits";
        else if (actionName === "merge") description = "Merge a merge request";
        else if (actionName === "approve") description = "Approve a merge request";
        else if (actionName === "unapprove") description = "Remove approval from a merge request";
        else if (actionName === "rebase") description = "Rebase a merge request";
        else if (actionName === "cancel") description = "Cancel a running operation";
        else if (actionName === "retry") description = "Retry a failed operation";
        else if (actionName === "play") description = "Run a manual job";
        else if (actionName === "publish") description = "Publish draft notes";
        else if (actionName === "drafts") description = "List draft notes";
        else if (actionName === "draft") description = "Get a single draft note";
        else if (actionName === "resolve") description = "Resolve a discussion thread";
        else if (actionName === "unresolve") description = "Unresolve a discussion thread";
        else if (actionName === "note") description = "Add a note/comment";
        else if (actionName === "mark_done") description = "Mark as done";
        else if (actionName === "mark_pending") description = "Mark as pending";
        else if (actionName === "disable") description = "Disable the integration";
        else if (actionName === "test") description = "Test a webhook";
        else if (actionName === "read") description = "Read item details";
        else description = `Perform ${actionName} operation`;

        actions.push({ name: actionName, description });
      }
    }
  }

  return actions;
}

/**
 * Extract parameters with their action applicability from schema
 */
function extractParameters(schema: JsonSchemaProperty): ParameterInfo[] {
  const params: ParameterInfo[] = [];

  if (!schema.properties) return params;

  const requiredFields = schema.required ?? [];

  for (const [name, prop] of Object.entries(schema.properties)) {
    const type = resolveJsonSchemaType(prop, schema);
    const required = requiredFields.includes(name);
    const description = prop.description ?? "";

    params.push({
      name,
      type,
      required,
      description,
    });
  }

  // Sort: required first, then alphabetically
  params.sort((a, b) => {
    if (a.required && !b.required) return -1;
    if (!a.required && b.required) return 1;
    // Action field always first
    if (a.name === "action") return -1;
    if (b.name === "action") return 1;
    return a.name.localeCompare(b.name);
  });

  return params;
}

/**
 * Generate example JSON for a tool
 */
function generateExample(toolName: string, schema: JsonSchemaProperty): Record<string, unknown> {
  const example: Record<string, unknown> = {};
  const actions = extractActions(schema);

  // Use first action as default
  if (actions.length > 0) {
    example.action = actions[0].name;
  }

  if (!schema.properties) return example;

  const requiredFields = schema.required ?? [];

  for (const [name, prop] of Object.entries(schema.properties)) {
    if (name === "action") continue; // Already handled

    const isRequired = requiredFields.includes(name);
    const description = (prop.description ?? "").toLowerCase();

    // Only include required fields and some common optional ones
    if (!isRequired) continue;

    // Generate example values based on type and name
    if (prop.enum && Array.isArray(prop.enum) && prop.enum.length > 0) {
      example[name] = prop.enum[0];
    } else if (name.includes("project_id") || name === "projectId") {
      example[name] = "my-group/my-project";
    } else if (name.includes("group_id") || name === "groupId") {
      example[name] = "my-group";
    } else if (name.includes("namespace")) {
      example[name] = "my-group/my-project";
    } else if (name.includes("_iid") || name === "iid") {
      example[name] = "1";
    } else if (name.includes("_id") || name === "id") {
      example[name] = "123";
    } else if (name === "title") {
      example[name] = "Example title";
    } else if (name === "description") {
      example[name] = "Example description";
    } else if (name === "url") {
      example[name] = "https://example.com/webhook";
    } else if (name === "content") {
      example[name] = "File content here";
    } else if (name === "file_path" || name === "path") {
      example[name] = "path/to/file.txt";
    } else if (name === "ref" || name === "branch") {
      example[name] = "main";
    } else if (name === "from" || name === "to") {
      example[name] = name === "from" ? "main" : "feature-branch";
    } else if (description.includes("boolean") || prop.type === "boolean") {
      example[name] = true;
    } else if (prop.type === "number" || prop.type === "integer") {
      example[name] = 10;
    } else if (prop.type === "array") {
      example[name] = [];
    } else {
      example[name] = `example_${name}`;
    }
  }

  return example;
}

/**
 * Get package version from package.json
 */
function getPackageVersion(): string {
  try {
    // Find package.json by looking for it from cwd upwards
    let dir = process.cwd();
    for (let i = 0; i < 5; i++) {
      const pkgPath = path.join(dir, "package.json");
      if (fs.existsSync(pkgPath)) {
        const content = fs.readFileSync(pkgPath, "utf8");
        const pkg = JSON.parse(content) as { version?: string; name?: string };
        // Verify it's our package
        if (pkg.name === "@structured-world/gitlab-mcp") {
          return pkg.version ?? "unknown";
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Generate complete TOOLS.md content
 */
function generateExportMarkdown(
  tools: any[],
  options: { noExamples?: boolean; toc?: boolean }
): string {
  const lines: string[] = [];
  const version = getPackageVersion();
  const timestamp = new Date().toISOString().split("T")[0];

  // Header
  lines.push("# GitLab MCP Tools Reference");
  lines.push("");
  lines.push("> Auto-generated from source code. Do not edit manually.");
  lines.push(`> Generated: ${timestamp} | Tools: ${tools.length} | Version: ${version}`);
  lines.push("");

  const grouped = groupToolsByEntity(tools);

  // Table of Contents
  if (options.toc) {
    lines.push("## Table of Contents");
    lines.push("");
    for (const [entity, entityTools] of grouped) {
      const anchor = entity.toLowerCase().replace(/\s+/g, "-");
      lines.push(`- [${entity} (${entityTools.length})](#${anchor})`);
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  // Tools by category
  for (const [entity, entityTools] of grouped) {
    lines.push(`## ${entity}`);
    lines.push("");

    for (const tool of entityTools) {
      const tierInfo = getToolTierInfo(tool.name);
      const tierDisplay = tierInfo ? ` ${tierInfo}` : "";

      lines.push(`### ${tool.name}${tierDisplay}`);
      lines.push("");
      lines.push(tool.description);
      lines.push("");

      // Actions table
      const actions = extractActions(tool.inputSchema);
      if (actions.length > 0) {
        lines.push("#### Actions");
        lines.push("");
        lines.push("| Action | Description |");
        lines.push("|--------|-------------|");
        for (const action of actions) {
          lines.push(`| \`${action.name}\` | ${action.description} |`);
        }
        lines.push("");
      }

      // Parameters table
      const params = extractParameters(tool.inputSchema);
      if (params.length > 0) {
        lines.push("#### Parameters");
        lines.push("");
        lines.push("| Parameter | Type | Required | Description |");
        lines.push("|-----------|------|----------|-------------|");
        for (const param of params) {
          const req = param.required ? "Yes" : "No";
          const desc = param.description || "-";
          lines.push(`| \`${param.name}\` | ${param.type} | ${req} | ${desc} |`);
        }
        lines.push("");
      }

      // Example
      if (!options.noExamples && tool.inputSchema) {
        const example = generateExample(tool.name, tool.inputSchema);
        if (Object.keys(example).length > 0) {
          lines.push("#### Example");
          lines.push("");
          lines.push("```json");
          lines.push(JSON.stringify(example, null, 2));
          lines.push("```");
          lines.push("");
        }
      }

      lines.push("---");
      lines.push("");
    }
  }

  return lines.join("\n");
}

export async function main() {
  const options = parseArgs();

  if (options.showEnv) {
    printEnvironmentInfo();
  }

  // Get all tools from registry manager
  // For export mode: get ALL tools without filtering (for documentation)
  // For other modes: respect env vars filtering
  const registryManager = RegistryManager.getInstance();
  const toolDefinitions =
    options.format === "export"
      ? registryManager.getAllToolDefinitionsUnfiltered()
      : registryManager.getAllToolDefinitionsTierless();
  const tools = toolDefinitions.map(def => ({
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
  }));

  // Filter by entity if specified
  let filteredTools = tools;
  if (options.entity) {
    const grouped = groupToolsByEntity(tools);
    const entityKey = Array.from(grouped.keys()).find(
      k => k.toLowerCase().replace(" ", "") === options.entity!.toLowerCase().replace(" ", "")
    );
    filteredTools = entityKey ? (grouped.get(entityKey) ?? []) : [];

    if (filteredTools.length === 0) {
      console.error(`No tools found for entity: ${options.entity}`);
      process.exit(1);
    }
  }

  // Filter by specific tool if specified
  if (options.tool) {
    filteredTools = filteredTools.filter(t => t.name === options.tool);
    if (filteredTools.length === 0) {
      console.error(`Tool not found: ${options.tool}`);
      process.exit(1);
    }
  }

  // Output based on format
  switch (options.format) {
    case "json":
      const output = filteredTools.map(tool => ({
        name: tool.name,
        description: tool.description,
        tier: ToolAvailability.getToolRequirement(tool.name)?.requiredTier ?? "unknown",
        minVersion: ToolAvailability.getToolRequirement(tool.name)?.minVersion,
        parameters: tool.inputSchema,
      }));
      console.log(JSON.stringify(output, null, 2));
      break;

    case "simple":
      filteredTools.forEach(tool => {
        console.log(tool.name);
      });
      break;

    case "export":
      const markdown = generateExportMarkdown(filteredTools, {
        noExamples: options.noExamples,
        toc: options.toc,
      });
      console.log(markdown);
      break;

    case "markdown":
    default:
      if (!options.entity && !options.tool) {
        console.log("# GitLab MCP Tools\n");
        console.log(`Total tools available: ${filteredTools.length}\n`);

        const grouped = groupToolsByEntity(filteredTools);

        // Show summary
        console.log("## Categories\n");
        for (const [entity, entityTools] of grouped) {
          console.log(`- **${entity}**: ${entityTools.length} tools`);
        }
        console.log();

        // Show tools by category
        for (const [entity, entityTools] of grouped) {
          console.log(`## ${entity}\n`);

          for (const tool of entityTools) {
            const tierInfo = getToolTierInfo(tool.name);
            const tierDisplay = tierInfo ? ` ${tierInfo}` : "";
            console.log(`### ${tool.name}${tierDisplay}`);
            console.log(`**Description**: ${tool.description}\n`);

            if ((options.verbose || options.detail) && tool.inputSchema) {
              console.log("**Parameters**:");
              const params = getParameterDescription(tool.inputSchema);
              if (params.length > 0) {
                params.forEach(p => console.log(p));
              } else {
                console.log("  (no parameters)");
              }
              console.log();
            }
          }
        }
      } else {
        // Detailed view for filtered results
        for (const tool of filteredTools) {
          const tierInfo = getToolTierInfo(tool.name);
          const tierDisplay = tierInfo ? ` ${tierInfo}` : "";
          console.log(`## ${tool.name}${tierDisplay}\n`);
          console.log(`**Description**: ${tool.description}\n`);

          if (tool.inputSchema) {
            console.log("**Parameters**:\n");
            const params = getParameterDescription(tool.inputSchema);
            if (params.length > 0) {
              params.forEach(p => console.log(p));
            } else {
              console.log("(no parameters)");
            }
          }
          console.log();
        }
      }
      break;
  }

  if (options.showEnv && options.format === "markdown") {
    console.log("\n---\n");
    console.log("*Note: Tool availability may be affected by environment variables shown above.*");
  }
}

// Auto-execute when script is run directly
if (!process.env.NODE_ENV || process.env.NODE_ENV !== "test") {
  main().catch(error => {
    console.error("Error:", error);
    process.exit(1);
  });
}
