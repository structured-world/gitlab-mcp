/**
 * Tool selection flow for the setup wizard.
 * Handles preset selection, manual tool category selection, and advanced settings.
 */

import * as p from "@clack/prompts";
import { ToolConfig, ToolConfigMode } from "../types";
import { TOOL_CATEGORIES, PRESET_DEFINITIONS, getToolCount, getTotalToolCount } from "../presets";

/**
 * Map tool category IDs to USE_* environment variables.
 * Used by both local and server flows to apply manual category selection.
 */
const CATEGORY_ENV_MAP: Record<string, string> = {
  "merge-requests": "USE_MRS",
  "work-items": "USE_WORKITEMS",
  pipelines: "USE_PIPELINE",
  files: "USE_FILES",
  wiki: "USE_GITLAB_WIKI",
  snippets: "USE_SNIPPETS",
  releases: "USE_RELEASES",
  refs: "USE_REFS",
  labels: "USE_LABELS",
  milestones: "USE_MILESTONE",
  members: "USE_MEMBERS",
  search: "USE_SEARCH",
  variables: "USE_VARIABLES",
  webhooks: "USE_WEBHOOKS",
  integrations: "USE_INTEGRATIONS",
};

/**
 * Apply manual category selections to env vars.
 * Disables USE_* flags for categories not in the selection.
 */
export function applyManualCategories(
  selectedCategories: string[],
  env: Record<string, string>
): void {
  const selected = new Set(selectedCategories);
  for (const [category, envVar] of Object.entries(CATEGORY_ENV_MAP)) {
    if (!selected.has(category)) {
      env[envVar] = "false";
    }
  }
}

/**
 * Run the tool configuration flow.
 * Presents the user with three options: preset, manual selection, or advanced settings.
 */
export async function runToolSelectionFlow(): Promise<ToolConfig | null> {
  // Step 1: Choose configuration mode
  const mode = await p.select<ToolConfigMode>({
    message: "How do you want to configure tools?",
    options: [
      {
        value: "preset" as ToolConfigMode,
        label: "Use preset (recommended)",
        hint: "Quick setup with role-based tool selection",
      },
      {
        value: "manual" as ToolConfigMode,
        label: "Select tools manually",
        hint: "Choose individual tool categories",
      },
      {
        value: "advanced" as ToolConfigMode,
        label: "Advanced settings",
        hint: "Full control over all environment variables",
      },
    ],
  });

  if (p.isCancel(mode)) {
    return null;
  }

  switch (mode) {
    case "preset":
      return runPresetSelection();
    case "manual":
      return runManualSelection();
    case "advanced":
      return runAdvancedSettings();
  }
}

/**
 * Preset selection flow
 */
async function runPresetSelection(): Promise<ToolConfig | null> {
  const preset = await p.select({
    message: "Select a preset:",
    options: PRESET_DEFINITIONS.map(p => ({
      value: p.id,
      label: p.name,
      hint: p.description,
    })),
  });

  if (p.isCancel(preset)) {
    return null;
  }

  const presetDef = PRESET_DEFINITIONS.find(p => p.id === preset);
  const toolCount = presetDef ? getToolCount(presetDef.enabledCategories) : 0;
  const totalTools = getTotalToolCount();

  p.log.info(`Selected: ${toolCount}/${totalTools} tools`);

  return {
    mode: "preset",
    preset,
    enabledCategories: presetDef?.enabledCategories,
  };
}

/**
 * Manual tool category selection flow
 */
async function runManualSelection(): Promise<ToolConfig | null> {
  const totalTools = getTotalToolCount();

  const selectedCategories = await p.multiselect({
    message: `Select tool categories (${totalTools} tools total):`,
    options: TOOL_CATEGORIES.map(category => ({
      value: category.id,
      label: `${category.name} [${category.tools.length} tools]`,
      hint: category.description,
    })),
    // Pre-select default-enabled categories
    initialValues: TOOL_CATEGORIES.filter(c => c.defaultEnabled).map(c => c.id),
    required: true,
  });

  if (p.isCancel(selectedCategories)) {
    return null;
  }

  const categories = selectedCategories;
  const selectedCount = getToolCount(categories);

  p.log.info(`Selected: ${selectedCount}/${totalTools} tools`);

  return {
    mode: "manual",
    enabledCategories: categories,
  };
}

/**
 * Advanced settings flow - configure environment variables
 */
