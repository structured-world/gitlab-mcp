/**
 * Scope Enforcer - enforces project/namespace/group restrictions
 *
 * When a project config defines a scope, the ScopeEnforcer ensures
 * that all operations are limited to the allowed projects/namespaces/groups.
 *
 * Security model:
 * - Scope is ADDITIVE RESTRICTION only - can only narrow, never expand
 * - Applied at tool invocation time, not registration time
 * - Throws clear error when operation would exceed scope
 */

import { ProjectPreset, ScopeConfig } from "./types";
import { logDebug, logWarn } from "../logger";

// Re-export ScopeConfig for backward compatibility
export type { ScopeConfig } from "./types";

/**
 * Error thrown when an operation exceeds the allowed scope
 */
export class ScopeViolationError extends Error {
  constructor(
    public readonly attemptedTarget: string,
    public readonly allowedScope: ScopeConfig
  ) {
    const scopeDescription = getScopeDescription(allowedScope);
    super(`Operation on '${attemptedTarget}' is outside the allowed scope (${scopeDescription})`);
    this.name = "ScopeViolationError";
  }
}

/**
 * Get a human-readable description of the scope
 */
function getScopeDescription(scope: ScopeConfig): string {
  const parts: string[] = [];

  if (scope.project) {
    parts.push(`project: ${scope.project}`);
  }
  if (scope.group) {
    const subgroupSuffix = scope.includeSubgroups !== false ? "/*" : "";
    parts.push(`group: ${scope.group}${subgroupSuffix}`);
  }
  if (scope.namespace) {
    parts.push(`namespace: ${scope.namespace}/*`);
  }
  if (scope.projects && scope.projects.length > 0) {
    if (scope.projects.length <= 3) {
      parts.push(`projects: ${scope.projects.join(", ")}`);
    } else {
      parts.push(`${scope.projects.length} allowed projects`);
    }
  }
  if (scope.groups && scope.groups.length > 0) {
    if (scope.groups.length <= 3) {
      parts.push(`groups: ${scope.groups.join(", ")}`);
    } else {
      parts.push(`${scope.groups.length} allowed groups`);
    }
  }

  return parts.length > 0 ? parts.join("; ") : "unrestricted";
}

/**
 * Normalize a project path for comparison
 *
 * - Removes leading/trailing slashes
 * - Converts to lowercase
 * - Handles numeric IDs (returns as-is)
 */
function normalizeProjectPath(path: string): string {
  const trimmed = path.trim().replace(/^\/+|\/+$/g, "");
  // If it's a numeric ID, return as-is
  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }
  return trimmed.toLowerCase();
}

/**
 * Check if a path matches a namespace (used for both projects and groups)
 *
 * Examples:
 * - "mygroup/project" matches namespace "mygroup"
 * - "mygroup/subgroup/project" matches namespace "mygroup"
 * - "mygroup/subgroup/project" matches namespace "mygroup/subgroup"
 * - "other/project" does NOT match namespace "mygroup"
 */
export function isInNamespace(projectPath: string, namespace: string): boolean {
  const normalizedProject = normalizeProjectPath(projectPath);
  const normalizedNamespace = normalizeProjectPath(namespace);

  // Project must start with namespace followed by /
  return (
    normalizedProject === normalizedNamespace ||
    normalizedProject.startsWith(normalizedNamespace + "/")
  );
}

/**
 * Scope Enforcer class
 *
 * Enforces project/namespace/group restrictions defined in project config.
 * Use isAllowed()/isGroupAllowed() to check before operations,
 * or enforce()/enforceGroup() to throw on violation.
 */
export class ScopeEnforcer {
  private readonly scope: ScopeConfig;
  private readonly allowedProjectsSet: Set<string>;
  private readonly allowedGroupsSet: Set<string>;
  private readonly includeSubgroups: boolean;

