import { RegistryManager } from '../registry-manager.js';
import type { ToolDefinition } from '../types.js';

export interface JsonSchemaProperty {
  type?: string;
  properties?: Record<string, JsonSchemaProperty>;
  oneOf?: JsonSchemaProperty[];
  enum?: unknown[];
  const?: unknown;
  description?: string;
  [key: string]: unknown;
}

export interface ActionInfo {
  name: string;
  description: string;
}

const ACTION_DESCRIPTIONS: Record<string, string> = {
  list: 'List items with filtering and pagination',
  get: 'Get a single item by ID',
  create: 'Create a new item',
  update: 'Update an existing item',
  delete: 'Delete an item',
  search: 'Search for items',
  diffs: 'Get file changes/diffs',
  compare: 'Compare two branches or commits',
  merge: 'Merge a merge request',
  approve: 'Approve a merge request',
  unapprove: 'Remove approval from a merge request',
  rebase: 'Rebase a merge request',
  cancel: 'Cancel a running operation',
  retry: 'Retry a failed operation',
  play: 'Run a manual job',
  publish: 'Publish draft notes',
  drafts: 'List draft notes',
  draft: 'Get a single draft note',
  resolve: 'Resolve a discussion thread',
  unresolve: 'Unresolve a discussion thread',
  note: 'Add a note/comment',
  mark_done: 'Mark as done',
  mark_pending: 'Mark as pending',
  disable: 'Disable the integration',
  test: 'Test a webhook',
  read: 'Read item details',
};

/** Action names and descriptions used by both documentation and publication metrics. */
export function extractActions(schema: JsonSchemaProperty): ActionInfo[] {
  const actions: ActionInfo[] = [];
  if (Array.isArray(schema.oneOf)) {
    for (const branch of schema.oneOf) {
      const action = branch.properties?.action;
      if (typeof action?.const === 'string') {
        actions.push({
          name: action.const,
          description:
            action.description ??
            ACTION_DESCRIPTIONS[action.const] ??
            `Perform ${action.const} operation`,
        });
      }
    }
    return actions;
  }
  const action = schema.properties?.action;
  const names = Array.isArray(action?.enum) ? action.enum : [action?.const];
  for (const name of names) {
    if (typeof name === 'string')
      actions.push({
        name,
        description:
          (Array.isArray(action?.enum) ? undefined : action?.description) ??
          ACTION_DESCRIPTIONS[name] ??
          `Perform ${name} operation`,
      });
  }
  return actions;
}

export interface CatalogMetrics {
  toolCount: number;
  cqrsToolCount: number;
  helperToolCount: number;
  actionCount: number;
  /** Complete registry groups, including core/context, not configurable settings switches. */
  toolGroupCount: number;
  readonlyToolCount: number;
  description: string;
}

/** Count declared actions, not schema variants, and use each registry's read-only policy. */
export function measureCatalog(catalog: {
  tools: ToolDefinition[];
  toolGroupCount: number;
  readOnlyToolNames: string[];
}): CatalogMetrics {
  const readOnly = new Set(catalog.readOnlyToolNames);
  let actionCount = 0;
  let cqrsToolCount = 0;
  let readonlyToolCount = 0;
  for (const tool of catalog.tools) {
    const names = new Set(extractActions(tool.inputSchema).map((action) => action.name));
    actionCount += names.size;
    if (names.size > 0) cqrsToolCount++;
    if (readOnly.has(tool.name)) readonlyToolCount++;
  }
  const toolCount = catalog.tools.length;
  return {
    toolCount,
    cqrsToolCount,
    helperToolCount: toolCount - cqrsToolCount,
    actionCount,
    toolGroupCount: catalog.toolGroupCount,
    readonlyToolCount,
    description: `${toolCount} tools, ${actionCount} typed actions, ${catalog.toolGroupCount} registry groups`,
  };
}

export function loadToolCatalog() {
  const catalog = RegistryManager.getInstance().getUnfilteredCatalog();
  return {
    tools: catalog.tools,
    metrics: measureCatalog(catalog),
    readOnlyToolNames: catalog.readOnlyToolNames,
  };
}

// Build-time input for the release and MCPB scripts, never an instance-filtered catalog.
export function main(): void {
  const { tools, metrics, readOnlyToolNames } = loadToolCatalog();
  const readOnly = new Set(readOnlyToolNames);
  console.log(
    JSON.stringify({
      metrics,
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        tier: tool.requirements?.default.tier,
        readOnly: readOnly.has(tool.name),
      })),
    }),
  );
}

if (require.main === module) main();