async function runAdvancedSettings(): Promise<ToolConfig | null> {
  const envOverrides: Record<string, string> = {};

  // Feature flags
  p.log.step("Feature Flags");

  const featureFlags = await p.multiselect({
    message: "Enable features:",
    options: [
      { value: "USE_WORKITEMS", label: "Issues/Work Items", hint: "Issue tracking and epics" },
      { value: "USE_MRS", label: "Merge Requests", hint: "Code review and MR management" },
      { value: "USE_PIPELINE", label: "Pipelines", hint: "CI/CD pipeline management" },
      { value: "USE_FILES", label: "Files", hint: "Repository file operations" },
      { value: "USE_GITLAB_WIKI", label: "Wiki", hint: "Wiki page management" },
      { value: "USE_SNIPPETS", label: "Snippets", hint: "Code snippets" },
      { value: "USE_RELEASES", label: "Releases", hint: "Release management" },
      { value: "USE_REFS", label: "Branches/Tags", hint: "Branch and tag management" },
      { value: "USE_LABELS", label: "Labels", hint: "Label management" },
      { value: "USE_MILESTONE", label: "Milestones", hint: "Milestone management" },
      { value: "USE_MEMBERS", label: "Members", hint: "Team member management" },
      { value: "USE_SEARCH", label: "Search", hint: "Global search" },
      { value: "USE_WEBHOOKS", label: "Webhooks", hint: "Webhook configuration" },
      { value: "USE_INTEGRATIONS", label: "Integrations", hint: "Service integrations" },
      { value: "USE_VARIABLES", label: "Variables", hint: "CI/CD variable management" },
    ],
    initialValues: ["USE_WORKITEMS", "USE_MRS", "USE_PIPELINE", "USE_FILES"],
    required: false,
  });

  if (p.isCancel(featureFlags)) {
    return null;
  }

  // Set all feature flags based on selection (matching src/config.ts USE_* names)
  const allFeatures = [
    "USE_WORKITEMS",
    "USE_MRS",
    "USE_PIPELINE",
    "USE_FILES",
    "USE_GITLAB_WIKI",
    "USE_SNIPPETS",
    "USE_RELEASES",
    "USE_REFS",
    "USE_LABELS",
    "USE_MILESTONE",
    "USE_MEMBERS",
    "USE_SEARCH",
    "USE_WEBHOOKS",
    "USE_INTEGRATIONS",
    "USE_VARIABLES",
  ];
  const selectedFeatures = featureFlags;
  for (const feature of allFeatures) {
    envOverrides[feature] = selectedFeatures.includes(feature) ? "true" : "false";
  }

  // Read-only mode
  const readOnly = await p.confirm({
    message: "Enable read-only mode?",
    initialValue: false,
  });

  if (p.isCancel(readOnly)) {
    return null;
  }

  if (readOnly) {
    envOverrides.GITLAB_READ_ONLY_MODE = "true";
  }

  // Scope restrictions
  const configureScope = await p.confirm({
    message: "Configure scope restrictions?",
    initialValue: false,
  });

  if (p.isCancel(configureScope)) {
    return null;
  }

  if (configureScope) {
    const scopeType = await p.select({
      message: "Scope type:",
      options: [
        { value: "project", label: "Single project", hint: "Restrict to one project" },
        { value: "allowlist", label: "Project allowlist", hint: "Restrict to multiple projects" },
      ],
    });

    if (p.isCancel(scopeType)) {
      return null;
    }

    if (scopeType === "project") {
      const project = await p.text({
        message: "Project ID or path (e.g., group/project):",
        validate: v => (!v ? "Project path is required" : undefined),
      });
      if (p.isCancel(project)) return null;
      envOverrides.GITLAB_PROJECT_ID = project;
    } else {
      const allowlist = await p.text({
        message: "Allowed project paths (comma-separated, e.g., group/project1,group/project2):",
        validate: v => (!v ? "At least one project path is required" : undefined),
      });
      if (p.isCancel(allowlist)) return null;
      envOverrides.GITLAB_ALLOWED_PROJECT_IDS = allowlist;
    }
  }

  // Log level
  const logLevel = await p.select({
    message: "Log level:",
    options: [
      { value: "info", label: "Info (default)" },
      { value: "debug", label: "Debug" },
      { value: "warn", label: "Warn" },
      { value: "error", label: "Error" },
    ],
  });

  if (p.isCancel(logLevel)) {
    return null;
  }

  if (logLevel !== "info") {
    envOverrides.LOG_LEVEL = logLevel;
  }

  return {
    mode: "advanced",
    envOverrides,
  };
}