  constructor(scope: ScopeConfig) {
    this.scope = scope;
    this.includeSubgroups = scope.includeSubgroups !== false; // Default true

    // Initialize allowed projects set
    this.allowedProjectsSet = new Set((scope.projects ?? []).map(p => normalizeProjectPath(p)));

    // Add single project to set if specified
    if (scope.project) {
      this.allowedProjectsSet.add(normalizeProjectPath(scope.project));
    }

    // Initialize allowed groups set
    this.allowedGroupsSet = new Set((scope.groups ?? []).map(g => normalizeProjectPath(g)));

    // Add single group to set if specified
    if (scope.group) {
      this.allowedGroupsSet.add(normalizeProjectPath(scope.group));
    }

    logDebug("ScopeEnforcer initialized", {
      scope: getScopeDescription(scope),
      allowedProjectsCount: this.allowedProjectsSet.size,
      allowedGroupsCount: this.allowedGroupsSet.size,
      includeSubgroups: this.includeSubgroups,
    });
  }

  /**
   * Create a ScopeEnforcer from a ProjectPreset
   * Returns null if preset has no scope restrictions
   */
  static fromPreset(preset: ProjectPreset): ScopeEnforcer | null {
    if (!preset.scope) {
      return null;
    }
    return new ScopeEnforcer(preset.scope);
  }

  /**
   * Check if a project path is within the allowed scope
   *
   * @param projectPath Project path or ID to check (e.g., "group/project" or "123")
   * @returns true if allowed, false if outside scope
   */
  isAllowed(projectPath: string): boolean {
    // If no project restrictions are defined, allow all projects
    if (!this.hasProjectRestrictions()) {
      return true;
    }

    const normalized = normalizeProjectPath(projectPath);

    // Check explicit project list (includes single project from scope.project if set)
    if (this.allowedProjectsSet.size > 0 && this.allowedProjectsSet.has(normalized)) {
      return true;
    }

    // Check namespace
    if (this.scope.namespace && isInNamespace(projectPath, this.scope.namespace)) {
      return true;
    }

    // Check if project is within an allowed group (when group scope is set)
    if (this.allowedGroupsSet.size > 0) {
      for (const allowedGroup of this.allowedGroupsSet) {
        if (this.includeSubgroups) {
          // Project must be in group or its subgroups
          if (isInNamespace(projectPath, allowedGroup)) {
            return true;
          }
        } else {
          // Project must be directly in group (first-level only)
          const parts = normalized.split("/");
          if (parts.length >= 2) {
            const projectGroup = parts.slice(0, -1).join("/");
            if (projectGroup === allowedGroup) {
              return true;
            }
          }
        }
      }
    }

    // Check if numeric ID is in allowed projects (can't validate without API call)
    // For security, we deny numeric IDs unless they're in the explicit list
    if (/^\d+$/.test(normalized)) {
      logWarn("Numeric project ID not in allowed scope - denying access", {
        projectId: normalized,
      });
      return false;
    }

    return false;
  }

  /**
   * Check if a group path is within the allowed scope
   *
   * @param groupPath Group path or ID to check (e.g., "mygroup" or "parent/child")
   * @returns true if allowed, false if outside scope
   */
  isGroupAllowed(groupPath: string): boolean {
    // If no group restrictions are defined, allow all groups
    if (!this.hasGroupRestrictions()) {
      return true;
    }

    const normalized = normalizeProjectPath(groupPath);

    // Check explicit group list (includes single group from scope.group if set)
    if (this.allowedGroupsSet.size > 0 && this.allowedGroupsSet.has(normalized)) {
      return true;
    }

    // Check if group is a subgroup of an allowed group (when includeSubgroups is true)
    if (this.includeSubgroups && this.allowedGroupsSet.size > 0) {
      for (const allowedGroup of this.allowedGroupsSet) {
        if (isInNamespace(groupPath, allowedGroup)) {
          return true;
        }
      }
    }

    // Check namespace (groups in namespace are allowed)
    if (this.scope.namespace && isInNamespace(groupPath, this.scope.namespace)) {
      return true;
    }

    // Check if numeric ID is in allowed groups (can't validate without API call)
    // For security, we deny numeric IDs unless they're in the explicit list
    if (/^\d+$/.test(normalized)) {
      logWarn("Numeric group ID not in allowed scope - denying access", { groupId: normalized });
      return false;
    }

    return false;
  }

  /**
   * Enforce project scope restriction, throwing if violated
   *
   * @param projectPath Project path to check
   * @throws ScopeViolationError if outside allowed scope
   */
  enforce(projectPath: string): void {
    if (!this.isAllowed(projectPath)) {
      logWarn("Project scope violation attempted", {
        attempted: projectPath,
        scope: getScopeDescription(this.scope),
      });
      throw new ScopeViolationError(projectPath, this.scope);
    }
  }

  /**
   * Enforce group scope restriction, throwing if violated
   *
   * @param groupPath Group path to check
   * @throws ScopeViolationError if outside allowed scope
   */
  enforceGroup(groupPath: string): void {
    if (!this.isGroupAllowed(groupPath)) {
      logWarn("Group scope violation attempted", {
        attempted: groupPath,
        scope: getScopeDescription(this.scope),
      });
      throw new ScopeViolationError(groupPath, this.scope);
    }
  }

  /**
   * Get the scope configuration
   */
  getScope(): ScopeConfig {
    return this.scope;
  }

  /**
   * Get scope description for display
   */
  getScopeDescription(): string {
    return getScopeDescription(this.scope);
  }

  /**
   * Check if scope has any project restrictions
   */
  hasProjectRestrictions(): boolean {
    const hasProject = Boolean(this.scope.project);
    const hasNamespace = Boolean(this.scope.namespace);
    const hasProjects = Boolean(this.scope.projects && this.scope.projects.length > 0);
    const hasGroup = Boolean(this.scope.group);
    const hasGroups = Boolean(this.scope.groups && this.scope.groups.length > 0);
    // Groups also restrict projects (projects must be within allowed groups)
    return hasProject || hasNamespace || hasProjects || hasGroup || hasGroups;
  }

  /**
   * Check if scope has any group restrictions
   */
  hasGroupRestrictions(): boolean {
    const hasGroup = Boolean(this.scope.group);
    const hasNamespace = Boolean(this.scope.namespace);
    const hasGroups = Boolean(this.scope.groups && this.scope.groups.length > 0);
    return hasGroup || hasNamespace || hasGroups;
  }

  /**
   * Check if scope has any restrictions (projects or groups)
   */
  hasRestrictions(): boolean {
    return this.hasProjectRestrictions() || this.hasGroupRestrictions();
  }
}

/**
 * Extract project path from tool arguments
 *
 * Tools may specify project in different ways:
 * - project_id: "group/project" or "123"
 * - namespace: "group/project"
 * - projectId: "group/project"
 *
 * @param args Tool arguments object
 * @returns Array of project paths found in arguments
 */
export function extractProjectsFromArgs(args: Record<string, unknown>): string[] {
  const projects: string[] = [];

  // Common parameter names for project identification
  const projectFields = [
    "project_id",
    "projectId",
    "project",
    "namespace",
    "namespacePath",
    "fullPath",
  ];

  for (const field of projectFields) {
    const value = args[field];
    if (typeof value === "string" && value.trim()) {
      projects.push(value.trim());
    }
  }

  return projects;
}

/**
 * Extract group path from tool arguments
 *
 * Tools may specify group in different ways:
 * - group_id: "mygroup" or "parent/child" or "123"
 * - groupId: "mygroup"
 * - group: "mygroup"
 *
 * @param args Tool arguments object
 * @returns Array of group paths found in arguments
 */
export function extractGroupsFromArgs(args: Record<string, unknown>): string[] {
  const groups: string[] = [];

  // Common parameter names for group identification
  const groupFields = ["group_id", "groupId", "group"];

  for (const field of groupFields) {
    const value = args[field];
    if (typeof value === "string" && value.trim()) {
      groups.push(value.trim());
    }
  }

  return groups;
}

/**
 * Enforce scope on tool arguments
 *
 * Checks all project-related and group-related fields in arguments against the scope.
 *
 * @param enforcer ScopeEnforcer instance
 * @param args Tool arguments
 * @throws ScopeViolationError if any project or group is outside scope
 */
export function enforceArgsScope(enforcer: ScopeEnforcer, args: Record<string, unknown>): void {
  // Check project paths
  const projects = extractProjectsFromArgs(args);
  for (const project of projects) {
    enforcer.enforce(project);
  }

  // Check group paths
  const groups = extractGroupsFromArgs(args);
  for (const group of groups) {
    enforcer.enforceGroup(group);
  }
}
